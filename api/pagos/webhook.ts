import crypto from "node:crypto";
import { handle, json } from "../_lib/core.js";
import { procesarPagoMP } from "../_lib/pagos.js";

/**
 * POST /api/pagos/webhook  — notificaciones de Mercado Pago.
 * Formatos soportados: { type: "payment", data: { id } } o ?topic=payment&id=...
 * El pago se consulta siempre a la API de MP, así que una notificación falsa no puede acreditar nada.
 */
export const POST = handle(async (req) => {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as any));

  const type = body?.type || body?.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const paymentId = String(body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");

  if (type !== "payment" || !paymentId) return json({ ok: true, ignorado: true });

  // Validación opcional de firma (Mercado Pago > Webhooks > Clave secreta). Si la notificación
  // trae firma y no coincide se rechaza; igualmente el pago siempre se verifica contra la API de MP.
  const secret = process.env.MP_WEBHOOK_SECRET;
  const sig = req.headers.get("x-signature") || "";
  if (secret && sig) {
    const requestId = req.headers.get("x-request-id") || "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=") as [string, string]));
    const dataId = (url.searchParams.get("data.id") || paymentId).toLowerCase();
    const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (!parts.v1 || parts.v1 !== expected) {
      return json({ error: "Firma inválida" }, 401);
    }
  }

  const result = await procesarPagoMP(paymentId);
  return json({ ok: true, ...result });
});

// Mercado Pago a veces verifica la URL con GET
export const GET = () => json({ ok: true });
