import { HttpError, env, getCaller, handle, json, pesos, readJson, requireStaff, supabaseAdmin } from "../_lib/core.js";
import { emailLayout, emailValido, sendEmails, textToHtml } from "../_lib/email.js";

/**
 * POST /api/comunicaciones/enviar { socio_ids, asunto, cuerpo, comunicado_id?, imagen_url? }
 * Envío masivo de emails. Variables disponibles en asunto y cuerpo: {{nombre}}, {{deuda}}.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["atencion", "tesoreria"]);

  const body = await readJson<{ socio_ids?: string[]; asunto?: string; cuerpo?: string; comunicado_id?: string; imagen_url?: string | null }>(req);
  const asunto = body.asunto?.trim();
  const cuerpo = body.cuerpo?.trim();
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

  const resultados = mensajes.length ? await sendEmails(mensajes) : [];

  const logs = [
    ...resultados.map((r, i) => ({
      socio_id: conEmail[i].id,
      comunicado_id: body.comunicado_id || null,
      canal: "email",
      tipo: body.comunicado_id ? "comunicado" : "manual",
      asunto: mensajes[i].subject,
      destinatario: r.to,
      estado: r.ok ? "enviado" : "error",
      error: r.error || null,
      created_by: caller.userId,
    })),
    ...sinEmail.map((s) => ({
      socio_id: s.id,
      comunicado_id: body.comunicado_id || null,
      canal: "email",
      tipo: body.comunicado_id ? "comunicado" : "manual",
      asunto,
      destinatario: null,
      estado: "error",
      error: "Socio sin email válido",
      created_by: caller.userId,
    })),
  ];
  if (logs.length) await sb.from("envios").insert(logs);

  return json({
    enviados: resultados.filter((r) => r.ok).length,
    errores: [
      ...resultados.filter((r) => !r.ok).map((r) => ({ socio: r.to, error: r.error })),
      ...sinEmail.map((s) => ({ socio: s.nombre_comercial || s.razon_social, error: "Sin email válido" })),
    ],
  });
});
