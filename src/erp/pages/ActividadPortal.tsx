import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Lightbulb, MousePointerClick, Search, Users } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora, nombreSocio } from "../../lib/format";
import { descargarCSV } from "../../lib/csv";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, Textarea, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";

/**
 * Actividad de los socios en el Portal (qué secciones visitan, qué abren y qué descargan) para medir
 * qué les interesa, y las sugerencias que mandan al CeCIP.
 */
interface Evento { id: number; socio_id: string | null; accion: string; seccion: string; detalle: Record<string, unknown>; created_at: string }
export interface Sugerencia {
  id: string; socio_id: string | null; categoria: string; mensaje: string; estado: "nueva" | "en_revision" | "respondida" | "archivada";
  respuesta: string | null; respondido_at: string | null; created_at: string;
}

export const SECCIONES_PORTAL: Record<string, string> = {
  inicio: "Inicio", copiloto: "Copiloto IA", cuotas: "Mis cuotas", comunicados: "Comunicados", eventos: "Eventos y capacitaciones",
  comercia: "ComercIA", bolsa: "Bolsa de empleo", convenios: "Convenios y promociones", empresa: "Mi empresa", sugerencias: "Sugerencias",
};
const ACCIONES: Record<string, string> = { ver: "Visitó", click: "Abrió", descarga: "Descargó", inscripcion: "Se inscribió", pago: "Pagó", sugerencia: "Envió una sugerencia", interes: "Marcó interés", consulta: "Consultó" };
export const ESTADOS_SUG: Record<Sugerencia["estado"], { label: string; tone: "blue" | "amber" | "green" | "gray" }> = {
  nueva: { label: "Nueva", tone: "blue" }, en_revision: { label: "En revisión", tone: "amber" },
  respondida: { label: "Respondida", tone: "green" }, archivada: { label: "Archivada", tone: "gray" },
};

const DIA = 86400000;
const nombreSeccion = (s: string) => SECCIONES_PORTAL[s] || s;
const describir = (e: Evento) => {
  const titulo = typeof e.detalle?.titulo === "string" ? `: ${e.detalle.titulo}` : "";
  return `${ACCIONES[e.accion] || e.accion} ${nombreSeccion(e.seccion)}${titulo}`;
};

type Tab = "resumen" | "socio" | "sugerencias";

export default function ActividadPortal() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [socioSel, setSocioSel] = useState("");
  const [dias, setDias] = useState(30);
  const { data: socios } = useSociosMin();

  const { data: eventos, isLoading, error } = useQuery({
    queryKey: ["portal_actividad", dias],
    queryFn: async () => unwrap(await supabase.from("portal_actividad").select("id, socio_id, accion, seccion, detalle, created_at")
      .gte("created_at", new Date(Date.now() - dias * DIA).toISOString()).order("created_at", { ascending: false }).limit(20000)) as Evento[],
  });
  const { data: sugerencias } = useQuery({
    queryKey: ["sugerencias"],
    queryFn: async () => unwrap(await supabase.from("sugerencias").select("*").order("created_at", { ascending: false })) as Sugerencia[],
  });
  const nombre = useMemo(() => new Map((socios || []).map((s) => [s.id, nombreSocio(s)])), [socios]);
  const nuevas = (sugerencias || []).filter((s) => s.estado === "nueva").length;

  return (
    <>
      <PageHeader title="Actividad de socios en el portal"
        subtitle="Qué miran y usan los socios en el Portal, para saber qué les interesa, y sus sugerencias al CeCIP."
        actions={tab !== "sugerencias" && (
          <Select className="w-auto" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option>
          </Select>
        )} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "resumen", label: "Métricas" },
        { value: "socio", label: "Actividad por socio" },
        { value: "sugerencias", label: <>Sugerencias {nuevas > 0 && <Badge tone="blue">{nuevas}</Badge>}</> },
      ]} />
      <ErrorBox error={error} />
      {tab === "resumen" && (isLoading ? <Loading /> : <Resumen eventos={eventos || []} dias={dias} nombre={nombre} sugerencias={sugerencias || []}
        onSocio={(id) => { setSocioSel(id); setTab("socio"); }} />)}
      {tab === "socio" && (isLoading ? <Loading /> : <PorSocio eventos={eventos || []} socioId={socioSel} setSocioId={setSocioSel} nombre={nombre} dias={dias} />)}
      {tab === "sugerencias" && <Sugerencias lista={sugerencias || []} nombre={nombre} />}
    </>
  );
}

function Barras({ datos, total }: { datos: [string, number][]; total: number }) {
  return (
    <ul className="space-y-2 p-4">
      {datos.map(([k, n]) => (
        <li key={k}>
          <div className="mb-0.5 flex justify-between text-sm"><span>{k}</span><span className="font-semibold">{n}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-sky-500" style={{ width: `${Math.max(3, (n / total) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Resumen({ eventos, dias, nombre, sugerencias, onSocio }: {
  eventos: Evento[]; dias: number; nombre: Map<string, string>; sugerencias: Sugerencia[]; onSocio: (id: string) => void;
}) {
  const socios = new Set(eventos.map((e) => e.socio_id).filter(Boolean));
  const ultimos7 = new Set(eventos.filter((e) => Date.now() - new Date(e.created_at).getTime() <= 7 * DIA).map((e) => e.socio_id).filter(Boolean));
  const visitas = eventos.filter((e) => e.accion === "ver").length;
  const acciones = eventos.length - visitas;

  const secciones = useMemo(() => {
    const c: Record<string, number> = {};
    eventos.forEach((e) => { c[nombreSeccion(e.seccion)] = (c[nombreSeccion(e.seccion)] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [eventos]);
  const interes = useMemo(() => {
    // lo que más abren o descargan (eventos, convenios, comunicados, cursos…)
    const c: Record<string, number> = {};
    eventos.filter((e) => e.accion !== "ver" && typeof e.detalle?.titulo === "string")
      .forEach((e) => { const k = `${e.detalle.titulo} (${nombreSeccion(e.seccion)})`; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [eventos]);
  const ranking = useMemo(() => {
    const c = new Map<string, { n: number; ultima: string }>();
    eventos.forEach((e) => {
      if (!e.socio_id) return;
      const r = c.get(e.socio_id) || { n: 0, ultima: e.created_at };
      r.n++; if (e.created_at > r.ultima) r.ultima = e.created_at;
      c.set(e.socio_id, r);
    });
    return [...c.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  }, [eventos]);
  const porDia = useMemo(() => {
    const n = Math.min(dias, 60);
    const c = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * DIA);
      return { k: d.toISOString().slice(0, 10), label: `${d.getDate()}/${d.getMonth() + 1}`, n: 0 };
    });
    const idx = new Map(c.map((x, i) => [x.k, i]));
    eventos.forEach((e) => { const i = idx.get(new Date(e.created_at).toISOString().slice(0, 10)); if (i !== undefined) c[i].n++; });
    return c;
  }, [eventos, dias]);
  const max = Math.max(1, ...porDia.map((d) => d.n));

  if (!eventos.length) return <Card><Empty icon={<Activity className="h-8 w-8" />}>Todavía no hay actividad de socios en el Portal en este período.</Empty></Card>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Socios que entraron (${dias} días)`} value={socios.size} icon={<Users className="h-5 w-5" />} hint={`${ultimos7.size} en los últimos 7 días`} />
        <Stat label="Visitas a secciones" value={visitas} icon={<Activity className="h-5 w-5" />} />
        <Stat label="Acciones (abrir, descargar, inscribirse…)" value={acciones} icon={<MousePointerClick className="h-5 w-5" />} />
        <Stat label="Sugerencias sin responder" value={sugerencias.filter((s) => s.estado === "nueva" || s.estado === "en_revision").length} icon={<Lightbulb className="h-5 w-5" />} tone="warn" />
      </div>
      <Card title="Actividad por día" actions={<Button size="sm" variant="secondary" onClick={() => descargarCSV("actividad-portal", eventos.map((e) => ({
        fecha: fechaHora(e.created_at), socio: e.socio_id ? nombre.get(e.socio_id) || "" : "", seccion: nombreSeccion(e.seccion), accion: ACCIONES[e.accion] || e.accion,
        detalle: typeof e.detalle?.titulo === "string" ? e.detalle.titulo : "",
      })))}>Exportar</Button>}>
        <div className="flex h-36 items-end gap-[3px] px-4 pb-2 pt-4">
          {porDia.map((d) => (
            <div key={d.k} className="group relative flex-1" title={`${d.label}: ${d.n}`}>
              <div className="rounded-t bg-sky-500/80 transition group-hover:bg-sky-600" style={{ height: `${(d.n / max) * 120}px`, minHeight: d.n ? 3 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between px-4 pb-3 text-[10px] text-slate-400"><span>{porDia[0]?.label}</span><span>Hoy</span></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Secciones más usadas"><Barras datos={secciones} total={secciones[0]?.[1] || 1} /></Card>
        <Card title="Lo que más les interesa">
          {interes.length ? <Barras datos={interes} total={interes[0][1]} /> : <Empty>Todavía no abrieron ni descargaron contenidos.</Empty>}
        </Card>
        <Card title="Socios más activos">
          <ul className="divide-y divide-slate-100">
            {ranking.map(([id, r]) => (
              <li key={id}>
                <button type="button" onClick={() => onSocio(id)} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="truncate">{nombre.get(id) || "Socio"}</span>
                  <span className="shrink-0 text-xs text-slate-500">{r.n} · {fechaHora(r.ultima)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function PorSocio({ eventos, socioId, setSocioId, nombre, dias }: {
  eventos: Evento[]; socioId: string; setSocioId: (id: string) => void; nombre: Map<string, string>; dias: number;
}) {
  const [q, setQ] = useState("");
  const conActividad = useMemo(() => {
    const c = new Map<string, number>();
    eventos.forEach((e) => e.socio_id && c.set(e.socio_id, (c.get(e.socio_id) || 0) + 1));
    return [...c.entries()].map(([id, n]) => ({ id, n, nombre: nombre.get(id) || "Socio" })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [eventos, nombre]);
  const filtrados = conActividad.filter((s) => !q || s.nombre.toLowerCase().includes(q.toLowerCase()));
  const propios = eventos.filter((e) => e.socio_id === socioId);
  const secciones = useMemo(() => {
    const c: Record<string, number> = {};
    propios.forEach((e) => { c[nombreSeccion(e.seccion)] = (c[nombreSeccion(e.seccion)] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [propios]);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card title={`Socios con actividad (${conActividad.length})`}>
        <div className="relative border-b border-slate-100 p-2">
          <Search className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Buscar socio…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
          {filtrados.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setSocioId(s.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${s.id === socioId ? "bg-sky-50 font-semibold text-sky-800" : "hover:bg-slate-50"}`}>
                <span className="truncate">{s.nombre}</span><span className="text-xs text-slate-500">{s.n}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {!socioId ? <Card><Empty icon={<Users className="h-8 w-8" />}>Elegí un socio para ver sus movimientos en el Portal.</Empty></Card> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`Movimientos (${dias} días)`} value={propios.length} />
            <Stat label="Última vez" value={propios[0] ? fechaHora(propios[0].created_at) : "—"} />
            <Stat label="Lo que más usa" value={secciones[0]?.[0] || "—"} />
          </div>
          <Card title={nombre.get(socioId) || "Socio"}>
            {secciones.length > 0 && <Barras datos={secciones} total={secciones[0][1]} />}
            <Table>
              <thead className="bg-slate-50"><tr><th className="th">Fecha</th><th className="th">Movimiento</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {propios.slice(0, 300).map((e) => (
                  <tr key={e.id}><td className="td whitespace-nowrap text-xs text-slate-500">{fechaHora(e.created_at)}</td><td className="td text-sm">{describir(e)}</td></tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

function Sugerencias({ lista, nombre }: { lista: Sugerencia[]; nombre: Map<string, string> }) {
  const { can, staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("atencion", "prensa");
  const [estado, setEstado] = useState("pendientes");
  const [abrir, setAbrir] = useState<Sugerencia | null>(null);
  const [respuesta, setRespuesta] = useState("");
  const [saving, setSaving] = useState(false);

  const filtradas = lista.filter((s) => estado === "pendientes" ? ["nueva", "en_revision"].includes(s.estado) : !estado || s.estado === estado);
  const categorias = useMemo(() => {
    const c: Record<string, number> = {};
    lista.forEach((s) => { c[s.categoria] = (c[s.categoria] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lista]);

  async function guardar(s: Sugerencia, cambios: Partial<Sugerencia>, aviso: string) {
    setSaving(true);
    const extra = cambios.estado === "respondida" ? { respondido_por: staff?.user_id, respondido_at: new Date().toISOString() } : {};
    const { error } = await supabase.from("sugerencias").update({ ...cambios, ...extra }).eq("id", s.id);
    setSaving(false);
    if (error) return toast(traducirError(error.message), "error");
    toast(aviso);
    invalidate("sugerencias");
    setAbrir(null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <Select className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="pendientes">Sin responder</option><option value="">Todas</option>
            {Object.entries(ESTADOS_SUG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <span className="text-xs text-slate-500">Los socios las mandan desde el botón "Sugerencias" del Portal y ven la respuesta ahí.</span>
        </div>
        {!filtradas.length ? <Empty icon={<Lightbulb className="h-8 w-8" />}>No hay sugerencias con este filtro.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {filtradas.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { setAbrir(s); setRespuesta(s.respuesta || ""); }} className="w-full px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{s.socio_id ? nombre.get(s.socio_id) || "Socio" : "Socio"}</span>
                    <Badge tone={ESTADOS_SUG[s.estado].tone}>{ESTADOS_SUG[s.estado].label}</Badge>
                    <Badge>{s.categoria}</Badge>
                    <span className="text-xs text-slate-400">{fechaHora(s.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{s.mensaje}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Temas">{categorias.length ? <Barras datos={categorias} total={categorias[0][1]} /> : <Empty>Sin sugerencias.</Empty>}</Card>

      <Modal open={!!abrir} onClose={() => setAbrir(null)} size="lg" title="Sugerencia de socio"
        footer={abrir && puede && <>
          <Button variant="secondary" onClick={() => guardar(abrir, { estado: "archivada" }, "Sugerencia archivada.")}>Archivar</Button>
          <Button variant="secondary" onClick={() => guardar(abrir, { estado: "en_revision" }, "Marcada en revisión.")}>En revisión</Button>
          <Button loading={saving} disabled={!respuesta.trim()} onClick={() => guardar(abrir, { estado: "respondida", respuesta: respuesta.trim() }, "Respuesta enviada: el socio la ve en el Portal.")}>Responder</Button>
        </>}>
        {abrir && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>{abrir.socio_id ? nombre.get(abrir.socio_id) || "Socio" : "Socio"}</b><Badge>{abrir.categoria}</Badge>
              <span className="text-xs text-slate-400">{fechaHora(abrir.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{abrir.mensaje}</p>
            {puede ? (
              <Textarea rows={5} placeholder="Respuesta para el socio (la ve en el Portal, en Sugerencias)" value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />
            ) : abrir.respuesta && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3">{abrir.respuesta}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
