import { HttpError, getCaller, handle, json, readJson } from "../_lib/core.js";
import { procesarPagoMP } from "../_lib/pagos.js";

/**
 * POST /api/pagos/verificar { payment_id }
 * Cuando el socio vuelve de Mercado Pago, el portal pide verificar el pago al instante
 * (por si el webhook todavía no llegó). Es seguro: el estado se consulta a Mercado Pago.
 */
export const POST = handle(async (req) => {
  await getCaller(req);
  const { payment_id } = await readJson<{ payment_id?: string }>(req);
  if (!payment_id || !/^\d+$/.test(String(payment_id))) throw new HttpError(400, "payment_id inválido.");
  return json(await procesarPagoMP(String(payment_id)));
});
