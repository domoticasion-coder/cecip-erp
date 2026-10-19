/** Backend del modo demo (reemplaza a src/lib/backend.ts cuando se ejecuta `npm run demo`) */
import type { ComponentType } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient, DEMO_PASSWORD } from "./demoClient";
import { DEMO_USERS } from "./demoDb";
import { demoApi } from "./demoApi";
import { DemoBanner as Banner, DemoCheckout as Checkout, esCheckoutDemo as esCheckout } from "./DemoUi";

export const isDemo = true;

export function createBackendClient(_url: string, _anonKey: string, _storageKey: string): SupabaseClient {
  return createDemoClient() as unknown as SupabaseClient;
}

export const apiOverride: ((path: string, body?: unknown) => Promise<any>) | null = demoApi;
export const DemoBanner: ComponentType | null = Banner;
export const DemoCheckout: ComponentType | null = Checkout;
export const esCheckoutDemo = esCheckout;

export type DemoLogin = { app: "erp" | "portal"; etiqueta: string; email: string; password: string };
export const demoLogins: DemoLogin[] = [
  { app: "erp", etiqueta: "Administrador", email: DEMO_USERS.admin.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Administración", email: DEMO_USERS.administracion.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Prensa y capacitación", email: DEMO_USERS.prensa.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Presidente", email: DEMO_USERS.presidente.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Prosecretario", email: DEMO_USERS.prosecretario.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Comisión directiva", email: DEMO_USERS.comision.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Tesorería", email: DEMO_USERS.tesoreria.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "Atención al socio", email: DEMO_USERS.atencion.email, password: DEMO_PASSWORD },
  { app: "erp", etiqueta: "ComercIA (IEC / FactorIA)", email: DEMO_USERS.comercia.email, password: DEMO_PASSWORD },
  { app: "portal", etiqueta: "Socio: 25 de Junio S.A.", email: DEMO_USERS.socio.email, password: DEMO_PASSWORD },
];
