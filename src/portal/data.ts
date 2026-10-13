import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import { api } from "../lib/api";
import type { Configuracion, CuotaDetalle } from "../lib/types";

export function useMisCuotas(socioId: string) {
  return useQuery({
    queryKey: ["mis-cuotas", socioId],
    queryFn: async () =>
      unwrap(await supabase.from("cuotas_detalle").select("*").eq("socio_id", socioId).neq("estado", "anulada").order("vencimiento", { ascending: false })) as CuotaDetalle[],
  });
}

export function useConfigPortal() {
  return useQuery({
    queryKey: ["config-portal"],
    queryFn: async () => unwrap(await supabase.from("configuracion").select("*").eq("id", 1).single()) as Configuracion,
  });
}

/** Genera el link de Mercado Pago y redirige al checkout */
export function usePagar() {
  const [pagando, setPagando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function pagar(cuotaIds: string[] | undefined, key: string) {
    setPagando(key);
    setError(null);
    try {
      const r = await api<{ url: string }>("pagos/link", { cuota_ids: cuotaIds });
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
      setPagando(null);
    }
  }
  return { pagar, pagando, error };
}
