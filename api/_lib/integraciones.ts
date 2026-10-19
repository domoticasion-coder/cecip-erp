import crypto from "node:crypto";
import { HttpError, supabaseAdmin } from "./core.js";

/**
 * Integraciones con n8n:
 *  - Facturación electrónica: el ERP manda cada factura "en cola" al webhook de n8n
 *    (N8N_FACTURAS_WEBHOOK_URL). n8n la emite en ARCA (WSFE) y devuelve el CAE en la misma
 *    respuesta o más tarde a /api/integraciones/facturas-callback.
 *  - Banco Santander: n8n consulta la API del banco y envía los movimientos a
 *    /api/integraciones/banco-movimientos (o los devuelve al pedir "Sincronizar").
 * Todas las llamadas entre el ERP y n8n llevan el header x-cecip-secret = N8N_SECRET.
 */

export const n8nConfig = () => ({
  facturas: process.env.N8N_FACTURAS_WEBHOOK_URL || "",
  banco: process.env.N8N_BANCO_WEBHOOK_URL || "",
  secreto: process.env.N8N_SECRET || "",
});


/** Verifica que la llamada venga de n8n (header x-cecip-secret) */
export function verificarSecreto(req: Request) {
  const esperado = n8nConfig().secreto;
  const recibido = req.headers.get("x-cecip-secret") || "";
  if (!esperado) throw new HttpError(503, "Falta configurar N8N_SECRET en el servidor.");
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, "Secreto inválido.");
}

async function llamarN8n(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cecip-secret": n8nConfig().secreto },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const texto = await res.text();
  let data: any = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = { texto }; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `n8n respondió ${res.status}`);
  return data;
}

// Códigos de ARCA (WSFE)
const CBTE_TIPO = { A: 1, B: 6, C: 11 } as const;
const IVA_RECEPTOR: Record<string, number> = { RI: 1, Exento: 4, "Consumidor final": 5, Monotributo: 6 };
const digitos = (t?: string | null) => (t || "").replace(/\D/g, "");

/** Normaliza fechas que n8n puede mandar como YYYYMMDD o YYYY-MM-DD */
const fechaIso = (v?: string | null) => {
  if (!v) return null;
  const d = String(v).replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
};

/** Envía a n8n las facturas en cola (o las indicadas, si están en cola o con error) */
export async function procesarFacturas(origin: string, ids?: string[]) {
  const sb = supabaseAdmin();
  const cfgN8n = n8nConfig();
  if (!cfgN8n.facturas) return { enviadas: 0, emitidas: 0, errores: 0, sinConfigurar: true };

  let q = sb.from("facturas").select("*").order("created_at").limit(300);
  q = ids?.length ? q.in("id", ids).in("estado", ["en_cola", "error"]) : q.eq("estado", "en_cola");
  const { data: facturas, error } = await q;
  if (error) throw new Error(error.message);
  if (!facturas?.length) return { enviadas: 0, emitidas: 0, errores: 0 };

  const { data: cfg } = await sb.from("configuracion")
    .select("nombre_institucion, cuit, direccion, factura_condicion_emisor, factura_punto_venta").eq("id", 1).single();

  // Período de servicio (ARCA lo pide para concepto "servicios")
  const cuotaIds = facturas.map((f) => f.cuota_id).filter(Boolean);
  const cargoIds = facturas.map((f) => f.cargo_id).filter(Boolean);
  const [{ data: cuotas }, { data: cargos }] = await Promise.all([
    cuotaIds.length ? sb.from("cuotas").select("id, periodo, periodo_hasta, vencimiento").in("id", cuotaIds) : Promise.resolve({ data: [] as any[] }),
    cargoIds.length ? sb.from("alquiler_cargos").select("id, periodo, vencimiento").in("id", cargoIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const finDeMes = (p: string) => { const d = new Date(p + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };

  // Facturación masiva: todas las facturas viajan en UN solo pedido (lote). n8n responde enseguida
  // (202) y las emite de a una en ARCA, en orden, avisando el resultado de cada una al callback.
  // Así el ERP no espera a ARCA (las funciones de Vercel tienen 60 s) y la numeración no se pisa.
  const emisor = {
    razon_social: cfg?.nombre_institucion, cuit: digitos(cfg?.cuit), domicilio: cfg?.direccion,
    condicion_iva: cfg?.factura_condicion_emisor, punto_venta: cfg?.factura_punto_venta,
  };
  const items = facturas.map((f) => {
    const ref = (cuotas || []).find((c: any) => c.id === f.cuota_id) || (cargos || []).find((c: any) => c.id === f.cargo_id);
    const cuit = digitos(f.receptor_cuit);
    return {
      factura: {
        id: f.id,
        tipo: f.tipo,
        cbte_tipo: CBTE_TIPO[f.tipo as keyof typeof CBTE_TIPO],
        punto_venta: f.punto_venta || cfg?.factura_punto_venta,
        fecha: f.fecha,
        concepto: f.concepto,
        concepto_arca: 2, // 2 = servicios
        servicio_desde: ref?.periodo || f.fecha,
        servicio_hasta: ref?.periodo ? finDeMes(ref.periodo_hasta || ref.periodo) : f.fecha,
        vencimiento_pago: f.fecha,
        moneda: "PES",
        neto: Number(f.neto),
        iva_alicuota: Number(f.iva_alicuota),
        iva: Number(f.iva),
        total: Number(f.total),
        origen: f.origen,
      },
      receptor: {
        nombre: f.receptor_nombre,
        doc_tipo: cuit.length === 11 ? 80 : 99, // 80 = CUIT · 99 = consumidor final sin identificar
        doc_nro: cuit.length === 11 ? cuit : "0",
        condicion_iva: f.receptor_condicion_iva,
        condicion_iva_id: IVA_RECEPTOR[f.receptor_condicion_iva] || 5,
        domicilio: f.receptor_domicilio,
        email: f.receptor_email,
      },
    };
  });

  const ids_lote = facturas.map((f) => f.id);
  let enviadas = 0, emitidas = 0, errores = 0;
  try {
    const r = await llamarN8n(cfgN8n.facturas, {
      evento: "emitir_lote",
      callback_url: `${origin}/api/integraciones/facturas-callback`,
      emisor,
      facturas: items,
    });
    enviadas = items.length;
    const ahora = new Date().toISOString();
    for (const f of facturas) {
      await sb.from("facturas").update({ estado: "enviada", error: null, intentos: f.intentos + 1, enviada_at: ahora }).eq("id", f.id);
    }
    // Si n8n respondió los resultados en el momento (modo sincrónico), se registran ya
    for (const res of Array.isArray(r?.resultados) ? r.resultados : []) {
      const reg = await registrarResultadoFactura(res).catch(() => null);
      if (reg?.estado === "emitida") emitidas++;
      else if (reg?.estado === "error") errores++;
    }
  } catch (e) {
    errores = ids_lote.length;
    for (const f of facturas) {
      await sb.from("facturas").update({ estado: "error", error: (e as Error).message.slice(0, 500), intentos: f.intentos + 1 }).eq("id", f.id);
    }
  }
  return { enviadas, emitidas, errores };
}

/** Resultado que devuelve n8n después de emitir en ARCA */
export async function registrarResultadoFactura(body: any) {
  const id = String(body?.factura_id || body?.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Falta factura_id.");
  const sb = supabaseAdmin();
  const { data: f } = await sb.from("facturas").select("id, estado").eq("id", id).maybeSingle();
  if (!f) throw new HttpError(404, "Factura inexistente.");
  if (f.estado === "emitida" || f.estado === "anulada") return { ok: true, sinCambios: true };

  const cambios = body?.cae
    ? {
        estado: "emitida", cae: String(body.cae), cae_vencimiento: fechaIso(body.cae_vencimiento),
        numero: body.numero ? Number(body.numero) : null, pdf_url: body.pdf_url || null, error: null,
        emitida_at: new Date().toISOString(), respuesta: body,
      }
    : { estado: "error", error: String(body?.error || "ARCA no devolvió CAE").slice(0, 500), respuesta: body };
  const { error } = await sb.from("facturas").update(cambios).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, estado: cambios.estado };
}

export interface MovimientoBanco {
  id?: string;
  fecha?: string;
  descripcion?: string;
  monto?: number | string;
  saldo?: number | string | null;
  referencia?: string | null;
  contraparte_nombre?: string | null;
  contraparte_cuit?: string | null;
}

const numero = (v: unknown) => {
  if (typeof v === "number") return v;
  const t = String(v ?? "").trim();
  // Acepta 1234.56, 1.234,56 y -1234,56
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
};

/** Guarda movimientos del banco sin duplicar (por banco + id del movimiento) */
export async function guardarMovimientosBanco(movs: MovimientoBanco[], banco = "Santander") {
  if (!Array.isArray(movs)) throw new HttpError(400, "Se esperaba una lista de movimientos.");
  const sb = supabaseAdmin();
  const { data: cuenta } = await sb.from("cuentas").select("id").eq("nombre", `Banco ${banco}`).maybeSingle();
  const filas = movs
    .map((m) => {
      const monto = numero(m.monto);
      const fecha = fechaIso(m.fecha);
      if (!fecha || !Number.isFinite(monto) || monto === 0) return null;
      const descripcion = String(m.descripcion || "Movimiento").slice(0, 300);
      const idExterno = String(m.id || crypto.createHash("sha1").update(`${fecha}|${monto}|${descripcion}|${m.referencia || ""}`).digest("hex"));
      return {
        banco, cuenta_id: cuenta?.id || null, id_externo: idExterno.slice(0, 120), fecha, descripcion, monto,
        saldo: m.saldo === null || m.saldo === undefined || m.saldo === "" ? null : numero(m.saldo),
        referencia: m.referencia ? String(m.referencia).slice(0, 120) : null,
        contraparte_nombre: m.contraparte_nombre ? String(m.contraparte_nombre).slice(0, 200) : null,
        contraparte_cuit: m.contraparte_cuit ? String(m.contraparte_cuit).slice(0, 20) : null,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];
  if (!filas.length) return { recibidos: movs.length, nuevos: 0 };
  const { data, error } = await sb.from("banco_movimientos")
    .upsert(filas, { onConflict: "banco,id_externo", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(error.message);
  return { recibidos: movs.length, nuevos: data?.length || 0 };
}

/** Pide a n8n que traiga los movimientos del banco */
export async function sincronizarBanco(origin: string, desde: string, hasta: string) {
  const url = n8nConfig().banco;
  if (!url) throw new HttpError(503, "Falta configurar N8N_BANCO_WEBHOOK_URL (flujo de n8n con la API de Santander).");
  const r = await llamarN8n(url, {
    evento: "sincronizar_movimientos", banco: "Santander", desde, hasta,
    callback_url: `${origin}/api/integraciones/banco-movimientos`,
  });
  if (Array.isArray(r?.movimientos)) return await guardarMovimientosBanco(r.movimientos, r.banco || "Santander");
  return { recibidos: 0, nuevos: 0, pendiente: true };
}
