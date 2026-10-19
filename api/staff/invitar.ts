import { HttpError, env, getCaller, handle, json, readJson, requireStaff, supabaseAdmin, type Rol } from "../_lib/core.js";
import { ROLES_INFO } from "../../shared/roles.js";

/**
 * Alta y contraseñas del personal (solo administradores).
 *
 * POST /api/staff/invitar { email, nombre, rol, password? }
 *   - Con password: crea el usuario con esa contraseña (ya confirmado) y puede entrar enseguida.
 *   - Sin password: envía una invitación por email (Supabase Auth) para que la defina la persona.
 *
 * POST /api/staff/invitar { user_id, password }
 *   Cambia la contraseña de alguien del personal.
 */
const validarClave = (p: string) => {
  if (p.length < 8) throw new HttpError(400, "La contraseña tiene que tener al menos 8 caracteres.");
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, "La contraseña tiene que tener letras y números.");
};

export const POST = handle(async (req) => {
  const caller = await getCaller(req);
  requireStaff(caller, []);
  if (caller.staff!.rol !== "admin") throw new HttpError(403, "Solo un administrador puede gestionar al personal.");

  const body = await readJson<{ email?: string; nombre?: string; rol?: Rol; password?: string; user_id?: string }>(req);
  const sb = supabaseAdmin();
  const password = body.password?.trim() ? body.password : undefined;

  // Cambio de contraseña de alguien que ya es del personal
  if (body.user_id) {
    if (!password) throw new HttpError(400, "Escribí la contraseña nueva.");
    validarClave(password);
    const { data: st } = await sb.from("staff").select("user_id").eq("user_id", body.user_id).maybeSingle();
    if (!st) throw new HttpError(404, "Ese usuario no es del personal.");
    const { error } = await sb.auth.admin.updateUserById(body.user_id, { password, email_confirm: true });
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true, clave: true });
  }

  const { nombre, rol } = body;
  const mail = body.email?.trim().toLowerCase();
  if (!mail || !nombre?.trim()) throw new HttpError(400, "Completá nombre y email.");
  if (!rol || !(rol in ROLES_INFO)) throw new HttpError(400, "Rol inválido.");
  if (password) validarClave(password);

  // ¿Ya existe en el personal? (por ejemplo, alguien que fue dado de baja o una invitación que no llegó)
  const { data: existente } = await sb.from("staff").select("user_id").eq("email", mail).maybeSingle();
  if (existente) {
    await sb.from("staff").update({ nombre: nombre.trim(), rol, activo: true }).eq("user_id", existente.user_id);
    if (password) {
      const { error } = await sb.auth.admin.updateUserById(existente.user_id, { password, email_confirm: true });
      if (error) throw new HttpError(400, error.message);
    }
    return json({ ok: true, reactivado: true, clave: !!password });
  }

  const yaRegistrado = (m?: string) => !!m && /already (been )?registered|already exists/i.test(m);

  const { data, error } = password
    ? await sb.auth.admin.createUser({ email: mail, password, email_confirm: true, user_metadata: { tipo: "staff", nombre: nombre.trim() } })
    : await sb.auth.admin.inviteUserByEmail(mail, {
        redirectTo: `${env.erpUrl()}/definir-clave`,
        data: { tipo: "staff", nombre: nombre.trim() },
      });
  if (error || !data.user) {
    throw new HttpError(400, yaRegistrado(error?.message)
      ? "Ese email ya tiene un usuario (quizás como socio). Usá otro email para el personal."
      : error?.message || "No se pudo crear el usuario.");
  }

  const { error: e2 } = await sb.from("staff").insert({ user_id: data.user.id, nombre: nombre.trim(), email: mail, rol });
  if (e2) throw new HttpError(500, e2.message);

  return json({ ok: true, clave: !!password });
});
