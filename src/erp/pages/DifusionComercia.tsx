import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Tabs, Textarea, useToast } from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { useCategorias } from "../data";
import { Editor, type Definicion } from "./Contenido";
import { WhatsappCampanas } from "../components/WhatsappCampanas";

/*
 * Difusión del equipo de ComercIA a los socios del CeCIP: novedades en el portal, email y WhatsApp.
 * El equipo de ComercIA no ve el padrón: para email el servidor arma la lista; para WhatsApp recibe
 * solo nombre y teléfono de cada destinatario al enviar.
 */

type Tab = "novedades" | "email" | "whatsapp";

const NOVEDADES: Definicion = {
  tabla: "comercia_novedades", singular: "novedad", campoTitulo: "titulo", campoSubtitulo: "cuerpo", campoActivo: "publicada",
  ayuda: "Novedades que los socios ven al entrar a ComercIA en el portal (y que el Copiloto puede contarles). Para avisarles además por email o WhatsApp, usá las otras pestañas.",
  campos: [
    { key: "titulo", label: "Título", tipo: "texto", requerido: true, ancho: "completo" },
    { key: "cuerpo", label: "Texto", tipo: "parrafo", requerido: true, ancho: "completo" },
    { key: "imagen_url", label: "Imagen (opcional)", tipo: "imagen", ancho: "completo" },
  ],
};

export default function DifusionComercia() {
  const [tab, setTab] = useState<Tab>("novedades");
  return (
    <>
      <PageHeader title="Difusión a socios" subtitle="Hacé llegar las ofertas de ComercIA, IEC y FactorIA a los socios del CeCIP." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "novedades", label: "Novedades en el portal" },
        { value: "email", label: "Email" },
        { value: "whatsapp", label: "WhatsApp" },
      ]} />
      {tab === "novedades" && <Editor def={NOVEDADES} />}
      {tab === "email" && <EmailComercia />}
      {tab === "whatsapp" && <WhatsappCampanas origen="comercia" />}
    </>
  );
}

type Base = { id: string; titulo: string; texto: string; imagen?: string | null };

function EmailComercia() {
  const toast = useToast();
  const { data: categorias } = useCategorias();
  const [rubro, setRubro] = useState("");
  const [categoria, setCategoria] = useState("");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [imagen, setImagen] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Para arrancar desde una novedad o una promoción ya cargada
  const { data: bases } = useQuery({
    queryKey: ["comercia-bases-email"],
    queryFn: async () => {
      const [n, p] = await Promise.all([
        supabase.from("comercia_novedades").select("id, titulo, cuerpo, imagen_url").eq("publicada", true).order("orden"),
        supabase.from("comercia_promociones").select("id, titulo, descuento, descripcion, condiciones").eq("activa", true).order("orden"),
      ]);
      const novedades: Base[] = (unwrap(n) as any[]).map((x) => ({ id: "n" + x.id, titulo: x.titulo, texto: x.cuerpo, imagen: x.imagen_url }));
      const promos: Base[] = (unwrap(p) as any[]).map((x) => ({
        id: "p" + x.id,
        titulo: x.descuento ? `${x.descuento} · ${x.titulo}` : x.titulo,
        texto: [x.descripcion, x.condiciones && `Condiciones: ${x.condiciones}`].filter(Boolean).join("\n\n"),
      }));
      return { novedades, promos };
    },
  });

  // Cantidad de destinatarios (el servidor cuenta; no se ven las direcciones)
  useEffect(() => {
    let vigente = true;
    setCantidad(null);
    const t = setTimeout(() => {
      api<{ destinatarios: number }>("comercia/difundir", { soloContar: true, rubro, categoria_id: categoria || undefined })
        .then((r) => vigente && setCantidad(r.destinatarios))
        .catch(() => vigente && setCantidad(null));
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
  }, [rubro, categoria]);

  function usarBase(id: string) {
    const b = [...(bases?.novedades || []), ...(bases?.promos || [])].find((x) => x.id === id);
    if (!b) return;
    setAsunto(b.titulo);
    setImagen(b.imagen || null);
    setCuerpo(`Hola {{nombre}},\n\n${b.texto}\n\nEntrá a la sección ComercIA del Portal de Socios y tocá "Quiero sumarme" o "¡La quiero!" para que te asesoremos.`);
  }

  async function enviar() {
    if (!asunto.trim() || !cuerpo.trim()) return setError("Completá asunto y mensaje.");
    if (!confirm(`¿Enviar este email a ${cantidad ?? "los"} socios?`)) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api<{ enviados: number; errores: number }>("comercia/difundir", { asunto, cuerpo, rubro, categoria_id: categoria || undefined, imagen_url: imagen });
      toast(`Emails enviados: ${r.enviados}.` + (r.errores ? ` No se pudieron enviar: ${r.errores}.` : ""), r.enviados ? "ok" : "error");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Destinatarios" className="h-fit">
        <div className="space-y-3 p-4">
          <Field label="Rubro (opcional)" hint="Ej.: gastronomía, indumentaria, ferretería.">
            <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Todos los rubros" />
          </Field>
          <Field label="Categoría">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            {cantidad === null ? "Calculando…" : <><b>{cantidad}</b> socios activos con email van a recibirlo.</>}
            <div className="mt-1 text-xs text-slate-500">Por privacidad no se muestran las direcciones: el sistema las completa al enviar.</div>
          </div>
        </div>
      </Card>

      <Card title="Mensaje" className="lg:col-span-2">
        <div className="space-y-3 p-4">
          {!!(bases?.novedades.length || bases?.promos.length) && (
            <Field label="Partir de una novedad o promoción (opcional)">
              <Select value="" onChange={(e) => usarBase(e.target.value)}>
                <option value="">Elegí para completar el mensaje…</option>
                {!!bases?.novedades.length && <optgroup label="Novedades">{bases.novedades.map((b) => <option key={b.id} value={b.id}>{b.titulo}</option>)}</optgroup>}
                {!!bases?.promos.length && <optgroup label="Promociones">{bases.promos.map((b) => <option key={b.id} value={b.id}>{b.titulo}</option>)}</optgroup>}
              </Select>
            </Field>
          )}
          <Field label="Asunto"><Input value={asunto} onChange={(e) => setAsunto(e.target.value)} /></Field>
          <Field label="Mensaje" hint={<>Variables: <code>{"{{nombre}}"}</code> y <code>{"{{empresa}}"}</code>. El email incluye un botón para ir a ComercIA en el portal.</>}>
            <Textarea rows={10} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
          </Field>
          <ImagenInput value={imagen} onChange={setImagen} carpeta="comercia" hint="Se muestra debajo del título del email." />
          <ErrorBox error={error} />
          <div className="flex justify-end">
            <Button icon={enviando ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />} loading={enviando} disabled={!cantidad} onClick={enviar}>
              Enviar a {cantidad ?? "…"} socios
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
