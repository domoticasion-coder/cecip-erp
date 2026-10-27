import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tienePermiso, type Permiso, type Rol } from "../../shared/roles.js";

export type { Rol, Permiso };

// Cliente con service role: SOLO se usa en funciones del servidor, nunca en el navegador.
let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new HttpError(500, "Falta configurar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Envuelve un handler para devolver errores como JSON prolijo. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: err instanceof Error ? err.message : "Error interno" }, 500);
    }
  };
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Cuerpo de la solicitud inválido.");
  }
}

export interface Caller {
  userId: string;
  email: string;
  staff: { nombre: string; rol: Rol } | null;
  socioId: string | null;
}

/** Identifica a quien llama a partir del token de Supabase (header Authorization). */
export async function getCaller(req: Request): Promise<Caller> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "No autenticado.");

  const sb = supabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sesión inválida o vencida.");

  const userId = data.user.id;
  const [{ data: staff }, { data: su }] = await Promise.all([
    sb.from("staff").select("nombre, rol, activo").eq("user_id", userId).maybeSingle(),
    sb.from("socio_usuarios").select("socio_id, estado").eq("user_id", userId).maybeSingle(),
  ]);

  return {
    userId,
    email: data.user.email || "",
    staff: staff && staff.activo ? { nombre: staff.nombre, rol: staff.rol as Rol } : null,
    socioId: su && su.estado === "aprobado" ? su.socio_id : null,
  };
}

/**
 * Exige que quien llama sea del personal y, si se indican permisos, que su rol tenga alguno
 * (ver shared/roles.ts). Sin permisos alcanza con ser del personal; con [] solo el administrador.
 */
export function requireStaff(c: Caller, permisos?: Permiso[]): void {
  if (!c.staff) throw new HttpError(403, "Acceso solo para el personal de CeCIP.");
  if (permisos && !tienePermiso(c.staff.rol, permisos)) {
    throw new HttpError(403, "Tu rol no tiene permiso para esta acción.");
  }
}

// Dirección pública de la app: la variable si está cargada; si no, el dominio de producción que
// informa Vercel (VERCEL_PROJECT_PRODUCTION_URL); en desarrollo, localhost.
const baseVercel = () => {
  const d = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return d ? `https://${d.replace(/^https?:\/\//, "")}` : "http://localhost:5173";
};
export const env = {
  erpUrl: () => (process.env.ERP_URL || process.env.VITE_ERP_URL || `${baseVercel()}/erp`).trim().replace(/\/$/, ""),
  portalUrl: () => (process.env.PORTAL_URL || process.env.VITE_PORTAL_URL || `${baseVercel()}/portal`).trim().replace(/\/$/, ""),
};

export const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
