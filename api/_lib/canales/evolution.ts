/**
 * Cliente de Evolution API (v2): envío de textos y archivos, estado de la instancia,
 * configuración del webhook y lectura de los mensajes que llegan.
 * Misma base que el ERP del IEC (C:\Users\Agus\IEC-ERP\server\lib\evolution.ts).
 *
 *  EVOLUTION_API_URL   ej. http://149.50.147.172:3900
 *  EVOLUTION_API_KEY   token de la instancia
 *  EVOLUTION_INSTANCE  nombre de la instancia (CECIP)
 */

export function evolutionConfig() {
  const url = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY || "";
  const instance = process.env.EVOLUTION_INSTANCE || "";
  return { url, key, instance, configurado: Boolean(url && key && instance) };
}

async function evo<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, key, configurado } = evolutionConfig();
  if (!configurado) throw new Error("WhatsApp no está configurado (faltan EVOLUTION_API_URL, EVOLUTION_API_KEY o EVOLUTION_INSTANCE).");
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.response?.message ?? data?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(`Evolution API: ${Array.isArray(msg) ? msg.join(" ") : typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data as T;
}

/**
 * Número en el formato de WhatsApp: solo dígitos, con código de país. Los celulares argentinos
 * llevan un 9 después del 54 (54 9 343 …); si falta, se agrega. Un número local de Paraná sin
 * código de país (343 15 …) se completa como +54 9 343.
 */
export function normalizarNumero(raw: unknown): string {
  let d = String(raw ?? "").replace(/@.*$/, "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.slice(1);
  // 343 15 4123456 -> 343 4123456 (el 15 de los celulares locales)
  if (!d.startsWith("54") && d.length === 12 && d.slice(3, 5) === "15") d = d.slice(0, 3) + d.slice(5);
  if (!d.startsWith("54") && d.length === 10) d = `549${d}`;
  if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) d = `549${d.slice(2)}`;
  return d;
}

/** Variantes con y sin el 9 de celular argentino, para buscar un número guardado de cualquier forma. */
export function variantesNumero(raw: unknown): string[] {
  const n = normalizarNumero(raw);
  const out = new Set([n]);
  if (n.startsWith("549")) out.add(`54${n.slice(3)}`);
  return [...out].filter(Boolean);
}

export async function enviarTexto(numero: string, texto: string): Promise<{ id: string | null }> {
  const { instance } = evolutionConfig();
  const r = await evo<any>("POST", `/message/sendText/${encodeURIComponent(instance)}`, { number: normalizarNumero(numero), text: texto });
  return { id: r?.key?.id ?? null };
}

/** Envía un archivo (PDF, imagen) con un texto opcional. */
export async function enviarArchivo(numero: string, archivo: { base64: string; nombre: string; mime: string }, texto = ""): Promise<{ id: string | null }> {
  const { instance } = evolutionConfig();
  const r = await evo<any>("POST", `/message/sendMedia/${encodeURIComponent(instance)}`, {
    number: normalizarNumero(numero),
    mediatype: archivo.mime.startsWith("image/") ? "image" : archivo.mime.startsWith("video/") ? "video" : "document",
    mimetype: archivo.mime, media: archivo.base64, fileName: archivo.nombre, caption: texto,
  });
  return { id: r?.key?.id ?? null };
}

/** Descarga el archivo de un mensaje recibido (el webhook llega sin el contenido). */
export async function descargarMedia(crudo: unknown): Promise<{ base64: string; mime: string; nombre: string }> {
  const { instance } = evolutionConfig();
  const r = await evo<any>("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, { message: crudo, convertToMp4: false });
  if (!r?.base64) throw new Error("Evolution no devolvió el archivo.");
  return { base64: String(r.base64).replace(/^data:[^,]+,/, ""), mime: String(r.mimetype || "application/octet-stream").split(";")[0], nombre: String(r.fileName || "") };
}

export async function estadoInstancia(): Promise<{ estado: string; numero: string | null }> {
  const { instance } = evolutionConfig();
  const r = await evo<any>("GET", `/instance/connectionState/${encodeURIComponent(instance)}`);
  const estado = r?.instance?.state ?? r?.state ?? "desconocido";
  let numero: string | null = null;
  try {
    const lista = await evo<any[]>("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    const owner = lista?.[0]?.ownerJid ?? lista?.[0]?.instance?.owner;
    numero = owner ? normalizarNumero(owner) : null;
  } catch {
    // con el token de la instancia (no el global) a veces no se puede listar: el número queda sin mostrar
  }
  return { estado, numero };
}

/** QR para vincular el celular (si la instancia todavía no está conectada). */
export async function qrInstancia(): Promise<{ base64: string | null; codigo: string | null }> {
  const { instance } = evolutionConfig();
  const r = await evo<any>("GET", `/instance/connect/${encodeURIComponent(instance)}`);
  return { base64: r?.base64 ?? null, codigo: r?.pairingCode ?? r?.code ?? null };
}

/** Le indica a Evolution a qué URL mandar los mensajes que recibe el número. */
export async function configurarWebhook(webhookUrl: string) {
  const { instance } = evolutionConfig();
  return evo<any>("POST", `/webhook/set/${encodeURIComponent(instance)}`, {
    webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT"] },
  });
}

export type TipoMedia = "imagen" | "documento" | "audio" | "video";

export interface MensajeEntrante {
  id: string;
  numero: string;
  texto: string;
  nombre: string;
  /** Archivo adjunto (el contenido se baja aparte con descargarMedia). */
  media?: { tipo: TipoMedia; mime: string; nombre: string; segundos?: number; crudo: unknown };
}

function leerMensaje(data: any): { texto: string; media?: MensajeEntrante["media"] } {
  const m = data?.message || {};
  const texto = String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption ?? m.documentWithCaptionMessage?.message?.documentMessage?.caption ?? "").trim();
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  const fuente: [TipoMedia, any][] = [["imagen", m.imageMessage], ["documento", doc], ["audio", m.audioMessage], ["video", m.videoMessage]];
  const [tipo, info] = fuente.find(([, v]) => v) || [];
  const media = tipo
    ? { tipo, mime: String(info.mimetype || "").split(";")[0], nombre: String(info.fileName || info.title || ""), segundos: Number(info.seconds) || undefined, crudo: { key: data.key, message: data.message } }
    : undefined;
  return { texto: texto.slice(0, 4000), media };
}

function jidDe(data: any): string {
  const key = data?.key || {};
  let jid: string = key.remoteJid || "";
  // las cuentas nuevas pueden llegar con un id anónimo (@lid): el número real viene aparte
  if (jid.endsWith("@lid")) jid = key.remoteJidAlt || key.senderPn || data?.senderPn || "";
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return "";
  return jid;
}

const datosUpsert = (body: any) => {
  const evento = String(body?.event || "").toLowerCase().replace(/_/g, ".");
  if (evento && evento !== "messages.upsert") return null;
  return Array.isArray(body?.data) ? body.data[0] : body?.data;
};

/**
 * Mensaje que alguien del CeCIP escribió a mano desde el celular del número institucional
 * (no por el ERP): queda en la conversación y pausa la IA con ese contacto.
 */
export function leerPropio(body: any): { id: string; numero: string; texto: string } | null {
  const data = datosUpsert(body);
  if (!data?.key?.fromMe) return null;
  const jid = jidDe(data);
  if (!jid) return null;
  const { texto, media } = leerMensaje(data);
  if (!texto && !media) return null;
  return { id: String(data.key.id || ""), numero: normalizarNumero(jid), texto: texto || `[${media!.tipo}]` };
}

export function leerWebhook(body: any): MensajeEntrante | null {
  const data = datosUpsert(body);
  const key = data?.key;
  if (!key || key.fromMe) return null;
  const jid = jidDe(data);
  if (!jid) return null;
  const { texto, media } = leerMensaje(data);
  if (!texto && !media) return null;
  return { id: String(key.id || ""), numero: normalizarNumero(jid), texto, nombre: String(data?.pushName || ""), ...(media ? { media } : {}) };
}
