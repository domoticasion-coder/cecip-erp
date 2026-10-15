import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, CheckCircle2, Clock, Copy, MessageCircle, Pause, Play, Plus, RefreshCw, Save, SkipForward, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fechaHora, hoyISO, nombreSocio, pesos } from "../../lib/format";
import { normalizarWhatsapp } from "../../lib/whatsapp";
import {
  armarMensaje, linkWhatsapp, mezclar, nombreParaSaludo, usaLinkPago, type OpcionesVariacion,
} from "../../lib/variaciones";
import type { WaCampana, WaMensaje } from "../../lib/types";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Select, Textarea, cx, useToast } from "../../components/ui";
import { ImagenInput } from "../../components/ImagenInput";
import { copiarImagen } from "../../lib/imagenes";
import { useCategorias, useConfig, useInvalidate } from "../data";
import { useSociosResumen } from "../pages/Socios";

/*
 * Difusión por WhatsApp sin la API paga de Meta: el sistema arma un mensaje distinto para cada socio,
 * abre el chat con el texto listo y el administrativo solo toca "Enviar". Entre un envío y otro hay
 * una espera al azar y un tope diario, para que WhatsApp no lo tome como spam.
 */

const PROXIMO_KEY = "cecip-wa-proximo-envio";
const MODO_KEY = "cecip-wa-modo";
const LINK_IMAGEN_KEY = "cecip-wa-link-imagen";

type Vista = { tipo: "lista" } | { tipo: "nueva"; segmento?: string } | { tipo: "enviar"; id: string };

type Origen = "cecip" | "comercia";

export function WhatsappCampanas({ segmentoInicial, origen = "cecip" }: { segmentoInicial?: string; origen?: Origen }) {
  const [vista, setVista] = useState<Vista>(segmentoInicial ? { tipo: "nueva", segmento: segmentoInicial } : { tipo: "lista" });
  if (vista.tipo === "nueva") return <NuevaCampana origen={origen} segmentoInicial={vista.segmento} onVolver={() => setVista({ tipo: "lista" })} onCreada={(id) => setVista({ tipo: "enviar", id })} />;
  if (vista.tipo === "enviar") return <EnviarCampana id={vista.id} onVolver={() => setVista({ tipo: "lista" })} />;
  return <ListaCampanas origen={origen} onNueva={() => setVista({ tipo: "nueva" })} onAbrir={(id) => setVista({ tipo: "enviar", id })} />;
}

/** Cantidad de WhatsApp enviados hoy (todas las campañas) */
function useEnviadosHoy(origen: Origen) {
  return useQuery({
    queryKey: ["wa", "hoy", origen],
    queryFn: async () => {
      const desde = new Date(hoyISO() + "T00:00:00").toISOString();
      const r = await supabase.from("wa_mensajes").select("id", { count: "exact", head: true }).eq("estado", "enviado").eq("origen", origen).gte("enviado_at", desde);
      return r.count || 0;
    },
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Lista de campañas
// ---------------------------------------------------------------------------

type CampanaConConteo = WaCampana & { enviados: number; omitidos: number };

function ListaCampanas({ origen, onNueva, onAbrir }: { origen: Origen; onNueva: () => void; onAbrir: (id: string) => void }) {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const { data: hoy } = useEnviadosHoy(origen);
  const toast = useToast();
  const invalidate = useInvalidate();

  const { data, isLoading } = useQuery({
    queryKey: ["wa", "campanas", origen],
    queryFn: async () => {
      const camps = unwrap(await supabase.from("wa_campanas").select("*").eq("origen", origen).order("created_at", { ascending: false }).limit(50)) as WaCampana[];
      const conteos = await Promise.all(camps.map(async (c) => {
        const [e, o] = await Promise.all([
          supabase.from("wa_mensajes").select("id", { count: "exact", head: true }).eq("campana_id", c.id).eq("estado", "enviado"),
          supabase.from("wa_mensajes").select("id", { count: "exact", head: true }).eq("campana_id", c.id).eq("estado", "omitido"),
        ]);
        return { ...c, enviados: e.count || 0, omitidos: o.count || 0 };
      }));
      return conteos as CampanaConConteo[];
    },
  });

  async function borrar(c: WaCampana) {
    if (!confirm(`¿Eliminar la campaña "${c.nombre}"? Se borra también su registro de mensajes.`)) return;
    const { error } = await supabase.from("wa_campanas").delete().eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("wa");
  }

  const puede = origen === "comercia" ? can("comercia") : can("atencion", "tesoreria");

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Campañas de WhatsApp"
        actions={puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={onNueva}>Nueva campaña</Button>}>
        {isLoading ? <Loading /> : !data?.length ? (
          <Empty icon={<MessageCircle className="h-10 w-10" />}>
            Todavía no hay campañas. Creá una para enviar un comunicado, un recordatorio de cuota o una invitación por WhatsApp.
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((c) => {
              const hechos = c.enviados + c.omitidos;
              const pct = c.total ? Math.round((hechos / c.total) * 100) : 0;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{c.nombre}</span>
                      <Badge tone={c.estado === "finalizada" ? "green" : c.estado === "pausada" ? "amber" : "blue"}>{c.estado}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      {c.enviados} enviados{c.omitidos ? ` · ${c.omitidos} omitidos` : ""} de {c.total} · {fechaHora(c.created_at)}
                    </div>
                  </div>
                  <Button size="sm" variant={c.estado === "finalizada" ? "secondary" : "success"}
                    icon={c.estado === "finalizada" ? undefined : <Play className="h-3.5 w-3.5" />} onClick={() => onAbrir(c.id)}>
                    {c.estado === "finalizada" ? "Ver" : "Continuar"}
                  </Button>
                  {puede && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => borrar(c)} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="space-y-5">
        <Card title="Hoy">
          <div className="p-4">
            <div className="text-3xl font-bold tabular-nums text-slate-900">{hoy ?? 0}<span className="text-base font-medium text-slate-400"> / {cfg?.wa_limite_diario ?? "—"}</span></div>
            <div className="text-sm text-slate-500">mensajes de WhatsApp enviados (tope diario)</div>
          </div>
        </Card>
        <AjustesEnvio />
        <Card title="Para que WhatsApp no lo tome como spam">
          <ul className="space-y-1.5 p-4 text-sm text-slate-600">
            <li>• Enviá solo a socios: personas que conocen al CeCIP y esperan sus avisos.</li>
            <li>• Pediles que agenden el número del CeCIP: los mensajes de contactos agendados casi nunca se marcan.</li>
            <li>• Respetá la espera entre envíos y el tope diario. Si el número es nuevo, empezá con 20 a 30 por día.</li>
            <li>• Usá varias variantes del mensaje (la IA las arma) y activá saludo y despedida variados.</li>
            <li>• Dejá activada la opción de BAJA y, si alguien la pide, marcalo con el botón "BAJA".</li>
            <li>• Enviá en horario laboral, de lunes a viernes.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AjustesEnvio() {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ limite: "", min: "", max: "" });

  useEffect(() => {
    if (cfg) setF({ limite: String(cfg.wa_limite_diario), min: String(cfg.wa_espera_min), max: String(cfg.wa_espera_max) });
  }, [cfg]);

  if (!cfg) return null;
  const esAdmin = can();

  async function guardar() {
    const limite = Number(f.limite), min = Number(f.min), max = Number(f.max);
    if (!(limite >= 1 && limite <= 500)) return toast("El tope diario debe estar entre 1 y 500.", "error");
    if (!(min >= 0 && max >= min)) return toast("La espera máxima debe ser mayor o igual a la mínima.", "error");
    const { error } = await supabase.from("configuracion").update({ wa_limite_diario: limite, wa_espera_min: min, wa_espera_max: max }).eq("id", 1);
    if (error) return toast(traducirError(error.message), "error");
    toast("Ajustes de envío guardados.");
    invalidate("configuracion");
  }

  return (
    <Card title="Ajustes de envío" actions={esAdmin && <Button size="sm" variant="secondary" icon={<Save className="h-3.5 w-3.5" />} onClick={guardar}>Guardar</Button>}>
      <div className="grid grid-cols-3 gap-2 p-4">
        <Field label="Tope diario"><Input type="number" disabled={!esAdmin} value={f.limite} onChange={(e) => setF({ ...f, limite: e.target.value })} /></Field>
        <Field label="Espera mín. (seg)"><Input type="number" disabled={!esAdmin} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label="Espera máx. (seg)"><Input type="number" disabled={!esAdmin} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        {!esAdmin && <p className="col-span-3 text-xs text-slate-500">Solo un administrador puede cambiarlos.</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Nueva campaña
// ---------------------------------------------------------------------------

const EJEMPLO = "Te recordamos que el {jueves|próximo jueves} a las 19 hs tenemos la charla \"Ventas por redes sociales\" en la sede del CeCIP. Es sin costo para socios. ¿Te anotamos?";

/** Destinatario de una campaña (mismo formato para las del CeCIP y las de ComercIA) */
type Dest = { id: string; empresa: string; contacto_nombre: string | null; telefono: string; deuda: number };

const EJEMPLO_COMERCIA = "Te contamos que por el convenio CeCIP + Instituto IEC tu comercio puede tener su {web|tienda online} con FactorIA en condiciones preferenciales. {¿Querés que te asesoremos?|¿Te interesa que te contemos más?}";

function NuevaCampana({ origen, segmentoInicial, onVolver, onCreada }: {
  origen: Origen; segmentoInicial?: string; onVolver: () => void; onCreada: (id: string) => void;
}) {
  const esCia = origen === "comercia";
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios, isLoading } = useSociosResumen(); // personal del CeCIP
  const { data: categorias } = useCategorias();

  const [nombre, setNombre] = useState(segmentoInicial === "vencidas" ? "Recordatorio de cuotas vencidas" : "");
  const [segmento, setSegmento] = useState(segmentoInicial || "activos");
  const [imagen, setImagen] = useState<string | null>(null);
  const [categoria, setCategoria] = useState("");
  const [rubro, setRubro] = useState("");

  // ComercIA no accede al padrón: recibe solo nombre y teléfono de los destinatarios
  const { data: destCia, isLoading: cargandoCia } = useQuery({
    queryKey: ["wa", "dest-comercia", rubro.trim(), categoria],
    enabled: esCia,
    queryFn: async () => unwrap(await supabase.rpc("destinatarios_comercia", { p_rubro: rubro.trim() || null, p_categoria: categoria || null })) as
      { socio_id: string; nombre: string; contacto_nombre: string | null; telefono: string }[],
  });
  const [base, setBase] = useState(segmentoInicial === "vencidas"
    ? "Te escribimos de la administración del CeCIP: {tenés|figura} un saldo pendiente de {{deuda}} en tu cuenta de socio. Podés pagarlo online desde este link: {{link_pago}}\n{Si ya lo abonaste, desestimá este mensaje|Si ya pagaste, no tengas en cuenta este aviso}."
    : "");
  const [variantes, setVariantes] = useState<string[]>([]);
  const [op, setOp] = useState<OpcionesVariacion>({ saludo: true, cierre: true, baja: true, remitente: origen });
  const [generando, setGenerando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [semilla, setSemilla] = useState(0);

  const destinatarios: Dest[] = useMemo(() => {
    if (esCia) {
      return (destCia || [])
        .map((d) => ({ id: d.socio_id, empresa: d.nombre, contacto_nombre: d.contacto_nombre, telefono: normalizarWhatsapp(d.telefono) || "", deuda: 0 }))
        .filter((d) => d.telefono);
    }
    return (socios || []).filter((s) => {
      if (s.whatsapp_baja || !normalizarWhatsapp(s.whatsapp || s.telefono)) return false;
      if (segmento !== "todos" && s.estado !== "activo") return false;
      if (segmento === "con-deuda" && !(s.deuda > 0)) return false;
      if (segmento === "vencidas" && !(s.cuotas_vencidas > 0)) return false;
      if (segmento === "al-dia" && s.deuda > 0) return false;
      if (categoria && s.categoria_id !== categoria) return false;
      return true;
    }).map((s) => ({ id: s.id, empresa: nombreSocio(s), contacto_nombre: s.contacto_nombre, telefono: normalizarWhatsapp(s.whatsapp || s.telefono)!, deuda: s.deuda }));
  }, [esCia, destCia, socios, segmento, categoria]);

  const excluidos = useMemo(() => esCia ? 0 : (socios || []).filter((s) => s.estado === "activo" && (s.whatsapp_baja || !normalizarWhatsapp(s.whatsapp || s.telefono))).length, [socios, esCia]);

  const plantillas = [base, ...variantes].map((t) => t.trim()).filter(Boolean);
  const conLink = plantillas.some(usaLinkPago);

  const ejemplos = useMemo(() => {
    if (!plantillas.length || !destinatarios.length) return [];
    return mezclar(destinatarios).slice(0, 3).map((s) => ({
      socio: s.empresa,
      texto: armarMensaje(plantillas, datosDe(s), op).replace(/\{\{\s*link_pago\s*\}\}/gi, "https://mpago.la/…"),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, variantes, op, destinatarios, semilla]);

  async function generarVariantes() {
    if (!base.trim()) return setError("Escribí primero el mensaje base.");
    setError(null);
    setGenerando(true);
    try {
      const r = await api<{ variantes: string[] }>("comunicaciones/variantes", { mensaje: base, cantidad: 6 });
      setVariantes((v) => [...v, ...r.variantes]);
      toast(`La IA generó ${r.variantes.length} variantes. Revisalas y borrá las que no te gusten.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  async function crear() {
    if (!nombre.trim()) return setError("Poné un nombre a la campaña (solo lo ve el personal).");
    if (!plantillas.length) return setError("Escribí el mensaje.");
    if (!destinatarios.length) return setError("No hay destinatarios con WhatsApp válido para ese filtro.");
    if (!confirm(`¿Crear la campaña para ${destinatarios.length} socios? Cada uno va a recibir un mensaje distinto.`)) return;
    setCreando(true);
    setError(null);
    const { data: camp, error: e1 } = await supabase.from("wa_campanas")
      .insert({ nombre: nombre.trim(), mensaje_base: base.trim(), variantes: variantes.map((v) => v.trim()).filter(Boolean), total: destinatarios.length, created_by: staff?.user_id, origen, imagen_url: imagen })
      .select("id").single();
    if (e1 || !camp) {
      setCreando(false);
      return setError(traducirError(e1?.message || "No se pudo crear la campaña."));
    }
    const filas = mezclar(destinatarios).map((s, i) => {
      const texto = armarMensaje(plantillas, datosDe(s), op);
      return {
        campana_id: camp.id, socio_id: s.id, nombre: s.empresa, telefono: s.telefono,
        mensaje: texto, usa_link_pago: !esCia && usaLinkPago(texto), orden: i + 1, origen,
      };
    });
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await supabase.from("wa_mensajes").insert(filas.slice(i, i + 200));
      if (error) {
        setCreando(false);
        return setError(traducirError(error.message));
      }
    }
    setCreando(false);
    invalidate("wa");
    toast(`Campaña creada: ${filas.length} mensajes personalizados listos para enviar.`);
    onCreada(camp.id);
  }

  if (esCia ? false : isLoading) return <Loading />;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onVolver}>Campañas</Button>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card title="1. Campaña y destinatarios">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Nombre de la campaña (interno)" className="sm:col-span-2">
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={esCia ? "Ej.: Promo desarrollo web FactorIA" : "Ej.: Invitación charla redes sociales"} />
              </Field>
              {esCia ? (
                <Field label="Rubro (opcional)" hint={cargandoCia ? "Buscando socios…" : "Ej.: gastronomía, indumentaria, ferretería."}>
                  <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Todos los rubros" />
                </Field>
              ) : (
              <Field label="Socios">
                <Select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
                  <option value="activos">Todos los activos</option>
                  <option value="al-dia">Activos al día</option>
                  <option value="con-deuda">Activos con deuda</option>
                  <option value="vencidas">Activos con cuotas vencidas</option>
                  <option value="todos">Todos (incluye suspendidos y bajas)</option>
                </Select>
              </Field>
              )}
              <Field label="Categoría">
                <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                  <option value="">Todas</option>
                  {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </Select>
              </Field>
              <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2">
                <b>{destinatarios.length}</b> socios {esCia ? "activos " : ""}van a recibir el mensaje.
                <span className="text-xs text-slate-500">
                  {esCia
                    ? " Se excluyen automáticamente los socios sin WhatsApp válido o que pidieron BAJA."
                    : ` Se excluyen automáticamente ${excluidos} socios activos sin WhatsApp válido o que pidieron BAJA.`}
                </span>
              </div>
            </div>
          </Card>

          <Card title="2. Mensaje">
            <div className="space-y-3 p-4">
              <Field label="Mensaje base" hint={<>
                Variables: <code>{"{{nombre}}"}</code>, <code>{"{{empresa}}"}</code>
                {!esCia && <>, <code>{"{{deuda}}"}</code>, <code>{"{{link_pago}}"}</code> (link de Mercado Pago propio de cada socio)</>}.
                {" "}Alternativas: <code>{"{opción 1|opción 2}"}</code> elige una al azar en cada mensaje.
              </>}>
                <Textarea rows={6} value={base} onChange={(e) => setBase(e.target.value)} placeholder={esCia ? EJEMPLO_COMERCIA : EJEMPLO} />
              </Field>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox checked={op.saludo} onChange={(v) => setOp({ ...op, saludo: v })} label="Saludo variado con el nombre" />
                <Checkbox checked={op.cierre} onChange={(v) => setOp({ ...op, cierre: v })} label="Despedida variada" />
                <Checkbox checked={op.baja} onChange={(v) => setOp({ ...op, baja: v })} label="Opción de BAJA (recomendado)" />
              </div>
              <ImagenInput value={imagen} onChange={setImagen} carpeta="whatsapp" label="Imagen o flyer (opcional)"
                hint="Al enviar cada mensaje vas a poder copiar la imagen y pegarla en el chat (Ctrl+V), o mandar su link." />
            </div>
          </Card>

          <Card title="3. Variantes del mensaje"
            actions={<Button size="sm" variant="secondary" loading={generando} icon={<Wand2 className="h-3.5 w-3.5" />} onClick={generarVariantes}>Generar con IA</Button>}>
            <div className="space-y-2 p-4">
              <p className="text-sm text-slate-500">Cuantas más variantes, más distintos salen los mensajes. Cada socio recibe una al azar, con su saludo y despedida.</p>
              {variantes.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea rows={3} value={v} onChange={(e) => setVariantes(variantes.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button onClick={() => setVariantes(variantes.filter((_, j) => j !== i))} title="Quitar" className="self-start rounded p-2 text-slate-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setVariantes([...variantes, ""])}>Agregar variante a mano</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Vista previa (3 socios al azar)"
            actions={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setSemilla(semilla + 1)}>Otros</Button>}>
            <div className="space-y-3 bg-[#efeae2] p-4">
              {!ejemplos.length && <p className="text-sm text-slate-500">Escribí el mensaje para ver cómo le llega a cada socio.</p>}
              {ejemplos.map((e, i) => (
                <div key={i}>
                  <div className="mb-1 text-[11px] font-medium text-slate-500">Para: {e.socio}</div>
                  {imagen && <img src={imagen} alt="" className="mb-1 max-h-40 rounded-lg rounded-tr-none bg-[#d9fdd3] p-1 shadow-sm" />}
                  <div className="whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-sm">{e.texto}</div>
                </div>
              ))}
            </div>
          </Card>
          {conLink && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              El link de pago de cada socio se genera en el momento de enviarle el mensaje (Mercado Pago).
            </div>
          )}
          <ErrorBox error={error} />
          <Button className="w-full py-2.5" loading={creando} icon={<Sparkles className="h-4 w-4" />} onClick={crear}>
            Crear campaña ({destinatarios.length} mensajes distintos)
          </Button>
        </div>
      </div>
    </div>
  );
}

function datosDe(s: Dest) {
  return { nombre: nombreParaSaludo(s.contacto_nombre, s.empresa), empresa: s.empresa, deuda: pesos(s.deuda) };
}

// ---------------------------------------------------------------------------
// Envío de una campaña
// ---------------------------------------------------------------------------

function pitido() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch { /* sin audio */ }
}

function EnviarCampana({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { staff } = useAuth();
  const { data: cfg } = useConfig();
  const [origenCampana, setOrigenCampana] = useState<Origen>("cecip");
  const { data: hoy, refetch: refetchHoy } = useEnviadosHoy(origenCampana);
  const toast = useToast();
  const invalidate = useInvalidate();
  const [modo, setModo] = useState<"web" | "app">(() => {
    try { return (localStorage.getItem(MODO_KEY) as "web" | "app") || (window.innerWidth < 768 ? "app" : "web"); } catch { return "web"; }
  });
  const [proximo, setProximo] = useState<number>(() => {
    try { return Number(localStorage.getItem(PROXIMO_KEY) || 0); } catch { return 0; }
  });
  const [ahora, setAhora] = useState(Date.now());
  const [texto, setTexto] = useState("");
  const [abriendo, setAbriendo] = useState(false);
  const [conLinkImagen, setConLinkImagen] = useState(() => {
    try { return localStorage.getItem(LINK_IMAGEN_KEY) === "1"; } catch { return false; }
  });
  const avisado = useRef(false);

  const { data, refetch } = useQuery({
    queryKey: ["wa", "campana", id],
    queryFn: async () => {
      const [c, m] = await Promise.all([
        supabase.from("wa_campanas").select("*").eq("id", id).single(),
        supabase.from("wa_mensajes").select("*").eq("campana_id", id).order("orden"),
      ]);
      return { campana: unwrap(c) as WaCampana, mensajes: unwrap(m) as WaMensaje[] };
    },
  });

  useEffect(() => {
    if (data?.campana.origen) setOrigenCampana(data.campana.origen);
  }, [data?.campana.origen]);

  const pendientes = (data?.mensajes || []).filter((m) => m.estado === "pendiente");
  const actual = pendientes[0];
  const enviados = (data?.mensajes || []).filter((m) => m.estado === "enviado").length;
  const omitidos = (data?.mensajes || []).filter((m) => m.estado === "omitido").length;
  const limite = cfg?.wa_limite_diario ?? 40;
  const topeAlcanzado = (hoy ?? 0) >= limite;
  const restante = Math.max(0, Math.ceil((proximo - ahora) / 1000));
  const pausada = data?.campana.estado === "pausada";

  useEffect(() => {
    setTexto(actual?.mensaje || "");
  }, [actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuenta regresiva + aviso sonoro cuando se puede enviar el próximo
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (restante > 0) {
      avisado.current = false;
      document.title = `⏳ ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, "0")} · WhatsApp`;
    } else if (!avisado.current && actual && proximo > 0) {
      avisado.current = true;
      document.title = "✅ Listo para enviar · ERP CeCIP";
      pitido();
    }
  }, [restante, actual, proximo]);
  useEffect(() => () => { document.title = "ERP · CeCIP Paraná"; }, []);

  async function enviar() {
    if (!actual || !cfg) return;
    // La ventana se abre en el mismo clic (si no, el navegador la bloquea) y se reutiliza para todos los chats
    const ventana = window.open("about:blank", "cecip-whatsapp");
    setAbriendo(true);
    try {
      let mensaje = texto;
      if (actual.usa_link_pago || usaLinkPago(mensaje)) {
        let link = "";
        if (actual.socio_id) {
          try { link = (await api<{ url: string }>("pagos/link", { socio_id: actual.socio_id })).url; } catch { /* sin deuda o MP no disponible */ }
        }
        mensaje = mensaje.replace(/\{\{\s*link_pago\s*\}\}/gi, link || "el Portal de Socios (sección Mis cuotas)");
      }
      const imagenUrl = data?.campana.imagen_url;
      if (imagenUrl && conLinkImagen && !mensaje.includes(imagenUrl)) mensaje = `${mensaje}\n\n${imagenUrl}`;
      const url = linkWhatsapp(actual.telefono, mensaje, modo);
      if (ventana) ventana.location.href = url;
      else window.location.href = url;

      await supabase.from("wa_mensajes").update({ estado: "enviado", mensaje, enviado_at: new Date().toISOString(), enviado_por: staff?.user_id }).eq("id", actual.id);
      await supabase.from("envios").insert({
        socio_id: actual.socio_id, canal: "whatsapp", tipo: origenCampana === "comercia" ? "comercia" : "comunicado", asunto: data?.campana.nombre, destinatario: actual.telefono, created_by: staff?.user_id,
      });
      // Espera al azar antes del próximo
      const min = Math.max(0, cfg.wa_espera_min), max = Math.max(min, cfg.wa_espera_max);
      const espera = (min + Math.random() * (max - min)) * 1000;
      const prox = Date.now() + espera;
      setProximo(prox);
      try { localStorage.setItem(PROXIMO_KEY, String(prox)); } catch { /* sin storage */ }
      if (pendientes.length === 1) {
        await supabase.from("wa_campanas").update({ estado: "finalizada" }).eq("id", id);
        toast("¡Campaña terminada!");
      }
      await Promise.all([refetch(), refetchHoy()]);
      invalidate("envios");
    } finally {
      setAbriendo(false);
    }
  }

  async function omitir(baja = false) {
    if (!actual) return;
    if (baja && actual.socio_id) {
      if (!confirm(`¿Marcar a ${actual.nombre} como BAJA de difusiones por WhatsApp? No va a recibir más campañas.`)) return;
      await supabase.rpc("marcar_baja_whatsapp", { p_socio: actual.socio_id });
      invalidate("socios");
    }
    await supabase.from("wa_mensajes").update({ estado: "omitido" }).eq("id", actual.id);
    if (pendientes.length === 1) await supabase.from("wa_campanas").update({ estado: "finalizada" }).eq("id", id);
    refetch();
  }

  async function guardarTexto() {
    if (!actual) return;
    await supabase.from("wa_mensajes").update({ mensaje: texto }).eq("id", actual.id);
    toast("Mensaje actualizado.");
    refetch();
  }

  async function pausar(p: boolean) {
    await supabase.from("wa_campanas").update({ estado: p ? "pausada" : "activa" }).eq("id", id);
    refetch();
    invalidate("wa");
  }

  if (!data || !cfg) return <Loading />;
  const total = data.mensajes.length;
  const pct = total ? Math.round(((enviados + omitidos) / total) * 100) : 0;
  const bloqueado = restante > 0 || topeAlcanzado || pausada || abriendo;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onVolver}>Campañas</Button>

      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-slate-900">{data.campana.nombre}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs text-slate-500">{enviados} enviados · {omitidos} omitidos · {pendientes.length} pendientes de {total}</div>
          </div>
          <div className="text-right text-sm">
            <div className={cx("font-semibold", topeAlcanzado ? "text-red-600" : "text-slate-700")}>Hoy: {hoy ?? 0} / {limite}</div>
            <div className="text-xs text-slate-500">Espera entre envíos: {cfg.wa_espera_min}–{cfg.wa_espera_max} seg</div>
          </div>
          {data.campana.estado !== "finalizada" && (
            <Button variant="secondary" size="sm" icon={pausada ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => pausar(!pausada)}>
              {pausada ? "Reanudar" : "Pausar"}
            </Button>
          )}
        </div>
      </Card>

      {!actual ? (
        <Card>
          <Empty icon={<CheckCircle2 className="h-10 w-10 text-emerald-400" />}>Campaña terminada: no quedan mensajes pendientes.</Empty>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          <Card className="lg:col-span-3" title={<>Próximo: <span className="font-normal">{actual.nombre}</span> <span className="text-xs font-normal text-slate-400">· +{actual.telefono}</span></>}>
            <div className="space-y-3 p-4">
              <Textarea rows={9} value={texto} onChange={(e) => setTexto(e.target.value)} />
              {texto !== actual.mensaje && (
                <Button size="sm" variant="secondary" icon={<Save className="h-3.5 w-3.5" />} onClick={guardarTexto}>Guardar cambios del mensaje</Button>
              )}
              {usaLinkPago(texto) && <p className="text-xs text-blue-700">El link de pago de este socio se genera al tocar "Abrir WhatsApp".</p>}
              {data.campana.imagen_url && (
                <div className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <img src={data.campana.imagen_url} alt="" className="h-24 rounded object-cover" />
                  <div className="min-w-48 flex-1 space-y-2 text-xs text-slate-600">
                    <p>WhatsApp no permite adjuntar imágenes desde un link: <b>copiala</b> y pegala en el chat con <b>Ctrl+V</b> antes de enviar (en el celular, mandá el link).</p>
                    <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />}
                      onClick={() => copiarImagen(data.campana.imagen_url!).then(() => toast("Imagen copiada: pegala en el chat con Ctrl+V.")).catch(() => toast("Tu navegador no permitió copiar la imagen. Usá la opción del link.", "error"))}>
                      Copiar imagen
                    </Button>
                    <Checkbox checked={conLinkImagen} onChange={(v) => { setConLinkImagen(v); try { localStorage.setItem(LINK_IMAGEN_KEY, v ? "1" : "0"); } catch { /* */ } }}
                      label="Agregar el link de la imagen al final del mensaje" />
                  </div>
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-4 lg:col-span-2">
            <Card>
              <div className="space-y-3 p-4 text-center">
                {pausada ? (
                  <p className="text-sm text-amber-700">Campaña en pausa.</p>
                ) : topeAlcanzado ? (
                  <p className="text-sm text-red-700">Llegaste al tope de {limite} mensajes de hoy. Seguí mañana: la campaña queda guardada donde la dejaste.</p>
                ) : restante > 0 ? (
                  <div>
                    <Clock className="mx-auto mb-1 h-6 w-6 text-slate-400" />
                    <div className="text-3xl font-bold tabular-nums text-slate-900">{Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")}</div>
                    <p className="text-xs text-slate-500">Esperá antes del próximo envío (así WhatsApp no lo toma como spam). Va a sonar un aviso.</p>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-emerald-700">Listo para enviar.</p>
                )}
                <Button variant="success" className="w-full py-3 text-base" disabled={bloqueado} loading={abriendo}
                  icon={<MessageCircle className="h-5 w-5" />} onClick={enviar}>
                  Abrir WhatsApp de {actual.nombre.split(" ")[0]}
                </Button>
                <p className="text-xs text-slate-500">Se abre el chat con el mensaje escrito: tocá <b>Enviar</b> en WhatsApp y volvé acá.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" icon={<SkipForward className="h-3.5 w-3.5" />} onClick={() => omitir(false)}>Omitir</Button>
                  <Button variant="secondary" size="sm" className="flex-1" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => omitir(true)}>BAJA</Button>
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <Field label="Abrir en">
                  <Select value={modo} onChange={(e) => { const m = e.target.value as "web" | "app"; setModo(m); try { localStorage.setItem(MODO_KEY, m); } catch { /* */ } }}>
                    <option value="web">WhatsApp Web (usa siempre la misma pestaña)</option>
                    <option value="app">App de WhatsApp (celular o WhatsApp de escritorio)</option>
                  </Select>
                </Field>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
