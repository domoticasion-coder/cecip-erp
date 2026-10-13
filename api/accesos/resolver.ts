import { createClient } from "@supabase/supabase-js";
import { HttpError, env, getCaller, handle, json, readJson, requireStaff, supabaseAdmin } from "../_lib/core.js";
import { emailLayout, sendEmails, textToHtml } from "../_lib/email.js";

/**
 * POST /api/accesos/resolver { user_id, aprobar, socio_id?, motivo? }
 * Aprueba o rechaza una solicitud de acceso al portal y avisa al socio por email.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["atencion", "tesoreria"]);

  const body = await readJson<{ user_id?: string; aprobar?: boolean; socio_id?: string; motivo?: string }>(req);
  if (!body.user_id || typeof body.aprobar !== "boolean") throw new HttpError(400, "Datos incompletos.");

  // Se ejecuta con la sesión de quien aprueba para que la base valide su rol y lo registre
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY!;
  const asUser = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get("authorization")! } },
  });

  const { data: su, error } = await asUser.rpc("resolver_acceso", {
    p_user_id: body.user_id,
    p_aprobar: body.aprobar,
    p_socio_id: body.socio_id || null,
    p_motivo: body.motivo || null,
  });
  if (error) throw new HttpError(400, error.message);

  // Aviso por email (si falla no se revierte la aprobación)
  let emailOk = false;
  try {
    const nombre = su.nombre || "";
    const html = body.aprobar
      ? emailLayout({
          titulo: "¡Tu acceso al portal fue aprobado!",
          cuerpoHtml: textToHtml(`Hola ${nombre},\n\nYa podés ingresar al Portal de Socios de CeCIP Paraná para ver tus cuotas, pagarlas online, inscribirte en eventos y capacitaciones y recibir las comunicaciones oficiales.`),
          boton: { texto: "Ingresar al portal", url: env.portalUrl() },
        })
      : emailLayout({
          titulo: "Solicitud de acceso al portal",
          cuerpoHtml: textToHtml(`Hola ${nombre},\n\nNo pudimos validar tu solicitud de acceso al Portal de Socios.${body.motivo ? `\n\nMotivo: ${body.motivo}` : ""}\n\nPor cualquier consulta respondé este correo o comunicate con la administración del CeCIP.`),
        });
    const [r] = await sendEmails([{ to: su.email, subject: body.aprobar ? "Acceso aprobado - Portal de Socios CeCIP" : "Solicitud de acceso - Portal de Socios CeCIP", html }]);
    emailOk = r.ok;
    await supabaseAdmin().from("envios").insert({
      socio_id: su.socio_id, canal: "email", tipo: "acceso", asunto: body.aprobar ? "Acceso aprobado" : "Acceso rechazado",
      destinatario: su.email, estado: r.ok ? "enviado" : "error", error: r.error || null, created_by: caller.userId,
    });
  } catch (err) {
    console.error("Email acceso:", err);
  }

  return json({ ok: true, email_enviado: emailOk });
});
