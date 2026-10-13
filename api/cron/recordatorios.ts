import { handle, json, supabaseAdmin } from "../_lib/core.js";
import { enviarRecordatorios } from "../_lib/cobranza.js";

/**
 * GET /api/cron/recordatorios — lo ejecuta Vercel Cron una vez por día (ver vercel.json).
 * Si en Configuración están activados los recordatorios automáticos:
 *  - avisa a quienes tienen una cuota que vence en "dias_aviso" días (una sola vez), y
 *  - a quienes tienen cuotas vencidas, como máximo una vez cada 7 días.
 */
export const GET = handle(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "No autorizado" }, 401);
  }

  const sb = supabaseAdmin();
  const { data: cfg } = await sb.from("configuracion").select("recordatorios_auto, dias_aviso").eq("id", 1).single();
  if (!cfg?.recordatorios_auto) return json({ ok: true, desactivado: true });

  const hoy = new Date();
  const objetivo = new Date(hoy.getTime() + cfg.dias_aviso * 86400000).toISOString().slice(0, 10);
  const haceUnaSemana = new Date(hoy.getTime() - 7 * 86400000).toISOString();

  const [{ data: porVencer }, { data: vencidas }] = await Promise.all([
    sb.from("cuotas").select("id, socio_id").eq("estado", "pendiente").eq("vencimiento", objetivo).is("ultimo_recordatorio", null),
    sb.from("cuotas").select("id, socio_id").eq("estado", "pendiente").lt("vencimiento", hoy.toISOString().slice(0, 10))
      .or(`ultimo_recordatorio.is.null,ultimo_recordatorio.lt.${haceUnaSemana}`),
  ]);

  const socios = [...new Set([...(porVencer || []), ...(vencidas || [])].map((c) => c.socio_id))];
  if (socios.length === 0) return json({ ok: true, enviados: 0 });

  const result = await enviarRecordatorios(socios, { createdBy: null });
  return json({ ok: true, ...result });
});
