import { HttpError, getCaller, handle, json, readJson, requireStaff, supabaseAdmin } from "./_lib/core.js";
import { contextoSocio, preguntarGemini, type Mensaje } from "./_lib/copilot.js";
import { armarContextoErp, INSTRUCCIONES_ERP } from "../shared/copilotErp.js";

/**
 * POST /api/copilot { pregunta, historial?, ambito? }
 * Copiloto CeCIP (Gemini).
 *  - ambito "portal" (por defecto): socios aprobados del portal (y personal, para probarlo).
 *  - ambito "erp": personal del ERP, con los datos de gestión que permite su rol.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  const { pregunta, historial, ambito } = await readJson<{ pregunta?: string; historial?: Mensaje[]; ambito?: string }>(req);
  const p = pregunta?.trim();
  if (!p) throw new HttpError(400, "Escribí tu consulta.");
  if (p.length > 4000) throw new HttpError(400, "La consulta es demasiado larga.");
  const hist = Array.isArray(historial) ? historial : [];

  if (ambito === "erp") {
    requireStaff(caller);
    // Para traer el detalle de los socios mencionados se mira la pregunta y las últimas del usuario
    const busqueda = [p, ...hist.filter((m) => m.rol === "usuario").slice(-2).map((m) => String(m.texto || ""))].join(" ").slice(0, 2000);
    const { data, error } = await supabaseAdmin().rpc("datos_copiloto_erp", { p_rol: caller.staff!.rol, p_busqueda: busqueda });
    if (error) throw new HttpError(500, /datos_copiloto_erp/.test(error.message) ? "Falta ejecutar la migración 009_copiloto_erp.sql en Supabase." : error.message);
    const contexto = armarContextoErp(data, { nombre: caller.staff!.nombre, rol: caller.staff!.rol });
    return json({ respuesta: await preguntarGemini(contexto, hist, p, INSTRUCCIONES_ERP) });
  }

  if (!caller.socioId && !caller.staff) throw new HttpError(403, "El Copiloto está disponible para socios con acceso aprobado.");
  if (p.length > 1500) throw new HttpError(400, "La consulta es demasiado larga.");
  const contexto = await contextoSocio(caller.socioId);
  return json({ respuesta: await preguntarGemini(contexto, hist, p) });
});
