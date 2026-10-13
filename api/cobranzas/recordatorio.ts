import { HttpError, getCaller, handle, json, readJson, requireStaff } from "../_lib/core.js";
import { enviarRecordatorios } from "../_lib/cobranza.js";

/**
 * POST /api/cobranzas/recordatorio { socio_ids, cuota_ids? }
 * Envía por email el estado de deuda con link de pago de Mercado Pago.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["tesoreria", "atencion"]);

  const { socio_ids, cuota_ids } = await readJson<{ socio_ids?: string[]; cuota_ids?: string[] }>(req);
  if (!socio_ids?.length) throw new HttpError(400, "Indicá al menos un socio.");
  if (socio_ids.length > 500) throw new HttpError(400, "Máximo 500 socios por envío.");

  const soloCuotas = cuota_ids?.length && socio_ids.length === 1 ? { [socio_ids[0]]: cuota_ids } : undefined;
  const result = await enviarRecordatorios(socio_ids, { createdBy: caller.userId, soloCuotas });
  return json(result);
});
