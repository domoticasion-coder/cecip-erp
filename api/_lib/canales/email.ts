/**
 * Emails entrantes (casilla del dominio por IMAP), como en el IBP:
 *  - Cada pocos minutos (cron) se leen los emails nuevos de la casilla.
 *  - La IA clasifica cada email y sus adjuntos: comprobante de pago, consulta, alta de socio,
 *    inscripción, reclamo, factura de proveedor, publicidad…
 *  - Queda asentado en la conversación del contacto (vinculada al socio por email), los
 *    comprobantes van a Tesorería y cada tema se deriva al área que corresponde.
 *  - Las respuestas salen desde el ERP por email, en el mismo hilo.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../core.js";
import {
  AREAS, asegurarConversacion, avisarArea, cifrar, descifrar, guardarArchivo, leerArchivo, quien, registrarMensaje, rutaNueva, sb,
  type Area, type Row,
} from "./base.js";
import { analizarJson, iaConfigurada } from "./ia.js";
import { leerArchivoIA, registrarComprobante } from "./comprobantes.js";

const MAX_POR_CORRIDA = 6; // la función de Vercel tiene ~60 s
const MAX_ADJUNTO_MB = 10;

// -----------------------------------------------------------------------------
// Conexión

export interface DatosCasilla { host: string; puerto: number; usuario: string; password: string; carpeta?: string }

function cliente(c: DatosCasilla) {
  return new ImapFlow({
    host: c.host, port: c.puerto, secure: c.puerto === 993,
    auth: { user: c.usuario, pass: c.password },
    logger: false, socketTimeout: 30_000, greetingTimeout: 15_000,
  });
}

/** Prueba la casilla y la guarda (cifrada). Solo se procesan los emails que lleguen desde ahora. */
export async function conectarCasilla(c: DatosCasilla, userId: string) {
  const imap = cliente(c);
  try {
    await imap.connect();
    const caja = await imap.mailboxOpen(c.carpeta || "INBOX", { readOnly: true });
    const ultimo = Math.max(0, Number(caja.uidNext || 1) - 1);
    const { error } = await sb().from("email_cuenta").upsert({
      id: 1, host: c.host, puerto: c.puerto, usuario: c.usuario, password_enc: cifrar(c.password), carpeta: c.carpeta || "INBOX",
      ultimo_uid: ultimo, uid_validity: Number(caja.uidValidity || 0), conectada_por: userId, conectada_at: new Date().toISOString(),
      ultimo_error: null, ultimo_resultado: `Conectada. ${caja.exists} emails en la casilla; se procesan los que lleguen desde ahora.`,
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    throw new Error(/auth|login|credentials/i.test(err?.message || "") ? "Usuario o contraseña incorrectos." : `No se pudo conectar a la casilla: ${err?.message || err}`);
  } finally {
    await imap.logout().catch(() => {});
  }
}

export async function estadoCasilla() {
  const { data } = await sb().from("email_cuenta").select("usuario, host, carpeta, conectada_at, ultima_sync_at, ultimo_resultado, ultimo_error").eq("id", 1).maybeSingle();
  return data ? { conectada: true, ...data } : { conectada: false };
}

export async function desconectarCasilla() {
  await sb().from("email_cuenta").delete().eq("id", 1);
}

// -----------------------------------------------------------------------------
// Análisis con IA

interface AnalisisEmail {
  tipo: "comprobante_pago" | "consulta" | "alta_socio" | "inscripcion" | "reclamo" | "factura_proveedor" | "alquiler" | "comercia" | "publicidad" | "otro";
  area: Area | null;
  prioridad: "alta" | "normal" | "baja";
  resumen: string;
  respuesta_sugerida: string | null;
  datos: Record<string, unknown> | null;
}

const TIPOS_A_INTERES: Record<string, string> = {
  comprobante_pago: "Pagos y cuotas", alta_socio: "Asociarse", inscripcion: "Capacitación", reclamo: "Reclamo",
  alquiler: "Alquiler de salón", comercia: "ComercIA", consulta: "Otro",
};

const INSTRUCCIONES_EMAIL = `Clasificás emails que recibe la casilla del Centro Comercial e Industrial de Paraná (CeCIP), una institución que nuclea comercios e industrias.
Respondé SOLO un JSON:
{"tipo": "comprobante_pago" | "consulta" | "alta_socio" | "inscripcion" | "reclamo" | "factura_proveedor" | "alquiler" | "comercia" | "publicidad" | "otro",
 "area": "tesoreria" | "prensa" | "administracion" | "secretaria" | "presidencia" | "comercia" | null,
 "prioridad": "alta" | "normal" | "baja",
 "resumen": "una o dos líneas para el equipo",
 "respuesta_sugerida": "borrador de respuesta cordial en español rioplatense (trato de vos), sin inventar datos; null si es publicidad o no requiere respuesta",
 "datos": { campos útiles detectados: razon_social, cuit, telefono, monto, fecha, evento, etc. } o null}
Áreas: tesoreria = pagos, cuotas, comprobantes, facturas; prensa = capacitaciones, eventos, difusión; administracion = alquileres y trámites; secretaria = altas de socios, reclamos y consultas generales; presidencia = temas institucionales; comercia = programa ComercIA.
"publicidad" = newsletters, promociones masivas o notificaciones automáticas que no requieren acción.`;

// -----------------------------------------------------------------------------
// Sincronización

async function tomarLock(): Promise<boolean> {
  const ahora = new Date();
  const { data } = await sb().from("email_cuenta").update({ lock_hasta: new Date(ahora.getTime() + 90_000).toISOString() })
    .eq("id", 1).or(`lock_hasta.is.null,lock_hasta.lt.${ahora.toISOString()}`).select("id");
  return !!data?.length;
}

const esAutomatico = (headers: Map<string, any>, de: string) =>
  /no-?reply|mailer-daemon|postmaster/i.test(de) ||
  String(headers.get("auto-submitted") || "").toLowerCase().startsWith("auto-") ||
  /bulk|list|junk/i.test(String(headers.get("precedence") || ""));

export async function sincronizarEmail(origen: "cron" | "manual") {
  const { data: cuenta } = await sb().from("email_cuenta").select("*").eq("id", 1).maybeSingle();
  if (!cuenta) return { omitido: "La casilla de email no está conectada." };
  if (!(await tomarLock())) return { omitido: "Ya hay una sincronización en curso." };

  const imap = cliente({ host: cuenta.host, puerto: cuenta.puerto, usuario: cuenta.usuario, password: descifrar(cuenta.password_enc) });
  let procesados = 0, comprobantes = 0;
  let ultimoUid = Number(cuenta.ultimo_uid || 0);
  try {
    await imap.connect();
    const caja = await imap.mailboxOpen(cuenta.carpeta || "INBOX", { readOnly: true });
    // si la casilla se reinició (UIDVALIDITY distinto), se arranca desde el final para no reprocesar todo
    if (cuenta.uid_validity && Number(caja.uidValidity) !== Number(cuenta.uid_validity)) {
      ultimoUid = Math.max(0, Number(caja.uidNext || 1) - 1);
    }
    const uids: number[] = [];
    if (Number(caja.uidNext || 0) - 1 > ultimoUid) {
      for await (const m of imap.fetch(`${ultimoUid + 1}:*`, { uid: true }, { uid: true })) {
        if (m.uid > ultimoUid) uids.push(m.uid);
      }
    }
    for (const uid of uids.sort((a, b) => a - b).slice(0, MAX_POR_CORRIDA)) {
      const m = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (m && m.source) {
        try {
          if (await procesarEmail(m.source as Buffer, cuenta.usuario)) procesados++;
        } catch (err: any) {
          console.error(`[email] uid ${uid}:`, err?.message || err);
        }
      }
      ultimoUid = uid;
      await sb().from("email_cuenta").update({ ultimo_uid: ultimoUid }).eq("id", 1);
    }
    const { count } = await sb().from("comprobantes_recibidos").select("id", { count: "exact", head: true }).eq("canal", "email")
      .gte("created_at", new Date(Date.now() - 120_000).toISOString());
    comprobantes = count || 0;
    const pendientes = Math.max(0, uids.length - MAX_POR_CORRIDA);
    await sb().from("email_cuenta").update({
      ultima_sync_at: new Date().toISOString(), uid_validity: Number(caja.uidValidity || 0), ultimo_error: null, lock_hasta: null,
      ultimo_resultado: `${procesados} emails nuevos (${origen === "cron" ? "automática" : "manual"})${pendientes ? `, quedan ${pendientes} para la próxima` : ""}`,
    }).eq("id", 1);
    return { procesados, comprobantes, pendientes };
  } catch (err: any) {
    const mensaje = String(err?.message || err).slice(0, 400);
    await sb().from("email_cuenta").update({ ultimo_error: mensaje, lock_hasta: null }).eq("id", 1);
    throw new Error(`Email: ${mensaje}`);
  } finally {
    await imap.logout().catch(() => {});
  }
}

/** Procesa un email crudo. Devuelve false si ya estaba registrado o se descartó. */
async function procesarEmail(fuente: Buffer, casilla: string): Promise<boolean> {
  const mail = await simpleParser(fuente);
  const de = mail.from?.value?.[0];
  const email = (de?.address || "").toLowerCase();
  if (!email || email === casilla.toLowerCase()) return false;
  const messageId = mail.messageId || `${email}-${mail.date?.toISOString()}`;
  const { data: ya } = await sb().from("mensajes").select("id").eq("canal", "email").eq("externo_id", messageId).limit(1);
  if (ya?.length) return false;

  const cuerpo = (mail.text || (typeof mail.html === "string" ? mail.html.replace(/<[^>]+>/g, " ") : "") || "").replace(/\n{3,}/g, "\n\n").trim();
  // se saca lo citado de respuestas anteriores
  const limpio = cuerpo.split(/\n(?:El .{5,80} escribió:|On .{5,80} wrote:|-----Original Message-----|De: .+\nEnviado)/)[0].trim().slice(0, 8000);
  const asunto = (mail.subject || "(sin asunto)").slice(0, 300);
  const automatico = esAutomatico(mail.headers as any, email);

  const { conv } = await asegurarConversacion({ email, nombre: de?.name || undefined });
  const socio = conv.socio_id
    ? (await sb().from("socios").select("id, razon_social, nombre_comercial").eq("id", conv.socio_id).maybeSingle()).data
    : null;

  // Adjuntos (PDF e imágenes) a Storage
  const adjuntos: { ruta: string; nombre: string; mime: string; base64: string }[] = [];
  for (const a of mail.attachments || []) {
    if (a.related || !a.content || a.size > MAX_ADJUNTO_MB * 1024 * 1024) continue;
    if (!(a.contentType === "application/pdf" || a.contentType.startsWith("image/"))) continue;
    const nombre = a.filename || `adjunto.${a.contentType.split("/")[1]}`;
    const ruta = await guardarArchivo(rutaNueva("email", nombre, a.contentType), a.content, a.contentType);
    adjuntos.push({ ruta, nombre, mime: a.contentType, base64: a.content.toString("base64") });
    if (adjuntos.length >= 3) break;
  }

  // Clasificación con IA
  let analisis: AnalisisEmail | null = null;
  if (iaConfigurada() && !automatico) {
    try {
      analisis = await analizarJson<AnalisisEmail>(INSTRUCCIONES_EMAIL, [{
        text: `De: ${de?.name || ""} <${email}>${socio ? ` (es socio: ${socio.razon_social})` : " (no figura como socio)"}\nAsunto: ${asunto}\nAdjuntos: ${adjuntos.map((x) => x.nombre).join(", ") || "ninguno"}\n\n${limpio.slice(0, 6000)}`,
      }]);
    } catch (err: any) {
      console.error("[email] análisis:", err?.message || err);
    }
  }
  if (automatico) analisis = { tipo: "publicidad", area: null, prioridad: "baja", resumen: "Email automático o masivo.", respuesta_sugerida: null, datos: null };

  const principal = await registrarMensaje({
    conversacion_id: conv.id, canal: "email", direccion: "entrante", autor: "contacto", asunto,
    cuerpo: limpio || "(sin texto)", externo_id: messageId, hilo_ref: mail.inReplyTo || null, analisis,
    adjunto_path: adjuntos[0]?.ruta || null, adjunto_nombre: adjuntos[0]?.nombre || null, adjunto_mime: adjuntos[0]?.mime || null,
    media_tipo: adjuntos[0] ? (adjuntos[0].mime.startsWith("image/") ? "imagen" : "documento") : null,
  });
  if (!principal) return false;
  // más de un adjunto: cada uno queda como mensaje propio (para verlos en la Bandeja)
  for (const extra of adjuntos.slice(1)) {
    await registrarMensaje({
      conversacion_id: conv.id, canal: "email", direccion: "entrante", autor: "contacto", cuerpo: "", externo_id: `${messageId}#${extra.nombre}`,
      adjunto_path: extra.ruta, adjunto_nombre: extra.nombre, adjunto_mime: extra.mime, media_tipo: extra.mime.startsWith("image/") ? "imagen" : "documento",
    });
  }

  if (analisis?.tipo === "publicidad") {
    // no molesta en la Bandeja
    await sb().from("conversaciones").update({ no_leidos: 0, estado: "cerrada" }).eq("id", conv.id).eq("no_leidos", 1);
    return true;
  }

  // Comprobantes de pago → Tesorería
  const esPago = analisis?.tipo === "comprobante_pago";
  for (const adj of adjuntos) {
    const lectura = await leerArchivoIA(adj.base64, adj.mime, `${asunto}\n${limpio.slice(0, 800)}`);
    if (lectura?.tipo === "comprobante_pago" || (esPago && lectura)) {
      await registrarComprobante({ conv, socio, mensajeId: principal.id, canal: "email", lectura: lectura?.tipo === "comprobante_pago" ? lectura : { ...lectura!, tipo: "comprobante_pago" }, archivo: adj });
    }
  }

  const area = (analisis?.area && analisis.area in AREAS ? analisis.area : esPago ? "tesoreria" : "secretaria") as Area;
  const patch: Row = { area, resumen: analisis?.resumen?.slice(0, 400) || null };
  if (analisis?.tipo && TIPOS_A_INTERES[analisis.tipo]) patch.interes = TIPOS_A_INTERES[analisis.tipo];
  if (!socio && analisis?.tipo === "alta_socio") patch.etapa = "Alta en trámite";
  else if (!socio && conv.etapa === "Nuevo") patch.etapa = "Consultando";
  await sb().from("conversaciones").update(patch).eq("id", conv.id);

  if (!esPago) {
    await avisarArea(area, `📧 ${analisis?.prioridad === "alta" ? "*Urgente* · " : ""}Email de ${quien(conv, socio)}: "${asunto}"\n${analisis?.resumen || ""}\nRespondé desde la Bandeja: ${env.erpUrl()}/bandeja?c=${conv.id}`);
  }
  return true;
}

// -----------------------------------------------------------------------------
// Respuesta por email (Resend), en el mismo hilo

export async function responderEmail(conv: Row, texto: string, opts: { staffId: string | null; archivo?: { ruta: string; nombre: string; mime: string } | null; asunto?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("El envío de emails no está configurado (RESEND_API_KEY / EMAIL_FROM).");
  if (!conv.email) throw new Error("La conversación no tiene email.");
  const { data: ultimo } = await sb().from("mensajes").select("asunto, externo_id").eq("conversacion_id", conv.id).eq("canal", "email").eq("direccion", "entrante")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const asuntoBase = opts.asunto || ultimo?.asunto || "Centro Comercial e Industrial de Paraná";
  const asunto = /^re:/i.test(asuntoBase) || opts.asunto ? asuntoBase : `Re: ${asuntoBase}`;
  const replyTo = process.env.EMAIL_REPLY_TO || (await sb().from("email_cuenta").select("usuario").eq("id", 1).maybeSingle()).data?.usuario;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">${texto
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}<br><br>
    <span style="color:#64748b;font-size:12px">Centro Comercial e Industrial de Paraná</span></div>`;
  const body: Record<string, unknown> = { from, to: [conv.email], subject: asunto, text: texto, html, ...(replyTo ? { reply_to: replyTo } : {}) };
  if (ultimo?.externo_id && !opts.asunto) body.headers = { "In-Reply-To": ultimo.externo_id, References: ultimo.externo_id };
  if (opts.archivo) body.attachments = [{ filename: opts.archivo.nombre, content: (await leerArchivo(opts.archivo.ruta)).toString("base64") }];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const r: any = await res.json().catch(() => ({}));
  const base = {
    conversacion_id: conv.id, canal: "email" as const, direccion: "saliente" as const, autor: "personal" as const, staff_id: opts.staffId,
    cuerpo: texto, asunto, hilo_ref: ultimo?.externo_id || null,
    adjunto_path: opts.archivo?.ruta || null, adjunto_nombre: opts.archivo?.nombre || null, adjunto_mime: opts.archivo?.mime || null,
    media_tipo: opts.archivo ? (opts.archivo.mime.startsWith("image/") ? "imagen" : "documento") : null,
  };
  if (!res.ok) {
    await registrarMensaje({ ...base, estado: "error", error: `Resend ${res.status}: ${JSON.stringify(r).slice(0, 300)}` });
    throw new Error(`No se pudo enviar el email (Resend ${res.status}).`);
  }
  // envíos para el cupo diario
  await sb().from("envios").insert({ socio_id: conv.socio_id, canal: "email", tipo: "manual", asunto, destinatario: conv.email, estado: "enviado", created_by: opts.staffId });
  await registrarMensaje({ ...base, externo_id: r?.id ? `resend:${r.id}` : null });
}
