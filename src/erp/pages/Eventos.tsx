import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Copy, Download, ExternalLink, Globe, Mail, MessageCircle, Pencil, Plus, Receipt, Share2, Trash2, Users } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fechaHora, hoyISO, nombreSocio, pesos } from "../../lib/format";
import type { Evento, Inscripcion, PreguntaFormulario } from "../../lib/types";
import { PORTAL_URL } from "../../lib/appMode";
import { ImagenInput } from "../../components/ImagenInput";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";

type EventoConCount = Evento & { inscripciones: { count: number }[] };

const ORIGENES: Record<Inscripcion["origen"], string> = { portal: "Portal de socios", erp: "Cargado en el ERP", publico: "Formulario público" };

export default function Eventos() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<"proximos" | "pasados">("proximos");
  const [editar, setEditar] = useState<Evento | "nuevo" | null>(null);
  const [inscriptos, setInscriptos] = useState<Evento | null>(null);
  const [compartir, setCompartir] = useState<Evento | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["eventos", "lista", tab],
    queryFn: async () => {
      const ahora = new Date().toISOString();
      // Las capacitaciones (cursos) tienen su propia sección
      const q = supabase.from("eventos").select("*, inscripciones(count)").eq("tipo", "evento");
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

  const puede = can("atencion", "prensa");

  return (
    <>
      <PageHeader
        title="Eventos"
        subtitle="Charlas, reuniones y actividades. Los publicados aparecen en el portal; con el formulario público se anotan también los no socios. Los cursos se cargan en Capacitaciones."
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
                      {e.formulario_publico && <Badge tone="purple"><Globe className="mr-1 h-3 w-3" />Formulario público</Badge>}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-500">
                      {fechaHora(e.fecha_inicio)} · {e.modalidad}{e.lugar && ` · ${e.lugar}`} · {Number(e.costo) > 0 ? pesos(e.costo) : "Sin costo"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {e.formulario_publico && e.slug && (
                      <Button size="sm" variant="secondary" icon={<Share2 className="h-3.5 w-3.5" />} onClick={() => setCompartir(e)}>Compartir</Button>
                    )}
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
      <CompartirModal evento={compartir} onClose={() => setCompartir(null)} />
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
    titulo: "", descripcion: "", tipo: "evento" as Evento["tipo"], fecha_inicio: `${hoyISO()}T18:00`, fecha_fin: "",
    lugar: "Sede CeCIP", modalidad: "presencial" as Evento["modalidad"], link: "", cupo: "", costo: "0", publicado: true, inscripcion_abierta: true,
    imagen_url: null as string | null, formulario_publico: false, preguntas: [] as PreguntaFormulario[],
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
      imagen_url: value.imagen_url, formulario_publico: value.formulario_publico, preguntas: value.preguntas || [],
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
      publicado: f.publicado, inscripcion_abierta: f.inscripcion_abierta, imagen_url: f.imagen_url,
      formulario_publico: f.formulario_publico, preguntas: f.preguntas.filter((p) => p.etiqueta.trim()).map((p) => ({ ...p, etiqueta: p.etiqueta.trim() })),
    };
    if (f.formulario_publico && f.preguntas.some((p) => p.tipo === "opciones" && p.etiqueta.trim() && !(p.opciones || []).length)) {
      setSaving(false);
      return setError("Las preguntas de tipo «Opciones» necesitan al menos una opción.");
    }
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
        <div className="sm:col-span-2">
          <ImagenInput value={f.imagen_url} onChange={(url) => setF({ ...f, imagen_url: url })} carpeta="eventos" label="Imagen o flyer (opcional)" hint="Se muestra en el formulario de inscripción." />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
          <Checkbox checked={f.publicado} onChange={(v) => setF({ ...f, publicado: v })} label="Publicado en el portal de socios" />
          <Checkbox checked={f.inscripcion_abierta} onChange={(v) => setF({ ...f, inscripcion_abierta: v })} label="Inscripción abierta" />
        </div>
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 sm:col-span-2">
          <Checkbox checked={f.formulario_publico} onChange={(v) => setF({ ...f, formulario_publico: v })}
            label={<b>Formulario de inscripción público (para no socios)</b>} />
          <p className="mt-1 text-xs text-slate-500">
            Genera un link para compartir por WhatsApp, redes o email: cualquiera se anota con nombre, email, teléfono y empresa, sin crear cuenta.
          </p>
          {f.formulario_publico && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold text-slate-600">Preguntas adicionales (opcional)</div>
              <EditorPreguntas value={f.preguntas} onChange={(preguntas) => setF({ ...f, preguntas })} />
            </div>
          )}
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
      es_socio: !!socio, origen: "erp",
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
              asistente: i.asistente_nombre, socio: socioNombre(i.socio_id), empresa: i.empresa, cuit: i.cuit, email: i.asistente_email,
              telefono: i.asistente_telefono, origen: ORIGENES[i.origen], inscripto: fechaHora(i.created_at), asistio: i.asistio ? "Sí" : "No",
              ...Object.fromEntries((evento.preguntas || []).map((p) => [p.etiqueta, i.respuestas?.[p.id] || ""])),
            })))}>Exportar</Button>
          <Button onClick={onClose}>Cerrar</Button>
        </>
      }>
      {can("atencion", "prensa") && (
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
                <td className="td">
                  {i.asistente_nombre}
                  <div className="text-xs text-slate-400">{fechaHora(i.created_at)} · {ORIGENES[i.origen]}</div>
                  {(evento.preguntas || []).filter((p) => i.respuestas?.[p.id]).map((p) => (
                    <div key={p.id} className="text-xs text-slate-500"><b>{p.etiqueta}:</b> {i.respuestas[p.id]}</div>
                  ))}
                </td>
                <td className="td text-sm">
                  {i.socio_id ? socioNombre(i.socio_id) : <Badge tone="purple">No socio</Badge>}
                  {i.empresa && <div className="text-xs text-slate-500">{i.empresa}{i.cuit && ` · ${i.cuit}`}</div>}
                </td>
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

const linkPublico = (e: Pick<Evento, "slug">) => `${PORTAL_URL}/inscripcion/${e.slug}`;

/** Compartir el formulario público de inscripción (WhatsApp, email, redes) */
export function CompartirModal({ evento, onClose }: { evento: Evento | null; onClose: () => void }) {
  const toast = useToast();
  if (!evento) return null;
  const url = linkPublico(evento);
  const texto = `📣 ${evento.titulo}\n🗓️ ${fechaHora(evento.fecha_inicio)}${evento.lugar ? `\n📍 ${evento.lugar}` : ""}\n\nInscribite acá: ${url}`;
  return (
    <Modal open onClose={onClose} title="Compartir formulario de inscripción">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Cualquier persona (socia o no) se puede anotar con este link, sin crear una cuenta. Las inscripciones aparecen en «Inscriptos» con la marca
          <Badge tone="purple">Formulario público</Badge>.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.target.select()} />
          <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard.writeText(url).then(() => toast("Link copiado."))}>Copiar</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
            <Button variant="success" className="w-full" icon={<MessageCircle className="h-4 w-4" />}>WhatsApp</Button>
          </a>
          <a href={`mailto:?subject=${encodeURIComponent(evento.titulo)}&body=${encodeURIComponent(texto)}`}>
            <Button variant="secondary" className="w-full" icon={<Mail className="h-4 w-4" />}>Email</Button>
          </a>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" className="w-full" icon={<ExternalLink className="h-4 w-4" />}>Ver formulario</Button>
          </a>
        </div>
        <Field label="Texto para redes / difusión">
          <Textarea rows={5} readOnly value={texto} onFocus={(e) => e.target.select()} />
        </Field>
        {!evento.inscripcion_abierta && <p className="text-xs text-amber-700">La inscripción está cerrada: el formulario muestra que no se aceptan más inscriptos.</p>}
      </div>
    </Modal>
  );
}

const nuevaPregunta = (): PreguntaFormulario => ({ id: `p${Math.random().toString(36).slice(2, 8)}`, etiqueta: "", tipo: "texto", requerida: false, opciones: [] });

/** Preguntas extra del formulario público */
export function EditorPreguntas({ value, onChange }: { value: PreguntaFormulario[]; onChange: (v: PreguntaFormulario[]) => void }) {
  const upd = (i: number, cambios: Partial<PreguntaFormulario>) => onChange(value.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={p.id} className="grid gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-12">
          <Input className="sm:col-span-6" placeholder="Pregunta (ej.: ¿A qué rubro pertenece tu empresa?)" value={p.etiqueta} onChange={(e) => upd(i, { etiqueta: e.target.value })} />
          <Select className="sm:col-span-3" value={p.tipo} onChange={(e) => upd(i, { tipo: e.target.value as PreguntaFormulario["tipo"] })}>
            <option value="texto">Respuesta libre</option>
            <option value="opciones">Opciones</option>
            <option value="si_no">Sí / No</option>
          </Select>
          <div className="flex items-center justify-between gap-2 sm:col-span-3">
            <Checkbox checked={p.requerida} onChange={(v) => upd(i, { requerida: v })} label="Obligatoria" />
            <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
          {p.tipo === "opciones" && (
            <Input className="sm:col-span-12" placeholder="Opciones separadas por coma (ej.: Comercio, Industria, Servicios)"
              value={(p.opciones || []).join(", ")} onChange={(e) => upd(i, { opciones: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...value, nuevaPregunta()])}>Agregar pregunta</Button>
    </div>
  );
}
