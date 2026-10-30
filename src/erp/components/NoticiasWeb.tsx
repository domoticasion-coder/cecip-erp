import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Newspaper, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora } from "../../lib/format";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useToast } from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { useInvalidate } from "../data";

/** Noticias de la sección Noticias de la web del CeCIP (www.centrocomercialparana.com.ar) */
export interface NoticiaWeb {
  id: string; titulo: string; bajada: string | null; cuerpo: string; categoria: string; imagen_url: string | null;
  fecha: string; destacado: boolean; publicado: boolean; created_at: string;
}

export const CATEGORIAS_NOTICIA = ["Institucional", "Capacitación", "Comercio", "Industria", "Servicios", "Gremiales", "Eventos", "Prensa"];
const WEB = "https://www.centrocomercialparana.com.ar";

export function NoticiasWeb() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("prensa");
  const [editar, setEditar] = useState<NoticiaWeb | "nueva" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["noticias_web"],
    queryFn: async () => unwrap(await supabase.from("noticias_web").select("*").order("fecha", { ascending: false })) as NoticiaWeb[],
  });

  async function eliminar(n: NoticiaWeb) {
    if (!confirm(`¿Eliminar la noticia "${n.titulo}"? Deja de verse en la web.`)) return;
    const { error } = await supabase.from("noticias_web").delete().eq("id", n.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("noticias_web");
  }

  return (
    <>
      <Card
        title="Noticias de la web"
        actions={<div className="flex gap-2">
          <a href={WEB} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />}>Ver la web</Button></a>
          {puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nueva")}>Nueva noticia</Button>}
        </div>}
      >
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          Las noticias publicadas aparecen en la sección Noticias de centrocomercialparana.com.ar (las más recientes primero; las destacadas, arriba).
          Los comunicados del portal marcados "Publicar también en la web" también se suman ahí.
        </p>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : !data?.length ? (
          <Empty icon={<Newspaper className="h-8 w-8" />}>Todavía no hay noticias. Cargá la primera con "Nueva noticia".</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                {n.imagen_url ? <img src={n.imagen_url} alt="" className="h-16 w-24 shrink-0 rounded object-cover" /> : <div className="grid h-16 w-24 shrink-0 place-items-center rounded bg-slate-100 text-slate-300"><Newspaper className="h-6 w-6" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{n.titulo}</span>
                    {n.publicado ? <Badge tone="green">En la web</Badge> : <Badge>Borrador</Badge>}
                    {n.destacado && <Badge tone="amber">Destacada</Badge>}
                    <Badge tone="blue">{n.categoria}</Badge>
                  </div>
                  {n.bajada && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{n.bajada}</p>}
                  <div className="mt-0.5 text-xs text-slate-400">{fechaHora(n.fecha)}</div>
                </div>
                {puede && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(n)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(n)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NoticiaForm value={editar} onClose={() => setEditar(null)} />
    </>
  );
}

const aLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function NoticiaForm({ value, onClose }: { value: NoticiaWeb | "nueva" | null; onClose: () => void }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ titulo: "", bajada: "", cuerpo: "", categoria: CATEGORIAS_NOTICIA[0], fecha: aLocal(new Date().toISOString()), destacado: false, publicado: true });
  const [imagen, setImagen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nueva") {
      setF({ titulo: "", bajada: "", cuerpo: "", categoria: CATEGORIAS_NOTICIA[0], fecha: aLocal(new Date().toISOString()), destacado: false, publicado: true });
      setImagen(null);
    } else {
      setF({ titulo: value.titulo, bajada: value.bajada || "", cuerpo: value.cuerpo, categoria: value.categoria, fecha: aLocal(value.fecha), destacado: value.destacado, publicado: value.publicado });
      setImagen(value.imagen_url);
    }
  }, [value]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.titulo.trim() || !f.cuerpo.trim()) return setError("Completá el título y el texto de la noticia.");
    setSaving(true);
    const payload = {
      titulo: f.titulo.trim(), bajada: f.bajada.trim() || null, cuerpo: f.cuerpo.trim(), categoria: f.categoria,
      fecha: new Date(f.fecha).toISOString(), destacado: f.destacado, publicado: f.publicado, imagen_url: imagen,
    };
    const res = value && value !== "nueva"
      ? await supabase.from("noticias_web").update(payload).eq("id", value.id)
      : await supabase.from("noticias_web").insert({ ...payload, created_by: staff?.user_id });
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast(f.publicado ? "Noticia publicada en la web." : "Borrador guardado.");
    invalidate("noticias_web");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nueva" ? "Nueva noticia para la web" : "Editar noticia"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Título"><Input value={f.titulo} onChange={set("titulo")} /></Field>
        <Field label="Bajada" hint="Una o dos líneas que resumen la noticia (se ven en la tarjeta)."><Input value={f.bajada} onChange={set("bajada")} /></Field>
        <Field label="Texto de la noticia"><Textarea rows={10} value={f.cuerpo} onChange={set("cuerpo")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoría">
            <Select value={f.categoria} onChange={set("categoria")}>{CATEGORIAS_NOTICIA.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Fecha de publicación" hint="Si es futura, se publica sola ese día."><Input type="datetime-local" value={f.fecha} onChange={set("fecha")} /></Field>
        </div>
        <ImagenInput value={imagen} onChange={setImagen} carpeta="noticias" hint="Foto principal de la noticia (horizontal)." />
        <div className="flex flex-wrap gap-6">
          <Checkbox checked={f.publicado} onChange={(v) => setF({ ...f, publicado: v })} label="Publicada en la web" />
          <Checkbox checked={f.destacado} onChange={(v) => setF({ ...f, destacado: v })} label="Destacada (aparece primero)" />
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
