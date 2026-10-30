import { supabase } from "../lib/supabase";

/**
 * Registra lo que hace el socio en el Portal (lo ve el personal en ERP → Actividad del portal).
 * No bloquea ni muestra errores: si falla, el Portal sigue igual.
 */
export function registrarActividad(accion: string, seccion: string, detalle: Record<string, unknown> = {}) {
  supabase.rpc("registrar_actividad_portal", { p_accion: accion, p_seccion: seccion, p_detalle: detalle }).then(() => {}, () => {});
}

/** Sección del Portal según la ruta */
export function seccionDeRuta(path: string): string {
  const s = path.split("/")[1] || "inicio";
  return ({ empresa: "empresa", cuotas: "cuotas" } as Record<string, string>)[s] || s;
}
