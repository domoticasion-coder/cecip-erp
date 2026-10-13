/**
 * Un mismo deploy sirve dos aplicaciones según el subdominio:
 *   erp.centrocomercialparana.com.ar          -> ERP administrativo
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
  if (host.startsWith("portalsocios.")) return { app: "portal", basename: "" };
  if (host.startsWith("erp.")) return { app: "erp", basename: "" };

  const path = window.location.pathname;
  if (path === "/portal" || path.startsWith("/portal/")) return { app: "portal", basename: "/portal" };
  return { app: "erp", basename: "/erp" };
}

export const appMode = detectAppMode();

/** URL absoluta dentro de la app actual (para redirecciones de emails de Supabase). */
export const appUrl = (path: string) => `${window.location.origin}${appMode.basename}${path}`;

const trim = (u?: string) => (u || "").replace(/\/$/, "");
export const PORTAL_URL = trim(import.meta.env.VITE_PORTAL_URL) || `${window.location.origin}/portal`;
export const ERP_URL = trim(import.meta.env.VITE_ERP_URL) || `${window.location.origin}/erp`;
