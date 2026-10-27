import { HttpError, env, supabaseAdmin } from "./core.js";

const MP_API = "https://api.mercadopago.com";
const VIGENCIA_DIAS = 5;

function mpToken(): string {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new HttpError(500, "Mercado Pago no está configurado (MP_ACCESS_TOKEN).");
  return t;
}

export async function mpFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mpToken()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, `Mercado Pago respondió ${res.status}: ${body?.message || JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

export interface LinkPago {
  id: string;
  url: string;
  total: number;
  cuotas: number;
}

/**
 * Crea (o reutiliza, si ya existe uno de hoy para las mismas cuotas) un link de pago
 * de Mercado Pago. Si no se indican cuotas, incluye toda la deuda pendiente del socio.
 */
export async function crearLinkPago(socioId: string, cuotaIds: string[] | null, createdBy: string | null): Promise<LinkPago> {
  const sb = supabaseAdmin();

  let q = sb
    .from("cuotas_detalle")
    .select("id, concepto, total, socio_id, socio_email")
    .eq("socio_id", socioId)
    .eq("estado", "pendiente")
    .order("vencimiento");
  if (cuotaIds && cuotaIds.length) q = q.in("id", cuotaIds);

  const { data: cuotas, error } = await q;
  if (error) throw new HttpError(500, error.message);
  if (!cuotas || cuotas.length === 0) throw new HttpError(400, "No hay cuotas pendientes para cobrar.");

  const items = cuotas.map((c) => ({ cuota_id: c.id, concepto: c.concepto, monto: Number(c.total) }));
  const total = Math.round(items.reduce((s, i) => s + i.monto, 0) * 100) / 100;
  const ids = items.map((i) => i.cuota_id).sort();

  // Reutilizar un link activo creado hoy con exactamente las mismas cuotas y el mismo total
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const { data: existentes } = await sb
    .from("links_pago")
    .select("id, url, total, items, expira_at")
    .eq("socio_id", socioId)
    .eq("estado", "activo")
    .gte("created_at", hoy.toISOString());
  const reuse = (existentes || []).find((l) => {
    const lids = (l.items as { cuota_id: string }[]).map((i) => i.cuota_id).sort();
    return (
      l.url && Number(l.total) === total && new Date(l.expira_at) > new Date() &&
      lids.length === ids.length && lids.every((v, i) => v === ids[i])
    );
  });
  if (reuse) return { id: reuse.id, url: reuse.url!, total, cuotas: items.length };

  const expira = new Date(Date.now() + VIGENCIA_DIAS * 24 * 3600 * 1000);
  const { data: link, error: e2 } = await sb
    .from("links_pago")
    .insert({ socio_id: socioId, items, total, expira_at: expira.toISOString(), created_by: createdBy })
    .select("id")
    .single();
  if (e2 || !link) throw new HttpError(500, e2?.message || "No se pudo crear el link.");

  const portal = env.portalUrl();
  const webhookBase = env.erpUrl();
  const preference: Record<string, unknown> = {
    items: items.map((i) => ({
      id: i.cuota_id,
      title: `CeCIP - ${i.concepto}`,
      quantity: 1,
      unit_price: i.monto,
      currency_id: "ARS",
    })),
    external_reference: link.id,
    statement_descriptor: "CECIP PARANA",
    expires: true,
    expiration_date_to: expira.toISOString(),
    back_urls: {
      success: `${portal}/cuotas?pago=ok`,
      pending: `${portal}/cuotas?pago=pendiente`,
      failure: `${portal}/cuotas?pago=error`,
    },
    auto_return: "approved",
  };
  if (webhookBase.startsWith("https://")) {
    preference.notification_url = `${webhookBase}/api/pagos/webhook`;
  }
  if (cuotas[0].socio_email) preference.payer = { email: cuotas[0].socio_email };

  let pref: any;
  try {
    pref = await mpFetch("/checkout/preferences", { method: "POST", body: JSON.stringify(preference) });
  } catch (err) {
    // Si Mercado Pago no respondió (o no está configurado) no queda un link sin URL registrado
    await sb.from("links_pago").delete().eq("id", link.id);
    throw err;
  }

  await sb.from("links_pago").update({ mp_preference_id: pref.id, url: pref.init_point }).eq("id", link.id);
  return { id: link.id, url: pref.init_point, total, cuotas: items.length };
}

/**
 * Procesa un pago de Mercado Pago (consultándolo directamente a la API de MP, así no se puede
 * falsificar). Si está aprobado, registra el cobro de cada cuota del link. Es idempotente.
 */
export async function procesarPagoMP(paymentId: string): Promise<{ estado: string; detalle?: string }> {
  const sb = supabaseAdmin();
  const pago = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);

  const linkId: string | undefined = pago.external_reference;
  if (!linkId) return { estado: "ignorado", detalle: "Pago sin referencia CeCIP" };

  const { data: link } = await sb.from("links_pago").select("*").eq("id", linkId).maybeSingle();
  if (!link) return { estado: "ignorado", detalle: "Link inexistente" };

  if (pago.status !== "approved") return { estado: pago.status };
  if (link.estado === "pagado") return { estado: "ya_procesado" };

  const pagado = Number(pago.transaction_amount);
  if (pagado + 0.01 < Number(link.total)) {
    return { estado: "monto_insuficiente", detalle: `Pagó ${pagado} de ${link.total}` };
  }

  const fecha = (pago.date_approved || new Date().toISOString()).slice(0, 10);
  for (const item of link.items as { cuota_id: string; monto: number }[]) {
    const { error } = await sb.rpc("registrar_pago", {
      p_cuota_id: item.cuota_id,
      p_metodo: "Mercado Pago",
      p_cuenta_id: null,
      p_fecha: fecha,
      p_referencia: `MP ${paymentId}`,
      p_monto: item.monto,
    });
    if (error && !/pagada|anulada/i.test(error.message)) throw new HttpError(500, error.message);
  }

  await sb.from("links_pago").update({ estado: "pagado", mp_payment_id: String(paymentId) }).eq("id", linkId);
  return { estado: "acreditado" };
}
