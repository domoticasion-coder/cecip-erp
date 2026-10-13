import { env, pesos, supabaseAdmin } from "./core.js";
import { emailLayout, emailValido, escapeHtml, sendEmails, textToHtml, type EmailMessage } from "./email.js";
import { crearLinkPago } from "./pagos.js";

/** Ejecuta fn sobre items con un máximo de "limite" tareas simultáneas */
async function enParalelo<T>(items: T[], limite: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker));
}

const fecha = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-AR");

/**
 * Envía a cada socio un email con el detalle de sus cuotas pendientes y un link de pago
 * de Mercado Pago. Registra cada envío en la tabla "envios".
 */
export async function enviarRecordatorios(
  socioIds: string[],
  opts: { createdBy: string | null; soloCuotas?: Record<string, string[]> } = { createdBy: null }
): Promise<{ enviados: number; errores: { socio: string; error: string }[] }> {
  const sb = supabaseAdmin();
  const errores: { socio: string; error: string }[] = [];
  const mensajes: (EmailMessage & { socioId: string; cuotaIds: string[] })[] = [];

  const { data: socios } = await sb
    .from("socios")
    .select("id, razon_social, nombre_comercial, email")
    .in("id", socioIds);

  const { data: cfg } = await sb.from("configuracion").select("*").eq("id", 1).single();

  // Se procesan varios socios en paralelo (cada uno crea su link en Mercado Pago)
  await enParalelo(socios || [], 8, async (s) => {
    const nombre = s.nombre_comercial || s.razon_social;
    if (!emailValido(s.email)) {
      errores.push({ socio: nombre, error: "Sin email válido" });
      return;
    }

    let q = sb.from("cuotas_detalle").select("id, concepto, vencimiento, total, situacion")
      .eq("socio_id", s.id).eq("estado", "pendiente").order("vencimiento");
    const filtro = opts.soloCuotas?.[s.id];
    if (filtro) q = q.in("id", filtro);
    const { data: cuotas } = await q;
    if (!cuotas || cuotas.length === 0) return;

    let linkUrl: string | null = null;
    try {
      linkUrl = (await crearLinkPago(s.id, cuotas.map((c) => c.id), opts.createdBy)).url;
    } catch (err) {
      // Si Mercado Pago falla igual se envía el recordatorio con los datos de transferencia
      console.error("Link MP:", err);
    }

    const total = cuotas.reduce((a, c) => a + Number(c.total), 0);
    const vencidas = cuotas.some((c) => c.situacion === "vencida");
    const filas = cuotas
      .map((c) => `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0">${escapeHtml(c.concepto)}${c.situacion === "vencida" ? ' <span style="color:#b91c1c">(vencida)</span>' : ""}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0">${fecha(c.vencimiento)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #e2e8f0">${pesos(Number(c.total))}</td></tr>`)
      .join("");

    const transferencia = cfg?.cbu || cfg?.alias
      ? `<p style="margin:16px 0 0;font-size:13px;color:#475569">También podés pagar por transferencia:<br>${cfg.banco ? `Banco: ${escapeHtml(cfg.banco)}<br>` : ""}${cfg.titular ? `Titular: ${escapeHtml(cfg.titular)}<br>` : ""}${cfg.cbu ? `CBU: ${cfg.cbu}<br>` : ""}${cfg.alias ? `Alias: ${cfg.alias}` : ""}<br>Enviá el comprobante respondiendo este correo.</p>`
      : "";

    const html = emailLayout({
      titulo: vencidas ? "Tenés cuotas vencidas" : "Recordatorio de cuota social",
      cuerpoHtml:
        textToHtml(`Hola ${nombre},\n\nTe recordamos el detalle de tu cuenta con el Centro Comercial e Industrial de Paraná:`) +
        `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 12px"><tr style="color:#64748b;font-size:12px"><td>Concepto</td><td>Vencimiento</td><td align="right">Importe</td></tr>${filas}<tr><td colspan="2" style="padding-top:10px"><b>Total</b></td><td align="right" style="padding-top:10px"><b>${pesos(total)}</b></td></tr></table>` +
        transferencia,
      boton: linkUrl ? { texto: "Pagar con Mercado Pago", url: linkUrl } : { texto: "Ver mi cuenta", url: `${env.portalUrl()}/cuotas` },
      pie: "Si ya realizaste el pago, desestimá este mensaje.",
    });

    mensajes.push({
      to: s.email!.trim(),
      subject: vencidas ? `CeCIP: cuotas vencidas por ${pesos(total)}` : `CeCIP: recordatorio de cuota (${pesos(total)})`,
      html,
      socioId: s.id,
      cuotaIds: cuotas.map((c) => c.id),
    });
  });

  const resultados = mensajes.length ? await sendEmails(mensajes) : [];
  let enviados = 0;
  const logs = resultados.map((r, i) => {
    const m = mensajes[i];
    if (r.ok) enviados++;
    else errores.push({ socio: m.to, error: r.error || "Error" });
    return {
      socio_id: m.socioId,
      canal: "email",
      tipo: "recordatorio",
      asunto: m.subject,
      destinatario: m.to,
      estado: r.ok ? "enviado" : "error",
      error: r.error || null,
      created_by: opts.createdBy,
    };
  });
  if (logs.length) await sb.from("envios").insert(logs);

  const okIds = mensajes.filter((_, i) => resultados[i]?.ok).flatMap((m) => m.cuotaIds);
  if (okIds.length) {
    await sb.from("cuotas").update({ ultimo_recordatorio: new Date().toISOString() }).in("id", okIds);
  }

  return { enviados, errores };
}
