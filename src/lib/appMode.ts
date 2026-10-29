/**
 * Un mismo deploy sirve dos aplicaciones según el subdominio:
 *   erp.centrocomercialparana.com.ar          -> ERP administrativo
 *     (y en ese dominio /portal/... sigue siendo el Portal de socios)
 *   portalsocios.centrocomercialparana.com.ar -> Portal de socios
 * En local (o en previews de Vercel) se usan rutas: /erp/... y /portal/...
 */
export type AppKind = "erp" | "portal";

export interface AppMode {
  app: AppKind;
  basename: string;
}

export function detectAppMode(): AppMode {
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname;
  const bajo = (base: string) => path === base || path.startsWith(`${base}/`);
  if (host.startsWith("portalsocios.")) return { app: "portal", basename: "" };
  // En cualquier dominio (también erp.…) /portal/... es el Portal: así funcionan los links de
  // inscripción, Mercado Pago y "Login Socios" de la web aunque apunten al dominio del ERP
  if (bajo("/portal")) return { app: "portal", basename: "/portal" };
  // erp.centrocomercialparana.com.ar: el ERP en la raíz, y también en /erp/... (links viejos y avisos)
  if (host.startsWith("erp.")) return { app: "erp", basename: bajo("/erp") ? "/erp" : "" };
  return { app: "erp", basename: "/erp" };
}

export const appMode = detectAppMode();

/** URL absoluta dentro de la app actual (para redirecciones de emails de Supabase). */
export const appUrl = (path: string) => `${window.location.origin}${appMode.basename}${path}`;

const trim = (u?: string) => (u || "").replace(/\/$/, "");
export const PORTAL_URL = trim(import.meta.env.VITE_PORTAL_URL) || `${window.location.origin}/portal`;
export const ERP_URL = trim(import.meta.env.VITE_ERP_URL) || `${window.location.origin}/erp`;
