/**
 * IA de los canales (Gemini): conversación con herramientas (function calling), transcripción de
 * audios y lectura de documentos/emails con respuesta en JSON. Prueba los modelos en orden
 * (GEMINI_MODEL primero) igual que el Copiloto.
 */
import { MODELOS } from "../copilot.js";

export type Parte = { text?: string; inlineData?: { mimeType: string; data: string }; functionCall?: any; functionResponse?: any };
export type Turno = { role: "user" | "model"; parts: Parte[] };

export interface Declaracion {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const modelos = () => [process.env.GEMINI_MODEL, ...MODELOS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

export const iaConfigurada = () => Boolean(process.env.GEMINI_API_KEY);

/** Una llamada a generateContent con respaldo de modelos. Devuelve el contenido del candidato. */
async function generar(cuerpo: Record<string, unknown>): Promise<{ parts: Parte[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY.");
  const body = JSON.stringify(cuerpo);
  let ultimo = "";
  for (const modelo of modelos()) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        ultimo = `${modelo}: ${res.status} ${json?.error?.message || ""}`;
        if ((res.status === 401 || res.status === 403) && !/not found|not supported/i.test(json?.error?.message || "")) break;
        continue;
      }
      const content = json?.candidates?.[0]?.content;
      if (content?.parts?.length) return content;
      ultimo = `${modelo}: respuesta vacía`;
    } catch (err) {
      ultimo = `${modelo}: ${String(err)}`;
    }
  }
  throw new Error(`La IA no está disponible (${ultimo}).`);
}

const textoDe = (c: { parts: Parte[] }) => c.parts.map((p) => p.text || "").join("").trim();

/**
 * Conversación con herramientas: la IA puede pedir ejecutar funciones (consultar la cuenta del
 * socio, generar un link de pago, derivar a un área…) y con los resultados arma la respuesta.
 */
export async function conversarConHerramientas(opts: {
  sistema: string;
  turnos: Turno[];
  declaraciones: Declaracion[];
  ejecutar: (nombre: string, args: Record<string, any>) => Promise<unknown>;
  maxRondas?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const contents: Turno[] = [...opts.turnos];
  for (let ronda = 0; ronda < (opts.maxRondas ?? 5); ronda++) {
    const c = await generar({
      systemInstruction: { parts: [{ text: opts.sistema }] },
      contents,
      tools: opts.declaraciones.length ? [{ functionDeclarations: opts.declaraciones }] : undefined,
      generationConfig: { temperature: 0.3, maxOutputTokens: opts.maxTokens ?? 900 },
    });
    const llamadas = c.parts.filter((p) => p.functionCall);
    if (!llamadas.length) return textoDe(c) || null;
    contents.push({ role: "model", parts: c.parts });
    const respuestas: Parte[] = [];
    for (const p of llamadas) {
      const fc = p.functionCall;
      const resultado = await opts.ejecutar(fc.name, fc.args || {}).catch((err: any) => ({ error: err?.message || String(err) }));
      respuestas.push({ functionResponse: { id: fc.id, name: fc.name, response: { resultado: JSON.stringify(resultado).slice(0, 12_000) } } });
    }
    contents.push({ role: "user", parts: respuestas });
  }
  return null;
}

export const MAX_SEGUNDOS_AUDIO = 300;

/** Pasa a texto una nota de voz (hasta 5 minutos). */
export async function transcribirAudio(base64: string, mime: string): Promise<string> {
  const tipo = /ogg|opus/.test(mime) ? "audio/ogg" : /mpeg|mp3/.test(mime) ? "audio/mp3" : /mp4|m4a|aac/.test(mime) ? "audio/aac" : /wav/.test(mime) ? "audio/wav" : "audio/ogg";
  const c = await generar({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: tipo, data: base64 } },
      { text: "Transcribí este audio en español tal cual se dice, sin agregar comentarios ni encabezados. Si no se entiende nada, respondé exactamente: [inaudible]" },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1500 },
  });
  return textoDe(c).replace(/^["«]|["»]$/g, "").trim();
}

/** Pide a la IA un JSON (para clasificar emails o leer comprobantes). Devuelve null si no se pudo leer. */
export async function analizarJson<T>(instrucciones: string, partes: Parte[], maxTokens = 1200): Promise<T | null> {
  const c = await generar({
    systemInstruction: { parts: [{ text: instrucciones }] },
    contents: [{ role: "user", parts: partes }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  });
  const t = textoDe(c).replace(/^```(json)?|```$/g, "").trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/** Respuesta de texto simple (resúmenes, borradores de respuesta). */
export async function redactar(instrucciones: string, texto: string, maxTokens = 700): Promise<string> {
  const c = await generar({
    systemInstruction: { parts: [{ text: instrucciones }] },
    contents: [{ role: "user", parts: [{ text: texto }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
  });
  return textoDe(c);
}
