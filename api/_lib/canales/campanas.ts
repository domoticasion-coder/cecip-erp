/**
 * Tareas periódicas de los canales (las dispara el cron cada pocos minutos):
 *  - Campañas de WhatsApp en modo automático: salen desde el número del CeCIP de a poco,
 *    en horario, con tope diario, respetando las BAJAS y con el link de pago de cada socio.
 *  - Seguimientos: a quien no es socio y dejó una consulta abierta, la IA le escribe para
 *    retomarla (como máximo los configurados).
 */
import { crearLinkPago } from "../pagos.js";
import { env } from "../core.js";
import { ajustes, asegurarConversacion, enviarWhatsapp, guardarArchivo, historial, rutaNueva, sb, type Ajustes } from "./base.js";
import { evolutionConfig } from "./evolution.js";
import { iaConfigurada, redactar } from "./ia.js";

const POR_CORRIDA = 6;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function horaArgentina() {
  const ahora = new Date();
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(ahora).map((p) => [p.type, p.value]));
  return { hhmm: `${partes.hour}:${partes.minute}`, domingo: partes.weekday === "Sun", fecha: ahora.toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }) };
}

export function enHorario(a: Ajustes) {
  const h = horaArgentina();
  return !h.domingo && h.hhmm >= a.campanas_desde && h.hhmm <= a.campanas_hasta;
}

async function imagenDeCampana(url: string | null, cache: Map<string, { ruta: string; nombre: string; mime: string } | null>) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    const nombre = url.split("/").pop()?.split("?")[0] || "imagen.jpg";
    const ruta = await guardarArchivo(rutaNueva("campanas", nombre, mime), Buffer.from(await res.arrayBuffer()), mime);
    cache.set(url, { ruta, nombre, mime });
  } catch {
    cache.set(url, null);
  }
  return cache.get(url)!;
}

export async function enviarCampanas() {
  const a = await ajustes();
  if (!evolutionConfig().configurado || !enHorario(a)) return { enviados: 0, motivo: "fuera de horario o sin WhatsApp" };

  const { fecha } = horaArgentina();
  const { count: hoy } = await sb().from("wa_mensajes").select("id", { count: "exact", head: true })
    .eq("estado", "enviado").eq("origen", "cecip").gte("enviado_at", new Date(`${fecha}T00:00:00-03:00`).toISOString());
  const cupo = Math.min(POR_CORRIDA, a.campanas_tope_diario - (hoy || 0));
  if (cupo <= 0) return { enviados: 0, motivo: "tope diario alcanzado" };

  const { data: camps } = await sb().from("wa_campanas").select("id, imagen_url").eq("modo", "automatico").eq("estado", "activa").eq("origen", "cecip").order("created_at");
  if (!camps?.length) return { enviados: 0 };
  const imagenes = new Map<string, { ruta: string; nombre: string; mime: string } | null>();
  let enviados = 0;

  for (const camp of camps) {
    if (enviados >= cupo) break;
    const { data: pend } = await sb().from("wa_mensajes").select("*").eq("campana_id", camp.id).eq("estado", "pendiente").order("orden").limit(cupo - enviados);
    if (!pend?.length) {
      await sb().from("wa_campanas").update({ estado: "finalizada" }).eq("id", camp.id);
      continue;
    }
    for (const m of pend) {
      // las bajas no reciben difusiones
      const { data: socio } = m.socio_id ? await sb().from("socios").select("whatsapp_baja").eq("id", m.socio_id).maybeSingle() : { data: null };
      const { conv } = await asegurarConversacion({ telefono: m.telefono, nombre: m.nombre });
      if (socio?.whatsapp_baja || conv.baja_at || conv.staff_user_id) {
        await sb().from("wa_mensajes").update({ estado: "omitido", error: "Pidió la baja de difusiones" }).eq("id", m.id);
        continue;
      }
      let texto: string = m.mensaje;
      if (m.usa_link_pago || /\{\{\s*link_pago\s*\}\}/i.test(texto)) {
        let link = "";
        if (m.socio_id) {
          try { link = (await crearLinkPago(m.socio_id, null, null)).url; } catch { link = ""; }
        }
        texto = texto.replace(/\{\{\s*link_pago\s*\}\}/gi, link || `el Portal de Socios (${env.portalUrl()}/cuotas)`);
      }
      const ok = await enviarWhatsapp(conv, texto, { autor: "sistema", archivo: await imagenDeCampana(camp.imagen_url, imagenes) });
      await sb().from("wa_mensajes").update(ok
        ? { estado: "enviado", mensaje: texto, enviado_at: new Date().toISOString(), error: null }
        : { estado: "error", error: "No se pudo enviar (ver la conversación en la Bandeja)" }).eq("id", m.id);
      if (ok) {
        enviados++;
        await sb().from("envios").insert({ socio_id: m.socio_id, canal: "whatsapp", tipo: "comunicado", asunto: "Campaña de WhatsApp", destinatario: m.telefono, estado: "enviado" });
      }
      if (enviados >= cupo) break;
      await pausa(2500 + Math.random() * 3500); // espacio entre mensajes, para no parecer un envío masivo
    }
  }
  return { enviados };
}

export async function enviarSeguimientos() {
  const a = await ajustes();
  if (!evolutionConfig().configurado || !iaConfigurada() || !a.ia_activa || !a.max_seguimientos || !enHorario(a)) return { enviados: 0 };
  const ahora = new Date().toISOString();
  const { data } = await sb().from("conversaciones").select("*")
    .is("socio_id", null).is("staff_user_id", null).is("baja_at", null).not("telefono", "is", null)
    .in("etapa", ["Consultando", "Interesado"]).lte("seguimiento_at", ahora).lt("seguimientos_enviados", a.max_seguimientos).limit(3);
  let enviados = 0;
  for (const conv of data || []) {
    if (conv.ia_pausada_hasta && conv.ia_pausada_hasta > ahora) continue;
    const h = await historial(conv.id, undefined, 10);
    const texto = await redactar(
      `Sos el asistente del Centro Comercial e Industrial de Paraná (CeCIP). Escribí UN mensaje corto de WhatsApp (máximo 3 líneas, español rioplatense, cordial, trato de vos) para retomar la consulta de esta persona y ofrecer ayuda. No inventes datos, precios ni fechas. No uses comillas. Si la conversación terminó con una despedida clara o la persona no quiere más contacto, respondé exactamente: NADA`,
      `Resumen: ${conv.resumen || "—"}\nInterés: ${conv.interes || "—"}\nConversación:\n${h.map((m) => `${m.rol === "contacto" ? "Persona" : "CeCIP"}: ${m.texto}`).join("\n")}`,
      200,
    ).catch(() => "NADA");
    const proximo = new Date(Date.now() + a.seguimiento_dias * 86_400_000).toISOString();
    if (!texto || /^NADA\b/.test(texto.trim())) {
      await sb().from("conversaciones").update({ seguimiento_at: null }).eq("id", conv.id);
      continue;
    }
    if (await enviarWhatsapp(conv, texto.trim(), { autor: "ia" })) enviados++;
    await sb().from("conversaciones").update({ seguimientos_enviados: conv.seguimientos_enviados + 1, seguimiento_at: proximo }).eq("id", conv.id);
  }
  return { enviados };
}
