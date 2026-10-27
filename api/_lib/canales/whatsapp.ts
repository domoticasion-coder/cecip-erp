/**
 * Mensajes de WhatsApp que llegan por el webhook de Evolution.
 *
 * Orden: se registra (sin duplicar) → archivos y audios → vinculación del personal
 * ("VINCULAR XXXX-XXXX") → personal vinculado (Copiloto de su rol) → BAJA/ALTA →
 * comprobantes de pago → IA pausada o apagada (avisa a quien atiende) → asistente de socios
 * o asistente institucional (no socios).
 */
import crypto from "node:crypto";
import { env } from "../core.js";
import type { Rol } from "../../../shared/roles.js";
import {
  ajustes, asegurarConversacion, avisar, avisarArea, enviarWhatsapp, guardarArchivo, personasDeArea, quien, registrarMensaje,
  rutaNueva, sb,
} from "./base.js";
import { descargarMedia, variantesNumero, type MensajeEntrante } from "./evolution.js";
import { MAX_SEGUNDOS_AUDIO, iaConfigurada, transcribirAudio } from "./ia.js";
import { responderExterno, responderPersonal, responderSocio } from "./asistentes.js";
import { leerArchivoIA, registrarComprobante } from "./comprobantes.js";

const VENTANA_MIN = 10;
const MAX_MENSAJES_VENTANA = 25;
const MAX_INTENTOS_VINCULAR = 5;
const VIGENCIA_CODIGO_HORAS = 24;
const ES_BAJA = /^\s*(baja|stop|no quiero (recibir )?(m[aá]s )?(mensajes|novedades))\s*[.!]*\s*$/i;
const ES_ALTA = /^\s*alta\s*[.!]*\s*$/i;

// -----------------------------------------------------------------------------
// Vinculación del personal

/** Código de 8 caracteres (sin letras confusas) para vincular un WhatsApp a un usuario del ERP. */
export async function generarCodigo(userId: string): Promise<{ codigo: string; vence: string }> {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  const c = Array.from(bytes, (b) => letras[b % letras.length]).join("");
  const codigo = `${c.slice(0, 4)}-${c.slice(4)}`;
  const vence = new Date(Date.now() + VIGENCIA_CODIGO_HORAS * 3_600_000).toISOString();
  const { error } = await sb().from("staff").update({ whatsapp_codigo: codigo, whatsapp_codigo_vence: vence }).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { codigo, vence };
}

const leerVincular = (texto: string) => texto.toUpperCase().match(/^\s*VINCULAR\s+([A-Z0-9]{4})-?([A-Z0-9]{4})\s*$/)?.slice(1, 3).join("-") || null;

async function staffPorNumero(numero: string): Promise<{ user_id: string; nombre: string; rol: Rol } | null> {
  const { data } = await sb().from("staff_whatsapp").select("user_id").in("telefono", variantesNumero(numero)).limit(1).maybeSingle();
  if (!data) return null;
  const { data: st } = await sb().from("staff").select("user_id, nombre, rol, activo").eq("user_id", data.user_id).maybeSingle();
  return st?.activo ? { user_id: st.user_id, nombre: st.nombre, rol: st.rol as Rol } : null;
}

// -----------------------------------------------------------------------------

/** Procesa un mensaje entrante. Devuelve lo que se respondió (o null). */
export async function procesarEntrante(msg: MensajeEntrante): Promise<string | null> {
  const personal = await staffPorNumero(msg.numero);
  const { conv, nueva } = await asegurarConversacion({ telefono: msg.numero, nombre: msg.nombre, staffUserId: personal?.user_id || null });
  if (!conv.nombre && msg.nombre && !personal) await sb().from("conversaciones").update({ nombre: msg.nombre.slice(0, 120) }).eq("id", conv.id);

  // Archivos: se guardan para verlos en la Bandeja; los audios se transcriben
  let texto = msg.texto;
  let archivo: { ruta: string; nombre: string; mime: string; base64: string } | null = null;
  let eco = "";
  if (msg.media) {
    try {
      const m = await descargarMedia(msg.media.crudo);
      const nombreArch = msg.media.nombre || m.nombre || `${msg.media.tipo}-${Date.now()}`;
      const ruta = await guardarArchivo(rutaNueva("whatsapp", nombreArch, m.mime), Buffer.from(m.base64, "base64"), m.mime);
      archivo = { ruta, nombre: nombreArch, mime: m.mime, base64: m.base64 };
      if (msg.media.tipo === "audio" && iaConfigurada() && (msg.media.segundos || 0) <= MAX_SEGUNDOS_AUDIO) {
        eco = await transcribirAudio(m.base64, m.mime).catch(() => "");
        if (eco === "[inaudible]") eco = "";
        if (eco) texto = eco;
      }
    } catch (err: any) {
      console.error("[whatsapp] no se pudo bajar el archivo:", err?.message || err);
    }
  }

  const registrado = await registrarMensaje({
    conversacion_id: conv.id, canal: "whatsapp", direccion: "entrante", autor: "contacto",
    cuerpo: msg.media?.tipo === "audio" && eco ? `🎤 ${eco}` : texto,
    externo_id: msg.id || null, media_tipo: msg.media?.tipo || null,
    adjunto_path: archivo?.ruta || null, adjunto_nombre: archivo?.nombre || null, adjunto_mime: archivo?.mime || null,
  });
  if (!registrado) return null; // Evolution reenvió el mismo mensaje

  const responder = async (t: string, autor: "ia" | "sistema" = "ia") => {
    const final = eco && msg.media?.tipo === "audio" ? `🎤 _«${eco.length > 300 ? `${eco.slice(0, 297)}…` : eco}»_\n\n${t}` : t;
    await enviarWhatsapp(conv, final, { autor });
    return final;
  };

  // Vinculación: "VINCULAR K7P2-9QXA" desde el celular que se quiere sumar
  const codigo = leerVincular(msg.texto || "");
  if (codigo || /^\s*vincular\b/i.test(msg.texto || "")) {
    const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await sb().from("mensajes").select("id", { count: "exact", head: true })
      .eq("conversacion_id", conv.id).eq("direccion", "entrante").ilike("cuerpo", "vincular%").gte("created_at", haceUnaHora);
    if ((count || 0) > MAX_INTENTOS_VINCULAR) return null;
    const { data: duenio } = codigo
      ? await sb().from("staff").select("user_id, nombre").eq("whatsapp_codigo", codigo).eq("activo", true).gt("whatsapp_codigo_vence", new Date().toISOString()).maybeSingle()
      : { data: null };
    if (!duenio) return responder("El código no es válido o ya venció. Generá uno nuevo en el ERP (*Configuración → Canales → Mi WhatsApp*) y mandá \"VINCULAR\" seguido del código.", "sistema");
    if (personal) return responder(personal.user_id === duenio.user_id ? "Este número ya estaba vinculado a tu usuario." : "Este número ya está vinculado a otra persona del CeCIP.", "sistema");
    const { error } = await sb().from("staff_whatsapp").insert({ user_id: duenio.user_id, telefono: msg.numero });
    if (error) throw new Error(error.message);
    await sb().from("staff").update({ whatsapp_codigo: null, whatsapp_codigo_vence: null }).eq("user_id", duenio.user_id);
    await sb().from("conversaciones").update({ staff_user_id: duenio.user_id, socio_id: null, etapa: "Nuevo" }).eq("id", conv.id);
    return responder(`¡Listo, ${duenio.nombre.split(" ")[0]}! Este WhatsApp quedó vinculado al ERP del CeCIP.\n\nPodés preguntarme lo que necesites de tu área (por ejemplo "¿cuántos socios deben cuotas?") y vas a recibir acá los avisos de las consultas que te deriven.`, "sistema");
  }

  // Límite por número: protege la IA de un uso desmedido
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { count: recientes } = await sb().from("mensajes").select("id", { count: "exact", head: true })
    .eq("conversacion_id", conv.id).eq("direccion", "entrante").gte("created_at", desde);
  if ((recientes || 0) > MAX_MENSAJES_VENTANA) return null;

  // Personal vinculado: el Copiloto de su rol
  if (personal) {
    if (!texto.trim()) return responder("Por WhatsApp leo texto y audios. Para cargar archivos usá el ERP.", "sistema");
    try {
      return responder(await responderPersonal(conv, personal, texto, registrado.id));
    } catch (err: any) {
      console.error("[whatsapp] copiloto:", err?.message || err);
      return responder("⚠️ No pude consultar el ERP en este momento. Probá de nuevo en unos minutos.", "sistema");
    }
  }

  const socio = conv.socio_id
    ? (await sb().from("socios").select("id, razon_social, nombre_comercial, numero_socio, email, contacto_nombre").eq("id", conv.socio_id).maybeSingle()).data
    : null;

  // BAJA / ALTA de difusiones
  if (ES_BAJA.test(msg.texto || "")) {
    await sb().from("conversaciones").update({ baja_at: new Date().toISOString(), acepta_novedades: false }).eq("id", conv.id);
    if (socio) await sb().from("socios").update({ whatsapp_baja: true }).eq("id", socio.id);
    return responder("Listo, no te vamos a mandar más difusiones por WhatsApp. Si querés volver a recibirlas, escribí ALTA.", "sistema");
  }
  if (ES_ALTA.test(msg.texto || "")) {
    await sb().from("conversaciones").update({ baja_at: null, acepta_novedades: true }).eq("id", conv.id);
    if (socio) await sb().from("socios").update({ whatsapp_baja: false }).eq("id", socio.id);
    return responder("¡Genial! Vas a recibir las novedades del CeCIP. Escribí BAJA cuando quieras dejar de recibirlas.", "sistema");
  }

  const a = await ajustes();

  // Archivos que no son audio: comprobantes de pago a Tesorería
  if (archivo && msg.media?.tipo !== "audio") {
    const lectura = await leerArchivoIA(archivo.base64, archivo.mime, msg.texto);
    if (lectura?.tipo === "comprobante_pago") {
      await sb().from("mensajes").update({ analisis: lectura }).eq("id", registrado.id);
      await registrarComprobante({ conv, socio, mensajeId: registrado.id, canal: "whatsapp", lectura, archivo });
      return responder(`¡Gracias! Recibimos tu comprobante${lectura.monto ? ` por $ ${Math.round(lectura.monto).toLocaleString("es-AR")}` : ""}. Tesorería lo concilia y te avisamos. 🧾`);
    }
    if (lectura) await sb().from("mensajes").update({ analisis: lectura }).eq("id", registrado.id);
    texto = `[La persona mandó ${msg.media?.tipo === "imagen" ? "una imagen" : "un archivo"}${lectura?.resumen ? ` (${lectura.resumen})` : ""}${msg.texto ? ` con el texto: ${msg.texto}` : ""}.]`;
  }

  // IA apagada o pausada (alguien del CeCIP está respondiendo a mano): se avisa a quien atiende
  const pausada = conv.ia_pausada_hasta && new Date(conv.ia_pausada_hasta) > new Date();
  if (!a.ia_activa || pausada || !iaConfigurada()) {
    const anterior = conv.ultimo_entrante_at ? new Date(conv.ultimo_entrante_at) : null;
    if (!anterior || Date.now() - anterior.getTime() > 30 * 60_000) {
      const destino = conv.asignado_a ? [conv.asignado_a] : await personasDeArea(conv.area || (socio ? "tesoreria" : "secretaria"));
      await avisar(destino, `💬 ${quien(conv, socio)} escribió: "${(texto || "").slice(0, 300)}"\nRespondé desde la Bandeja: ${env.erpUrl()}/bandeja?c=${conv.id}`);
    }
    return null;
  }

  if (msg.media?.tipo === "audio" && !eco) return responder("¡Hola! No pude escuchar tu audio en este momento, ¿me lo escribís? 🙏");
  if (msg.media?.tipo === "video") return responder("Por ahora leo texto, audios, fotos y PDF. ¿Me lo contás por escrito o por audio?");

  if (nueva && !socio) {
    await avisarArea("secretaria", `📥 Nueva consulta por WhatsApp de ${quien(conv, null)}: "${(texto || "").slice(0, 200)}"`);
  }

  let respuesta: string | null = null;
  try {
    respuesta = socio ? await responderSocio(conv, socio, texto, registrado.id) : await responderExterno(conv, texto, registrado.id);
  } catch (err: any) {
    console.error("[whatsapp] asistente:", err?.message || err);
  }
  if (!respuesta) {
    await avisarArea("secretaria", `⚠️ La IA no pudo responderle a ${quien(conv, socio)}: "${(texto || "").slice(0, 200)}". Respondé desde la Bandeja.`);
    return responder("¡Hola! Gracias por escribirle al CeCIP 😊 En un ratito te responde alguien del equipo.", "sistema");
  }
  if (!socio && conv.etapa === "Nuevo") await sb().from("conversaciones").update({ etapa: "Consultando" }).eq("id", conv.id).eq("etapa", "Nuevo");
  // seguimiento automático a quien no es socio y sigue con la consulta abierta
  if (!socio) await sb().from("conversaciones").update({ seguimiento_at: new Date(Date.now() + a.seguimiento_dias * 86_400_000).toISOString(), seguimientos_enviados: 0 }).eq("id", conv.id);
  return responder(respuesta);
}

/**
 * Mensaje escrito a mano desde el celular del CeCIP (no por el ERP): queda en la conversación
 * y pausa la IA con ese contacto para no pisarse.
 */
export async function registrarPropio(m: { id: string; numero: string; texto: string }) {
  if (m.id) {
    // lo que manda el ERP también vuelve por el webhook: se espera a que quede registrado
    for (let i = 0; i < 3; i++) {
      const { data } = await sb().from("mensajes").select("id").eq("canal", "whatsapp").eq("externo_id", m.id).limit(1);
      if (data?.length) return;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  const { conv } = await asegurarConversacion({ telefono: m.numero });
  const reg = await registrarMensaje({ conversacion_id: conv.id, canal: "whatsapp", direccion: "saliente", autor: "personal", cuerpo: m.texto, externo_id: m.id || null });
  if (reg) {
    const { pausa_manual_horas } = await ajustes();
    await sb().from("conversaciones").update({ ia_pausada_hasta: new Date(Date.now() + pausa_manual_horas * 3_600_000).toISOString() }).eq("id", conv.id);
  }
}

