import { HttpError, getCaller, handle, json, readJson, requireStaff, type Caller } from "../_lib/core.js";
import {
  BUCKET, MAX_ARCHIVO_MB, TIPOS_ARCHIVO, ajustes, asegurarConversacion, enviarWhatsapp, guardarArchivo, historial, rutaNueva, sb, urlDeSubida, urlFirmada,
} from "../_lib/canales/base.js";
import { configurarWebhook, estadoInstancia, evolutionConfig, leerPropio, leerWebhook, normalizarNumero, qrInstancia } from "../_lib/canales/evolution.js";
import { procesarEntrante, registrarPropio, generarCodigo } from "../_lib/canales/whatsapp.js";
import { conectarCasilla, desconectarCasilla, estadoCasilla, responderEmail, sincronizarEmail } from "../_lib/canales/email.js";
import { enviarCampanas, enviarSeguimientos } from "../_lib/canales/campanas.js";
import { iaConfigurada, redactar } from "../_lib/canales/ia.js";
import { reciboPdf } from "../_lib/canales/recibo.js";

/**
 * Canales de comunicación (WhatsApp por Evolution API y email por IMAP), en un solo endpoint:
 *
 *  Evolution / cron:
 *   POST /api/canales/whatsapp-webhook?secret=…   mensajes que llegan al número del CeCIP
 *   POST /api/canales/cron                        (Bearer CRON_SECRET) emails nuevos, campañas y seguimientos
 *  Personal (Bandeja):
 *   GET  /api/canales/estado
 *   POST /api/canales/enviar          { conversacion_id, texto, archivo?, recibo_cuota_id?, asunto? }
 *   POST /api/canales/subir           { nombre, mime, tamano }  -> URL firmada para subir un archivo
 *   POST /api/canales/archivo         { ruta, nombre? }         -> URL firmada para verlo
 *   POST /api/canales/iniciar         { socio_id? | telefono? | email? } -> conversación
 *   POST /api/canales/ia              { conversacion_id, pausar }
 *   POST /api/canales/sugerir         { conversacion_id }        -> borrador de respuesta (IA)
 *   POST /api/canales/vincular        -> código para vincular el WhatsApp propio
 *   POST /api/canales/desvincular     { id }
 *   POST /api/canales/email-sincronizar
 *  Administrador:
 *   POST /api/canales/whatsapp-qr | whatsapp-webhook-config | email-conectar | email-desconectar
 */
const accion = (req: Request) => new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
const PUEDEN_RESPONDER = ["atencion", "tesoreria", "prensa"] as const;

function soloAdmin(c: Caller) {
  requireStaff(c);
  if (c.staff!.rol !== "admin") throw new HttpError(403, "Solo el administrador del sistema.");
}

async function conversacion(id: unknown) {
  const { data } = await sb().from("conversaciones").select("*").eq("id", String(id || "")).maybeSingle();
  if (!data) throw new HttpError(404, "La conversación no existe.");
  return data;
}

export const GET = handle(async (req) => {
  if (accion(req) === "cron") return cron(req);
  if (accion(req) !== "estado") throw new HttpError(404, "Acción inexistente.");
  const caller = await getCaller(req);
  requireStaff(caller);
  const evo = evolutionConfig();
  let whatsapp: Record<string, unknown> = { configurado: evo.configurado };
  if (evo.configurado) {
    try { whatsapp = { configurado: true, ...(await estadoInstancia()) }; } catch (err: any) { whatsapp = { configurado: true, estado: "error", error: err?.message }; }
  }
  const { data: mios } = await sb().from("staff_whatsapp").select("id, telefono, recibe_avisos").eq("user_id", caller.userId);
  return json({
    whatsapp, email: await estadoCasilla(), ia: iaConfigurada(), mi_whatsapp: mios || [],
    webhook_listo: Boolean(process.env.WHATSAPP_WEBHOOK_SECRET), cron_listo: Boolean(process.env.CRON_SECRET),
  });
});

async function cron(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) return json({ error: "No autorizado" }, 401);
  const r: Record<string, unknown> = {};
  r.email = await sincronizarEmail("cron").catch((e) => ({ error: (e as Error).message }));
  r.campanas = await enviarCampanas().catch((e) => ({ error: (e as Error).message }));
  r.seguimientos = await enviarSeguimientos().catch((e) => ({ error: (e as Error).message }));
  return json({ ok: true, ...r });
}

export const POST = handle(async (req) => {
  const a = accion(req);

  // ---- Webhook de Evolution (sin sesión: se valida el secreto de la URL)
  if (a === "whatsapp-webhook") {
    const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (!secreto || new URL(req.url).searchParams.get("secret") !== secreto) return json({ error: "No autorizado" }, 401);
    const body = await req.json().catch(() => null);
    const propio = leerPropio(body);
    if (propio) {
      await registrarPropio(propio).catch((e) => console.error("[webhook] propio:", e));
      return json({ ok: true, tipo: "propio" });
    }
    const msg = leerWebhook(body);
    if (!msg) return json({ ok: true, ignorado: true });
    try {
      await procesarEntrante(msg);
    } catch (err) {
      // se responde 200 igual para que Evolution no reintente sin fin; el error queda en el log
      console.error("[webhook] entrante:", err);
    }
    return json({ ok: true });
  }
  if (a === "cron") return cron(req);

  const caller = await getCaller(req);
  requireStaff(caller);
  const body = await readJson<Record<string, any>>(req).catch(() => ({} as Record<string, any>));

  switch (a) {
    case "enviar": {
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      const conv = await conversacion(body.conversacion_id);
      const texto = String(body.texto || "").trim();
      let archivo = body.archivo?.ruta ? { ruta: String(body.archivo.ruta), nombre: String(body.archivo.nombre || "archivo"), mime: String(body.archivo.mime || "application/octet-stream") } : null;
      if (body.recibo_cuota_id) {
        const pdf = await reciboPdf(String(body.recibo_cuota_id));
        if (conv.socio_id && pdf.socioId !== conv.socio_id) throw new HttpError(400, "Ese recibo es de otro socio.");
        archivo = { ruta: await guardarArchivo(rutaNueva("recibos", pdf.nombre, pdf.mime), Buffer.from(pdf.base64, "base64"), pdf.mime), nombre: pdf.nombre, mime: pdf.mime };
      }
      if (!texto && !archivo) throw new HttpError(400, "Escribí un mensaje o adjuntá un archivo.");
      const canal = body.canal === "email" || (!conv.telefono && conv.email) ? "email" : "whatsapp";
      if (canal === "email") {
        await responderEmail(conv, texto || "Te enviamos el archivo adjunto.", { staffId: caller.userId, archivo, asunto: body.asunto });
      } else {
        const ok = await enviarWhatsapp(conv, texto, { autor: "personal", staffId: caller.userId, archivo });
        if (!ok) throw new HttpError(502, "No se pudo enviar por WhatsApp (revisá la conexión en Configuración → Canales). Quedó registrado con error.");
      }
      // quien responde a mano pausa la IA con ese contacto
      const { pausa_manual_horas } = await ajustes();
      await sb().from("conversaciones").update({
        ia_pausada_hasta: new Date(Date.now() + pausa_manual_horas * 3_600_000).toISOString(), no_leidos: 0,
        asignado_a: conv.asignado_a || caller.userId,
      }).eq("id", conv.id);
      return json({ ok: true, canal });
    }

    case "subir": {
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      const mime = String(body.mime || "");
      if (!TIPOS_ARCHIVO.includes(mime)) throw new HttpError(400, "Tipo de archivo no permitido (PDF, imágenes, Word o Excel).");
      if (Number(body.tamano || 0) > MAX_ARCHIVO_MB * 1024 * 1024) throw new HttpError(400, `El archivo supera los ${MAX_ARCHIVO_MB} MB.`);
      return json(await urlDeSubida(rutaNueva("personal", String(body.nombre || "archivo"), mime)));
    }

    case "archivo": {
      const ruta = String(body.ruta || "");
      if (!/^(whatsapp|email|personal|recibos|campanas)\//.test(ruta) || ruta.includes("..")) throw new HttpError(400, "Archivo inválido.");
      return json({ url: await urlFirmada(ruta, body.nombre ? String(body.nombre) : undefined), bucket: BUCKET });
    }

    case "iniciar": {
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      let telefono = body.telefono ? String(body.telefono) : "";
      let email = body.email ? String(body.email) : "";
      let nombre = "";
      if (body.socio_id) {
        const { data: s } = await sb().from("socios").select("id, razon_social, nombre_comercial, whatsapp, telefono, email").eq("id", body.socio_id).maybeSingle();
        if (!s) throw new HttpError(404, "Socio inexistente.");
        telefono = telefono || s.whatsapp || s.telefono || "";
        email = email || s.email || "";
        nombre = s.nombre_comercial || s.razon_social;
      }
      if (!normalizarNumero(telefono) && !email) throw new HttpError(400, "Falta un WhatsApp o un email para iniciar la conversación.");
      const { conv } = await asegurarConversacion({ telefono: normalizarNumero(telefono) ? telefono : undefined, email: normalizarNumero(telefono) ? undefined : email, nombre });
      if (body.socio_id && !conv.socio_id) await sb().from("conversaciones").update({ socio_id: body.socio_id, etapa: "Socio" }).eq("id", conv.id);
      if (email && !conv.email) await sb().from("conversaciones").update({ email }).eq("id", conv.id).then(() => null, () => null);
      return json({ id: conv.id });
    }

    case "ia": {
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      const conv = await conversacion(body.conversacion_id);
      const hasta = body.pausar ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;
      await sb().from("conversaciones").update({ ia_pausada_hasta: hasta }).eq("id", conv.id);
      return json({ ok: true, ia_pausada_hasta: hasta });
    }

    case "sugerir": {
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      if (!iaConfigurada()) throw new HttpError(400, "La IA no está configurada (GEMINI_API_KEY).");
      const conv = await conversacion(body.conversacion_id);
      const h = await historial(conv.id, undefined, 14);
      const borrador = await redactar(
        `Sos parte del equipo del Centro Comercial e Industrial de Paraná (CeCIP). Redactá la próxima respuesta a esta conversación, en español rioplatense, cordial y profesional (trato de vos), ${conv.telefono ? "corta para WhatsApp" : "como email breve"}. No inventes datos, montos ni fechas: si falta información, dejá [completar]. Respondé solo con el texto del mensaje.`,
        `${conv.socio_id ? "Es socio del CeCIP." : "No es socio."}${conv.resumen ? `\nResumen: ${conv.resumen}` : ""}\n\n${h.map((m) => `${m.rol === "contacto" ? "Contacto" : "CeCIP"}: ${m.texto}`).join("\n")}`,
      );
      return json({ texto: borrador });
    }

    case "vincular":
      return json(await generarCodigo(caller.userId));

    case "desvincular": {
      const { data: n } = await sb().from("staff_whatsapp").select("id, user_id").eq("id", String(body.id || "")).maybeSingle();
      if (!n) throw new HttpError(404, "Número inexistente.");
      if (n.user_id !== caller.userId && caller.staff!.rol !== "admin") throw new HttpError(403, "Solo podés desvincular tus números.");
      await sb().from("staff_whatsapp").delete().eq("id", n.id);
      return json({ ok: true });
    }

    case "email-sincronizar":
      requireStaff(caller, [...PUEDEN_RESPONDER]);
      return json(await sincronizarEmail("manual"));

    case "whatsapp-qr":
      soloAdmin(caller);
      return json(await qrInstancia());

    case "whatsapp-webhook-config": {
      soloAdmin(caller);
      const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;
      if (!secreto) throw new HttpError(400, "Falta WHATSAPP_WEBHOOK_SECRET en el servidor.");
      const url = `${new URL(req.url).origin}/api/canales/whatsapp-webhook?secret=${encodeURIComponent(secreto)}`;
      await configurarWebhook(url);
      return json({ ok: true, url: url.replace(encodeURIComponent(secreto), "…") });
    }

    case "email-conectar": {
      soloAdmin(caller);
      const host = String(body.host || "").trim(), usuario = String(body.usuario || "").trim(), password = String(body.password || "");
      if (!host || !usuario || !password) throw new HttpError(400, "Completá servidor, usuario y contraseña.");
      await conectarCasilla({ host, puerto: Number(body.puerto) || 993, usuario, password, carpeta: String(body.carpeta || "INBOX") }, caller.userId);
      return json(await estadoCasilla());
    }

    case "email-desconectar":
      soloAdmin(caller);
      await desconectarCasilla();
      return json({ ok: true });

    default:
      throw new HttpError(404, "Acción inexistente.");
  }
});
