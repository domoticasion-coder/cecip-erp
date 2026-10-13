import { HttpError, getCaller, handle, json, readJson, requireStaff } from "../_lib/core.js";
import { variantesGemini } from "../_lib/copilot.js";

/**
 * POST /api/comunicaciones/variantes { mensaje, cantidad? }
 * Devuelve reescrituras del mensaje (IA) para que cada socio reciba un WhatsApp distinto.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["atencion", "tesoreria"]);
  const { mensaje, cantidad } = await readJson<{ mensaje?: string; cantidad?: number }>(req);
  if (!mensaje?.trim()) throw new HttpError(400, "Escribí el mensaje base.");
  const variantes = await variantesGemini(mensaje.trim(), cantidad || 6);
  if (!variantes.length) throw new HttpError(502, "La IA no pudo generar variantes. Probá de nuevo.");
  return json({ variantes });
});
