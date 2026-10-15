import { appMode } from "./appMode";
import { createBackendClient, isDemo } from "@backend";

// Acepta los nombres de Vite o los que crea la integración Supabase de Vercel
const env = import.meta.env;
const url = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) as string;
const anonKey = (env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string;

export const supabaseConfigured = isDemo || Boolean(url && anonKey);

// Cada app guarda su sesión por separado (en local comparten dominio)
export const supabase = createBackendClient(url, anonKey, `cecip-${appMode.app}-auth`);

/** Lanza el error de Supabase con un mensaje legible. */
export function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(traducirError(res.error.message));
  return res.data;
}

export function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email o contraseña incorrectos.";
  if (m.includes("email not confirmed")) return "Todavía no confirmaste tu email. Revisá tu casilla (y la carpeta de spam).";
  if (m.includes("user already registered")) return "Ya existe una cuenta con ese email. Probá iniciar sesión o recuperar la contraseña.";
  if (m.includes("password should be at least")) return "La contraseña debe tener al menos 8 caracteres.";
  if (m.includes("duplicate key") && m.includes("cuit")) return "Ya existe un socio con ese CUIT.";
  if (m.includes("duplicate key") && m.includes("numero_socio")) return "Ya existe un socio con ese número.";
  if (m.includes("cuotas_social_unica")) return "Ese socio ya tiene la cuota social de ese período.";
  if (m.includes("row-level security") || m.includes("permission denied")) return "No tenés permisos para realizar esta acción.";
  if (m.includes("rate limit")) return "Demasiados intentos. Esperá unos minutos y volvé a probar.";
  if (m.includes("violates foreign key") && m.includes("cuotas")) return "No se puede eliminar: tiene cuotas asociadas. Podés darlo de baja.";
  return msg;
}
