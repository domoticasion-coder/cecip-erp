import { HttpError, getCaller, handle, json, readJson } from "./_lib/core.js";
import { contextoSocio, preguntarGemini, type Mensaje } from "./_lib/copilot.js";

/**
 * POST /api/copilot { pregunta, historial? }
 * Copiloto CeCIP (Gemini) para socios aprobados del portal (y personal, para probarlo).
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  if (!caller.socioId && !caller.staff) throw new HttpError(403, "El Copiloto está disponible para socios con acceso aprobado.");

  const { pregunta, historial } = await readJson<{ pregunta?: string; historial?: Mensaje[] }>(req);
  const p = pregunta?.trim();
  if (!p) throw new HttpError(400, "Escribí tu consulta.");
  if (p.length > 1500) throw new HttpError(400, "La consulta es demasiado larga.");

  const contexto = await contextoSocio(caller.socioId);
  const respuesta = await preguntarGemini(contexto, Array.isArray(historial) ? historial : [], p);
  return json({ respuesta });
});
