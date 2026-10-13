/**
 * Backend real (Supabase + funciones /api). En `npm run demo`, Vite reemplaza este módulo
 * por src/demo/backend.ts (ver vite.config.ts), así el modo demo nunca llega a producción.
 */
import type { ComponentType } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const isDemo = false;

export function createBackendClient(url: string, anonKey: string, storageKey: string): SupabaseClient {
  return createClient(url || "http://localhost", anonKey || "missing", {
    auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

/** En demo reemplaza las llamadas a /api; en producción no se usa */
export const apiOverride: ((path: string, body?: unknown) => Promise<any>) | null = null;

export const DemoBanner: ComponentType | null = null;
export const DemoCheckout: ComponentType | null = null;
export const esCheckoutDemo = () => false;

export type DemoLogin = { app: "erp" | "portal"; etiqueta: string; email: string; password: string };
/** Usuarios de prueba que se muestran en el ingreso (solo en modo demo) */
export const demoLogins: DemoLogin[] = [];
