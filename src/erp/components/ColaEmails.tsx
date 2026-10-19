import { useQuery } from "@tanstack/react-query";
import { Ban, Send } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { supabase, unwrap } from "../../lib/supabase";
import { fechaHora } from "../../lib/format";
import { Badge, Button, Card, Empty, Loading, Table, useToast } from "../../components/ui";
import { useInvalidate } from "../data";

/** Texto para avisar el resultado de un envío masivo que pasó por la cola */
export function textoEnvio(r: { enviados: number; pendientes?: number; cupo_diario?: number | null }, nombre = "emails") {
  let t = `Enviados ahora: ${r.enviados}.`;
  if (r.pendientes) {
    const dias = r.cupo_diario ? Math.ceil(r.pendientes / r.cupo_diario) : 1;
    t += `\nQuedan ${r.pendientes} ${nombre} en cola por el cupo diario de Resend: salen solos ${dias <= 1 ? "mañana" : `en los próximos ${dias} días`}.`;
  }
  return t;
}

interface Lote {
  lote_id: string;
  tipo: string;
  asunto: string;
  creado: string;
  total: number;
  enviados: number;
  pendientes: number;
  errores: number;
  cancelados: number;
  ultimo_envio: string | null;
}

const TIPOS: Record<string, string> = { comunicado: "Comunicado", manual: "Email masivo", recordatorio: "Recordatorios", comercia: "ComercIA" };

/** Cupo diario de emails y envíos masivos que todavía tienen emails esperando */
export function ColaEmails() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cupo = useQuery({
    queryKey: ["envios", "cupo"],
    queryFn: () => api<{ limite_diario: number | null; cupo_cola: number | null; usados_hoy: number; cupo_restante: number | null }>("integraciones/cola-emails"),
  });
  const lotes = useQuery({
    queryKey: ["envios", "cola"],
    queryFn: async () => unwrap(await supabase.from("email_cola_lotes").select("*").order("creado", { ascending: false }).limit(20)) as Lote[],
  });

  async function accion(clave: string, path: string, body: object) {
    setOcupado(clave);
    try {
      const r = await api<{ enviados?: number; pendientes?: number; cancelados?: number }>(path, body);
      toast(r.cancelados !== undefined ? `Cancelados: ${r.cancelados}.` : `Enviados ahora: ${r.enviados}. En cola: ${r.pendientes}.`);
      invalidate("envios");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOcupado(null);
    }
  }

  const activos = (lotes.data || []).filter((l) => l.pendientes > 0);
  const recientes = (lotes.data || []).filter((l) => l.pendientes === 0).slice(0, 5);
  const c = cupo.data;

  return (
    <Card
      title="Cola de envío"
      actions={activos.length > 0 && (c?.cupo_restante ?? 1) > 0 && (
        <Button size="sm" variant="secondary" icon={<Send className="h-4 w-4" />} loading={ocupado === "procesar"}
          onClick={() => accion("procesar", "integraciones/cola-emails-procesar", {})}>
          Enviar ahora lo que entre
        </Button>
      )}
    >
      <div className="space-y-3 p-4 text-sm">
        {c && (
          c.limite_diario === null ? (
            <p className="text-slate-600">Sin límite diario configurado: los envíos salen todos juntos.</p>
          ) : (
            <p className="text-slate-600">
              Cupo de hoy: <b>{c.usados_hoy}</b> de {c.limite_diario} emails usados (la cola usa hasta {c.cupo_cola} y deja el resto para envíos individuales).
              {" "}Quedan <b>{c.cupo_restante}</b> para la cola. Lo pendiente sale solo cada mañana.
            </p>
          )
        )}
        {lotes.isLoading ? <Loading /> : !activos.length && !recientes.length ? (
          <Empty>No hay envíos masivos todavía.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><th>Envío</th><th>Creado</th><th className="text-right">Enviados</th><th className="text-right">En cola</th><th /></tr>
            </thead>
            <tbody>
              {[...activos, ...recientes].map((l) => (
                <tr key={l.lote_id}>
                  <td>
                    <div className="font-medium">{l.asunto}</div>
                    <div className="text-xs text-slate-500">
                      {TIPOS[l.tipo] || l.tipo} · {l.total} destinatarios
                      {l.errores > 0 && <> · <span className="text-red-600">{l.errores} con error</span></>}
                      {l.cancelados > 0 && <> · {l.cancelados} cancelados</>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-xs">{fechaHora(l.creado)}</td>
                  <td className="text-right">{l.enviados}</td>
                  <td className="text-right">{l.pendientes > 0 ? <Badge tone="amber">{l.pendientes}</Badge> : <Badge tone="green">listo</Badge>}</td>
                  <td className="text-right">
                    {l.pendientes > 0 && (
                      <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} loading={ocupado === l.lote_id}
                        onClick={() => confirm(`¿Cancelar los ${l.pendientes} emails que todavía no salieron?`) && accion(l.lote_id, "integraciones/cola-emails-cancelar", { lote_id: l.lote_id })}>
                        Cancelar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  );
}
