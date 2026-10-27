import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, CheckCircle2, FileText, Image as ImageIcon, Mail, MessageCircle, Paperclip, PauseCircle, PlayCircle, Receipt, Search, Send, Sparkles, User, X,
} from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fecha, fechaHora, nombreSocio, pesos } from "../../lib/format";
import type { CuotaDetalle } from "../../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, cx, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";
import { PagoModal } from "../components/Cobro";

export const ETAPAS = ["Nuevo", "Consultando", "Interesado", "Alta en trámite", "Socio", "Derivado", "Perdido"] as const;
const AREAS: Record<string, string> = {
  tesoreria: "Tesorería", prensa: "Prensa y capacitación", administracion: "Administración", secretaria: "Secretaría", presidencia: "Presidencia", comercia: "ComercIA",
};

export interface Conversacion {
  id: string; nombre: string | null; telefono: string | null; email: string | null; socio_id: string | null; staff_user_id: string | null;
  etapa: string; interes: string | null; area: string | null; resumen: string | null; empresa: string | null; asignado_a: string | null;
  ia_pausada_hasta: string | null; no_leidos: number; ultimo_mensaje: string | null; ultimo_canal: "whatsapp" | "email" | null;
  ultimo_mensaje_at: string; acepta_novedades: boolean; baja_at: string | null; estado: string;
}
interface Mensaje {
  id: string; canal: "whatsapp" | "email"; direccion: "entrante" | "saliente"; autor: "contacto" | "ia" | "personal" | "sistema";
  staff_id: string | null; cuerpo: string; asunto: string | null; adjunto_path: string | null; adjunto_nombre: string | null; adjunto_mime: string | null;
  media_tipo: string | null; estado: "ok" | "error"; error: string | null; analisis: any; created_at: string;
}
interface Comprobante {
  id: string; conversacion_id: string | null; socio_id: string | null; canal: string; monto: number | null; fecha: string | null; emisor: string | null;
  referencia: string | null; archivo_path: string | null; archivo_nombre: string | null; estado: string; created_at: string;
}

type Tab = "conversaciones" | "contactos" | "comprobantes";

export function useStaffNombres() {
  return useQuery({
    queryKey: ["staff", "nombres"],
    queryFn: async () => unwrap(await supabase.from("staff").select("user_id, nombre, activo").order("nombre")) as { user_id: string; nombre: string; activo: boolean }[],
  });
}

export default function Bandeja() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "conversaciones");
  const { data: pendientes } = useQuery({
    queryKey: ["canales", "comprobantes-pendientes"],
    queryFn: async () => (await supabase.from("comprobantes_recibidos").select("id", { count: "exact", head: true }).eq("estado", "pendiente")).count || 0,
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader title="Bandeja" subtitle="WhatsApp y email de socios y contactos en un solo lugar, con la IA del CeCIP" />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => { setTab(t); setParams(t === "conversaciones" ? {} : { tab: t }); }}
        tabs={[
          { value: "conversaciones", label: "Conversaciones" },
          { value: "contactos", label: "Contactos (pipeline)" },
          { value: "comprobantes", label: `Comprobantes${pendientes ? ` (${pendientes})` : ""}` },
        ]}
      />
      {tab === "conversaciones" && <Conversaciones inicial={params.get("c")} />}
      {tab === "contactos" && <Pipeline onAbrir={(id) => { setTab("conversaciones"); setParams({ c: id }); }} />}
      {tab === "comprobantes" && <Comprobantes />}
    </>
  );
}

// -----------------------------------------------------------------------------

type Filtro = "todas" | "sin-leer" | "socios" | "no-socios" | "mias" | "email" | "personal" | "cerradas";

function Conversaciones({ inicial }: { inicial: string | null }) {
  const { staff } = useAuth();
  const [sel, setSel] = useState<string | null>(inicial);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const { data: socios } = useSociosMin();
  const { data, isLoading } = useQuery({
    queryKey: ["canales", "conversaciones"],
    queryFn: async () => unwrap(await supabase.from("conversaciones").select("*").order("ultimo_mensaje_at", { ascending: false }).limit(400)) as Conversacion[],
    refetchInterval: 10_000,
  });
  useEffect(() => { if (inicial) setSel(inicial); }, [inicial]);

  const sociosPorId = useMemo(() => new Map((socios || []).map((s) => [s.id, s])), [socios]);
  const lista = (data || []).filter((c) => {
    if (filtro === "personal") return !!c.staff_user_id;
    if (c.staff_user_id) return false;
    if (filtro === "cerradas") return c.estado === "cerrada";
    if (c.estado === "cerrada") return false;
    if (filtro === "sin-leer" && !c.no_leidos) return false;
    if (filtro === "socios" && !c.socio_id) return false;
    if (filtro === "no-socios" && c.socio_id) return false;
    if (filtro === "mias" && c.asignado_a !== staff?.user_id) return false;
    if (filtro === "email" && c.ultimo_canal !== "email") return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const s = c.socio_id ? sociosPorId.get(c.socio_id) : null;
    return [c.nombre, c.telefono, c.email, c.empresa, c.ultimo_mensaje, s?.razon_social, s?.nombre_comercial].some((x) => x?.toLowerCase().includes(t));
  });
  const actual = (data || []).find((c) => c.id === sel) || null;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className={cx("flex h-[calc(100vh-15rem)] min-h-[480px] flex-col overflow-hidden", actual && "hidden lg:flex")}>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar nombre, número, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="todas">Abiertas</option>
            <option value="sin-leer">Sin leer</option>
            <option value="socios">Socios</option>
            <option value="no-socios">No socios</option>
            <option value="mias">Asignadas a mí</option>
            <option value="email">Por email</option>
            <option value="cerradas">Cerradas / publicidad</option>
            <option value="personal">Personal (Copiloto por WhatsApp)</option>
          </Select>
        </div>
        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {isLoading && <Loading />}
          {!isLoading && !lista.length && <Empty icon={<MessageCircle className="h-8 w-8" />}>No hay conversaciones con este filtro.</Empty>}
          {lista.map((c) => {
            const s = c.socio_id ? sociosPorId.get(c.socio_id) : null;
            return (
              <li key={c.id}>
                <button onClick={() => setSel(c.id)} className={cx("flex w-full gap-3 px-3 py-2.5 text-left hover:bg-slate-50", sel === c.id && "bg-brand-50")}>
                  <div className={cx("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white", c.ultimo_canal === "email" ? "bg-indigo-500" : "bg-emerald-500")}>
                    {c.ultimo_canal === "email" ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx("truncate text-sm", c.no_leidos ? "font-bold" : "font-medium")}>{s ? nombreSocio(s) : c.nombre || c.empresa || (c.telefono ? `+${c.telefono}` : c.email)}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{fechaCorta(c.ultimo_mensaje_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-slate-500">{c.ultimo_mensaje || "—"}</span>
                      {c.no_leidos > 0 && <span className="ml-auto shrink-0 rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">{c.no_leidos}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s ? <Badge tone="blue">Socio</Badge> : !c.staff_user_id && <Badge>{c.etapa}</Badge>}
                      {c.area && <Badge tone="purple">{AREAS[c.area]}</Badge>}
                      {c.ia_pausada_hasta && new Date(c.ia_pausada_hasta) > new Date() && <Badge tone="amber">IA en pausa</Badge>}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {actual ? <Vista conv={actual} onCerrar={() => setSel(null)} /> : (
        <Card className="hidden h-[calc(100vh-15rem)] min-h-[480px] place-items-center lg:grid">
          <Empty icon={<MessageCircle className="h-10 w-10" />}>Elegí una conversación para ver los mensajes.</Empty>
        </Card>
      )}
    </div>
  );
}

const fechaCorta = (d: string) => {
  const f = new Date(d);
  return f.toDateString() === new Date().toDateString() ? f.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : f.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
};

// -----------------------------------------------------------------------------

function Vista({ conv, onCerrar }: { conv: Conversacion; onCerrar: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("atencion", "tesoreria", "prensa");
  const { data: socios } = useSociosMin();
  const { data: staff } = useStaffNombres();
  const socio = conv.socio_id ? socios?.find((s) => s.id === conv.socio_id) : null;
  const fin = useRef<HTMLDivElement>(null);
  const [vincular, setVincular] = useState(false);

  const { data: mensajes, isLoading } = useQuery({
    queryKey: ["canales", "mensajes", conv.id],
    queryFn: async () => unwrap(await supabase.from("mensajes").select("*").eq("conversacion_id", conv.id).order("created_at").limit(500)) as Mensaje[],
    refetchInterval: 8_000,
  });
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [mensajes?.length, conv.id]);
  useEffect(() => {
    if (conv.no_leidos) supabase.rpc("conversacion_leida", { p_id: conv.id }).then(() => invalidate("canales"));
  }, [conv.id, conv.no_leidos]); // eslint-disable-line react-hooks/exhaustive-deps

  const pausada = !!conv.ia_pausada_hasta && new Date(conv.ia_pausada_hasta) > new Date();
  const nombres = new Map((staff || []).map((s) => [s.user_id, s.nombre]));

  async function cambiar(cambios: Partial<Conversacion>) {
    const { error } = await supabase.from("conversaciones").update(cambios).eq("id", conv.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("canales");
  }
  async function alternarIa() {
    try {
      await api("canales/ia", { conversacion_id: conv.id, pausar: !pausada });
      toast(pausada ? "La IA vuelve a responder en esta conversación." : "IA en pausa: respondés vos.");
      invalidate("canales");
    } catch (e) { toast((e as Error).message, "error"); }
  }

  return (
    <Card className="flex h-[calc(100vh-15rem)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-slate-100 p-3">
        <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700 lg:hidden"><X className="h-5 w-5" /></button>
        <div className="min-w-[14rem] flex-1 basis-full xl:basis-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{socio ? nombreSocio(socio) : conv.nombre || conv.empresa || "Contacto"}</span>
            {socio ? <Link to={`/socios/${socio.id}`} className="text-xs text-brand-600 hover:underline">Ver ficha del socio</Link>
              : !conv.staff_user_id && puede && <button onClick={() => setVincular(true)} className="text-xs text-brand-600 hover:underline">Vincular a un socio</button>}
          </div>
          <div className="text-xs text-slate-500">
            {[conv.telefono && `+${conv.telefono}`, conv.email, conv.empresa && !socio && conv.empresa].filter(Boolean).join(" · ")}
            {conv.baja_at && <span className="ml-1 text-red-600">· pidió BAJA de difusiones</span>}
          </div>
          {conv.resumen && <div className="mt-1 text-xs text-slate-600"><Sparkles className="mr-1 inline h-3 w-3 text-brand-500" />{conv.resumen}</div>}
        </div>
        {!conv.staff_user_id && (
          <div className="flex flex-wrap items-center gap-2">
            {!socio && (
              <Select className="w-auto py-1 text-xs" value={conv.etapa} disabled={!puede} onChange={(e) => cambiar({ etapa: e.target.value })}>
                {ETAPAS.map((e) => <option key={e}>{e}</option>)}
              </Select>
            )}
            <Select className="w-auto py-1 text-xs" value={conv.asignado_a || ""} disabled={!puede} onChange={(e) => cambiar({ asignado_a: e.target.value || null })}>
              <option value="">Sin asignar</option>
              {staff?.filter((s) => s.activo).map((s) => <option key={s.user_id} value={s.user_id}>{s.nombre}</option>)}
            </Select>
            <Select className="w-auto py-1 text-xs" value={conv.area || ""} disabled={!puede} onChange={(e) => cambiar({ area: e.target.value || null })}>
              <option value="">Sin área</option>
              {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {puede && conv.telefono && (
              <Button size="sm" variant="secondary" icon={pausada ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />} onClick={alternarIa}>
                {pausada ? "Reactivar IA" : "Pausar IA"}
              </Button>
            )}
            {puede && (
              <Button size="sm" variant="ghost" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => cambiar({ estado: conv.estado === "cerrada" ? "abierta" : "cerrada" })}>
                {conv.estado === "cerrada" ? "Reabrir" : "Cerrar"}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        {isLoading && <Loading />}
        {mensajes?.map((m) => <Burbuja key={m.id} m={m} nombre={m.staff_id ? nombres.get(m.staff_id) : undefined} />)}
        {!isLoading && !mensajes?.length && <Empty>Todavía no hay mensajes.</Empty>}
        <div ref={fin} />
      </div>

      {puede && !conv.staff_user_id ? <Redactor conv={conv} socioId={socio?.id || null} /> : (
        <div className="border-t border-slate-100 p-3 text-center text-xs text-slate-500">
          {conv.staff_user_id ? "Conversación de alguien del personal con el Copiloto por WhatsApp (solo lectura)." : "Tu rol puede leer las conversaciones pero no responder."}
        </div>
      )}
      <VincularSocioModal open={vincular} conv={conv} onClose={() => setVincular(false)} />
    </Card>
  );
}

function Burbuja({ m, nombre }: { m: Mensaje; nombre?: string }) {
  const sale = m.direccion === "saliente";
  const etiqueta = m.autor === "ia" ? "IA del CeCIP" : m.autor === "sistema" ? "Aviso automático" : m.autor === "personal" ? nombre || "CeCIP" : null;
  return (
    <div className={cx("flex", sale ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
        sale ? (m.autor === "personal" ? "bg-brand-600 text-white" : "bg-emerald-100 text-slate-900") : "bg-white text-slate-900",
        m.estado === "error" && "ring-2 ring-red-400")}>
        <div className={cx("mb-0.5 flex items-center gap-1 text-[11px]", sale && m.autor === "personal" ? "text-brand-100" : "text-slate-500")}>
          {m.canal === "email" ? <Mail className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
          {etiqueta && <>{m.autor === "ia" ? <Bot className="h-3 w-3" /> : m.autor === "personal" ? <User className="h-3 w-3" /> : null}<span>{etiqueta}</span><span>·</span></>}
          <span>{fechaHora(m.created_at)}</span>
        </div>
        {m.asunto && <div className="mb-1 font-semibold">{m.asunto}</div>}
        {(m.adjunto_path || m.adjunto_nombre) && <Adjunto m={m} />}
        {m.cuerpo && <div className="whitespace-pre-wrap break-words">{m.cuerpo}</div>}
        {m.analisis && m.direccion === "entrante" && (m.analisis.resumen || m.analisis.tipo) && (
          <div className="mt-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
            <Sparkles className="mr-1 inline h-3 w-3" />{m.analisis.tipo ? `${String(m.analisis.tipo).replace(/_/g, " ")} · ` : ""}{m.analisis.resumen || ""}
            {m.analisis.respuesta_sugerida && <div className="mt-1 italic">Sugerida: {String(m.analisis.respuesta_sugerida).slice(0, 220)}…</div>}
          </div>
        )}
        {m.estado === "error" && <div className="mt-1 text-[11px] text-red-600">No se envió: {m.error}</div>}
      </div>
    </div>
  );
}

function Adjunto({ m }: { m: Mensaje }) {
  const esImagen = m.adjunto_mime?.startsWith("image/");
  const { data: url } = useQuery({
    queryKey: ["canales", "archivo", m.adjunto_path],
    queryFn: async () => (await api<{ url: string }>("canales/archivo", { ruta: m.adjunto_path })).url,
    enabled: !!esImagen && !!m.adjunto_path,
    staleTime: 240_000,
  });
  async function abrir() {
    try {
      const r = await api<{ url: string }>("canales/archivo", { ruta: m.adjunto_path, nombre: m.adjunto_nombre });
      window.open(r.url, "_blank", "noopener");
    } catch (e) { alert((e as Error).message); }
  }
  if (esImagen && url) return <button onClick={abrir} className="mb-1 block"><img src={url} alt={m.adjunto_nombre || "imagen"} className="max-h-60 rounded-lg" /></button>;
  return (
    <button onClick={abrir} className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-2 py-1.5 text-left text-xs hover:bg-black/10">
      {esImagen ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      <span className="truncate">{m.adjunto_nombre || "Archivo"}</span>
    </button>
  );
}

function Redactor({ conv, socioId }: { conv: Conversacion; socioId: string | null }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [texto, setTexto] = useState("");
  const [asunto, setAsunto] = useState("");
  const [archivo, setArchivo] = useState<{ ruta: string; nombre: string; mime: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [recibo, setRecibo] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canal = conv.telefono ? "whatsapp" : "email";
  useEffect(() => { setTexto(""); setArchivo(null); setAsunto(""); }, [conv.id]);

  async function subir(file: File) {
    setSubiendo(true);
    try {
      const r = await api<{ ruta: string; token?: string; url?: string }>("canales/subir", { nombre: file.name, mime: file.type, tamano: file.size });
      if (r.token) {
        const { error } = await supabase.storage.from("canales").uploadToSignedUrl(r.ruta, r.token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
      }
      setArchivo({ ruta: r.ruta, nombre: file.name, mime: file.type });
    } catch (e) { toast((e as Error).message, "error"); } finally { setSubiendo(false); }
  }

  async function enviar(extra: Record<string, unknown> = {}) {
    if (!texto.trim() && !archivo && !extra.recibo_cuota_id) return;
    setEnviando(true);
    try {
      await api("canales/enviar", { conversacion_id: conv.id, texto, archivo, asunto: asunto || undefined, ...extra });
      setTexto(""); setArchivo(null); setAsunto("");
      invalidate("canales");
    } catch (e) { toast((e as Error).message, "error"); } finally { setEnviando(false); }
  }

  async function sugerir() {
    setSugiriendo(true);
    try {
      const r = await api<{ texto: string }>("canales/sugerir", { conversacion_id: conv.id });
      setTexto(r.texto);
    } catch (e) { toast((e as Error).message, "error"); } finally { setSugiriendo(false); }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 p-3">
      {canal === "email" && <input className="input py-1.5 text-sm" placeholder="Asunto (vacío = responde en el mismo hilo)" value={asunto} onChange={(e) => setAsunto(e.target.value)} />}
      {archivo && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-xs">
          <Paperclip className="h-3.5 w-3.5" /><span className="truncate">{archivo.nombre}</span>
          <button onClick={() => setArchivo(null)} className="ml-auto text-slate-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <Textarea rows={2} placeholder={`Escribí un ${canal === "email" ? "email" : "mensaje de WhatsApp"}… (Ctrl+Enter envía)`} value={texto}
        onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(); }} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" className="hidden" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
        <Button size="sm" variant="ghost" icon={<Paperclip className="h-4 w-4" />} loading={subiendo} onClick={() => input.current?.click()}>Adjuntar</Button>
        {socioId && <Button size="sm" variant="ghost" icon={<Receipt className="h-4 w-4" />} onClick={() => setRecibo(true)}>Enviar recibo</Button>}
        <Button size="sm" variant="ghost" icon={<Sparkles className="h-4 w-4" />} loading={sugiriendo} onClick={sugerir}>Sugerir con IA</Button>
        <span className="ml-auto text-[11px] text-slate-400">por {canal === "email" ? "email" : "WhatsApp"} · al responder, la IA se pausa</span>
        <Button size="sm" icon={<Send className="h-4 w-4" />} loading={enviando} disabled={!texto.trim() && !archivo} onClick={() => enviar()}>Enviar</Button>
      </div>
      {socioId && <ReciboModal open={recibo} socioId={socioId} onClose={() => setRecibo(false)} onElegir={(id) => { setRecibo(false); enviar({ recibo_cuota_id: id }); }} />}
    </div>
  );
}

function ReciboModal({ open, socioId, onClose, onElegir }: { open: boolean; socioId: string; onClose: () => void; onElegir: (cuotaId: string) => void }) {
  const { data } = useQuery({
    queryKey: ["cuotas", "pagadas", socioId],
    queryFn: async () => unwrap(await supabase.from("cuotas").select("id, concepto, fecha_pago, monto_pagado, recibo_numero").eq("socio_id", socioId).eq("estado", "pagada")
      .not("recibo_numero", "is", null).order("fecha_pago", { ascending: false }).limit(24)) as { id: string; concepto: string; fecha_pago: string; monto_pagado: number; recibo_numero: number }[],
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="Enviar un recibo en PDF">
      {!data ? <Loading /> : !data.length ? <Empty>El socio no tiene pagos con recibo.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div><div className="font-medium">{c.concepto}</div><div className="text-xs text-slate-500">Recibo N° {c.recibo_numero} · {fecha(c.fecha_pago)} · {pesos(c.monto_pagado)}</div></div>
              <Button size="sm" variant="secondary" onClick={() => onElegir(c.id)}>Enviar</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function VincularSocioModal({ open, conv, onClose }: { open: boolean; conv: Conversacion; onClose: () => void }) {
  const { data: socios } = useSociosMin();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [q, setQ] = useState("");
  const lista = (socios || []).filter((s) => s.estado !== "baja" && `${s.razon_social} ${s.nombre_comercial || ""} ${s.numero_socio || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  async function elegir(id: string) {
    const { error } = await supabase.from("conversaciones").update({ socio_id: id, etapa: "Socio" }).eq("id", conv.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Conversación vinculada al socio: la IA ya le responde como socio.");
    invalidate("canales");
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="Vincular a un socio">
      <input className="input mb-3" placeholder="Buscar socio…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {lista.map((s) => (
          <li key={s.id}><button onClick={() => elegir(s.id)} className="w-full px-2 py-2 text-left text-sm hover:bg-slate-50">{nombreSocio(s)}{s.numero_socio ? <span className="text-xs text-slate-500"> · N° {s.numero_socio}</span> : null}</button></li>
        ))}
      </ul>
    </Modal>
  );
}

// -----------------------------------------------------------------------------

function Pipeline({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data, isLoading } = useQuery({
    queryKey: ["canales", "pipeline"],
    queryFn: async () => unwrap(await supabase.from("conversaciones").select("*").is("socio_id", null).is("staff_user_id", null).neq("estado", "cerrada")
      .order("ultimo_mensaje_at", { ascending: false }).limit(500)) as Conversacion[],
    refetchInterval: 20_000,
  });
  if (isLoading) return <Loading />;
  async function mover(c: Conversacion, etapa: string) {
    const { error } = await supabase.from("conversaciones").update({ etapa }).eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("canales");
  }
  const columnas = ETAPAS.filter((e) => e !== "Socio");
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columnas.map((etapa) => {
        const items = (data || []).filter((c) => c.etapa === etapa);
        return (
          <div key={etapa} className="w-72 shrink-0 rounded-xl bg-slate-100 p-2">
            <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">{etapa}<Badge>{items.length}</Badge></div>
            <div className="space-y-2">
              {items.map((c) => (
                <div key={c.id} className="rounded-lg bg-white p-2.5 text-sm shadow-sm">
                  <button onClick={() => onAbrir(c.id)} className="block w-full text-left">
                    <div className="font-medium">{c.nombre || c.empresa || (c.telefono ? `+${c.telefono}` : c.email)}</div>
                    {c.empresa && c.nombre && <div className="text-xs text-slate-500">{c.empresa}</div>}
                    {c.resumen && <div className="mt-1 line-clamp-3 text-xs text-slate-600">{c.resumen}</div>}
                  </button>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {c.interes && <Badge tone="blue">{c.interes}</Badge>}
                    {c.acepta_novedades && <Badge tone="green">Novedades</Badge>}
                    <span className="ml-auto text-[11px] text-slate-400">{fechaCorta(c.ultimo_mensaje_at)}</span>
                  </div>
                  {can("atencion", "tesoreria", "prensa") && (
                    <select className="input mt-2 py-0.5 text-xs" value={c.etapa} onChange={(e) => mover(c, e.target.value)}>
                      {ETAPAS.map((e) => <option key={e}>{e}</option>)}
                    </select>
                  )}
                </div>
              ))}
              {!items.length && <div className="px-1 py-3 text-center text-xs text-slate-400">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------

function Comprobantes() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const [estado, setEstado] = useState("pendiente");
  const [conciliar, setConciliar] = useState<Comprobante | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["canales", "comprobantes", estado],
    queryFn: async () => unwrap(await supabase.from("comprobantes_recibidos").select("*").eq("estado", estado).order("created_at", { ascending: false }).limit(200)) as Comprobante[],
  });
  const sociosPorId = new Map((socios || []).map((s) => [s.id, s]));
  const puede = can("tesoreria");

  async function ver(c: Comprobante) {
    try { window.open((await api<{ url: string }>("canales/archivo", { ruta: c.archivo_path, nombre: c.archivo_nombre })).url, "_blank", "noopener"); }
    catch (e) { toast((e as Error).message, "error"); }
  }
  async function descartar(c: Comprobante) {
    if (!confirm("¿Descartar este comprobante? (no es un pago a registrar)")) return;
    const { error } = await supabase.from("comprobantes_recibidos").update({ estado: "descartado", resuelto_at: new Date().toISOString() }).eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("canales");
  }

  return (
    <Card actions={<Select className="w-auto py-1 text-sm" value={estado} onChange={(e) => setEstado(e.target.value)}>
      <option value="pendiente">Para conciliar</option><option value="conciliado">Conciliados</option><option value="descartado">Descartados</option>
    </Select>} title="Comprobantes de pago recibidos por WhatsApp y email">
      <ErrorBox error={error} />
      {isLoading ? <Loading /> : !data?.length ? <Empty icon={<Receipt className="h-8 w-8" />}>No hay comprobantes {estado === "pendiente" ? "para conciliar" : estado + "s"}.</Empty> : (
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">Recibido</th><th className="th">De</th><th className="th text-right">Monto leído</th><th className="th">Pago</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((c) => {
              const s = c.socio_id ? sociosPorId.get(c.socio_id) : null;
              return (
                <tr key={c.id}>
                  <td className="td whitespace-nowrap text-xs">{fechaHora(c.created_at)}<div>{c.canal === "email" ? "Email" : "WhatsApp"}</div></td>
                  <td className="td">{s ? nombreSocio(s) : <span className="text-amber-700">Sin socio vinculado</span>}</td>
                  <td className="td text-right tabular-nums">{c.monto ? pesos(c.monto) : "—"}</td>
                  <td className="td text-xs text-slate-600">{[c.fecha && fecha(c.fecha), c.emisor, c.referencia && `Ref. ${c.referencia}`].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="td whitespace-nowrap text-right">
                    {c.archivo_path && <Button size="sm" variant="ghost" onClick={() => ver(c)}>Ver</Button>}
                    {puede && c.estado === "pendiente" && <>
                      <Button size="sm" variant="success" disabled={!c.socio_id} title={c.socio_id ? "" : "Vinculá la conversación a un socio"} onClick={() => setConciliar(c)}>Conciliar</Button>
                      <Button size="sm" variant="ghost" onClick={() => descartar(c)}>Descartar</Button>
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {conciliar && <ConciliarModal comp={conciliar} onClose={() => setConciliar(null)} />}
    </Card>
  );
}

function ConciliarModal({ comp, onClose }: { comp: Comprobante; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [cuota, setCuota] = useState<CuotaDetalle | null>(null);
  const { data } = useQuery({
    queryKey: ["cuotas", "pendientes", comp.socio_id],
    queryFn: async () => unwrap(await supabase.from("cuotas_detalle").select("*").eq("socio_id", comp.socio_id!).eq("estado", "pendiente").order("vencimiento")) as CuotaDetalle[],
  });
  async function registrado(cuotaId: string) {
    const { error } = await supabase.from("comprobantes_recibidos").update({ estado: "conciliado", cuota_id: cuotaId, resuelto_at: new Date().toISOString() }).eq("id", comp.id);
    if (error) toast(traducirError(error.message), "error");
    invalidate("canales");
    onClose();
  }
  return (
    <>
      <Modal open={!cuota} onClose={onClose} title="¿A qué cuota corresponde el pago?">
        {!data ? <Loading /> : !data.length ? <Empty>El socio no tiene cuotas pendientes.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div><div className="font-medium">{c.concepto}</div><div className="text-xs text-slate-500">Vence {fecha(c.vencimiento)} · {pesos(c.total)}</div></div>
                <Button size="sm" variant="secondary" onClick={() => setCuota(c)}>Elegir</Button>
              </li>
            ))}
          </ul>
        )}
        {comp.monto ? <p className="mt-3 text-xs text-slate-500">Monto leído en el comprobante: <b>{pesos(comp.monto)}</b>.</p> : null}
      </Modal>
      <PagoModal cuota={cuota} onClose={() => setCuota(null)} onRegistrado={registrado}
        sugerido={{ metodo: "Transferencia", fecha: comp.fecha, monto: comp.monto, referencia: comp.referencia }} />
    </>
  );
}
