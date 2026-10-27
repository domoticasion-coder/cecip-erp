/**
 * Núcleo de los canales: conversaciones (una por contacto), registro de mensajes, archivos
 * en Storage, envío por WhatsApp y avisos al personal por área.
 */
import crypto from "node:crypto";
import { supabaseAdmin } from "../core.js";
import { enviarArchivo, enviarTexto, normalizarNumero, variantesNumero, evolutionConfig } from "./evolution.js";

export type Row = Record<string, any>;
export const sb = () => supabaseAdmin();

// -----------------------------------------------------------------------------
// Ajustes
export type Area = "tesoreria" | "prensa" | "administracion" | "secretaria" | "presidencia" | "comercia";
export const AREAS: Record<Area, string> = {
  tesoreria: "Tesorería y pagos",
  prensa: "Prensa y capacitación",
  administracion: "Administración",
  secretaria: "Secretaría",
  presidencia: "Presidencia",
  comercia: "ComercIA",
};
// Si no se eligió a nadie para un área, se avisa a estos roles
const ROLES_POR_AREA: Record<Area, string[]> = {
  tesoreria: ["tesoreria", "administracion"],
  prensa: ["prensa"],
  administracion: ["administracion"],
  secretaria: ["prosecretario", "atencion", "administracion"],
  presidencia: ["presidente"],
  comercia: ["comercia"],
};

export interface Ajustes {
  ia_activa: boolean;
  perfil_institucional: string;
  avisos: Partial<Record<Area, string[]>>;
  pausa_manual_horas: number;
  seguimiento_dias: number;
  max_seguimientos: number;
  campanas_desde: string;
  campanas_hasta: string;
  campanas_tope_diario: number;
}

export async function ajustes(): Promise<Ajustes> {
  const { data } = await sb().from("canales_ajustes").select("*").eq("id", 1).maybeSingle();
  return {
    ia_activa: data?.ia_activa ?? true,
    perfil_institucional: data?.perfil_institucional ?? "",
    avisos: data?.avisos ?? {},
    pausa_manual_horas: data?.pausa_manual_horas ?? 12,
    seguimiento_dias: data?.seguimiento_dias ?? 3,
    max_seguimientos: data?.max_seguimientos ?? 2,
    campanas_desde: String(data?.campanas_desde ?? "09:00").slice(0, 5),
    campanas_hasta: String(data?.campanas_hasta ?? "19:30").slice(0, 5),
    campanas_tope_diario: data?.campanas_tope_diario ?? 150,
  };
}

// -----------------------------------------------------------------------------
// Cifrado (contraseña de la casilla de email)
function clave(): Buffer {
  const base = process.env.CANALES_CLAVE || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (base.length < 32) throw new Error("Falta CANALES_CLAVE para cifrar las credenciales.");
  return crypto.createHash("sha256").update(`cecip-canales:${base}`).digest();
}
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", clave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function descifrar(dato: string): string {
  const [v, iv, tag, enc] = dato.split(".");
  if (v !== "v1") throw new Error("Formato de credencial desconocido.");
  const d = crypto.createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// -----------------------------------------------------------------------------
// Archivos (bucket privado; se leen con URLs firmadas de pocos minutos)
export const BUCKET = "canales";
export const MAX_ARCHIVO_MB = 15;
export const TIPOS_ARCHIVO = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "video/mp4",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "application/vnd.ms-excel"];

let bucketListo = false;
async function asegurarBucket() {
  if (bucketListo) return;
  const { data } = await sb().storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await sb().storage.createBucket(BUCKET, { public: false, fileSizeLimit: `${MAX_ARCHIVO_MB}MB` });
    if (error && !/exists/i.test(error.message)) throw new Error(error.message);
  }
  bucketListo = true;
}

const nombreSeguro = (n: string) => n.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-100) || "archivo";
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/ogg": "ogg", "audio/mpeg": "mp3", "video/mp4": "mp4" };

export function rutaNueva(carpeta: string, nombre: string, mime: string) {
  const base = nombreSeguro(nombre || `archivo.${EXT[mime] || "bin"}`);
  return `${carpeta}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${base}`;
}

export async function guardarArchivo(ruta: string, contenido: Buffer, mime: string) {
  await asegurarBucket();
  const { error } = await sb().storage.from(BUCKET).upload(ruta, contenido, { contentType: mime, upsert: false });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  return ruta;
}

export async function leerArchivo(ruta: string): Promise<Buffer> {
  const { data, error } = await sb().storage.from(BUCKET).download(ruta);
  if (error || !data) throw new Error("No se encontró el archivo.");
  return Buffer.from(await data.arrayBuffer());
}

export async function urlFirmada(ruta: string, nombre?: string) {
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(ruta, 300, nombre ? { download: nombre } : undefined);
  if (error || !data) throw new Error("No se pudo abrir el archivo.");
  return data.signedUrl;
}

export async function urlDeSubida(ruta: string) {
  await asegurarBucket();
  const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(ruta);
  if (error || !data) throw new Error("No se pudo preparar la subida.");
  return { url: data.signedUrl, token: data.token, ruta };
}

// -----------------------------------------------------------------------------
// Conversaciones
export async function socioPorTelefono(numero: string): Promise<string | null> {
  const { data } = await sb().rpc("socio_por_telefono", { p_numero: numero });
  return (data as string) || null;
}
export async function socioPorEmail(email: string): Promise<string | null> {
  const { data } = await sb().rpc("socio_por_email", { p_email: email });
  return (data as string) || null;
}

export async function conversacionPorTelefono(numero: string): Promise<Row | null> {
  const { data } = await sb().from("conversaciones").select("*").in("telefono", variantesNumero(numero)).limit(1).maybeSingle();
  return data;
}

/** Busca (o crea) la conversación de un número de WhatsApp o de un email, y la vincula al socio si lo encuentra. */
export async function asegurarConversacion(c: { telefono?: string; email?: string; nombre?: string; staffUserId?: string | null }): Promise<{ conv: Row; nueva: boolean }> {
  const telefono = c.telefono ? normalizarNumero(c.telefono) : null;
  const email = c.email ? c.email.trim().toLowerCase() : null;
  let conv: Row | null = null;
  if (telefono) conv = await conversacionPorTelefono(telefono);
  else if (email) {
    const { data } = await sb().from("conversaciones").select("*").ilike("email", email).order("created_at").limit(1).maybeSingle();
    conv = data;
  }
  if (conv) {
    // si el socio se cargó después, se vincula ahora
    if (!conv.socio_id && !conv.staff_user_id) {
      const socio = telefono ? await socioPorTelefono(telefono) : email ? await socioPorEmail(email) : null;
      if (socio) {
        await sb().from("conversaciones").update({ socio_id: socio, etapa: "Socio" }).eq("id", conv.id);
        conv.socio_id = socio;
        conv.etapa = "Socio";
      }
    }
    return { conv, nueva: false };
  }
  const socio = c.staffUserId ? null : telefono ? await socioPorTelefono(telefono) : email ? await socioPorEmail(email) : null;
  const fila = {
    telefono, email, nombre: c.nombre?.slice(0, 120) || null, socio_id: socio, staff_user_id: c.staffUserId || null,
    etapa: socio ? "Socio" : "Nuevo",
  };
  const { data, error } = await sb().from("conversaciones").insert(fila).select("*").single();
  if (error) {
    // carrera: otro mensaje la creó al mismo tiempo
    if (error.code === "23505") return asegurarConversacion(c);
    throw new Error(error.message);
  }
  return { conv: data, nueva: true };
}

export interface NuevoMensaje {
  conversacion_id: string;
  canal: "whatsapp" | "email";
  direccion: "entrante" | "saliente";
  autor: "contacto" | "ia" | "personal" | "sistema";
  cuerpo: string;
  staff_id?: string | null;
  asunto?: string | null;
  adjunto_path?: string | null;
  adjunto_nombre?: string | null;
  adjunto_mime?: string | null;
  media_tipo?: string | null;
  externo_id?: string | null;
  hilo_ref?: string | null;
  estado?: "ok" | "error";
  error?: string | null;
  analisis?: unknown;
}

/** Registra un mensaje y actualiza la conversación. Devuelve null si ya estaba (Evolution reenvía). */
export async function registrarMensaje(m: NuevoMensaje): Promise<Row | null> {
  const { data, error } = await sb().from("mensajes").insert({ ...m, cuerpo: (m.cuerpo || "").slice(0, 20_000) }).select("*").single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }
  const resumen = (m.cuerpo || (m.adjunto_nombre ? `📎 ${m.adjunto_nombre}` : m.media_tipo ? `[${m.media_tipo}]` : "")).replace(/\s+/g, " ").slice(0, 200);
  const ahora = new Date().toISOString();
  const patch: Row = { ultimo_mensaje: resumen, ultimo_canal: m.canal, ultimo_mensaje_at: ahora };
  if (m.direccion === "entrante") {
    patch.ultimo_entrante_at = ahora;
    patch.estado = "abierta";
    const { data: c } = await sb().from("conversaciones").select("no_leidos").eq("id", m.conversacion_id).single();
    patch.no_leidos = (c?.no_leidos || 0) + 1;
  }
  await sb().from("conversaciones").update(patch).eq("id", m.conversacion_id);
  return data;
}

/** Historial reciente para la IA (los últimos mensajes de la conversación, en orden). */
export async function historial(conversacionId: string, sinId?: string, cantidad = 16): Promise<{ rol: "contacto" | "cecip"; texto: string }[]> {
  let q = sb().from("mensajes").select("id, direccion, cuerpo, media_tipo, adjunto_nombre").eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: false }).limit(cantidad);
  if (sinId) q = q.neq("id", sinId);
  const { data } = await q;
  return (data || []).reverse().map((m) => ({
    rol: m.direccion === "entrante" ? "contacto" : "cecip",
    texto: m.cuerpo || (m.adjunto_nombre ? `[archivo: ${m.adjunto_nombre}]` : `[${m.media_tipo || "mensaje"}]`),
  }));
}

// -----------------------------------------------------------------------------
// Envío por WhatsApp (nunca corta la operación que lo dispara: si falla, queda el error registrado)
export async function enviarWhatsapp(conv: Row, texto: string, info: {
  autor?: "ia" | "personal" | "sistema"; staffId?: string | null;
  archivo?: { ruta: string; nombre: string; mime: string } | null;
} = {}): Promise<boolean> {
  const base: NuevoMensaje = {
    conversacion_id: conv.id, canal: "whatsapp", direccion: "saliente", autor: info.autor || "ia", cuerpo: texto,
    staff_id: info.staffId || null,
    adjunto_path: info.archivo?.ruta || null, adjunto_nombre: info.archivo?.nombre || null, adjunto_mime: info.archivo?.mime || null,
    media_tipo: info.archivo ? (info.archivo.mime.startsWith("image/") ? "imagen" : "documento") : null,
  };
  try {
    if (!conv.telefono) throw new Error("La conversación no tiene número de WhatsApp.");
    const r = info.archivo
      ? await enviarArchivo(conv.telefono, { base64: (await leerArchivo(info.archivo.ruta)).toString("base64"), nombre: info.archivo.nombre, mime: info.archivo.mime }, texto)
      : await enviarTexto(conv.telefono, texto);
    await registrarMensaje({ ...base, externo_id: r.id });
    return true;
  } catch (err: any) {
    console.error("[canales] no se pudo enviar:", err?.message || err);
    await registrarMensaje({ ...base, estado: "error", error: String(err?.message || err).slice(0, 500) });
    return false;
  }
}

// -----------------------------------------------------------------------------
// Avisos al personal (a su WhatsApp vinculado)

/** Personas a avisar para un área: las elegidas en Ajustes o, si no hay, los roles del área (y si no, el administrador). */
export async function personasDeArea(area: Area): Promise<string[]> {
  const a = await ajustes();
  const elegidas = (a.avisos[area] || []).filter(Boolean);
  if (elegidas.length) return elegidas;
  const { data } = await sb().from("staff").select("user_id, rol").eq("activo", true).in("rol", [...ROLES_POR_AREA[area], "admin"]);
  const porRol = (data || []).filter((s) => s.rol !== "admin").map((s) => s.user_id);
  return porRol.length ? porRol : (data || []).map((s) => s.user_id);
}

/** Avisa a personas del CeCIP por WhatsApp. Si WhatsApp no está configurado no hace nada. */
export async function avisar(userIds: string[], texto: string) {
  if (!evolutionConfig().configurado || !userIds.length) return 0;
  const { data: numeros } = await sb().from("staff_whatsapp").select("user_id, telefono").in("user_id", userIds).eq("recibe_avisos", true);
  let enviados = 0;
  for (const n of numeros || []) {
    const { conv } = await asegurarConversacion({ telefono: n.telefono, staffUserId: n.user_id });
    if (await enviarWhatsapp(conv, texto, { autor: "sistema" })) enviados++;
  }
  return enviados;
}

export async function avisarArea(area: Area, texto: string) {
  return avisar(await personasDeArea(area), texto);
}

/** Etiqueta corta de un contacto para los avisos. */
export function quien(conv: Row, socio?: Row | null) {
  const nombre = socio ? socio.nombre_comercial || socio.razon_social : conv.nombre || "Un contacto";
  const via = conv.telefono ? `+${conv.telefono}` : conv.email || "";
  return `${nombre}${socio ? " (socio)" : ""}${via ? ` · ${via}` : ""}`;
}
