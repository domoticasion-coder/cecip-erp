import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Download, Pencil, Plus, Receipt, Trash2, Users } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fechaHora, hoyISO, nombreSocio, pesos } from "../../lib/format";
import type { Evento, Inscripcion } from "../../lib/types";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";

type EventoConCount = Evento & { inscripciones: { count: number }[] };

export default function Eventos() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<"proximos" | "pasados">("proximos");
  const [editar, setEditar] = useState<Evento | "nuevo" | null>(null);
  const [inscriptos, setInscriptos] = useState<Evento | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["eventos", "lista", tab],
    queryFn: async () => {
      const ahora = new Date().toISOString();
      const q = supabase.from("eventos").select("*, inscripciones(count)");
      const r = tab === "proximos"
        ? await q.gte("fecha_inicio", ahora).order("fecha_inicio")
        : await q.lt("fecha_inicio", ahora).order("fecha_inicio", { ascending: false }).limit(100);
      return unwrap(r) as EventoConCount[];
    },
  });

  async function eliminar(e: Evento) {
    if (!confirm(`¿Eliminar "${e.titulo}" y sus inscripciones?`)) return;
    const { error } = await supabase.from("eventos").delete().eq("id", e.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("eventos");
  }

  const puede = can("atencion");

  return (
    <>
      <PageHeader
        title="Eventos y capacitaciones"
        subtitle="Los eventos publicados aparecen en el portal y los socios se inscriben desde ahí"
        actions={puede && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditar("nuevo")}>Nuevo evento</Button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "proximos", label: "Próximos" }, { value: "pasados", label: "Pasados" }]} />

      <Card>
        {isLoading ? <Loading /> : !data?.length ? (
          <Empty icon={<CalendarDays className="h-10 w-10" />}>{tab === "proximos" ? "No hay eventos programados." : "Sin eventos pasados."}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((e) => {
              const n = e.inscripciones?.[0]?.count || 0;
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.titulo}</span>
                      <Badge tone={e.tipo === "capacitacion" ? "purple" : "blue"}>{e.tipo === "capacitacion" ? "Capacitación" : "Evento"}</Badge>
                      {e.publicado ? <Badge tone="green">Publicado</Badge> : <Badge>Borrador</Badge>}
                      {!e.inscripcion_abierta && <Badge tone="amber">Inscripción cerrada</Badge>}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500">
                      {fechaHora(e.fecha_inicio)} · {e.modalidad}{e.lugar && ` · ${e.lugar}`} · {Number(e.costo) > 0 ? pesos(e.costo) : "Sin costo"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="secondary" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setInscriptos(e)}>
                      {n}{e.cupo ? ` / ${e.cupo}` : ""} inscriptos
                    </Button>
                    {puede && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(e)} />}
                    {puede && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(e)} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <EventoForm value={editar} onClose={() => setEditar(null)} />
      <InscriptosModal evento={inscriptos} onClose={() => setInscriptos(null)} />
    </>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function EventoForm({ value, onClose }: { value: Evento | "nuevo" | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const vacio = {
    titulo: "", descripcion: "", tipo: "capacitacion" as Evento["tipo"], fecha_inicio: `${hoyISO()}T18:00`, fecha_fin: "",
    lugar: "Sede CeCIP", modalidad: "presencial" as Evento["modalidad"], link: "", cupo: "", costo: "0", publicado: true, inscripcion_abierta: true,
  };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nuevo") setF(vacio);
    else setF({
      titulo: value.titulo, descripcion: value.descripcion || "", tipo: value.tipo, fecha_inicio: toLocalInput(value.fecha_inicio),
      fecha_fin: toLocalInput(value.fecha_fin), lugar: value.lugar || "", modalidad: value.modalidad, link: value.link || "",
      cupo: value.cupo?.toString() || "", costo: String(value.costo), publicado: value.publicado, inscripcion_abierta: value.inscripcion_abierta,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function guardar() {
    if (!f.titulo.trim() || !f.fecha_inicio) return setError("Completá título y fecha.");
    setSaving(true);
    const payload = {
      titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null, tipo: f.tipo,
      fecha_inicio: new Date(f.fecha_inicio).toISOString(), fecha_fin: f.fecha_fin ? new Date(f.fecha_fin).toISOString() : null,
      lugar: f.lugar.trim() || null, modalidad: f.modalidad, link: f.link.trim() || null,
      cupo: f.cupo ? Number(f.cupo) : null, costo: Number(f.costo.replace(",", ".")) || 0,
      publicado: f.publicado, inscripcion_abierta: f.inscripcion_abierta,
    };
    const res = value === "nuevo"
      ? await supabase.from("eventos").insert(payload)
      : await supabase.from("eventos").update(payload).eq("id", (value as Evento).id);
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast("Evento guardado.");
    invalidate("eventos", "dashboard");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nuevo" ? "Nuevo evento" : "Editar evento"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título" className="sm:col-span-2"><Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
        <Field label="Tipo">
          <Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Evento["tipo"] })}>
            <option value="capacitacion">Capacitación</option>
            <option value="evento">Evento</option>
          </Select>
        </Field>
        <Field label="Modalidad">
          <Select value={f.modalidad} onChange={(e) => setF({ ...f, modalidad: e.target.value as Evento["modalidad"] })}>
            <option value="presencial">Presencial</option>
            <option value="virtual">Virtual</option>
            <option value="mixta">Mixta</option>
          </Select>
        </Field>
        <Field label="Inicio"><Input type="datetime-local" value={f.fecha_inicio} onChange={(e) => setF({ ...f, fecha_inicio: e.target.value })} /></Field>
        <Field label="Fin (opcional)"><Input type="datetime-local" value={f.fecha_fin} onChange={(e) => setF({ ...f, fecha_fin: e.target.value })} /></Field>
        <Field label="Lugar"><Input value={f.lugar} onChange={(e) => setF({ ...f, lugar: e.target.value })} /></Field>
        <Field label="Link (Zoom, Meet, etc.)" hint="Solo lo ven los socios inscriptos."><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
        <Field label="Cupo (vacío = sin límite)"><Input inputMode="numeric" value={f.cupo} onChange={(e) => setF({ ...f, cupo: e.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Costo para socios ($)"><Input inputMode="decimal" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} /></Field>
        <Field label="Descripción" className="sm:col-span-2"><Textarea rows={5} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Field>
        <div className="flex gap-6 sm:col-span-2">
          <Checkbox checked={f.publicado} onChange={(v) => setF({ ...f, publicado: v })} label="Publicado en el portal" />
          <Checkbox checked={f.inscripcion_abierta} onChange={(v) => setF({ ...f, inscripcion_abierta: v })} label="Inscripción abierta" />
        </div>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Modal>
  );
}

function InscriptosModal({ evento, onClose }: { evento: Evento | null; onClose: () => void }) {
  const { can, staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const [socio, setSocio] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");

  const { data, refetch } = useQuery({
    queryKey: ["inscripciones", evento?.id],
    enabled: !!evento,
    queryFn: async () => unwrap(await supabase.from("inscripciones").select("*").eq("evento_id", evento!.id).order("created_at")) as Inscripcion[],
  });

  if (!evento) return null;
  const socioNombre = (id: string | null) => {
    const s = socios?.find((x) => x.id === id);
    return s ? nombreSocio(s) : "Externo";
  };

  async function agregar() {
    const s = socios?.find((x) => x.id === socio);
    const asistente = nombre.trim() || (s ? nombreSocio(s) : "");
    if (!asistente) return toast("Indicá el nombre del asistente.", "error");
    const { error } = await supabase.from("inscripciones").insert({
      evento_id: evento!.id, socio_id: socio || null, asistente_nombre: asistente, asistente_email: email.trim() || s?.email || null,
    });
    if (error) return toast(traducirError(error.message), "error");
    setSocio(""); setNombre(""); setEmail("");
    refetch();
    invalidate("eventos");
  }

  async function asistio(i: Inscripcion) {
    await supabase.from("inscripciones").update({ asistio: !i.asistio }).eq("id", i.id);
    refetch();
  }

  async function quitar(i: Inscripcion) {
    if (!confirm(`¿Quitar a ${i.asistente_nombre}?`)) return;
    await supabase.from("inscripciones").delete().eq("id", i.id);
    refetch();
    invalidate("eventos");
  }

  async function generarCargos() {
    const concepto = `Inscripción: ${evento!.titulo}`;
    const sociosIns = [...new Set((data || []).filter((i) => i.socio_id).map((i) => i.socio_id!))];
    const { data: existentes } = await supabase.from("cuotas").select("socio_id").eq("concepto", concepto).neq("estado", "anulada");
    const ya = new Set((existentes || []).map((x) => x.socio_id));
    const nuevos = sociosIns.filter((id) => !ya.has(id));
    if (!nuevos.length) return toast("Todos los socios inscriptos ya tienen el cargo generado.", "info");
    if (!confirm(`¿Generar un cargo de ${pesos(evento!.costo)} a ${nuevos.length} socio(s)? Va a figurar en su cuenta para pagar online.`)) return;
    const { error } = await supabase.from("cuotas").insert(nuevos.map((id) => ({
      socio_id: id, tipo: "otro", concepto, monto: evento!.costo, vencimiento: evento!.fecha_inicio.slice(0, 10), created_by: staff?.user_id,
    })));
    if (error) return toast(traducirError(error.message), "error");
    toast(`Se generaron ${nuevos.length} cargos.`);
    invalidate("cuotas", "socios", "dashboard");
  }

  return (
    <Modal open onClose={onClose} size="xl" title={`Inscriptos · ${evento.titulo}`}
      footer={
        <>
          {Number(evento.costo) > 0 && can("tesoreria") && (
            <Button variant="secondary" icon={<Receipt className="h-4 w-4" />} onClick={generarCargos}>Cobrar inscripción a socios</Button>
          )}
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!data?.length}
            onClick={() => descargarCSV(`inscriptos-${evento.titulo}`, (data || []).map((i) => ({
              asistente: i.asistente_nombre, socio: socioNombre(i.socio_id), email: i.asistente_email, telefono: i.asistente_telefono,
              inscripto: fechaHora(i.created_at), asistio: i.asistio ? "Sí" : "No",
            })))}>Exportar</Button>
          <Button onClick={onClose}>Cerrar</Button>
        </>
      }>
      {can("atencion") && (
        <div className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
          <Select value={socio} onChange={(e) => setSocio(e.target.value)}>
            <option value="">Asistente externo</option>
            {socios?.filter((s) => s.estado === "activo").map((s) => <option key={s.id} value={s.id}>{nombreSocio(s)}</option>)}
          </Select>
          <Input placeholder="Nombre del asistente" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button onClick={agregar} icon={<Plus className="h-4 w-4" />}>Inscribir</Button>
        </div>
      )}
      {!data?.length ? <Empty>Sin inscriptos todavía.</Empty> : (
        <Table>
          <thead className="bg-slate-50">
            <tr><th className="th">Asistente</th><th className="th">Socio</th><th className="th">Contacto</th><th className="th text-center">Asistió</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.asistente_nombre}<div className="text-xs text-slate-400">{fechaHora(i.created_at)}</div></td>
                <td className="td text-sm">{socioNombre(i.socio_id)}</td>
                <td className="td text-xs">{i.asistente_email}<div>{i.asistente_telefono}</div></td>
                <td className="td text-center"><input type="checkbox" checked={i.asistio} onChange={() => asistio(i)} /></td>
                <td className="td text-right">
                  <button onClick={() => quitar(i)} className="text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}
