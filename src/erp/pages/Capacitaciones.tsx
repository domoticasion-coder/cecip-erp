import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Ban, CalendarClock, Download, GraduationCap, Pencil, Plus, Receipt, Share2, Trash2, Undo2, UserPlus, Users, Wallet,
} from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fecha, formatCuit, hoyISO, nombreSocio, pesos } from "../../lib/format";
import {
  CONDICIONES_IVA, DIAS_SEMANA, ESTADOS_FACTURA, ESTADOS_PAGO_INSCRIPCION, HONORARIOS, METODOS_PAGO,
  type CapacitacionResumen, type CondicionIva, type Docente, type DocentePago, type Evento, type Factura, type HonorarioTipo,
  type Inscripcion, type PreguntaFormulario,
} from "../../lib/types";
import {
  Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Textarea, useToast,
} from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { enviarFacturasEnCola, useConfig, useCuentas, useInvalidate, useSociosMin } from "../data";
import { CompartirModal, EditorPreguntas } from "./Eventos";

type Tab = "cursos" | "docentes" | "pagos";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Fechas de las clases: desde el inicio, en los días de la semana elegidos (1 = lunes ... 7 = domingo) */
export function fechasDeClases(inicio: string, dias: number[], cantidad: number | null): Date[] {
  const n = Math.max(1, Math.min(cantidad || 1, 200));
  const d = new Date(inicio.length === 10 ? inicio + "T12:00:00" : inicio);
  const out: Date[] = [];
  if (!dias.length) {
    for (let i = 0; i < n; i++) out.push(new Date(d.getTime() + i * 7 * 86400000));
    return out;
  }
  for (let guard = 0; out.length < n && guard < 1500; guard++) {
    const dow = ((d.getDay() + 6) % 7) + 1;
    if (dias.includes(dow)) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
const diasTexto = (dias: number[]) => [...dias].sort().map((d) => DIAS_SEMANA[d - 1]).join(", ");
const fechaCorta = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

/** Honorario previsto (misma cuenta que la vista capacitaciones_resumen) */
function honorarioPrevisto(tipo: HonorarioTipo, monto: number, clases: number | null, horaIni: string | null, horaFin: string | null, alumnos = 0, recaudado = 0) {
  const horas = horaIni && horaFin ? Math.max(0, (Date.parse(`2000-01-01T${horaFin}`) - Date.parse(`2000-01-01T${horaIni}`)) / 3600000) : 1;
  switch (tipo) {
    case "por_clase": return monto * (clases || 1);
    case "por_hora": return monto * (clases || 1) * (horas || 1);
    case "total": return monto;
    case "por_alumno": return monto * alumnos;
    case "porcentaje": return (recaudado * monto) / 100;
  }
}

function useDocentes() {
  return useQuery({
    queryKey: ["capacitaciones", "docentes"],
    queryFn: async () => unwrap(await supabase.from("docentes").select("*").order("nombre")) as Docente[],
  });
}

function useCursos() {
  return useQuery({
    queryKey: ["capacitaciones", "cursos"],
    queryFn: async () => {
      const [e, r] = await Promise.all([
        supabase.from("eventos").select("*").eq("tipo", "capacitacion").order("fecha_inicio", { ascending: false }),
        supabase.from("capacitaciones_resumen").select("*"),
      ]);
      const resumen = new Map((unwrap(r) as CapacitacionResumen[]).map((x) => [x.id, x]));
      return (unwrap(e) as Evento[]).map((c) => ({ ...c, resumen: resumen.get(c.id) }));
    },
  });
}

type Curso = Evento & { resumen?: CapacitacionResumen };

export default function Capacitaciones() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("cursos");
  return (
    <>
      <PageHeader title="Capacitaciones" subtitle="Cursos del CeCIP: cursada, docentes, inscripciones con facturación y pagos a docentes" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "cursos", label: "Cursos" },
        { value: "docentes", label: "Docentes" },
        ...(can("tesoreria") ? [{ value: "pagos" as Tab, label: "Pagos a docentes" }] : []),
      ]} />
      {tab === "cursos" && <Cursos />}
      {tab === "docentes" && <Docentes />}
      {tab === "pagos" && <PagosDocentes />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cursos
// ---------------------------------------------------------------------------

function Cursos() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: cursos, isLoading } = useCursos();
  const [vista, setVista] = useState<"activos" | "finalizados" | "todos">("activos");
  const [editar, setEditar] = useState<Curso | "nuevo" | null>(null);
  const [inscriptos, setInscriptos] = useState<Curso | null>(null);
  const [compartir, setCompartir] = useState<Curso | null>(null);
  const [pagar, setPagar] = useState<Curso | null>(null);

  const ahora = Date.now();
  const lista = (cursos || []).filter((c) => {
    const fin = new Date(c.fecha_fin || c.fecha_inicio).getTime();
    if (vista === "activos") return !c.cancelado && fin >= ahora - 86400000;
    if (vista === "finalizados") return c.cancelado || fin < ahora - 86400000;
    return true;
  });
  const tot = lista.reduce((a, c) => ({
    inscriptos: a.inscriptos + (c.resumen?.inscriptos || 0),
    recaudado: a.recaudado + Number(c.resumen?.recaudado || 0),
    aCobrar: a.aCobrar + Number(c.resumen?.a_cobrar || 0),
    deudaDocentes: a.deudaDocentes + Math.max(0, Number(c.resumen?.honorario_previsto || 0) - Number(c.resumen?.pagado_docente || 0)),
  }), { inscriptos: 0, recaudado: 0, aCobrar: 0, deudaDocentes: 0 });

  async function eliminar(c: Curso) {
    if (!confirm(`¿Eliminar "${c.titulo}" y sus inscripciones? Si ya tiene cobros o pagos, mejor marcalo como cancelado.`)) return;
    const { error } = await supabase.from("eventos").delete().eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("capacitaciones", "eventos");
  }

  const puede = can("atencion", "prensa");
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Inscriptos" value={tot.inscriptos} icon={<Users className="h-4 w-4" />} />
        <Stat label="Recaudado" value={pesos(tot.recaudado)} tone="good" />
        <Stat label="Inscripciones a cobrar" value={pesos(tot.aCobrar)} tone={tot.aCobrar ? "warn" : "default"} />
        {can("tesoreria") && <Stat label="Honorarios a pagar" value={pesos(tot.deudaDocentes)} tone={tot.deudaDocentes ? "warn" : "default"} hint="Previsto menos lo ya pagado" />}
      </div>
      <Card
        title={
          <Select className="w-auto py-1 text-sm" value={vista} onChange={(e) => setVista(e.target.value as typeof vista)}>
            <option value="activos">Próximos y en curso</option>
            <option value="finalizados">Finalizados y cancelados</option>
            <option value="todos">Todos</option>
          </Select>
        }
        actions={puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nuevo")}>Nueva capacitación</Button>}
      >
        {isLoading ? <Loading /> : !lista.length ? (
          <Empty icon={<GraduationCap className="h-10 w-10" />}>No hay capacitaciones {vista === "activos" ? "próximas ni en curso" : ""}.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((c) => {
              const r = c.resumen;
              const clases = fechasDeClases(c.fecha_inicio, c.dias_semana || [], c.cantidad_clases);
              const saldoDocente = Math.max(0, Number(r?.honorario_previsto || 0) - Number(r?.pagado_docente || 0));
              return (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.titulo}</span>
                        {c.cancelado ? <Badge tone="red">Cancelada</Badge> : c.publicado ? <Badge tone="green">Publicada en el portal</Badge> : <Badge>Borrador</Badge>}
                        {!c.inscripcion_abierta && !c.cancelado && <Badge tone="amber">Inscripción cerrada</Badge>}
                        {c.formulario_publico && <Badge tone="purple">Formulario público</Badge>}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-600">
                        {r?.docente_nombre ? <>Docente: <b>{r.docente_nombre}</b></> : <span className="text-amber-700">Sin docente asignado</span>}
                        {" · "}{c.dias_semana?.length ? diasTexto(c.dias_semana) : "Semanal"}{c.hora_inicio && ` de ${hhmm(c.hora_inicio)} a ${hhmm(c.hora_fin)} hs`}
                        {" · "}{c.cantidad_clases || 1} clase{(c.cantidad_clases || 1) > 1 ? "s" : ""}
                      </div>
                      <div className="text-xs text-slate-500">
                        Del {fecha(isoLocal(clases[0]))} al {fecha(isoLocal(clases[clases.length - 1]))} · {c.modalidad}{c.lugar && ` · ${c.lugar}`} ·{" "}
                        Socios {Number(c.costo) > 0 ? pesos(c.costo) : "sin cargo"}
                        {c.precio_no_socio !== null && Number(c.precio_no_socio) !== Number(c.costo) && ` · No socios ${pesos(c.precio_no_socio)}`}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span><b>{r?.inscriptos || 0}</b>{c.cupo ? ` / ${c.cupo}` : ""} inscriptos ({r?.inscriptos_pagos || 0} pagos)</span>
                        <span className="text-emerald-700">Recaudado {pesos(r?.recaudado)}</span>
                        {Number(r?.a_cobrar) > 0 && <span className="text-amber-700">A cobrar {pesos(r?.a_cobrar)}</span>}
                        {can("tesoreria") && (
                          <span>
                            Docente: {HONORARIOS[c.honorario_tipo].toLowerCase()} {c.honorario_tipo === "porcentaje" ? `${c.honorario_monto}%` : pesos(c.honorario_monto)} → previsto {pesos(r?.honorario_previsto)}, pagado {pesos(r?.pagado_docente)}
                            {saldoDocente > 0 && <b className="text-amber-700"> · resta {pesos(saldoDocente)}</b>}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="sm" variant="secondary" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setInscriptos(c)}>Inscriptos</Button>
                      {c.formulario_publico && c.slug && <Button size="sm" variant="secondary" icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => setCompartir(c)}>Compartir</Button>}
                      {can("tesoreria") && c.docente_id && <Button size="sm" variant="secondary" icon={<Wallet className="h-3.5 w-3.5" />} onClick={() => setPagar(c)}>Pagar docente</Button>}
                      {puede && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(c)} />}
                      {puede && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(c)} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <CursoForm value={editar} onClose={() => setEditar(null)} />
      <InscriptosCurso curso={inscriptos} onClose={() => setInscriptos(null)} />
      <CompartirModal evento={compartir} onClose={() => setCompartir(null)} />
      <PagoDocenteModal abierto={!!pagar} cursoInicial={pagar} onClose={() => setPagar(null)} />
    </>
  );
}

const cursoVacio = {
  titulo: "", descripcion: "", docente_id: "", modalidad: "presencial" as Evento["modalidad"], lugar: "Sede CeCIP", link: "",
  fecha: hoyISO(), dias: [] as number[], hora_inicio: "18:00", hora_fin: "20:00", cantidad_clases: "8", cupo: "",
  costo: "0", precio_no_socio: "", honorario_tipo: "por_clase" as HonorarioTipo, honorario_monto: "0",
  publicado: true, inscripcion_abierta: true, formulario_publico: true, facturar: true, cancelado: false,
  imagen_url: null as string | null, preguntas: [] as PreguntaFormulario[],
};

function CursoForm({ value, onClose }: { value: Curso | "nuevo" | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { can } = useAuth();
  const { data: docentes } = useDocentes();
  const [f, setF] = useState(cursoVacio);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nuevo") return setF(cursoVacio);
    const ini = new Date(value.fecha_inicio);
    setF({
      titulo: value.titulo, descripcion: value.descripcion || "", docente_id: value.docente_id || "", modalidad: value.modalidad,
      lugar: value.lugar || "", link: value.link || "", fecha: isoLocal(ini), dias: value.dias_semana || [],
      hora_inicio: hhmm(value.hora_inicio) || ini.toTimeString().slice(0, 5), hora_fin: hhmm(value.hora_fin),
      cantidad_clases: String(value.cantidad_clases || 1), cupo: value.cupo ? String(value.cupo) : "", costo: String(value.costo),
      precio_no_socio: value.precio_no_socio !== null ? String(value.precio_no_socio) : "", honorario_tipo: value.honorario_tipo,
      honorario_monto: String(value.honorario_monto), publicado: value.publicado, inscripcion_abierta: value.inscripcion_abierta,
      formulario_publico: value.formulario_publico, facturar: value.facturar, cancelado: value.cancelado, imagen_url: value.imagen_url,
      preguntas: value.preguntas || [],
    });
  }, [value]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const clases = useMemo(() => fechasDeClases(f.fecha, f.dias, Number(f.cantidad_clases) || 1), [f.fecha, f.dias, f.cantidad_clases]);
  const previsto = honorarioPrevisto(f.honorario_tipo, num(f.honorario_monto), Number(f.cantidad_clases) || 1, f.hora_inicio, f.hora_fin);
  const docente = docentes?.find((d) => d.id === f.docente_id);

  async function guardar() {
    if (!f.titulo.trim()) return setError("Poné el nombre de la capacitación.");
    if (!f.fecha || !f.hora_inicio) return setError("Completá la fecha de inicio y el horario.");
    if (f.hora_fin && f.hora_fin <= f.hora_inicio) return setError("La hora de fin tiene que ser posterior a la de inicio.");
    setSaving(true);
    const primera = isoLocal(clases[0]);
    const ultima = isoLocal(clases[clases.length - 1]);
    const payload = {
      titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null, tipo: "capacitacion" as const, docente_id: f.docente_id || null,
      modalidad: f.modalidad, lugar: f.lugar.trim() || null, link: f.link.trim() || null,
      fecha_inicio: new Date(`${primera}T${f.hora_inicio}`).toISOString(),
      fecha_fin: new Date(`${ultima}T${f.hora_fin || f.hora_inicio}`).toISOString(),
      dias_semana: [...f.dias].sort(), hora_inicio: f.hora_inicio, hora_fin: f.hora_fin || null,
      cantidad_clases: Number(f.cantidad_clases) || 1, cupo: f.cupo ? Number(f.cupo) : null, costo: num(f.costo),
      precio_no_socio: f.precio_no_socio.trim() ? num(f.precio_no_socio) : null,
      honorario_tipo: f.honorario_tipo, honorario_monto: num(f.honorario_monto),
      publicado: f.publicado, inscripcion_abierta: f.inscripcion_abierta, formulario_publico: f.formulario_publico,
      facturar: f.facturar, cancelado: f.cancelado, imagen_url: f.imagen_url,
      preguntas: f.preguntas.filter((p) => p.etiqueta.trim()).map((p) => ({ ...p, etiqueta: p.etiqueta.trim() })),
    };
    const res = value === "nuevo"
      ? await supabase.from("eventos").insert(payload)
      : await supabase.from("eventos").update(payload).eq("id", (value as Curso).id);
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast("Capacitación guardada.");
    invalidate("capacitaciones", "eventos", "dashboard");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="xl" title={value === "nuevo" ? "Nueva capacitación" : "Editar capacitación"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          <Field label="Nombre del curso *" className="sm:col-span-2"><Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} /></Field>
          <Field label="Docente" hint={docente?.honorario_sugerido ? `Honorario de referencia: ${pesos(docente.honorario_sugerido)}` : "Se cargan en la pestaña Docentes."}>
            <Select value={f.docente_id} onChange={(e) => set("docente_id", e.target.value)}>
              <option value="">— A definir —</option>
              {docentes?.filter((d) => d.activo || d.id === f.docente_id).map((d) => <option key={d.id} value={d.id}>{d.nombre}{d.especialidad ? ` · ${d.especialidad}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Modalidad">
            <Select value={f.modalidad} onChange={(e) => set("modalidad", e.target.value as Evento["modalidad"])}>
              <option value="presencial">Presencial</option><option value="virtual">Virtual</option><option value="mixta">Mixta</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Días de cursada</span>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_SEMANA.map((d, i) => {
                const n = i + 1;
                const activo = f.dias.includes(n);
                return (
                  <button key={d} type="button" onClick={() => setF((x) => ({ ...x, dias: x.dias.includes(n) ? x.dias.filter((y) => y !== n) : [...x.dias, n] }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${activo ? "border-brand-600 bg-brand-700 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {d}
                  </button>
                );
              })}
            </div>
            {!f.dias.length && <span className="mt-1 block text-xs text-slate-500">Sin días marcados: una clase por semana el mismo día que el inicio.</span>}
          </div>
          <Field label="Desde (fecha de inicio)"><Input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} /></Field>
          <Field label="Cantidad de clases"><Input type="number" min={1} max={200} value={f.cantidad_clases} onChange={(e) => set("cantidad_clases", e.target.value)} /></Field>
          <Field label="Hora de inicio"><Input type="time" value={f.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} /></Field>
          <Field label="Hora de fin"><Input type="time" value={f.hora_fin} onChange={(e) => set("hora_fin", e.target.value)} /></Field>
          <Field label="Lugar"><Input value={f.lugar} onChange={(e) => set("lugar", e.target.value)} /></Field>
          <Field label="Link (Zoom, Meet…)" hint="Solo lo ven los inscriptos."><Input value={f.link} onChange={(e) => set("link", e.target.value)} /></Field>
          <Field label="Precio para socios ($)"><Input inputMode="decimal" value={f.costo} onChange={(e) => set("costo", e.target.value)} /></Field>
          <Field label="Precio para no socios ($)" hint="Vacío = mismo precio."><Input inputMode="decimal" value={f.precio_no_socio} onChange={(e) => set("precio_no_socio", e.target.value)} /></Field>
          <Field label="Cupo (vacío = sin límite)"><Input inputMode="numeric" value={f.cupo} onChange={(e) => set("cupo", e.target.value.replace(/\D/g, ""))} /></Field>
          <div className="flex items-end pb-2"><Checkbox checked={f.facturar} onChange={(v) => set("facturar", v)} label="Facturar las inscripciones (ARCA)" /></div>
          <Field label="Descripción / temario" className="sm:col-span-2"><Textarea rows={4} value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} /></Field>
          <div className="sm:col-span-2"><ImagenInput value={f.imagen_url} onChange={(u) => set("imagen_url", u)} carpeta="capacitaciones" label="Imagen o flyer (opcional)" /></div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-brand-600" />Cronograma ({clases.length} clases)</div>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
              {clases.map((d, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{i + 1}. {DIAS_SEMANA[(d.getDay() + 6) % 7]} {fechaCorta(d)}</span>)}
            </div>
            <div className="mt-2 text-xs text-slate-500">Termina el {fecha(isoLocal(clases[clases.length - 1]))}{f.hora_inicio && ` · ${f.hora_inicio} a ${f.hora_fin || "?"} hs`}</div>
          </div>

          {can("tesoreria", "atencion", "prensa") && (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-brand-600" />Honorarios del docente</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Se paga">
                  <Select value={f.honorario_tipo} onChange={(e) => set("honorario_tipo", e.target.value as HonorarioTipo)}>
                    {Object.entries(HONORARIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label={f.honorario_tipo === "porcentaje" ? "Porcentaje (%)" : "Monto ($)"}>
                  <Input inputMode="decimal" value={f.honorario_monto} onChange={(e) => set("honorario_monto", e.target.value)} />
                </Field>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {["por_alumno", "porcentaje"].includes(f.honorario_tipo)
                  ? "El total depende de los inscriptos que paguen: se calcula solo en el resumen del curso."
                  : <>Total previsto: <b>{pesos(previsto)}</b></>}
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <Checkbox checked={f.publicado} onChange={(v) => set("publicado", v)} label="Publicada en el portal de socios" />
            <Checkbox checked={f.inscripcion_abierta} onChange={(v) => set("inscripcion_abierta", v)} label="Inscripción abierta" />
            <Checkbox checked={f.formulario_publico} onChange={(v) => set("formulario_publico", v)} label="Formulario público (no socios)" />
            {value !== "nuevo" && <Checkbox checked={f.cancelado} onChange={(v) => set("cancelado", v)} label="Capacitación cancelada" />}
            {f.formulario_publico && (
              <div className="pt-1">
                <div className="mb-1 text-xs text-slate-500">El formulario pide CUIT, razón social y condición IVA para la factura. Preguntas extra:</div>
                <EditorPreguntas value={f.preguntas} onChange={(p) => set("preguntas", p)} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inscriptos del curso: datos de facturación, cobro y factura
// ---------------------------------------------------------------------------

const inscVacia = { socio: "", nombre: "", email: "", telefono: "", empresa: "", cuit: "", razon_social: "", condicion_iva: "" as CondicionIva | "" };

function InscriptosCurso({ curso, onClose }: { curso: Curso | null; onClose: () => void }) {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const [nueva, setNueva] = useState(inscVacia);
  const [agregando, setAgregando] = useState(false);
  const [cobrar, setCobrar] = useState<Inscripcion | null>(null);
  const [editar, setEditar] = useState<Inscripcion | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ["capacitaciones", "inscriptos", curso?.id],
    enabled: !!curso,
    queryFn: async () => {
      const ins = unwrap(await supabase.from("inscripciones").select("*").eq("evento_id", curso!.id).order("created_at")) as Inscripcion[];
      const ids = ins.map((i) => i.id);
      const fac = ids.length
        ? (unwrap(await supabase.from("facturas").select("id, inscripcion_id, estado, tipo, punto_venta, numero, pdf_url, error").in("inscripcion_id", ids).neq("estado", "anulada")) as Factura[])
        : [];
      return { ins, facturas: new Map(fac.map((f) => [f.inscripcion_id!, f])) };
    },
  });

  if (!curso) return null;
  const lista = data?.ins || [];
  const refrescar = () => { refetch(); invalidate("capacitaciones", "movimientos", "facturas", "cuotas", "socios"); };

  async function agregar() {
    const s = socios?.find((x) => x.id === nueva.socio);
    const nombre = nueva.nombre.trim() || (s ? nombreSocio(s) : "");
    if (!nombre) return toast("Indicá el nombre del asistente.", "error");
    if (nueva.cuit && nueva.cuit.replace(/\D/g, "").length !== 11) return toast("El CUIT/CUIL tiene que tener 11 números.", "error");
    setAgregando(true);
    const { error } = await supabase.from("inscripciones").insert({
      evento_id: curso!.id, socio_id: nueva.socio || null, asistente_nombre: nombre, asistente_email: nueva.email.trim() || s?.email || null,
      asistente_telefono: nueva.telefono.trim() || null, empresa: nueva.empresa.trim() || null, cuit: nueva.cuit.trim() ? formatCuit(nueva.cuit) : null,
      razon_social: nueva.razon_social.trim() || null, condicion_iva: nueva.condicion_iva || null, es_socio: !!nueva.socio, origen: "erp",
    });
    setAgregando(false);
    if (error) return toast(traducirError(error.message), "error");
    setNueva(inscVacia);
    refrescar();
  }

  async function rpc(nombre: string, params: Record<string, unknown>, ok: string) {
    const { error } = await supabase.rpc(nombre, params);
    if (error) return toast(traducirError(error.message), "error");
    toast(ok);
    refrescar();
  }

  async function facturar(i: Inscripcion) {
    const { data: id, error } = await supabase.rpc("facturar_inscripcion", { p_inscripcion: i.id });
    if (error) return toast(traducirError(error.message), "error");
    const r = await enviarFacturasEnCola([id as string]);
    toast(r?.sinConfigurar ? "Factura en cola: falta configurar la conexión con n8n / ARCA." : r?.errores ? "ARCA rechazó la factura: revisá el detalle." : "Factura enviada a ARCA.", r?.errores ? "error" : "ok");
    refrescar();
  }

  async function bonificar(i: Inscripcion) {
    if (!confirm(`¿Bonificar la inscripción de ${i.asistente_nombre}? No se le cobra ni se factura.`)) return;
    const { error } = await supabase.from("inscripciones").update({ estado_pago: "bonificada" }).eq("id", i.id);
    if (error) return toast(traducirError(error.message), "error");
    refrescar();
  }

  async function quitar(i: Inscripcion) {
    if (i.estado_pago === "pagada" || i.estado_pago === "en_cuenta") return toast("Tiene un cobro registrado: primero anulá el cobro (o la cuota).", "error");
    if (!confirm(`¿Quitar a ${i.asistente_nombre}?`)) return;
    const { error } = await supabase.from("inscripciones").delete().eq("id", i.id);
    if (error) return toast(traducirError(error.message), "error");
    refrescar();
  }

  const recaudado = lista.filter((i) => i.estado_pago === "pagada").reduce((a, i) => a + Number(i.monto_pagado ?? i.monto), 0);
  const aCobrar = lista.filter((i) => ["pendiente", "en_cuenta"].includes(i.estado_pago)).reduce((a, i) => a + Number(i.monto), 0);

  return (
    <Modal open onClose={onClose} size="xl" title={`Inscriptos · ${curso.titulo}`}
      footer={
        <>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!lista.length}
            onClick={() => descargarCSV(`inscriptos-${curso.titulo}`, lista.map((i) => ({
              asistente: i.asistente_nombre, email: i.asistente_email, telefono: i.asistente_telefono, socio: i.socio_id ? "Sí" : "No",
              factura_a: i.razon_social || i.empresa, cuit: i.cuit, condicion_iva: i.condicion_iva, importe: Number(i.monto),
              estado: ESTADOS_PAGO_INSCRIPCION[i.estado_pago].label, pagado: i.monto_pagado ? Number(i.monto_pagado) : "", fecha_pago: fecha(i.fecha_pago),
              ...Object.fromEntries((curso.preguntas || []).map((p) => [p.etiqueta, i.respuestas?.[p.id] || ""])),
            })))}>Exportar</Button>
          <Button onClick={onClose}>Cerrar</Button>
        </>
      }>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span><b>{lista.length}</b>{curso.cupo ? ` / ${curso.cupo}` : ""} inscriptos</span>
        <span className="text-emerald-700">Recaudado {pesos(recaudado)}</span>
        <span className="text-amber-700">A cobrar {pesos(aCobrar)}</span>
        {cfg && !cfg.facturacion_auto && <span className="text-xs text-slate-500">Facturación automática desactivada: usá «Facturar» en cada cobro.</span>}
      </div>

      {can("atencion", "tesoreria", "prensa") && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4" />Inscribir</div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Select value={nueva.socio} onChange={(e) => setNueva({ ...nueva, socio: e.target.value })}>
              <option value="">No socio</option>
              {socios?.filter((s) => s.estado === "activo").map((s) => <option key={s.id} value={s.id}>{nombreSocio(s)}</option>)}
            </Select>
            <Input placeholder="Nombre del asistente" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
            <Input placeholder="Email" value={nueva.email} onChange={(e) => setNueva({ ...nueva, email: e.target.value })} />
            <Input placeholder="Teléfono" value={nueva.telefono} onChange={(e) => setNueva({ ...nueva, telefono: e.target.value })} />
            {!nueva.socio && (
              <>
                <Input placeholder="CUIT / CUIL para facturar" value={nueva.cuit} onChange={(e) => setNueva({ ...nueva, cuit: e.target.value })} />
                <Input placeholder="Razón social (factura a nombre de)" value={nueva.razon_social} onChange={(e) => setNueva({ ...nueva, razon_social: e.target.value })} />
                <Select value={nueva.condicion_iva} onChange={(e) => setNueva({ ...nueva, condicion_iva: e.target.value as CondicionIva | "" })}>
                  <option value="">Condición IVA…</option>
                  {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
                </Select>
              </>
            )}
            <Button onClick={agregar} loading={agregando} icon={<Plus className="h-4 w-4" />} className={nueva.socio ? "sm:col-span-4" : ""}>Inscribir</Button>
          </div>
          {nueva.socio && <p className="mt-1 text-xs text-slate-500">Los datos de facturación se toman del socio. Precio socio: {pesos(curso.costo)}.</p>}
          {!nueva.socio && <p className="mt-1 text-xs text-slate-500">Precio no socio: {pesos(curso.precio_no_socio ?? curso.costo)}.</p>}
        </div>
      )}

      {!data ? <Loading /> : !lista.length ? <Empty>Sin inscriptos todavía.</Empty> : (
        <Table>
          <thead className="bg-slate-50">
            <tr><th className="th">Asistente</th><th className="th min-w-44">Factura a</th><th className="th text-right">Importe</th><th className="th">Pago</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map((i) => {
              const fac = data.facturas.get(i.id);
              return (
                <tr key={i.id}>
                  <td className="td text-sm">
                    <div className="font-medium">{i.asistente_nombre}</div>
                    <div className="text-xs text-slate-500">{[i.asistente_email, i.asistente_telefono].filter(Boolean).join(" · ")}</div>
                    {i.socio_id ? <Badge tone="blue">Socio</Badge> : <Badge tone="purple">No socio</Badge>}
                    {i.origen === "publico" && <span className="ml-1 text-[11px] text-slate-400">formulario público</span>}
                  </td>
                  <td className="td text-xs">
                    <div className="text-sm">{i.razon_social || i.empresa || <span className="text-slate-400">—</span>}</div>
                    {i.cuit ? <div>CUIT {formatCuit(i.cuit)}</div> : <div className="text-amber-700">Sin CUIT (consumidor final)</div>}
                    {i.condicion_iva && <div>{i.condicion_iva}</div>}
                    {can("atencion", "tesoreria", "prensa") && <button className="text-brand-600 hover:underline" onClick={() => setEditar(i)}>Editar datos</button>}
                  </td>
                  <td className="td text-right tabular-nums">{pesos(i.estado_pago === "pagada" ? i.monto_pagado ?? i.monto : i.monto)}</td>
                  <td className="td">
                    <Badge tone={ESTADOS_PAGO_INSCRIPCION[i.estado_pago].tone}>{ESTADOS_PAGO_INSCRIPCION[i.estado_pago].label}</Badge>
                    {i.estado_pago === "pagada" && <div className="text-[11px] text-slate-500">{fecha(i.fecha_pago)} · {i.metodo_pago}{i.recibo_numero && ` · Rec. ${i.recibo_numero}`}</div>}
                    {fac && <div className="text-[11px]"><Badge tone={ESTADOS_FACTURA[fac.estado].tone}>Factura {fac.tipo}: {ESTADOS_FACTURA[fac.estado].label}</Badge>
                      {fac.pdf_url && <a href={fac.pdf_url} target="_blank" rel="noreferrer" className="ml-1 text-brand-600 hover:underline">PDF</a>}</div>}
                    {i.estado_pago === "en_cuenta" && <div className="text-[11px] text-slate-500">Se factura con la cuota del socio</div>}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    {i.estado_pago === "pendiente" && can("atencion", "tesoreria") && (
                      <>
                        <Button size="sm" variant="success" onClick={() => setCobrar(i)}>Cobrar</Button>
                        {i.socio_id && <Button size="sm" variant="ghost" title="Cargar en la cuenta corriente del socio" onClick={() => rpc("cargar_inscripcion_a_cuenta", { p_inscripcion: i.id }, "Cargado en la cuenta del socio: lo puede pagar desde el portal.")}>A su cuenta</Button>}
                        <Button size="sm" variant="ghost" className="text-slate-400" title="Bonificar" onClick={() => bonificar(i)}><Ban className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    {i.estado_pago === "pagada" && !i.cuota_id && !fac && can("atencion", "tesoreria") && (
                      <Button size="sm" variant="ghost" icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => facturar(i)}>Facturar</Button>
                    )}
                    {i.estado_pago === "pagada" && !i.cuota_id && can("tesoreria") && (
                      <Button size="sm" variant="ghost" className="text-slate-400" title="Anular cobro"
                        onClick={() => confirm("¿Anular el cobro? Se borra el ingreso de tesorería (si ya se facturó, hacé la nota de crédito en ARCA).") && rpc("anular_pago_inscripcion", { p_inscripcion: i.id }, "Cobro anulado.")}>
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {can("atencion", "tesoreria", "prensa") && <button onClick={() => quitar(i)} className="ml-1 text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <CobrarInscripcion insc={cobrar} onClose={() => setCobrar(null)} onDone={refrescar} />
      <DatosFactura insc={editar} onClose={() => setEditar(null)} onDone={refrescar} />
    </Modal>
  );
}

function CobrarInscripcion({ insc, onClose, onDone }: { insc: Inscripcion | null; onClose: () => void; onDone: () => void }) {
  const { data: cuentas } = useCuentas();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const [f, setF] = useState({ metodo: "Efectivo", cuenta: "", fecha: hoyISO(), monto: "", referencia: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (insc) { setF({ metodo: "Efectivo", cuenta: cfg?.cuenta_default_id || "", fecha: hoyISO(), monto: String(insc.monto), referencia: "" }); setError(null); }
  }, [insc, cfg]);

  async function guardar() {
    if (!num(f.monto)) return setError("Ingresá un monto válido.");
    setSaving(true);
    const { data, error } = await supabase.rpc("registrar_pago_inscripcion", {
      p_inscripcion: insc!.id, p_metodo: f.metodo, p_cuenta: f.cuenta || null, p_fecha: f.fecha, p_monto: num(f.monto), p_referencia: f.referencia || null,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    if (cfg?.facturacion_auto) await enviarFacturasEnCola();
    toast(`Cobro registrado. Recibo N° ${data.recibo_numero}.${cfg?.facturacion_auto ? " La factura se envió a ARCA." : ""}`);
    onDone();
    onClose();
  }

  return (
    <Modal open={!!insc} onClose={onClose} title="Cobrar inscripción"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="success" loading={saving} onClick={guardar}>Confirmar cobro</Button></>}>
      {insc && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <b>{insc.asistente_nombre}</b> · factura a {insc.razon_social || insc.empresa || insc.asistente_nombre}
            {insc.cuit ? ` (CUIT ${formatCuit(insc.cuit)})` : " (consumidor final)"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Forma de pago"><Select value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>{METODOS_PAGO.map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Ingresa en">
              <Select value={f.cuenta} onChange={(e) => setF({ ...f, cuenta: e.target.value })}>
                <option value="">— Sin cuenta —</option>
                {cuentas?.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Fecha"><Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
            <Field label="Monto"><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
          </div>
          <Field label="Referencia (opcional)"><Input value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></Field>
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}

function DatosFactura({ insc, onClose, onDone }: { insc: Inscripcion | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ razon_social: "", cuit: "", condicion_iva: "" as CondicionIva | "", monto: "" });
  useEffect(() => {
    if (insc) setF({ razon_social: insc.razon_social || insc.empresa || "", cuit: insc.cuit || "", condicion_iva: insc.condicion_iva || "", monto: String(insc.monto) });
  }, [insc]);

  async function guardar() {
    if (f.cuit && f.cuit.replace(/\D/g, "").length !== 11) return toast("El CUIT/CUIL tiene que tener 11 números.", "error");
    const cambios: Record<string, unknown> = { razon_social: f.razon_social.trim() || null, cuit: f.cuit.trim() ? formatCuit(f.cuit) : null, condicion_iva: f.condicion_iva || null };
    if (insc!.estado_pago === "pendiente") cambios.monto = num(f.monto);
    const { error } = await supabase.from("inscripciones").update(cambios).eq("id", insc!.id);
    if (error) return toast(traducirError(error.message), "error");
    onDone();
    onClose();
  }

  return (
    <Modal open={!!insc} onClose={onClose} title="Datos para la factura"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Razón social / nombre"><Input value={f.razon_social} onChange={(e) => setF({ ...f, razon_social: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CUIT / CUIL"><Input value={f.cuit} onChange={(e) => setF({ ...f, cuit: e.target.value })} /></Field>
          <Field label="Condición frente al IVA">
            <Select value={f.condicion_iva} onChange={(e) => setF({ ...f, condicion_iva: e.target.value as CondicionIva | "" })}>
              <option value="">—</option>
              {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
            </Select>
          </Field>
        </div>
        {insc?.estado_pago === "pendiente" && <Field label="Importe a cobrar" hint="Por ejemplo, para aplicar un descuento."><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>}
        {insc && insc.estado_pago !== "pendiente" && <p className="text-xs text-slate-500">Si la factura ya se emitió, el cambio vale para las próximas; la emitida se corrige con nota de crédito en ARCA.</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Docentes
// ---------------------------------------------------------------------------

function Docentes() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: docentes, isLoading } = useDocentes();
  const { data: cursos } = useCursos();
  const [editar, setEditar] = useState<Docente | "nuevo" | null>(null);
  const [ver, setVer] = useState<Docente | null>(null);
  const [inactivos, setInactivos] = useState(false);

  const { data: pagos } = useQuery({
    queryKey: ["capacitaciones", "pagos-docentes"],
    enabled: can("tesoreria"),
    queryFn: async () => unwrap(await supabase.from("docente_pagos").select("*").order("fecha", { ascending: false })) as DocentePago[],
  });

  async function activar(d: Docente, activo: boolean) {
    const { error } = await supabase.from("docentes").update({ activo }).eq("id", d.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("capacitaciones");
  }

  async function eliminar(d: Docente) {
    const tienePagos = (pagos || []).some((p) => p.docente_id === d.id);
    if (tienePagos) return toast("Tiene pagos registrados: no se puede eliminar (queda el historial). Podés desactivarlo.", "error");
    if (!confirm(`¿Eliminar a ${d.nombre}? Sus capacitaciones quedan sin docente asignado.`)) return;
    const { error } = await supabase.from("docentes").delete().eq("id", d.id);
    if (error) return toast(traducirError(/foreign key/i.test(error.message) ? "Tiene pagos registrados: desactivalo en lugar de eliminarlo." : error.message), "error");
    invalidate("capacitaciones");
  }

  const puede = can("atencion", "tesoreria", "prensa");
  const lista = (docentes || []).filter((d) => inactivos || d.activo);
  return (
    <>
      <Card
        title="Docentes"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Ver inactivos</label>
            {puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nuevo")}>Agregar docente</Button>}
          </div>
        }
      >
        {isLoading ? <Loading /> : !lista.length ? <Empty icon={<GraduationCap className="h-8 w-8" />}>Todavía no hay docentes cargados.</Empty> : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Docente</th><th className="th">Contacto</th><th className="th">Cursos</th>{can("tesoreria") && <th className="th text-right">Pagado</th>}<th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((d) => {
                const susCursos = (cursos || []).filter((c) => c.docente_id === d.id);
                const pagado = (pagos || []).filter((p) => p.docente_id === d.id).reduce((a, p) => a + Number(p.monto), 0);
                return (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setVer(d)}>
                    <td className="td">
                      <div className="font-medium">{d.nombre} {!d.activo && <Badge>Inactivo</Badge>}</div>
                      <div className="text-xs text-slate-500">{[d.especialidad, d.cuit && `CUIT ${formatCuit(d.cuit)}`, d.condicion_iva].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="td text-xs text-slate-500">{d.email}<div>{d.telefono}</div></td>
                    <td className="td text-sm">{susCursos.length}</td>
                    {can("tesoreria") && <td className="td text-right tabular-nums">{pesos(pagado)}</td>}
                    <td className="td whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      {puede && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(d)} />
                          <Button size="sm" variant="ghost" onClick={() => activar(d, !d.activo)}>{d.activo ? "Desactivar" : "Activar"}</Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(d)} />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <DocenteForm value={editar} onClose={() => setEditar(null)} />
      <DocenteDetalle docente={ver} cursos={(cursos || []).filter((c) => c.docente_id === ver?.id)} pagos={(pagos || []).filter((p) => p.docente_id === ver?.id)} onClose={() => setVer(null)} />
    </>
  );
}

function DocenteForm({ value, onClose }: { value: Docente | "nuevo" | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const vacio = { nombre: "", cuit: "", condicion_iva: "" as CondicionIva | "", email: "", telefono: "", especialidad: "", cbu: "", alias: "", honorario_sugerido: "", observaciones: "" };
  const [f, setF] = useState(vacio);
  useEffect(() => {
    if (!value) return;
    setF(value === "nuevo" ? vacio : {
      nombre: value.nombre, cuit: value.cuit || "", condicion_iva: value.condicion_iva || "", email: value.email || "", telefono: value.telefono || "",
      especialidad: value.especialidad || "", cbu: value.cbu || "", alias: value.alias || "",
      honorario_sugerido: value.honorario_sugerido ? String(value.honorario_sugerido) : "", observaciones: value.observaciones || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function guardar() {
    if (!f.nombre.trim()) return toast("Completá el nombre.", "error");
    const payload = {
      nombre: f.nombre.trim(), cuit: f.cuit.trim() ? formatCuit(f.cuit) : null, condicion_iva: f.condicion_iva || null,
      email: f.email.trim() || null, telefono: f.telefono.trim() || null, especialidad: f.especialidad.trim() || null,
      cbu: f.cbu.trim() || null, alias: f.alias.trim() || null, honorario_sugerido: f.honorario_sugerido ? num(f.honorario_sugerido) : null,
      observaciones: f.observaciones.trim() || null,
    };
    const { error } = value === "nuevo"
      ? await supabase.from("docentes").insert(payload)
      : await supabase.from("docentes").update(payload).eq("id", (value as Docente).id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Docente guardado.");
    invalidate("capacitaciones");
    onClose();
  }

  const campo = (k: keyof typeof f, label: string, extra?: { hint?: string; className?: string }) => (
    <Field label={label} hint={extra?.hint} className={extra?.className}>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nuevo" ? "Nuevo docente" : "Editar docente"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {campo("nombre", "Nombre y apellido *", { className: "sm:col-span-2" })}
        {campo("especialidad", "Especialidad")}
        {campo("cuit", "CUIT / CUIL")}
        <Field label="Condición frente al IVA">
          <Select value={f.condicion_iva} onChange={(e) => setF({ ...f, condicion_iva: e.target.value as CondicionIva | "" })}>
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
          </Select>
        </Field>
        {campo("honorario_sugerido", "Honorario de referencia ($)", { hint: "Por clase u hora: se sugiere al cargar cursos." })}
        {campo("email", "Email")}
        {campo("telefono", "Teléfono / WhatsApp")}
        {campo("cbu", "CBU / CVU")}
        {campo("alias", "Alias")}
        <Field label="Observaciones" className="sm:col-span-2"><Textarea rows={2} value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function DocenteDetalle({ docente, cursos, pagos, onClose }: { docente: Docente | null; cursos: Curso[]; pagos: DocentePago[]; onClose: () => void }) {
  const { can } = useAuth();
  if (!docente) return null;
  const total = pagos.reduce((a, p) => a + Number(p.monto), 0);
  return (
    <Modal open onClose={onClose} size="lg" title={docente.nombre}>
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div><span className="text-slate-500">CUIT:</span> {docente.cuit ? formatCuit(docente.cuit) : "—"} {docente.condicion_iva && `· ${docente.condicion_iva}`}</div>
          <div><span className="text-slate-500">Contacto:</span> {[docente.email, docente.telefono].filter(Boolean).join(" · ") || "—"}</div>
          <div><span className="text-slate-500">CBU/Alias:</span> {[docente.cbu, docente.alias].filter(Boolean).join(" · ") || "—"}</div>
          <div><span className="text-slate-500">Honorario de referencia:</span> {docente.honorario_sugerido ? pesos(docente.honorario_sugerido) : "—"}</div>
        </div>
        <div>
          <div className="mb-1 font-semibold">Capacitaciones ({cursos.length})</div>
          {!cursos.length ? <p className="text-slate-500">Sin capacitaciones asignadas.</p> : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {cursos.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 px-3 py-2">
                  <span>{c.titulo}<span className="text-xs text-slate-500"> · {fecha(c.fecha_inicio)}</span></span>
                  {can("tesoreria") && <span className="text-xs">previsto {pesos(c.resumen?.honorario_previsto)} · pagado {pesos(c.resumen?.pagado_docente)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {can("tesoreria") && (
          <div>
            <div className="mb-1 font-semibold">Historial de pagos · total {pesos(total)}</div>
            {!pagos.length ? <p className="text-slate-500">Sin pagos registrados.</p> : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {pagos.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 px-3 py-2">
                    <span>{fecha(p.fecha)} · {p.concepto}{p.clases && !/clase/i.test(p.concepto) && ` (${p.clases} clase${p.clases > 1 ? "s" : ""})`}<span className="text-xs text-slate-500"> · {p.metodo_pago}{p.comprobante && ` · ${p.comprobante}`}</span></span>
                    <b className="tabular-nums">{pesos(p.monto)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pagos a docentes (Tesorería)
// ---------------------------------------------------------------------------

function PagosDocentes() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: docentes } = useDocentes();
  const { data: cursos } = useCursos();
  const [docente, setDocente] = useState("");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [nuevo, setNuevo] = useState(false);

  const { data: pagos, isLoading } = useQuery({
    queryKey: ["capacitaciones", "pagos-docentes"],
    queryFn: async () => unwrap(await supabase.from("docente_pagos").select("*").order("fecha", { ascending: false })) as DocentePago[],
  });

  const lista = (pagos || []).filter((p) => (!docente || p.docente_id === docente) && (!anio || p.fecha.startsWith(anio)));
  const nombreDoc = (id: string) => docentes?.find((d) => d.id === id)?.nombre || "—";
  const nombreCurso = (id: string | null) => cursos?.find((c) => c.id === id)?.titulo || "—";
  const total = lista.reduce((a, p) => a + Number(p.monto), 0);
  const anios = [...new Set([String(new Date().getFullYear()), ...(pagos || []).map((p) => p.fecha.slice(0, 4))])].sort().reverse();

  async function anular(p: DocentePago) {
    if (!confirm(`¿Anular el pago de ${pesos(p.monto)} a ${nombreDoc(p.docente_id)}? Se borra el egreso de tesorería.`)) return;
    const { error } = await supabase.rpc("anular_pago_docente", { p_pago: p.id });
    if (error) return toast(traducirError(error.message), "error");
    invalidate("capacitaciones", "movimientos");
  }

  return (
    <>
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Select className="w-auto py-1 text-sm" value={docente} onChange={(e) => setDocente(e.target.value)}>
              <option value="">Todos los docentes</option>
              {docentes?.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </Select>
            <Select className="w-auto py-1 text-sm" value={anio} onChange={(e) => setAnio(e.target.value)}>
              {anios.map((a) => <option key={a}>{a}</option>)}
              <option value="">Todos los años</option>
            </Select>
            <span className="text-sm font-normal text-slate-500">Total {pesos(total)}</span>
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} disabled={!lista.length}
              onClick={() => descargarCSV(`pagos-docentes-${anio || "todos"}`, lista.map((p) => ({
                fecha: fecha(p.fecha), docente: nombreDoc(p.docente_id), capacitacion: nombreCurso(p.evento_id), concepto: p.concepto,
                clases: p.clases, monto: Number(p.monto), forma: p.metodo_pago, comprobante: p.comprobante,
              })))}>Exportar</Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNuevo(true)}>Registrar pago</Button>
          </div>
        }
      >
        {isLoading ? <Loading /> : !lista.length ? <Empty icon={<Wallet className="h-8 w-8" />}>Sin pagos registrados.</Empty> : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Fecha</th><th className="th">Docente</th><th className="th">Concepto</th><th className="th text-right">Monto</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="td whitespace-nowrap text-sm">{fecha(p.fecha)}</td>
                  <td className="td text-sm">{nombreDoc(p.docente_id)}</td>
                  <td className="td text-sm">
                    {p.concepto}{p.clases && !/clase/i.test(p.concepto) && <span className="text-slate-500"> · {p.clases} clase{p.clases > 1 ? "s" : ""}</span>}
                    <div className="text-xs text-slate-500">{nombreCurso(p.evento_id)} · {p.metodo_pago}{p.comprobante && ` · ${p.comprobante}`}</div>
                  </td>
                  <td className="td text-right font-medium tabular-nums">{pesos(p.monto)}</td>
                  <td className="td text-right"><Button size="sm" variant="ghost" className="text-slate-400" title="Anular" onClick={() => anular(p)}><Undo2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <PagoDocenteModal abierto={nuevo} cursoInicial={null} onClose={() => setNuevo(false)} />
    </>
  );
}

function PagoDocenteModal({ abierto, cursoInicial, onClose }: { abierto: boolean; cursoInicial: Curso | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: docentes } = useDocentes();
  const { data: cursos } = useCursos();
  const { data: cuentas } = useCuentas();
  const { data: cfg } = useConfig();
  const [f, setF] = useState({ docente: "", curso: "", clases: "", concepto: "", monto: "", fecha: hoyISO(), metodo: "Transferencia", cuenta: "", comprobante: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    const c = cursoInicial;
    const saldo = c?.resumen ? Math.max(0, Number(c.resumen.honorario_previsto) - Number(c.resumen.pagado_docente)) : 0;
    setF({
      docente: c?.docente_id || "", curso: c?.id || "", clases: "", concepto: c ? `Honorarios ${c.titulo}` : "Honorarios",
      monto: saldo ? String(saldo) : "", fecha: hoyISO(), metodo: "Transferencia", cuenta: cfg?.cuenta_default_id || "", comprobante: "",
    });
  }, [abierto, cursoInicial, cfg]);

  const curso = cursos?.find((c) => c.id === f.curso);
  // Pago por clase u hora: al indicar las clases se sugiere el monto
  function cambiarClases(v: string) {
    const n = Number(v) || 0;
    let monto = f.monto;
    if (curso && n && ["por_clase", "por_hora"].includes(curso.honorario_tipo)) {
      monto = String(honorarioPrevisto(curso.honorario_tipo, Number(curso.honorario_monto), n, curso.hora_inicio, curso.hora_fin));
    }
    setF({ ...f, clases: v, monto, concepto: curso && n ? `Honorarios ${curso.titulo} (${n} clases)` : f.concepto });
  }

  async function guardar() {
    if (!f.docente) return setError("Elegí el docente.");
    if (!num(f.monto)) return setError("Ingresá el monto.");
    setSaving(true);
    const { error } = await supabase.rpc("registrar_pago_docente", {
      p_docente: f.docente, p_evento: f.curso || null, p_monto: num(f.monto), p_concepto: f.concepto, p_clases: f.clases ? Number(f.clases) : null,
      p_fecha: f.fecha, p_metodo: f.metodo, p_cuenta: f.cuenta || null, p_comprobante: f.comprobante || null,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast("Pago registrado: quedó el egreso en tesorería.");
    invalidate("capacitaciones", "movimientos");
    onClose();
  }

  const docSel = docentes?.find((d) => d.id === f.docente);
  return (
    <Modal open={abierto} onClose={onClose} title="Pago a docente"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Registrar pago</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Docente">
            <Select value={f.docente} onChange={(e) => setF({ ...f, docente: e.target.value, curso: cursos?.find((c) => c.id === f.curso)?.docente_id === e.target.value ? f.curso : "" })}>
              <option value="">Elegí…</option>
              {docentes?.filter((d) => d.activo || d.id === f.docente).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Capacitación">
            <Select value={f.curso} onChange={(e) => setF({ ...f, curso: e.target.value })}>
              <option value="">— Otro concepto —</option>
              {cursos?.filter((c) => !f.docente || c.docente_id === f.docente).map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </Select>
          </Field>
        </div>
        {curso?.resumen && (
          <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            {HONORARIOS[curso.honorario_tipo]}: {curso.honorario_tipo === "porcentaje" ? `${curso.honorario_monto}%` : pesos(curso.honorario_monto)} ·
            previsto {pesos(curso.resumen.honorario_previsto)} · pagado {pesos(curso.resumen.pagado_docente)} ·{" "}
            <b>resta {pesos(Math.max(0, Number(curso.resumen.honorario_previsto) - Number(curso.resumen.pagado_docente)))}</b>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clases que se pagan (opcional)"><Input type="number" min={1} value={f.clases} onChange={(e) => cambiarClases(e.target.value)} /></Field>
          <Field label="Monto ($)"><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
        </div>
        <Field label="Concepto"><Input value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fecha"><Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
          <Field label="Forma"><Select value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>{METODOS_PAGO.map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="Sale de">
            <Select value={f.cuenta} onChange={(e) => setF({ ...f, cuenta: e.target.value })}>
              <option value="">— Sin cuenta —</option>
              {cuentas?.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Comprobante del docente (opcional)" hint="Ej.: Factura C 0001-00000123."><Input value={f.comprobante} onChange={(e) => setF({ ...f, comprobante: e.target.value })} /></Field>
        {docSel && (docSel.cbu || docSel.alias) && <p className="text-xs text-slate-500">Datos para transferir: {[docSel.cbu && `CBU ${docSel.cbu}`, docSel.alias && `Alias ${docSel.alias}`].filter(Boolean).join(" · ")}</p>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
