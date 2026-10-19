import { HttpError, env, getCaller, handle, json, readJson, requireStaff, supabaseAdmin, type Rol } from "../_lib/core.js";
import { ROLES_INFO } from "../../shared/roles.js";

/**
 * POST /api/staff/invitar { email, nombre, rol }  (solo administradores)
 * Envía una invitación por email (Supabase Auth) para que la persona defina su contraseña.
 */
export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, []);
  if (caller.staff!.rol !== "admin") throw new HttpError(403, "Solo un administrador puede invitar personal.");

  const { email, nombre, rol } = await readJson<{ email?: string; nombre?: string; rol?: Rol }>(req);
  const mail = email?.trim().toLowerCase();
  if (!mail || !nombre?.trim()) throw new HttpError(400, "Completá nombre y email.");
  if (!rol || !(rol in ROLES_INFO)) throw new HttpError(400, "Rol inválido.");

  const sb = supabaseAdmin();

  // ¿Ya existe el usuario? (por ejemplo, alguien del personal que fue dado de baja)
  const { data: existente } = await sb.from("staff").select("user_id").eq("email", mail).maybeSingle();
  if (existente) {
    await sb.from("staff").update({ nombre: nombre.trim(), rol, activo: true }).eq("user_id", existente.user_id);
    return json({ ok: true, reactivado: true });
  }

  const { data, error } = await sb.auth.admin.inviteUserByEmail(mail, {
    redirectTo: `${env.erpUrl()}/definir-clave`,
    data: { tipo: "staff", nombre: nombre.trim() },
  });
  if (error || !data.user) {
    throw new HttpError(400, error?.message?.includes("already been registered")
      ? "Ese email ya tiene un usuario (quizás como socio). Usá otro email para el personal."
      : error?.message || "No se pudo enviar la invitación.");
  }

  const { error: e2 } = await sb.from("staff").insert({ user_id: data.user.id, nombre: nombre.trim(), email: mail, rol });
  if (e2) throw new HttpError(500, e2.message);

  return json({ ok: true });
});
