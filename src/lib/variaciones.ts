/**
 * Arma un mensaje de WhatsApp distinto para cada socio, para que una difusión no sean
 * cientos de textos idénticos (lo que WhatsApp detecta como spam). Combina:
 *  - variantes del mensaje (escritas a mano o generadas por IA),
 *  - alternativas {opción 1|opción 2|opción 3} dentro del texto,
 *  - saludos, despedidas y avisos de BAJA que cambian en cada envío,
 *  - datos de cada socio: {{nombre}}, {{empresa}}, {{deuda}} y {{link_pago}}.
 */

const azar = <T,>(lista: readonly T[]): T => lista[Math.floor(Math.random() * lista.length)];

const SALUDOS = [
  "Hola {{nombre}}!",
  "¡Hola, {{nombre}}!",
  "Hola {{nombre}}, ¿cómo estás?",
  "¿Qué tal, {{nombre}}?",
  "{{nombre}}, ¿cómo va?",
  "Hola {{nombre}}, ¿todo bien?",
  "¡Buenas, {{nombre}}!",
  "Hola {{nombre}}, esperamos que estés muy bien.",
];

const CIERRES = [
  "Saludos, equipo del CeCIP.",
  "¡Gracias! Centro Comercial e Industrial de Paraná.",
  "Un saludo grande, Administración CeCIP.",
  "Quedamos a disposición. CeCIP Paraná.",
  "Cualquier consulta, escribinos por acá. Saludos!",
  "Abrazo, equipo CeCIP.",
  "Muchas gracias por ser parte del CeCIP.",
];

const CIERRES_COMERCIA = [
  "Saludos, equipo de ComercIA.",
  "¡Gracias! ComercIA Inteligente · Instituto IEC.",
  "Un saludo, equipo FactorIA.",
  "Quedamos a disposición. ComercIA · convenio CeCIP + IEC.",
  "Cualquier consulta, escribinos por acá. ¡Saludos!",
  "Abrazo, equipo de ComercIA.",
];

const BAJAS = [
  "Si preferís no recibir estos mensajes, respondé BAJA.",
  "Para no recibir más avisos por acá, respondé BAJA.",
  "¿No querés recibir más difusiones? Respondé BAJA y te quitamos de la lista.",
  "Si no querés recibir estos avisos, contestá BAJA.",
];

export interface OpcionesVariacion {
  saludo: boolean;
  cierre: boolean;
  baja: boolean;
  /** Quién firma la despedida (por defecto el CeCIP) */
  remitente?: "cecip" | "comercia";
}

export interface DatosDestinatario {
  nombre: string; // cómo se lo saluda (persona de contacto o comercio)
  empresa: string;
  deuda: string; // ya formateada en pesos
}

/** Resuelve {a|b|c} eligiendo una opción al azar (respeta las variables {{...}}) */
export function resolverAlternativas(texto: string): string {
  let t = texto;
  const re = /\{([^{}]*\|[^{}]*)\}/;
  for (let i = 0; i < 50 && re.test(t); i++) {
    t = t.replace(re, (_, opciones: string) => azar(opciones.split("|")));
  }
  return t;
}

const empiezaConSaludo = (t: string) => /^\s*(¡?hola|buen[oa]s?|¿?qu[eé] tal|estimad[oa])/i.test(t);
// Si la variante ya cierra con un saludo, no se le agrega otra despedida
const terminaConDespedida = (t: string) =>
  /(saludos?( cordiales)?|much[ao]s gracias|¡?gracias!?|abrazo|un saludo|quedamos a (tu )?disposici[oó]n)[\s.!🙌🙂😊💳📢👋]*$/i.test(t.trim());

/** Arma el texto final para un destinatario ({{link_pago}} se completa recién al enviar) */
export function armarMensaje(variantes: string[], datos: DatosDestinatario, op: OpcionesVariacion): string {
  let cuerpo = resolverAlternativas(azar(variantes.length ? variantes : [""])).trim();
  const partes: string[] = [];
  if (op.saludo && !empiezaConSaludo(cuerpo)) partes.push(azar(SALUDOS));
  partes.push(cuerpo);
  if (op.cierre && !terminaConDespedida(cuerpo)) partes.push(azar(op.remitente === "comercia" ? CIERRES_COMERCIA : CIERRES));
  if (op.baja) partes.push(azar(BAJAS));
  cuerpo = partes.filter(Boolean).join(Math.random() < 0.5 ? "\n\n" : "\n");
  return reemplazarVariables(cuerpo, datos);
}

export function reemplazarVariables(texto: string, d: DatosDestinatario): string {
  return texto
    .replace(/\{\{\s*nombre\s*\}\}/gi, d.nombre)
    .replace(/\{\{\s*empresa\s*\}\}/gi, d.empresa)
    .replace(/\{\{\s*deuda\s*\}\}/gi, d.deuda);
}

export const usaLinkPago = (t: string) => /\{\{\s*link_pago\s*\}\}/i.test(t);

/** Nombre con el que se saluda: primer nombre del contacto, o el nombre del comercio */
export function nombreParaSaludo(contacto: string | null | undefined, comercio: string): string {
  const primero = (contacto || "").trim().split(/\s+/)[0];
  if (primero && primero.length > 2) return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
  return comercio;
}

/** Mezcla una lista (para que el orden de envío no siga el padrón) */
export function mezclar<T>(lista: T[]): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Link de WhatsApp: Web (escritorio, reutiliza la misma pestaña) o app (celular / WhatsApp Desktop) */
export function linkWhatsapp(numero: string, texto: string, modo: "web" | "app"): string {
  const t = encodeURIComponent(texto);
  return modo === "web" ? `https://web.whatsapp.com/send?phone=${numero}&text=${t}` : `https://wa.me/${numero}?text=${t}`;
}
