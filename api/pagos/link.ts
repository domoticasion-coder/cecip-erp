import { HttpError, getCaller, handle, json, readJson } from "../_lib/core.js";
import { crearLinkPago } from "../_lib/pagos.js";

/**
 * POST /api/pagos/link  { socio_id, cuota_ids? }
 * Lo usa el personal (para enviar por WhatsApp/email) y el socio desde el portal (botón "Pagar").
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  const body = await readJson<{ socio_id?: string; cuota_ids?: string[] }>(req);

  if (caller.staff?.rol === "comercia") throw new HttpError(403, "El equipo de ComercIA no gestiona cobros de socios.");
  const socioId = caller.staff ? body.socio_id : caller.socioId;
  if (!socioId) throw new HttpError(403, "No tenés un socio asociado a tu usuario.");
  if (!caller.staff && body.socio_id && body.socio_id !== caller.socioId) {
    throw new HttpError(403, "No podés generar pagos de otro socio.");
  }

  const link = await crearLinkPago(socioId, body.cuota_ids?.length ? body.cuota_ids : null, caller.userId);
  return json(link);
});
