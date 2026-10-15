import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import { api } from "../lib/api";
import type { Categoria, Configuracion, Cuenta, Periodicidad } from "../lib/types";

export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: async () => unwrap(await supabase.from("categorias").select("*").order("orden").order("nombre")) as Categoria[],
  });
}

export function usePeriodicidades() {
  return useQuery({
    queryKey: ["periodicidades"],
    queryFn: async () => unwrap(await supabase.from("periodicidades").select("*").order("orden")) as Periodicidad[],
    staleTime: 5 * 60_000,
  });
}

export function useCuentas() {
  return useQuery({
    queryKey: ["cuentas"],
    queryFn: async () => unwrap(await supabase.from("cuentas").select("*").order("orden").order("nombre")) as Cuenta[],
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["configuracion"],
    queryFn: async () => unwrap(await supabase.from("configuracion").select("*").eq("id", 1).single()) as Configuracion,
  });
}

export interface SocioMin {
  id: string;
  razon_social: string;
  nombre_comercial: string | null;
  numero_socio: number | null;
  estado: string;
  email: string | null;
  whatsapp: string | null;
  categoria_id: string | null;
  periodicidad: string;
  seguimiento: string | null;
}

/** Lista liviana de socios para selectores y filtros */
export function useSociosMin() {
  return useQuery({
    queryKey: ["socios-min"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("socios")
          .select("id, razon_social, nombre_comercial, numero_socio, estado, email, whatsapp, categoria_id, periodicidad, seguimiento")
          .order("razon_social")
      ) as SocioMin[],
  });
}

/** Invalida todo lo relacionado a cuotas/pagos/socios tras una operación */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** Envía a n8n / ARCA las facturas en cola (no interrumpe si n8n no está configurado o falla) */
export async function enviarFacturasEnCola(ids?: string[]) {
  try {
    return await api<{ enviadas: number; emitidas: number; errores: number; sinConfigurar?: boolean }>("integraciones/facturas-procesar", { ids });
  } catch {
    return null;
  }
}
