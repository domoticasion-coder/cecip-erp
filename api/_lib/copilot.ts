import { HttpError, supabaseAdmin } from "./core.js";
import { armarContexto } from "../../shared/copilotContexto.js";

export interface Mensaje {
  rol: "usuario" | "copiloto";
  texto: string;
}

// Modelos de Gemini a probar en orden (el primero que responda). GEMINI_MODEL tiene prioridad.
const MODELOS = [
  "gemini-3.1-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
];

/** Busca los datos actualizados del socio y arma el contexto que recibe la IA. */
export async function contextoSocio(socioId: string | null): Promise<string> {
  const sb = supabaseAdmin();
  const ahora = new Date().toISOString();
  const hoy = new Date().toISOString().slice(0, 10);
  const [cfg, socio, cuotas, comunicados, eventos, conocimiento, ofertas, servicios, cursos, promociones, convenio, novedades] = await Promise.all([
    sb.from("configuracion").select("*").eq("id", 1).single(),
    socioId ? sb.from("socios_resumen").select("*").eq("id", socioId).single() : Promise.resolve({ data: null }),
    socioId ? sb.from("cuotas_detalle").select("concepto, vencimiento, total, situacion, estado, fecha_pago").eq("socio_id", socioId).neq("estado", "anulada").order("vencimiento", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    sb.from("comunicados").select("titulo, cuerpo, fecha_publicacion").eq("publicado", true).order("fecha_publicacion", { ascending: false }).limit(8),
    sb.from("eventos").select("titulo, descripcion, tipo, fecha_inicio, lugar, modalidad, costo, cupo, inscripcion_abierta").eq("publicado", true).gte("fecha_inicio", ahora).order("fecha_inicio").limit(10),
    sb.from("conocimiento_cecip").select("titulo, contenido").eq("activo", true).order("orden"),
    sb.from("comercia_ofertas").select("*").eq("activa", true).order("orden"),
    sb.from("iec_servicios").select("*").eq("activo", true).order("orden"),
    sb.from("iec_cursos").select("*").eq("activo", true).order("orden"),
    sb.from("comercia_promociones").select("*").eq("activa", true).or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`).order("orden"),
    sb.from("comercia_convenio").select("*").eq("activo", true).order("orden"),
    sb.from("comercia_novedades").select("titulo, cuerpo").eq("publicada", true).order("orden").limit(6),
  ]);
  return armarContexto({
    cfg: cfg.data, socio: socio.data, cuotas: cuotas.data || [], comunicados: comunicados.data || [], eventos: eventos.data || [],
    conocimiento: conocimiento.data || [], ofertas: ofertas.data || [], servicios: servicios.data || [], cursos: cursos.data || [],
    promociones: promociones.data || [], convenio: convenio.data || [], novedades: novedades.data || [],
  });
}

const INSTRUCCIONES = `Sos el Copiloto del Centro Comercial e Industrial de Paraná (CeCIP), el asistente virtual oficial del Portal de Socios.
Tu tarea es dar información clara y precisa sobre el CeCIP, la cuenta del socio que te escribe, sus cuotas y formas de pago, los comunicados, eventos y capacitaciones, los beneficios para socios y el programa ComercIA (ofertas para su comercio, IEC Services y cursos IEC).

REGLAS
1. Respondé SOLO con la información del CONTEXTO. Si algo no está, decilo con honestidad y sugerí contactar a la administración del CeCIP (teléfono, WhatsApp o email del contexto). Nunca inventes datos, montos, fechas, nombres ni teléfonos.
2. Español rioplatense, cálido y profesional (trato de "vos"). Respuestas breves y concretas: 2 a 6 oraciones o una lista corta.
3. Para pagar: indicá que puede hacerlo desde "Mis cuotas" con el botón de Mercado Pago, o por transferencia con los datos del contexto.
4. Para ofertas de ComercIA o servicios/cursos de IEC, indicá el camino exacto en el portal: sección "ComercIA" → pestaña "Ofertas para tu comercio", "IEC Services" (técnicos: electricidad, gas, cámaras, etc.) o "Cursos IEC" → botón "Pedir información", que lo conecta por WhatsApp con FactorIA. No derives estos pedidos a la administración del CeCIP.
5. Nunca reveles datos de otros socios. No des asesoramiento legal, contable o financiero personalizado: derivá al gabinete de asesoramiento gratuito del CeCIP.
6. Formato: texto simple con **negritas** puntuales y listas con "- ". Sin tablas ni encabezados.`;

type Turno = { role: "user" | "model"; parts: { text: string }[] };

/**
 * Llamada genérica a Gemini con reintento en otros modelos. Devuelve el texto de la respuesta.
 * La usan el Copiloto y el generador de variantes de mensajes de WhatsApp.
 */
export async function llamarGemini(sistema: string, turnos: Turno[], config: Record<string, unknown>, quien = "La IA"): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(500, `${quien} no está configurada (falta GEMINI_API_KEY).`);

  const body = JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents: turnos, generationConfig: config });
  const modelos = [process.env.GEMINI_MODEL, ...MODELOS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
  let ultimoError = "";
  for (const modelo of modelos) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        ultimoError = `${modelo}: ${res.status} ${json?.error?.message || ""}`;
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          // Clave inválida o pedido mal formado: no tiene sentido probar otros modelos
          if (!/not found|not supported/i.test(json?.error?.message || "")) break;
        }
        continue;
      }
      const texto = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (texto) return texto;
      ultimoError = `${modelo}: respuesta vacía`;
    } catch (err) {
      ultimoError = `${modelo}: ${String(err)}`;
    }
  }
  console.error("[gemini] falló:", ultimoError);
  throw new HttpError(502, `${quien} no está disponible en este momento. Probá de nuevo en unos minutos.`);
}

/** Copiloto: arma la conversación y consulta a Gemini. */
export async function preguntarGemini(contexto: string, historial: Mensaje[], pregunta: string, instrucciones = INSTRUCCIONES): Promise<string> {
  // Gemini exige que la conversación empiece por el usuario y alterne roles
  const turnos: Turno[] = [];
  for (const m of [...historial.slice(-12), { rol: "usuario" as const, texto: pregunta }]) {
    const role = m.rol === "usuario" ? "user" : "model";
    const texto = String(m.texto || "").slice(0, 2000);
    if (!texto.trim()) continue;
    const ultimo = turnos[turnos.length - 1];
    if (ultimo?.role === role) ultimo.parts[0].text += "\n" + texto;
    else turnos.push({ role, parts: [{ text: texto }] });
  }
  while (turnos[0]?.role === "model") turnos.shift();

  const largo = instrucciones === INSTRUCCIONES ? 900 : 2500; // en el ERP se piden redacciones y listados más largos
  return llamarGemini(`${instrucciones}\n\n=== CONTEXTO ===\n${contexto}`, turnos, { temperature: 0.3, maxOutputTokens: largo }, "El Copiloto");
}

const INSTRUCCIONES_VARIANTES = (n: number) => `Sos redactor del Centro Comercial e Industrial de Paraná (CeCIP). Reescribís mensajes de WhatsApp que la institución envía a sus socios.
Generá ${n} versiones DISTINTAS del mensaje que te pasen, con el mismo significado y la misma información.
Reglas:
- Español rioplatense, cordial y profesional (trato de "vos").
- Variá el saludo, el orden de las frases, la longitud y el vocabulario: que ninguna versión se parezca demasiado a otra.
- Conservá EXACTAMENTE las variables entre llaves dobles, como {{nombre}}, {{empresa}}, {{deuda}} o {{link_pago}}, sin traducirlas ni modificarlas.
- No agregues datos, montos, fechas ni links que no estén en el original. Como máximo un emoji por versión.
- Respondé SOLO con un array JSON de strings, sin texto adicional.`;

/**
 * Genera reescrituras de un mensaje de difusión para que cada socio reciba un texto distinto.
 * Descarta las versiones que pierdan alguna variable {{...}} del original.
 */
export async function variantesGemini(mensaje: string, cantidad: number): Promise<string[]> {
  const n = Math.max(2, Math.min(10, Math.round(cantidad)));
  const texto = await llamarGemini(
    INSTRUCCIONES_VARIANTES(n),
    [{ role: "user", parts: [{ text: mensaje.slice(0, 2000) }] }],
    { temperature: 1, maxOutputTokens: 2500, responseMimeType: "application/json" },
    "La IA"
  );

  let lista: unknown;
  try {
    lista = JSON.parse(texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
  } catch {
    throw new HttpError(502, "La IA no devolvió variantes válidas. Probá de nuevo.");
  }
  const sinEspacios = (t: string) => t.replace(/\s+/g, "");
  const variables = (mensaje.match(/\{\{\s*\w+\s*\}\}/g) || []).map(sinEspacios);
  return (Array.isArray(lista) ? lista : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .filter((x) => variables.every((v) => sinEspacios(x).includes(v)))
    .slice(0, n);
}
