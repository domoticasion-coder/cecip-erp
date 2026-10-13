import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import type { Categoria, Configuracion, Cuenta } from "../lib/types";

export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: async () => unwrap(await supabase.from("categorias").select("*").order("orden").order("nombre")) as Categoria[],
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
}

/** Lista liviana de socios para selectores y filtros */
export function useSociosMin() {
  return useQuery({
    queryKey: ["socios-min"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("socios")
          .select("id, razon_social, nombre_comercial, numero_socio, estado, email, whatsapp, categoria_id")
          .order("razon_social")
      ) as SocioMin[],
  });
}

/** Invalida todo lo relacionado a cuotas/pagos/socios tras una operación */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
