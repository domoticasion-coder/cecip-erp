import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { normalizarWhatsapp } from "../../lib/whatsapp";
import { ICONOS_CONTENIDO } from "../../../shared/comercia";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from "../../components/ui";
import { useConfig, useInvalidate } from "../data";

/*
 * Contenido editable sin tocar código: ofertas de ComercIA, servicios y cursos de IEC,
 * e información institucional que usa el Copiloto. Lo ven los socios en el portal al instante.
 */

type Tab = "promociones" | "convenio" | "ofertas" | "servicios" | "cursos" | "conocimiento" | "ajustes";

// Pestañas de ComercIA / IEC / FactorIA: las administra el rol "comercia" (y el Administrador).
// "Información para el Copiloto" es institucional del CeCIP: la administra Atención al socio (y el Administrador).
const TABS_COMERCIA: { value: Tab; label: string }[] = [
  { value: "promociones", label: "Promociones" },
  { value: "convenio", label: "Convenio" },
  { value: "ofertas", label: "Ofertas ComercIA" },
  { value: "servicios", label: "IEC Services" },
  { value: "cursos", label: "Cursos IEC" },
  { value: "ajustes", label: "Ajustes de ComercIA" },
];

export default function Contenido() {
  const { staff } = useAuth();
  const rol = staff?.rol;
  const tabs = [
    ...(rol === "admin" || rol === "comercia" ? TABS_COMERCIA : []),
    ...(rol === "admin" || rol === "atencion" ? [{ value: "conocimiento" as Tab, label: "Información para el Copiloto" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value || "conocimiento");
  return (
    <>
      <PageHeader
        title={rol === "comercia" ? "Contenido ComercIA" : "Contenido del portal"}
        subtitle={rol === "atencion"
          ? "Lo que sabe el Copiloto IA sobre el CeCIP. Los cambios se aplican al instante."
          : "Lo que ven los socios en la sección ComercIA del portal. Los cambios se publican al instante."}
      />
      {tabs.length > 1 && <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />}
      {tab === "promociones" && <Editor def={PROMOCIONES} />}
      {tab === "convenio" && <Editor def={CONVENIO} />}
      {tab === "ofertas" && <Editor def={OFERTAS} />}
      {tab === "servicios" && <Editor def={SERVICIOS} />}
      {tab === "cursos" && <Editor def={CURSOS} />}
      {tab === "conocimiento" && <Editor def={CONOCIMIENTO} />}
      {tab === "ajustes" && <AjustesComercia />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Definición de cada tipo de contenido
// ---------------------------------------------------------------------------

export type Campo = {
  key: string;
  label: string;
  tipo: "texto" | "parrafo" | "lista" | "icono" | "si_no" | "fecha" | "opciones";
  opciones?: { valor: string; etiqueta: string }[];
  ayuda?: string;
  requerido?: boolean;
  ancho?: "completo";
};

export interface Definicion {
  tabla: "comercia_promociones" | "comercia_convenio" | "comercia_ofertas" | "iec_servicios" | "iec_cursos" | "conocimiento_cecip" | "comercia_novedades";
  singular: string;
  campoTitulo: string;
  campoSubtitulo?: string;
  campoActivo: "activa" | "activo" | "publicada";
  ayuda: string;
  campos: Campo[];
  /** Texto corto que se muestra como etiqueta en cada fila */
  etiquetaFila?: (f: Record<string, any>) => string | null;
}

const TIPOS_CONVENIO = [
  { valor: "beneficio", etiqueta: "Beneficio (qué implica para el comercio)" },
  { valor: "paso", etiqueta: "Paso (cómo sumarse)" },
  { valor: "eje", etiqueta: "Eje del programa" },
  { valor: "parte", etiqueta: "Participante del convenio" },
  { valor: "pregunta", etiqueta: "Pregunta frecuente" },
];

const fechaCorta = (d: string) => d.split("-").reverse().join("/");

const PROMOCIONES: Definicion = {
  tabla: "comercia_promociones", singular: "promoción", campoTitulo: "titulo", campoSubtitulo: "descripcion", campoActivo: "activa",
  ayuda: "Promociones del convenio para los comercios socios. Se muestran bien grandes al comienzo de ComercIA en el portal; las vencidas se ocultan solas.",
  etiquetaFila: (f) => [f.descuento, f.vigente_hasta && `hasta ${fechaCorta(String(f.vigente_hasta))}`].filter(Boolean).join(" · ") || null,
  campos: [
    { key: "descuento", label: "Texto grande", tipo: "texto", ayuda: "Ej.: 25% OFF, SIN COSTO, 2x1, 3 CUOTAS." },
    { key: "titulo", label: "Título", tipo: "texto", requerido: true },
    { key: "vigente_hasta", label: "Vigente hasta", tipo: "fecha", ayuda: "Vacío = sin vencimiento." },
    { key: "destacada", label: "Destacada (más llamativa)", tipo: "si_no" },
    { key: "descripcion", label: "Descripción", tipo: "parrafo", ancho: "completo" },
    { key: "condiciones", label: "Condiciones", tipo: "parrafo", ancho: "completo" },
  ],
};

const CONVENIO: Definicion = {
  tabla: "comercia_convenio", singular: "bloque", campoTitulo: "titulo", campoSubtitulo: "texto", campoActivo: "activo",
  ayuda: "Qué implica el convenio CeCIP + Instituto IEC (programa ComercIA Inteligente): participantes, los ejes del programa, beneficios para el comercio, pasos para sumarse y preguntas frecuentes.",
  etiquetaFila: (f) => TIPOS_CONVENIO.find((t) => t.valor === f.tipo)?.etiqueta.split(" (")[0] || null,
  campos: [
    { key: "tipo", label: "Tipo", tipo: "opciones", requerido: true, opciones: TIPOS_CONVENIO },
    { key: "icono", label: "Ícono", tipo: "icono" },
    { key: "titulo", label: "Título (o pregunta)", tipo: "texto", requerido: true, ancho: "completo" },
    { key: "texto", label: "Texto (o respuesta)", tipo: "parrafo", ancho: "completo" },
  ],
};

const OFERTAS: Definicion = {
  tabla: "comercia_ofertas", singular: "oferta", campoTitulo: "titulo", campoSubtitulo: "solucion", campoActivo: "activa",
  ayuda: "Ofertas de ComercIA para el comercio del socio (pestaña \"Ofertas para tu comercio\" del portal). Cada una tiene un botón \"Pedir información\" que abre WhatsApp de FactorIA.",
  campos: [
    { key: "titulo", label: "Título", tipo: "texto", requerido: true },
    { key: "etiqueta", label: "Etiqueta", tipo: "texto", ayuda: "Texto corto destacado, ej.: \"Listo en ~30 días\"." },
    { key: "icono", label: "Ícono", tipo: "icono" },
    { key: "destacada", label: "Destacada (borde resaltado)", tipo: "si_no" },
    { key: "problema", label: "Sin ComercIA (el problema)", tipo: "parrafo", ancho: "completo" },
    { key: "solucion", label: "Con ComercIA (la solución)", tipo: "parrafo", requerido: true, ancho: "completo" },
    { key: "incluye", label: "Qué incluye", tipo: "lista", ayuda: "Un ítem por línea.", ancho: "completo" },
  ],
};

const SERVICIOS: Definicion = {
  tabla: "iec_servicios", singular: "servicio", campoTitulo: "nombre", campoSubtitulo: "subtitulo", campoActivo: "activo",
  ayuda: "Rubros de IEC Services que el socio puede pedir desde el portal (electricidad, gas, cámaras, etc.).",
  campos: [
    { key: "nombre", label: "Nombre del rubro", tipo: "texto", requerido: true },
    { key: "icono", label: "Ícono", tipo: "icono" },
    { key: "subtitulo", label: "Subtítulo", tipo: "texto", ancho: "completo" },
    { key: "descripcion", label: "Descripción", tipo: "parrafo", ancho: "completo" },
    { key: "subtipos", label: "Opciones que elige el socio", tipo: "lista", ayuda: "Una por línea, ej.: Instalación, Mantenimiento, Reparación.", ancho: "completo" },
  ],
};

const CURSOS: Definicion = {
  tabla: "iec_cursos", singular: "curso", campoTitulo: "nombre", campoSubtitulo: "subtitulo", campoActivo: "activo",
  ayuda: "Cursos y capacitaciones de IEC (pestaña \"Cursos IEC\" del portal). El socio pide información o cupo por WhatsApp.",
  campos: [
    { key: "nombre", label: "Nombre del curso", tipo: "texto", requerido: true, ancho: "completo" },
    { key: "subtitulo", label: "Subtítulo", tipo: "texto", ancho: "completo" },
    { key: "duracion", label: "Duración", tipo: "texto" },
    { key: "frecuencia", label: "Frecuencia", tipo: "texto" },
    { key: "modalidad", label: "Modalidad", tipo: "texto" },
    { key: "lugar", label: "Lugar", tipo: "texto" },
    { key: "requisitos", label: "Requisitos", tipo: "texto", ancho: "completo" },
    { key: "salida_laboral", label: "Salida laboral", tipo: "texto", ancho: "completo" },
    { key: "temario", label: "Temario", tipo: "lista", ayuda: "Un tema por línea.", ancho: "completo" },
  ],
};

const CONOCIMIENTO: Definicion = {
  tabla: "conocimiento_cecip", singular: "sección", campoTitulo: "titulo", campoSubtitulo: "contenido", campoActivo: "activo",
  ayuda: "Lo que sabe el Copiloto IA sobre el CeCIP: institución, autoridades, beneficios, trámites, novedades, horarios especiales… " +
    "Escribilo como lo explicarías a un socio. No incluyas datos privados: el Copiloto puede usarlo para responder a cualquier socio. " +
    "(La cuenta de cada socio, los comunicados y los eventos ya los toma solo del sistema.)",
  campos: [
    { key: "titulo", label: "Título de la sección", tipo: "texto", requerido: true, ancho: "completo" },
    { key: "contenido", label: "Contenido", tipo: "parrafo", requerido: true, ancho: "completo", ayuda: "Podés usar viñetas con \"- \" al comienzo de cada línea." },
  ],
};

// ---------------------------------------------------------------------------
// Editor genérico
// ---------------------------------------------------------------------------

type Fila = Record<string, any> & { id: string; orden: number };

export function Editor({ def }: { def: Definicion }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editar, setEditar] = useState<Fila | "nuevo" | null>(null);
  // Información institucional: Atención; contenido de ComercIA: equipo ComercIA (el Administrador puede todo)
  const puede = def.tabla === "conocimiento_cecip" ? can("atencion") : can("comercia");

  const { data, isLoading } = useQuery({
    queryKey: ["contenido", def.tabla],
    queryFn: async () => {
      let q = supabase.from(def.tabla).select("*");
      if (def.tabla === "comercia_convenio") q = q.order("tipo");
      return unwrap(await q.order("orden").order(def.campoTitulo)) as Fila[];
    },
  });

  const refrescar = () => invalidate("contenido", "portal-comercia-contenido");

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    const { error } = await supabase.from(def.tabla).update(cambios).eq("id", id);
    if (error) toast(traducirError(error.message), "error");
    refrescar();
  }

  async function mover(i: number, dir: -1 | 1) {
    const lista = data || [];
    const a = lista[i], b = lista[i + dir];
    if (!a || !b) return;
    // Renumera todo para que el orden quede consistente aunque hubiera empates
    const nueva = [...lista];
    nueva[i] = b;
    nueva[i + dir] = a;
    await Promise.all(nueva.map((f, idx) => f.orden !== idx + 1 ? supabase.from(def.tabla).update({ orden: idx + 1 }).eq("id", f.id) : null));
    refrescar();
  }

  async function borrar(f: Fila) {
    if (!confirm(`¿Eliminar "${f[def.campoTitulo]}"? Si solo querés ocultarlo, usá el ojo.`)) return;
    const { error } = await supabase.from(def.tabla).delete().eq("id", f.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Eliminado.");
    refrescar();
  }

  return (
    <>
      <Card
        title={<span className="font-normal text-slate-600">{def.ayuda}</span>}
        actions={puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nuevo")}>Agregar {def.singular}</Button>}
      >
        {isLoading ? <Loading /> : !data?.length ? <Empty>No hay nada cargado todavía.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.map((f, i) => {
              const activo = f[def.campoActivo];
              return (
                <li key={f.id} className={`flex items-start gap-3 px-4 py-3 ${activo ? "" : "opacity-60"}`}>
                  {puede && (
                    <div className="flex flex-col">
                      <button disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button disabled={i === data.length - 1} onClick={() => mover(i, 1)} title="Bajar" className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{f[def.campoTitulo]}</span>
                      {def.etiquetaFila?.(f) && <Badge tone="purple">{def.etiquetaFila(f)}</Badge>}
                      {!activo && <Badge>Oculto</Badge>}
                      {f.destacada && <Badge tone="blue">Destacada</Badge>}
                    </div>
                    {def.campoSubtitulo && f[def.campoSubtitulo] && (
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-slate-500">{f[def.campoSubtitulo]}</p>
                    )}
                  </div>
                  {puede && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" title={activo ? "Ocultar del portal" : "Mostrar en el portal"}
                        icon={activo ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        onClick={() => actualizar(f.id, { [def.campoActivo]: !activo })} />
                      <Button size="sm" variant="ghost" title="Editar" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditar(f)} />
                      <Button size="sm" variant="ghost" title="Eliminar" icon={<Trash2 className="h-4 w-4" />} onClick={() => borrar(f)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <FormularioContenido def={def} valor={editar} total={data?.length || 0} onClose={() => setEditar(null)} onSaved={refrescar} />
    </>
  );
}

function FormularioContenido({ def, valor, total, onClose, onSaved }: {
  def: Definicion; valor: Fila | "nuevo" | null; total: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!valor) return;
    setError(null);
    const base: Record<string, any> = {};
    for (const c of def.campos) {
      const v = valor === "nuevo" ? undefined : valor[c.key];
      base[c.key] = c.tipo === "lista" ? (v || []).join("\n") : c.tipo === "si_no" ? !!v : c.tipo === "icono" ? v || "Store" : c.tipo === "opciones" ? v || c.opciones?.[0]?.valor : v ?? "";
    }
    setF(base);
  }, [valor, def]);

  async function guardar() {
    for (const c of def.campos) {
      if (c.requerido && !String(f[c.key] || "").trim()) return setError(`Completá "${c.label}".`);
    }
    const payload: Record<string, any> = {};
    for (const c of def.campos) {
      const v = f[c.key];
      payload[c.key] = c.tipo === "lista"
        ? String(v || "").split("\n").map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean)
        : c.tipo === "si_no" ? !!v
        : typeof v === "string" ? (v.trim() || null) : v;
    }
    setSaving(true);
    setError(null);
    const res = valor === "nuevo"
      ? await supabase.from(def.tabla).insert({ ...payload, orden: total + 1 })
      : await supabase.from(def.tabla).update(def.tabla === "conocimiento_cecip" ? { ...payload, updated_at: new Date().toISOString() } : payload).eq("id", (valor as Fila).id);
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast("Guardado. Ya se ve en el portal.");
    onSaved();
    onClose();
  }

  return (
    <Modal open={!!valor} onClose={onClose} size="lg" title={`${valor === "nuevo" ? "Agregar" : "Editar"} ${def.singular}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.campos.map((c) => (
          <Field key={c.key} label={c.label + (c.requerido ? " *" : "")} hint={c.ayuda} className={c.ancho === "completo" || c.tipo === "parrafo" || c.tipo === "lista" ? "sm:col-span-2" : ""}>
            {c.tipo === "texto" && <Input value={f[c.key] || ""} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />}
            {c.tipo === "parrafo" && <Textarea rows={def.tabla === "conocimiento_cecip" ? 14 : 3} value={f[c.key] || ""} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />}
            {c.tipo === "lista" && <Textarea rows={5} value={f[c.key] || ""} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />}
            {c.tipo === "icono" && (
              <Select value={f[c.key] || "Store"} onChange={(e) => setF({ ...f, [c.key]: e.target.value })}>
                {ICONOS_CONTENIDO.map((i) => <option key={i} value={i}>{NOMBRES_ICONOS[i] || i}</option>)}
              </Select>
            )}
            {c.tipo === "fecha" && <Input type="date" value={f[c.key] || ""} onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />}
            {c.tipo === "opciones" && (
              <Select value={f[c.key] || ""} onChange={(e) => setF({ ...f, [c.key]: e.target.value })}>
                {c.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </Select>
            )}
            {c.tipo === "si_no" && <div className="pt-2"><Checkbox checked={!!f[c.key]} onChange={(v) => setF({ ...f, [c.key]: v })} label="Sí" /></div>}
          </Field>
        ))}
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Modal>
  );
}

const NOMBRES_ICONOS: Record<string, string> = {
  Store: "Local / comercio", Zap: "Rayo (electricidad, rapidez)", Search: "Búsqueda", Wrench: "Herramienta",
  BadgePercent: "Descuento / promoción", Shield: "Escudo (seguridad)", Flame: "Llama (gas)", Megaphone: "Megáfono (marketing)",
  GraduationCap: "Birrete (capacitación)", Hammer: "Martillo (construcción)", Smartphone: "Celular", Globe: "Web",
  Camera: "Cámara", Truck: "Camión (envíos)", Sparkles: "Destellos (IA)", Briefcase: "Maletín (institución, servicios)",
  MessageCircle: "Mensaje (contacto)", Gift: "Regalo (beneficio)", Rocket: "Cohete (crecimiento)", Users: "Personas (comunidad)",
};

// ---------------------------------------------------------------------------
// Ajustes: WhatsApp de FactorIA y formulario de adhesión
// ---------------------------------------------------------------------------

function AjustesComercia() {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [wa, setWa] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cfg) {
      setWa(cfg.factoria_whatsapp || "");
      setUrl(cfg.comercia_url_adhesion || "");
    }
  }, [cfg]);

  if (!cfg) return <Loading />;
  const esAdmin = can("comercia");
  const waOk = !wa.trim() || !!normalizarWhatsapp(wa);

  async function guardar() {
    if (!waOk) return toast("El número de WhatsApp no es válido. Cargalo con característica, ej.: 343 4123456.", "error");
    setSaving(true);
    const { error } = await supabase.rpc("actualizar_ajustes_comercia", { p_whatsapp: wa, p_url_adhesion: url });
    setSaving(false);
    if (error) return toast(traducirError(error.message), "error");
    toast("Ajustes guardados.");
    invalidate("configuracion", "config-portal");
  }

  return (
    <Card title="Ajustes de ComercIA" actions={esAdmin && <Button size="sm" loading={saving} icon={<Save className="h-3.5 w-3.5" />} onClick={guardar}>Guardar</Button>}>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="WhatsApp de FactorIA" hint={waOk ? "A este número llegan los pedidos de información de los socios. Con característica, ej.: 343 4123456." : "Número no válido."}>
          <Input value={wa} disabled={!esAdmin} placeholder="343 4123456" onChange={(e) => setWa(e.target.value)} />
        </Field>
        <Field label="Link del formulario de adhesión a ComercIA" hint="Se muestra al pie de la sección ComercIA del portal.">
          <Input value={url} disabled={!esAdmin} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        {!esAdmin && <p className="text-xs text-slate-500 sm:col-span-2">Solo el equipo de ComercIA o un administrador pueden cambiar estos ajustes.</p>}
      </div>
    </Card>
  );
}
