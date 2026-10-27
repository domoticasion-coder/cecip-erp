import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Mail, MessageCircle, QrCode, RefreshCw, Smartphone, Trash2, XCircle } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { fechaHora } from "../../lib/format";
import { Badge, Button, Card, Checkbox, Field, Input, Loading, Modal, Textarea, useToast } from "../../components/ui";
import { useInvalidate } from "../data";
import { useStaffNombres } from "../pages/Bandeja";

interface EstadoCanales {
  whatsapp: { configurado: boolean; estado?: string; numero?: string | null; error?: string };
  email: { conectada: boolean; usuario?: string; host?: string; ultima_sync_at?: string; ultimo_resultado?: string; ultimo_error?: string };
  ia: boolean;
  mi_whatsapp: { id: string; telefono: string; recibe_avisos: boolean }[];
  webhook_listo: boolean;
  cron_listo: boolean;
}

export function useEstadoCanales() {
  return useQuery({ queryKey: ["canales", "estado"], queryFn: () => api<EstadoCanales>("canales/estado"), staleTime: 30_000 });
}

const Ok = ({ ok, si, no }: { ok: boolean; si: string; no: string }) => (
  <span className={ok ? "text-emerald-700" : "text-amber-700"}>
    {ok ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <XCircle className="mr-1 inline h-4 w-4" />}{ok ? si : no}
  </span>
);

const AREAS: [string, string][] = [
  ["tesoreria", "Tesorería y pagos"], ["secretaria", "Secretaría (altas, reclamos, consultas)"], ["prensa", "Prensa y capacitación"],
  ["administracion", "Administración (alquileres, trámites)"], ["presidencia", "Presidencia"], ["comercia", "ComercIA"],
];

/** Configuración → Canales (solo administrador del sistema) */
export function ConfigCanales() {
  const { data: e, isLoading, refetch } = useEstadoCanales();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);

  async function accion(clave: string, path: string, body: object, ok: (r: any) => void) {
    setCargando(clave);
    try { ok(await api(path, body)); refetch(); } catch (err) { toast((err as Error).message, "error"); } finally { setCargando(null); }
  }

  if (isLoading || !e) return <Loading />;
  const wa = e.whatsapp;
  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp (Evolution API)</span>}>
        <div className="space-y-3 p-4 text-sm">
          {!wa.configurado ? (
            <p className="text-amber-700">Falta configurar en Vercel <code>EVOLUTION_API_URL</code>, <code>EVOLUTION_API_KEY</code> y <code>EVOLUTION_INSTANCE</code> (instancia <b>CECIP</b>).</p>
          ) : (
            <>
              <div>Estado: <Ok ok={wa.estado === "open"} si={`Conectado${wa.numero ? ` · +${wa.numero}` : ""}`} no={wa.estado === "error" ? `Error: ${wa.error}` : `Sin conectar (${wa.estado})`} /></div>
              <div className="flex flex-wrap gap-2">
                {wa.estado !== "open" && (
                  <Button size="sm" variant="secondary" icon={<QrCode className="h-4 w-4" />} loading={cargando === "qr"}
                    onClick={() => accion("qr", "canales/whatsapp-qr", {}, (r) => r.base64 ? setQr(r.base64) : toast(r.codigo ? `Código de vinculación: ${r.codigo}` : "Evolution no devolvió el QR.", r.codigo ? "ok" : "error"))}>
                    Vincular el celular (QR)
                  </Button>
                )}
                <Button size="sm" variant="secondary" loading={cargando === "webhook"} disabled={!e.webhook_listo}
                  onClick={() => accion("webhook", "canales/whatsapp-webhook-config", {}, () => toast("Listo: los mensajes que lleguen al número entran al ERP."))}>
                  Conectar mensajes entrantes (webhook)
                </Button>
              </div>
              {!e.webhook_listo && <p className="text-xs text-amber-700">Falta <code>WHATSAPP_WEBHOOK_SECRET</code> en Vercel.</p>}
            </>
          )}
          <div>Tareas automáticas (emails, campañas, seguimientos): <Ok ok={e.cron_listo} si="listas" no="falta CRON_SECRET" /> <span className="text-xs text-slate-500">— las dispara n8n cada 5 minutos.</span></div>
          <div>IA: <Ok ok={e.ia} si="configurada" no="falta GEMINI_API_KEY" /></div>
        </div>
      </Card>

      <EmailCard e={e} onCambio={refetch} />
      <AjustesIa />

      <Modal open={!!qr} onClose={() => setQr(null)} title="Escaneá el QR desde el celular del CeCIP">
        <p className="mb-3 text-sm text-slate-600">WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>
        {qr && <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR de WhatsApp" className="mx-auto w-64" />}
      </Modal>
    </div>
  );
}

function EmailCard({ e, onCambio }: { e: EstadoCanales; onCambio: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ host: "mail.centrocomercialparana.com.ar", puerto: "993", usuario: "", password: "", carpeta: "INBOX" });
  const [cargando, setCargando] = useState<string | null>(null);
  async function correr(clave: string, path: string, body: object, ok: string) {
    setCargando(clave);
    try { await api(path, body); toast(ok); onCambio(); } catch (err) { toast((err as Error).message, "error"); } finally { setCargando(null); }
  }
  const m = e.email;
  return (
    <Card title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-indigo-600" /> Emails entrantes (IMAP)</span>}>
      <div className="space-y-3 p-4 text-sm">
        {m.conectada ? (
          <>
            <div><Ok ok={!m.ultimo_error} si={`Conectada: ${m.usuario}`} no={`Error: ${m.ultimo_error}`} /></div>
            <div className="text-xs text-slate-500">Última revisión: {m.ultima_sync_at ? fechaHora(m.ultima_sync_at) : "todavía no"} · {m.ultimo_resultado || ""}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={cargando === "sync"} onClick={() => correr("sync", "canales/email-sincronizar", {}, "Casilla revisada.")}>Revisar ahora</Button>
              <Button size="sm" variant="ghost" loading={cargando === "off"} onClick={() => confirm("¿Desconectar la casilla?") && correr("off", "canales/email-desconectar", {}, "Casilla desconectada.")}>Desconectar</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-600">Conectá la casilla donde escriben los socios (por ejemplo <b>administracion@centrocomercialparana.com.ar</b>). La IA lee cada email nuevo, lo clasifica, lo deja en la Bandeja y manda los comprobantes de pago a Tesorería. La contraseña se guarda cifrada.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Servidor IMAP"><Input value={f.host} onChange={(x) => setF({ ...f, host: x.target.value })} /></Field>
              <Field label="Puerto"><Input value={f.puerto} onChange={(x) => setF({ ...f, puerto: x.target.value })} /></Field>
              <Field label="Usuario (email completo)"><Input value={f.usuario} onChange={(x) => setF({ ...f, usuario: x.target.value })} /></Field>
              <Field label="Contraseña"><Input type="password" autoComplete="new-password" value={f.password} onChange={(x) => setF({ ...f, password: x.target.value })} /></Field>
            </div>
            <Button size="sm" loading={cargando === "on"} onClick={() => correr("on", "canales/email-conectar", { ...f, puerto: Number(f.puerto) }, "Casilla conectada: se procesan los emails que lleguen desde ahora.")}>Probar y conectar</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function AjustesIa() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: staff } = useStaffNombres();
  const { data } = useQuery({ queryKey: ["canales", "ajustes"], queryFn: async () => unwrap(await supabase.from("canales_ajustes").select("*").eq("id", 1).single()) as any });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  async function guardar() {
    const { error } = await supabase.from("canales_ajustes").update({
      ia_activa: f.ia_activa, perfil_institucional: f.perfil_institucional, avisos: f.avisos,
      pausa_manual_horas: Number(f.pausa_manual_horas), seguimiento_dias: Number(f.seguimiento_dias), max_seguimientos: Number(f.max_seguimientos),
      campanas_desde: f.campanas_desde, campanas_hasta: f.campanas_hasta, campanas_tope_diario: Number(f.campanas_tope_diario), updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) return toast(traducirError(error.message), "error");
    toast("Ajustes guardados.");
    invalidate("canales");
  }
  const toggle = (area: string, id: string) => {
    const actual: string[] = f.avisos?.[area] || [];
    setF({ ...f, avisos: { ...f.avisos, [area]: actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id] } });
  };
  return (
    <Card title="IA y derivaciones" actions={<Button size="sm" onClick={guardar}>Guardar</Button>}>
      <div className="space-y-4 p-4 text-sm">
        <Checkbox checked={!!f.ia_activa} onChange={(v) => setF({ ...f, ia_activa: v })} label="La IA responde los WhatsApp de socios y contactos (si se apaga, se avisa al área y responde el personal)" />
        <Field label="Lo que la IA puede contar del CeCIP a quien no es socio" hint="Beneficios, cómo asociarse, servicios. Las cuotas, eventos y salones los toma del sistema.">
          <Textarea rows={6} value={f.perfil_institucional} onChange={(x) => setF({ ...f, perfil_institucional: x.target.value })} />
        </Field>
        <div>
          <div className="mb-1 font-medium">A quién avisar por WhatsApp en cada área</div>
          <p className="mb-2 text-xs text-slate-500">Si no elegís a nadie, se avisa a los roles del área. Cada persona tiene que vincular su WhatsApp en <b>Mi WhatsApp</b> (menú lateral).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {AREAS.map(([k, label]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 text-xs font-semibold">{label}</div>
                <div className="flex flex-wrap gap-1">
                  {staff?.filter((s) => s.activo).map((s) => {
                    const on = (f.avisos?.[k] || []).includes(s.user_id);
                    return <button key={s.user_id} onClick={() => toggle(k, s.user_id)} className={`rounded-full px-2 py-0.5 text-xs ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{s.nombre}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Pausa de la IA al responder a mano (horas)"><Input inputMode="numeric" value={f.pausa_manual_horas} onChange={(x) => setF({ ...f, pausa_manual_horas: x.target.value })} /></Field>
          <Field label="Seguimiento a contactos cada (días)"><Input inputMode="numeric" value={f.seguimiento_dias} onChange={(x) => setF({ ...f, seguimiento_dias: x.target.value })} /></Field>
          <Field label="Máximo de seguimientos"><Input inputMode="numeric" value={f.max_seguimientos} onChange={(x) => setF({ ...f, max_seguimientos: x.target.value })} /></Field>
          <Field label="Campañas automáticas desde"><Input type="time" value={String(f.campanas_desde).slice(0, 5)} onChange={(x) => setF({ ...f, campanas_desde: x.target.value })} /></Field>
          <Field label="hasta"><Input type="time" value={String(f.campanas_hasta).slice(0, 5)} onChange={(x) => setF({ ...f, campanas_hasta: x.target.value })} /></Field>
          <Field label="Tope de mensajes de campaña por día"><Input inputMode="numeric" value={f.campanas_tope_diario} onChange={(x) => setF({ ...f, campanas_tope_diario: x.target.value })} /></Field>
        </div>
      </div>
    </Card>
  );
}

/** Mi WhatsApp: cada persona del personal vincula su celular (Copiloto por WhatsApp y avisos de su área) */
export function MiWhatsappModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: e, refetch } = useEstadoCanales();
  const toast = useToast();
  const [codigo, setCodigo] = useState<{ codigo: string; vence: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  async function generar() {
    setCargando(true);
    try { setCodigo(await api("canales/vincular", {})); } catch (err) { toast((err as Error).message, "error"); } finally { setCargando(false); }
  }
  async function quitar(id: string) {
    if (!confirm("¿Desvincular este número?")) return;
    try { await api("canales/desvincular", { id }); refetch(); } catch (err) { toast((err as Error).message, "error"); }
  }
  const numeroCecip = e?.whatsapp?.numero;
  return (
    <Modal open={open} onClose={onClose} title="Mi WhatsApp">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">Vinculá tu celular para consultar el <b>Copiloto CeCIP</b> por WhatsApp (solo con los datos de tu rol) y recibir los avisos de las consultas que te deriven.</p>
        {e?.mi_whatsapp?.length ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {e.mi_whatsapp.map((n) => (
              <li key={n.id} className="flex items-center gap-2 px-3 py-2">
                <Smartphone className="h-4 w-4 text-slate-400" /> +{n.telefono}
                {n.recibe_avisos && <Badge tone="green">recibe avisos</Badge>}
                <button onClick={() => quitar(n.id)} className="ml-auto text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-500">Todavía no vinculaste ningún número.</p>}
        {codigo ? (
          <div className="rounded-lg bg-brand-50 p-3">
            <div>Desde tu celular, mandá este mensaje al WhatsApp del CeCIP{numeroCecip ? <> (<b>+{numeroCecip}</b>)</> : ""}:</div>
            <div className="mt-2 select-all rounded-md bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-widest">VINCULAR {codigo.codigo}</div>
            <div className="mt-1 text-xs text-slate-500">Vence {fechaHora(codigo.vence)}. Sirve una sola vez.</div>
          </div>
        ) : (
          <Button loading={cargando} onClick={generar} disabled={!e?.whatsapp?.configurado}>Generar código de vinculación</Button>
        )}
        {!e?.whatsapp?.configurado && <p className="text-xs text-amber-700">El WhatsApp del CeCIP todavía no está conectado.</p>}
      </div>
    </Modal>
  );
}
