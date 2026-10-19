import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, MapPin, Video } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora, pesos } from "../../lib/format";
import type { Evento, Inscripcion } from "../../lib/types";
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, Tabs, useToast } from "../../components/ui";
import { TextoConLinks } from "./Comunicados";

export default function Eventos({ socioId }: { socioId: string }) {
  const { socioUsuario, session } = useAuth();
  const toast = useToast();
  const [filtro, setFiltro] = useState<"todos" | "capacitacion" | "evento">("todos");
  const [inscribir, setInscribir] = useState<Evento | null>(null);
  const [asistente, setAsistente] = useState({ nombre: "", email: "", telefono: "" });
  const [saving, setSaving] = useState(false);

  const { data: eventos, isLoading } = useQuery({
    queryKey: ["portal-eventos", "lista"],
    queryFn: async () =>
      unwrap(await supabase.from("eventos").select("*").eq("publicado", true).gte("fecha_inicio", new Date().toISOString()).order("fecha_inicio")) as Evento[],
  });

  const { data: mias, refetch } = useQuery({
    queryKey: ["portal-inscripciones", socioId],
    queryFn: async () => unwrap(await supabase.from("inscripciones").select("*").eq("socio_id", socioId)) as Inscripcion[],
  });

  const { data: cupos, refetch: refetchCupos } = useQuery({
    queryKey: ["portal-cupos"],
    queryFn: async () => {
      const r = unwrap(await supabase.rpc("inscriptos_por_evento")) as { evento_id: string; inscriptos: number }[];
      return new Map(r.map((x) => [x.evento_id, Number(x.inscriptos)]));
    },
  });

  function abrir(e: Evento) {
    setAsistente({ nombre: socioUsuario?.nombre || "", email: session?.user.email || "", telefono: socioUsuario?.telefono || "" });
    setInscribir(e);
  }

  async function confirmar() {
    if (!asistente.nombre.trim()) return toast("Indicá el nombre de quien asiste.", "error");
    setSaving(true);
    const { error } = await supabase.from("inscripciones").insert({
      evento_id: inscribir!.id, socio_id: socioId, asistente_nombre: asistente.nombre.trim(),
      asistente_email: asistente.email.trim() || null, asistente_telefono: asistente.telefono.trim() || null,
    });
    setSaving(false);
    if (error) return toast(error.message.includes("duplicate") ? "Esa persona ya está inscripta." : traducirError(error.message), "error");
    toast(`¡Inscripción confirmada en "${inscribir!.titulo}"!`);
    setInscribir(null);
    refetch();
    refetchCupos();
  }

  async function cancelar(i: Inscripcion, e: Evento) {
    if (!confirm(`¿Cancelar la inscripción de ${i.asistente_nombre} a "${e.titulo}"?`)) return;
    const { error } = await supabase.from("inscripciones").delete().eq("id", i.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Inscripción cancelada.");
    refetch();
    refetchCupos();
  }

  const lista = (eventos || []).filter((e) => filtro === "todos" || e.tipo === filtro);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Eventos y capacitaciones</h1>
      <Tabs value={filtro} onChange={setFiltro} tabs={[
        { value: "todos", label: "Todos" }, { value: "capacitacion", label: "Capacitaciones" }, { value: "evento", label: "Eventos" },
      ]} />
      {isLoading ? <Loading /> : !lista.length ? (
        <Card><Empty icon={<CalendarDays className="h-10 w-10" />}>No hay actividades programadas por ahora.</Empty></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {lista.map((e) => {
            const inscripciones = (mias || []).filter((i) => i.evento_id === e.id);
            const ocupados = cupos?.get(e.id) || 0;
            const lleno = e.cupo !== null && ocupados >= e.cupo;
            return (
              <Card key={e.id}>
                <div className="flex h-full flex-col p-5">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge tone={e.tipo === "capacitacion" ? "purple" : "blue"}>{e.tipo === "capacitacion" ? "Capacitación" : "Evento"}</Badge>
                    {Number(e.costo) > 0 ? <Badge tone="gray">{pesos(e.costo)}</Badge> : <Badge tone="green">Sin costo para socios</Badge>}
                    {e.cupo && <Badge tone={lleno ? "red" : "gray"}>{lleno ? "Cupo completo" : `Quedan ${e.cupo - ocupados} lugares`}</Badge>}
                  </div>
                  <h2 className="text-lg font-semibold">{e.titulo}</h2>
                  <div className="mt-1 space-y-0.5 text-sm text-slate-600">
                    <div className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {fechaHora(e.fecha_inicio)}</div>
                    <div className="flex items-center gap-1.5">
                      {e.modalidad === "virtual" ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                      {e.modalidad === "virtual" ? "Virtual" : e.lugar}{e.modalidad === "mixta" && " (también virtual)"}
                    </div>
                  </div>
                  {e.descripcion && <div className="mt-3 flex-1"><TextoConLinks texto={e.descripcion} /></div>}

                  {inscripciones.length > 0 && (
                    <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                      <div className="mb-1 flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" /> Inscriptos</div>
                      {inscripciones.map((i) => (
                        <div key={i.id} className="flex items-center justify-between">
                          <span>{i.asistente_nombre}</span>
                          <button onClick={() => cancelar(i, e)} className="text-xs text-emerald-700 underline">cancelar</button>
                        </div>
                      ))}
                      {e.link && <a href={e.link} target="_blank" rel="noopener noreferrer" className="mt-1 block font-medium underline">Link de acceso</a>}
                      {Number(e.costo) > 0 && <div className="mt-1 text-xs">Costo {pesos(e.costo)}: lo abonás en la administración o se carga en tu cuenta para pagar online. La factura sale a nombre de tu empresa.</div>}
                    </div>
                  )}

                  <div className="mt-4">
                    {e.inscripcion_abierta && !lleno ? (
                      <Button variant={inscripciones.length ? "secondary" : "primary"} onClick={() => abrir(e)}>
                        {inscripciones.length ? "Inscribir a otra persona" : "Inscribirme"}
                      </Button>
                    ) : (
                      <span className="text-sm text-slate-500">{lleno ? "Sin cupo disponible" : "Inscripción cerrada"}</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!inscribir} onClose={() => setInscribir(null)} title={`Inscripción · ${inscribir?.titulo}`}
        footer={<><Button variant="secondary" onClick={() => setInscribir(null)}>Cancelar</Button><Button loading={saving} onClick={confirmar}>Confirmar inscripción</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Podés inscribirte vos o a un integrante de tu empresa.</p>
          <Field label="Nombre de quien asiste"><Input value={asistente.nombre} onChange={(e) => setAsistente({ ...asistente, nombre: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={asistente.email} onChange={(e) => setAsistente({ ...asistente, email: e.target.value })} /></Field>
          <Field label="Teléfono"><Input value={asistente.telefono} onChange={(e) => setAsistente({ ...asistente, telefono: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
