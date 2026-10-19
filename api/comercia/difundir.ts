import { HttpError, env, getCaller, handle, json, readJson, requireStaff, supabaseAdmin } from "../_lib/core.js";
import { emailLayout, emailValido, textToHtml } from "../_lib/email.js";
import { encolarEmails } from "../_lib/colaEmails.js";

/**
 * POST /api/comercia/difundir { asunto, cuerpo, rubro?, categoria_id?, soloContar? }
 * Email de ComercIA a los socios activos (todos, por rubro o por categoría).
 * El equipo de ComercIA no ve las direcciones: el servidor arma la lista y solo devuelve cantidades.
 * Variables: {{nombre}} (persona de contacto o comercio) y {{empresa}}.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, ["comercia"]);

  const body = await readJson<{ asunto?: string; cuerpo?: string; rubro?: string; categoria_id?: string; soloContar?: boolean; imagen_url?: string | null }>(req);
  const sb = supabaseAdmin();

  let q = sb.from("socios").select("id, razon_social, nombre_comercial, contacto_nombre, email").eq("estado", "activo").not("email", "is", null);
  if (body.rubro?.trim()) q = q.ilike("rubro", `%${body.rubro.trim()}%`);
  if (body.categoria_id) q = q.eq("categoria_id", body.categoria_id);
  const { data, error } = await q.range(0, 4999);
  if (error) throw new HttpError(500, error.message);
  const socios = (data || []).filter((s) => emailValido(s.email));

  if (body.soloContar) return json({ destinatarios: socios.length });

  const asunto = body.asunto?.trim();
  const cuerpo = body.cuerpo?.trim();
  if (!asunto || !cuerpo) throw new HttpError(400, "Completá asunto y mensaje.");
  if (!socios.length) throw new HttpError(400, "No hay socios con email para ese filtro.");

  const reemplazar = (t: string, s: (typeof socios)[number]) => {
    const empresa = s.nombre_comercial || s.razon_social;
    const nombre = (s.contacto_nombre || "").trim().split(/\s+/)[0] || empresa;
    return t.replace(/\{\{\s*nombre\s*\}\}/gi, nombre).replace(/\{\{\s*empresa\s*\}\}/gi, empresa);
  };

  const mensajes = socios.map((s) => ({
    to: s.email!.trim(),
    subject: reemplazar(asunto, s),
    text: reemplazar(cuerpo, s),
    html: emailLayout({
      titulo: reemplazar(asunto, s),
      cuerpoHtml: textToHtml(reemplazar(cuerpo, s)),
      imagenUrl: body.imagen_url,
      boton: { texto: "Ver ComercIA en el portal", url: `${env.portalUrl()}/comercia` },
      pie: "Beneficio del convenio ComercIA Inteligente (CeCIP + Instituto IEC).",
    }),
  }));

  // Pasa por la cola: sale ya lo que entra en el cupo diario y el resto en los días siguientes
  const r = await encolarEmails(mensajes.map((m, i) => ({ ...m, tipo: "comercia" as const, socio_id: socios[i].id })), caller.userId);
  return json({ enviados: r.enviados, pendientes: r.pendientes, errores: r.errores.length, cupo_diario: r.cupo_diario });
});
