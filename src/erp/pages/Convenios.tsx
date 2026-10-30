import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, Handshake, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha } from "../../lib/format";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Textarea, useToast } from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { useInvalidate } from "../data";

/** Convenios vigentes y promociones para socios: se cargan acá y los socios los ven en el Portal */
export interface Convenio {
  id: string; tipo: "convenio" | "promocion"; titulo: string; empresa: string | null; rubro: string | null; descripcion: string | null;
  beneficio: string | null; condiciones: string | null; como_usarlo: string | null; contacto: string | null; link: string | null;
  imagen_url: string | null; vigencia_desde: string | null; vigencia_hasta: string | null; activo: boolean; destacado: boolean; created_at: string;
}

const hoy = () => new Date().toISOString().slice(0, 10);
export function estadoConvenio(c: Convenio): { label: string; tone: "green" | "amber" | "gray" | "blue" } {
  if (!c.activo) return { label: "Pausado", tone: "gray" };
  if (c.vigencia_desde && c.vigencia_desde > hoy()) return { label: "Programado", tone: "blue" };
  if (c.vigencia_hasta && c.vigencia_hasta < hoy()) return { label: "Vencido", tone: "gray" };
  if (c.vigencia_hasta && (new Date(c.vigencia_hasta).getTime() - Date.now()) / 86400000 <= 15) return { label: "Vence pronto", tone: "amber" };
  return { label: "Vigente", tone: "green" };
}

export default function Convenios() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("prensa", "atencion");
  const [tipo, setTipo] = useState("");
  const [verVencidos, setVerVencidos] = useState(false);
  const [editar, setEditar] = useState<Convenio | "nuevo" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["convenios"],
    queryFn: async () => unwrap(await supabase.from("convenios").select("*").order("destacado", { ascending: false }).order("created_at", { ascending: false })) as Convenio[],
  });
  const { data: vistas } = useQuery({
    queryKey: ["convenios", "vistas"],
    queryFn: async () => unwrap(await supabase.from("portal_actividad").select("detalle").eq("seccion", "convenios").eq("accion", "click").limit(5000)) as { detalle: { id?: string } }[],
  });
  const clicsPorConvenio = useMemo(() => {
    const m = new Map<string, number>();
    (vistas || []).forEach((v) => v.detalle?.id && m.set(v.detalle.id, (m.get(v.detalle.id) || 0) + 1));
    return m;
  }, [vistas]);

  const lista = (data || []).filter((c) => (!tipo || c.tipo === tipo) && (verVencidos || !["Vencido"].includes(estadoConvenio(c).label)));
  const vigentes = (data || []).filter((c) => ["Vigente", "Vence pronto"].includes(estadoConvenio(c).label));

  async function eliminar(c: Convenio) {
    if (!confirm(`¿Eliminar "${c.titulo}"?`)) return;
    const { error } = await supabase.from("convenios").delete().eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("convenios");
  }

  return (
    <>
      <PageHeader title="Convenios y promociones"
        subtitle="Convenios vigentes y promociones para los socios. Los vigentes se ven en el Portal de socios (Convenios y promociones)."
        actions={puede && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditar("nuevo")}>Nuevo</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Convenios vigentes" value={vigentes.filter((c) => c.tipo === "convenio").length} icon={<Handshake className="h-5 w-5" />} />
        <Stat label="Promociones vigentes" value={vigentes.filter((c) => c.tipo === "promocion").length} icon={<BadgePercent className="h-5 w-5" />} />
        <Stat label="Consultas de socios" value={[...clicsPorConvenio.values()].reduce((a, b) => a + b, 0)} hint="Veces que un socio abrió un convenio en el Portal" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Select className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Convenios y promociones</option>
            <option value="convenio">Solo convenios</option>
            <option value="promocion">Solo promociones</option>
          </Select>
          <Checkbox checked={verVencidos} onChange={setVerVencidos} label="Ver vencidos" />
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : !lista.length ? (
          <Empty icon={<Handshake className="h-8 w-8" />}>No hay convenios ni promociones cargados con este filtro.</Empty>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {lista.map((c) => {
              const est = estadoConvenio(c);
              return (
                <div key={c.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {c.imagen_url && <img src={c.imagen_url} alt="" className="h-28 w-full object-cover" />}
                  <div className="flex flex-1 flex-col p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={c.tipo === "convenio" ? "blue" : "purple"}>{c.tipo === "convenio" ? "Convenio" : "Promoción"}</Badge>
                      <Badge tone={est.tone}>{est.label}</Badge>
                      {c.destacado && <Badge tone="amber">Destacado</Badge>}
                    </div>
                    <div className="mt-1.5 font-semibold">{c.titulo}</div>
                    <div className="text-xs text-slate-500">{[c.empresa, c.rubro].filter(Boolean).join(" · ")}</div>
                    {c.beneficio && <div className="mt-1 text-sm font-semibold text-emerald-700">{c.beneficio}</div>}
                    <div className="mt-auto flex items-center justify-between pt-2 text-xs text-slate-500">
                      <span>{c.vigencia_hasta ? `Hasta el ${fecha(c.vigencia_hasta)}` : "Sin vencimiento"} · {clicsPorConvenio.get(c.id) || 0} consultas</span>
                      {puede && <span className="flex">
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(c)} />
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(c)} />
                      </span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <ConvenioForm value={editar} onClose={() => setEditar(null)} />
    </>
  );
}

function ConvenioForm({ value, onClose }: { value: Convenio | "nuevo" | null; onClose: () => void }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const vacio = { tipo: "convenio", titulo: "", empresa: "", rubro: "", descripcion: "", beneficio: "", condiciones: "", como_usarlo: "", contacto: "", link: "", vigencia_desde: "", vigencia_hasta: "", activo: true, destacado: false };
  const [f, setF] = useState(vacio);
  const [imagen, setImagen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nuevo") { setF(vacio); setImagen(null); }
    else {
      const { id, created_at, imagen_url, ...resto } = value;
      setF(Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, v ?? ""])) as typeof vacio);
      setImagen(imagen_url);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof vacio) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.titulo.trim()) return setError("Escribí el título.");
    if (f.vigencia_desde && f.vigencia_hasta && f.vigencia_hasta < f.vigencia_desde) return setError("La fecha de fin es anterior a la de inicio.");
    setSaving(true);
    const payload = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])), imagen_url: imagen };
    const res = value && value !== "nuevo"
      ? await supabase.from("convenios").update(payload).eq("id", value.id)
      : await supabase.from("convenios").insert({ ...payload, created_by: staff?.user_id });
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast("Guardado. Si está vigente, ya lo ven los socios en el Portal.");
    invalidate("convenios");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nuevo" ? "Nuevo convenio o promoción" : "Editar"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo">
          <Select value={f.tipo} onChange={set("tipo")}><option value="convenio">Convenio</option><option value="promocion">Promoción</option></Select>
        </Field>
        <Field label="Título"><Input value={f.titulo} onChange={set("titulo")} placeholder="Ej. Seguro integral de comercio" /></Field>
        <Field label="Empresa o entidad"><Input value={f.empresa} onChange={set("empresa")} /></Field>
        <Field label="Rubro"><Input value={f.rubro} onChange={set("rubro")} /></Field>
        <Field label="Beneficio" hint="Lo que se destaca: 20% de descuento, 2x1, sin costo…" className="sm:col-span-2"><Input value={f.beneficio} onChange={set("beneficio")} /></Field>
        <Field label="Descripción" className="sm:col-span-2"><Textarea rows={4} value={f.descripcion} onChange={set("descripcion")} /></Field>
        <Field label="Cómo usarlo" className="sm:col-span-2"><Textarea rows={2} value={f.como_usarlo} onChange={set("como_usarlo")} placeholder="Ej. Mostrá tu credencial de socio o mencioná el CeCIP" /></Field>
        <Field label="Condiciones" className="sm:col-span-2"><Textarea rows={2} value={f.condiciones} onChange={set("condiciones")} /></Field>
        <Field label="Contacto"><Input value={f.contacto} onChange={set("contacto")} placeholder="Teléfono, WhatsApp o email" /></Field>
        <Field label="Link (opcional)"><Input value={f.link} onChange={set("link")} placeholder="https://…" /></Field>
        <Field label="Vigente desde"><Input type="date" value={f.vigencia_desde} onChange={set("vigencia_desde")} /></Field>
        <Field label="Vigente hasta" hint="Vacío = sin vencimiento. Al vencer deja de verse solo."><Input type="date" value={f.vigencia_hasta} onChange={set("vigencia_hasta")} /></Field>
        <div className="sm:col-span-2"><ImagenInput value={imagen} onChange={setImagen} carpeta="convenios" hint="Logo de la empresa o flyer de la promoción." /></div>
        <Checkbox checked={f.activo} onChange={(v) => setF({ ...f, activo: v })} label="Activo" />
        <Checkbox checked={f.destacado} onChange={(v) => setF({ ...f, destacado: v })} label="Destacado (aparece primero)" />
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
