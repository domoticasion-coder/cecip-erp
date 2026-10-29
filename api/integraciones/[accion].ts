import { HttpError, getCaller, handle, json, readJson, requireStaff } from "../_lib/core.js";
import {
  guardarMovimientosBanco, n8nConfig, procesarFacturas, registrarResultadoFactura, sincronizarBanco, verificarSecreto,
} from "../_lib/integraciones.js";
import { cancelarPendientes, cupoRestante, limitesDiarios, procesarCola, reintentarErrores, usadosHoy } from "../_lib/colaEmails.js";

/**
 * Un solo endpoint para las integraciones con n8n (así no se suman funciones en Vercel):
 *
 *  Desde el ERP (con la sesión del personal):
 *   GET  /api/integraciones/estado              -> qué está configurado
 *   POST /api/integraciones/facturas-procesar   { ids? }  -> envía a n8n las facturas en cola
 *   POST /api/integraciones/banco-sincronizar   { desde, hasta } -> pide a n8n los movimientos
 *   GET  /api/integraciones/cola-emails         -> cupo diario de emails y lo que queda en cola
 *   POST /api/integraciones/cola-emails-procesar          -> envía ahora lo que entre en el cupo de hoy
 *   POST /api/integraciones/cola-emails-cancelar { lote_id? } -> cancela lo que todavía no salió
 *   POST /api/integraciones/cola-emails-reintentar { lote_id? } -> vuelve a poner en cola los que fallaron
 *
 *  Desde n8n (header x-cecip-secret = N8N_SECRET):
 *   POST /api/integraciones/facturas-callback   { factura_id, cae, cae_vencimiento, numero, pdf_url } | { factura_id, error }
 *   POST /api/integraciones/banco-movimientos   { banco?, movimientos: [{ id, fecha, descripcion, monto, saldo, referencia, ... }] }
 */
const accion = (req: Request) => new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";

export const GET = handle(async (req) => {
  if (accion(req) === "cola-emails") {
    requireStaff(await getCaller(req), ["atencion", "tesoreria", "prensa"]);
    const { limite, cola } = limitesDiarios();
    return json({ limite_diario: limite, cupo_cola: cola, usados_hoy: await usadosHoy(), cupo_restante: await cupoRestante() });
  }
  if (accion(req) !== "estado") throw new HttpError(404, "Acción inexistente.");
  const caller = await getCaller(req);
  requireStaff(caller, ["tesoreria"]);
  const cfg = n8nConfig();
  const origin = new URL(req.url).origin;
  return json({
    facturas: Boolean(cfg.facturas),
    banco: Boolean(cfg.banco),
    secreto: Boolean(cfg.secreto),
    callback_facturas: `${origin}/api/integraciones/facturas-callback`,
    endpoint_banco: `${origin}/api/integraciones/banco-movimientos`,
  });
});

export const POST = handle(async (req) => {
  const origin = new URL(req.url).origin;
  switch (accion(req)) {
    case "facturas-procesar": {
      const caller = await getCaller(req);
      requireStaff(caller, ["tesoreria"]);
      const body = await readJson<{ ids?: string[] }>(req).catch(() => ({} as { ids?: string[] }));
      return json(await procesarFacturas(origin, body.ids));
    }
    case "banco-sincronizar": {
      const caller = await getCaller(req);
      requireStaff(caller, ["tesoreria"]);
      const body = await readJson<{ desde?: string; hasta?: string }>(req);
      const hoy = new Date().toISOString().slice(0, 10);
      const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      return json(await sincronizarBanco(origin, body.desde || hace30, body.hasta || hoy));
    }
    case "facturas-callback": {
      verificarSecreto(req);
      return json(await registrarResultadoFactura(await readJson(req)));
    }
    case "banco-movimientos": {
      verificarSecreto(req);
      const body = await readJson<{ banco?: string; movimientos?: unknown[] }>(req);
      return json(await guardarMovimientosBanco((body.movimientos || []) as any[], body.banco || "Santander"));
    }
    case "cola-emails-procesar": {
      requireStaff(await getCaller(req), ["atencion", "tesoreria", "prensa"]);
      return json(await procesarCola());
    }
    case "cola-emails-cancelar": {
      requireStaff(await getCaller(req), ["atencion", "tesoreria", "prensa"]);
      const body = await readJson<{ lote_id?: string }>(req).catch(() => ({} as { lote_id?: string }));
      return json({ cancelados: await cancelarPendientes(body.lote_id) });
    }
    case "cola-emails-reintentar": {
      requireStaff(await getCaller(req), ["atencion", "tesoreria", "prensa"]);
      const body = await readJson<{ lote_id?: string }>(req).catch(() => ({} as { lote_id?: string }));
      return json(await reintentarErrores(body.lote_id));
    }
    default:
      throw new HttpError(404, "Acción inexistente.");
  }
});
