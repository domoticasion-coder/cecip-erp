import { HttpError, env, getCaller, handle, json, pesos, readJson, requireStaff, supabaseAdmin } from "../_lib/core.js";
import { emailLayout, emailValido, sendEmails, textToHtml } from "../_lib/email.js";
import { encolarEmails } from "../_lib/colaEmails.js";

/**
 * POST /api/comunicaciones/enviar { socio_ids, asunto, cuerpo, comunicado_id?, imagen_url? }
 * Envío masivo de emails (pasa por la cola con cupo diario). Variables: {{nombre}}, {{deuda}}.
 *
 * POST /api/comunicaciones/enviar { para, asunto, cuerpo, imagen_url? }
 * Email individual a una o más direcciones escritas a mano (separadas por coma), sin socio asociado.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["atencion", "tesoreria", "prensa"]);

  const body = await readJson<{ socio_ids?: string[]; para?: string; asunto?: string; cuerpo?: string; comunicado_id?: string; imagen_url?: string | null }>(req);
  const asunto = body.asunto?.trim();
  const cuerpo = body.cuerpo?.trim();
  if (body.para !== undefined) return json(await enviarIndividual(body.para, asunto, cuerpo, body.imagen_url, caller.userId));
  if (!body.socio_ids?.length) throw new HttpError(400, "Elegí al menos un destinatario.");
  if (!asunto || !cuerpo) throw new HttpError(400, "Completá asunto y mensaje.");
  if (body.socio_ids.length > 1000) throw new HttpError(400, "Máximo 1000 destinatarios por envío.");

  const sb = supabaseAdmin();
  const { data: socios, error } = await sb
    .from("socios_resumen")
    .select("id, razon_social, nombre_comercial, email, emails_extra, deuda")
    .in("id", body.socio_ids);
  if (error) throw new HttpError(500, error.message);

  const sinEmail = (socios || []).filter((s) => !emailValido(s.email));
  const conEmail = (socios || []).filter((s) => emailValido(s.email));

  const reemplazar = (t: string, s: (typeof conEmail)[number]) =>
    t.replace(/\{\{\s*nombre\s*\}\}/gi, s.nombre_comercial || s.razon_social)
     .replace(/\{\{\s*deuda\s*\}\}/gi, pesos(Number(s.deuda || 0)));

  const mensajes = conEmail.map((s) => ({
    to: s.email!.trim(),
    // Los otros emails de la empresa reciben copia
    cc: (s.emails_extra || "").split(/[\s,;]+/).map((e: string) => e.trim()).filter((e: string) => emailValido(e) && e !== s.email!.trim()).slice(0, 5),
    subject: reemplazar(asunto, s),
    text: reemplazar(cuerpo, s),
    html: emailLayout({
      titulo: reemplazar(asunto, s),
      cuerpoHtml: textToHtml(reemplazar(cuerpo, s)),
      imagenUrl: body.imagen_url,
      boton: { texto: "Ingresar al portal de socios", url: env.portalUrl() + (body.comunicado_id ? "/comunicados" : "") },
    }),
  }));

  const tipo = body.comunicado_id ? "comunicado" : "manual";
  if (sinEmail.length) {
    await sb.from("envios").insert(sinEmail.map((s) => ({
      socio_id: s.id, comunicado_id: body.comunicado_id || null, canal: "email", tipo, asunto, destinatario: null,
      estado: "error", error: "Socio sin email válido", created_by: caller.userId,
    })));
  }

  // Se encola todo: sale ya lo que entra en el cupo diario y el resto en los días siguientes
  const r = await encolarEmails(mensajes.map((m, i) => ({
    ...m, tipo, socio_id: conEmail[i].id, comunicado_id: body.comunicado_id || null,
  })), caller.userId);

  return json({
    ...r,
    errores: [...r.errores, ...sinEmail.map((s) => ({ socio: s.nombre_comercial || s.razon_social, error: "Sin email válido" }))],
  });
});

/** Email individual: direcciones escritas a mano, se envía directo (sin la cola de n8n) */
async function enviarIndividual(para: string, asunto: string | undefined, cuerpo: string | undefined, imagenUrl: string | null | undefined, userId: string) {
  const direcciones = [...new Set(String(para || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!direcciones.length) throw new HttpError(400, "Escribí el email del destinatario.");
  const invalidas = direcciones.filter((e) => !emailValido(e));
  if (invalidas.length) throw new HttpError(400, `Email inválido: ${invalidas.join(", ")}`);
  if (direcciones.length > 20) throw new HttpError(400, "Máximo 20 direcciones. Para más, usá el email masivo.");
  if (!asunto || !cuerpo) throw new HttpError(400, "Completá asunto y mensaje.");

  const html = emailLayout({ titulo: asunto, cuerpoHtml: textToHtml(cuerpo), imagenUrl });
  const resultados = await sendEmails(direcciones.map((to) => ({ to, subject: asunto, text: cuerpo, html })));

  await supabaseAdmin().from("envios").insert(resultados.map((r) => ({
    socio_id: null, comunicado_id: null, canal: "email", tipo: "manual", asunto, destinatario: r.to,
    estado: r.ok ? "enviado" : "error", error: r.error || null, created_by: userId,
  })));

  return {
    enviados: resultados.filter((r) => r.ok).length,
    errores: resultados.filter((r) => !r.ok).map((r) => ({ socio: r.to, error: r.error })),
  };
}
