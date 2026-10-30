import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora } from "../../lib/format";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useToast } from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { useInvalidate } from "../data";

/**
 * Mujeres Empresarias y Jóvenes Empresarios: eventos, actividades y capacitaciones de cada espacio.
 * Lo publicado se ve en sus pestañas de la web del CeCIP.
 */
export type Grupo = "mujeres" | "jovenes";
export interface PublicacionGrupo {
  id: string; grupo: Grupo; tipo: "evento" | "actividad" | "capacitacion" | "novedad"; titulo: string; descripcion: string | null;
  fecha: string | null; fecha_fin: string | null; lugar: string | null; imagen_url: string | null; link: string | null; publicado: boolean;
}

export const GRUPOS: Record<Grupo, string> = { mujeres: "Mujeres Empresarias", jovenes: "Jóvenes Empresarios" };
export const TIPOS_PUB: Record<PublicacionGrupo["tipo"], { label: string; tone: "blue" | "green" | "purple" | "amber" }> = {
  evento: { label: "Evento", tone: "blue" },
  actividad: { label: "Actividad", tone: "green" },
  capacitacion: { label: "Capacitación", tone: "purple" },
  novedad: { label: "Novedad", tone: "amber" },
};

export function GruposEmpresarios() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("prensa");
  const [grupo, setGrupo] = useState<Grupo>("mujeres");
  const [editar, setEditar] = useState<PublicacionGrupo | "nueva" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["grupos_publicaciones"],
    queryFn: async () => unwrap(await supabase.from("grupos_publicaciones").select("*").order("fecha", { ascending: false, nullsFirst: false })) as PublicacionGrupo[],
  });
  const lista = (data || []).filter((p) => p.grupo === grupo);
  const proximas = lista.filter((p) => p.fecha && new Date(p.fecha_fin || p.fecha) >= new Date()).length;

  async function eliminar(p: PublicacionGrupo) {
    if (!confirm(`¿Eliminar "${p.titulo}"?`)) return;
    const { error } = await supabase.from("grupos_publicaciones").delete().eq("id", p.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("grupos_publicaciones");
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(GRUPOS) as Grupo[]).map((g) => (
          <button key={g} type="button" onClick={() => setGrupo(g)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${grupo === g ? (g === "mujeres" ? "bg-fuchsia-600 text-white" : "bg-sky-600 text-white") : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {GRUPOS[g]} · {(data || []).filter((p) => p.grupo === g).length}
          </button>
        ))}
      </div>
      <Card
        title={`${GRUPOS[grupo]}: eventos, actividades y capacitaciones`}
        actions={puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nueva")}>Nueva publicación</Button>}
      >
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          Lo publicado aparece en la pestaña {GRUPOS[grupo]} de la web del CeCIP (Cámaras → {GRUPOS[grupo]}). {proximas > 0 && `${proximas} próxima${proximas > 1 ? "s" : ""}.`}
        </p>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : !lista.length ? (
          <Empty icon={<CalendarDays className="h-8 w-8" />}>Todavía no hay publicaciones de {GRUPOS[grupo]}.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {p.imagen_url && <img src={p.imagen_url} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.titulo}</span>
                    <Badge tone={TIPOS_PUB[p.tipo].tone}>{TIPOS_PUB[p.tipo].label}</Badge>
                    {!p.publicado && <Badge>Borrador</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{[p.fecha && fechaHora(p.fecha), p.lugar].filter(Boolean).join(" · ")}</div>
                  {p.descripcion && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{p.descripcion}</p>}
                </div>
                {puede && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(p)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(p)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PublicacionForm value={editar} grupo={grupo} onClose={() => setEditar(null)} />
    </>
  );
}

const aLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function PublicacionForm({ value, grupo, onClose }: { value: PublicacionGrupo | "nueva" | null; grupo: Grupo; onClose: () => void }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const vacio = { grupo, tipo: "evento" as PublicacionGrupo["tipo"], titulo: "", descripcion: "", fecha: "", fecha_fin: "", lugar: "", link: "", publicado: true };
  const [f, setF] = useState(vacio);
  const [imagen, setImagen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nueva") { setF(vacio); setImagen(null); }
    else {
      setF({ grupo: value.grupo, tipo: value.tipo, titulo: value.titulo, descripcion: value.descripcion || "", fecha: aLocal(value.fecha),
        fecha_fin: aLocal(value.fecha_fin), lugar: value.lugar || "", link: value.link || "", publicado: value.publicado });
      setImagen(value.imagen_url);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.titulo.trim()) return setError("Escribí el título.");
    setSaving(true);
    const payload = {
      grupo: f.grupo, tipo: f.tipo, titulo: f.titulo.trim(), descripcion: f.descripcion.trim() || null,
      fecha: f.fecha ? new Date(f.fecha).toISOString() : null, fecha_fin: f.fecha_fin ? new Date(f.fecha_fin).toISOString() : null,
      lugar: f.lugar.trim() || null, link: f.link.trim() || null, publicado: f.publicado, imagen_url: imagen,
    };
    const res = value && value !== "nueva"
      ? await supabase.from("grupos_publicaciones").update(payload).eq("id", value.id)
      : await supabase.from("grupos_publicaciones").insert({ ...payload, created_by: staff?.user_id });
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast(f.publicado ? `Publicado en ${GRUPOS[f.grupo as Grupo]}.` : "Borrador guardado.");
    invalidate("grupos_publicaciones");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nueva" ? "Nueva publicación" : "Editar publicación"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Espacio">
            <Select value={f.grupo} onChange={set("grupo")}>{(Object.keys(GRUPOS) as Grupo[]).map((g) => <option key={g} value={g}>{GRUPOS[g]}</option>)}</Select>
          </Field>
          <Field label="Tipo">
            <Select value={f.tipo} onChange={set("tipo")}>{Object.entries(TIPOS_PUB).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          </Field>
        </div>
        <Field label="Título"><Input value={f.titulo} onChange={set("titulo")} /></Field>
        <Field label="Descripción"><Textarea rows={5} value={f.descripcion} onChange={set("descripcion")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha y hora"><Input type="datetime-local" value={f.fecha} onChange={set("fecha")} /></Field>
          <Field label="Hasta (opcional)"><Input type="datetime-local" value={f.fecha_fin} onChange={set("fecha_fin")} /></Field>
          <Field label="Lugar o modalidad"><Input value={f.lugar} onChange={set("lugar")} placeholder="Sede CeCIP, virtual…" /></Field>
          <Field label="Link de inscripción o información (opcional)"><Input value={f.link} onChange={set("link")} placeholder="https://…" /></Field>
        </div>
        <ImagenInput value={imagen} onChange={setImagen} carpeta="grupos" hint="Flyer o foto (se muestra en la web)." />
        <Checkbox checked={f.publicado} onChange={(v) => setF({ ...f, publicado: v })} label="Publicado en la web" />
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
