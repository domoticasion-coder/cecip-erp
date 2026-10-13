/**
 * Normaliza un teléfono argentino al formato que usa WhatsApp (549 + característica + número).
 * Acepta "343 4551234", "0343-155-551234", "+54 9 343 4551234", etc.
 * Si no se puede interpretar devuelve null.
 */
export function normalizarWhatsapp(tel: string | null | undefined): string | null {
  let d = (tel || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("549") && d.length === 13) return d;
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // Quitar el "15" después de la característica (ej. 343 15 4551234)
  for (const len of [2, 3, 4]) {
    if (d.length === 12 && d.slice(len, len + 2) === "15") {
      d = d.slice(0, len) + d.slice(len + 2);
      break;
    }
  }
  // Número local de Paraná sin característica (7 dígitos)
  if (d.length === 7) d = "343" + d;
  if (d.length !== 10) return null;
  return "549" + d;
}

export function whatsappLink(tel: string | null | undefined, texto: string): string | null {
  const n = normalizarWhatsapp(tel);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

export function abrirWhatsapp(tel: string | null | undefined, texto: string): boolean {
  const url = whatsappLink(tel, texto);
  if (!url) return false;
  window.open(url, "_blank", "noopener");
  return true;
}

/** WhatsApp de FactorIA por defecto (variable VITE_FACTORIA_WHATSAPP). Se puede definir desde ERP > Contenido. */
export const FACTORIA_WHATSAPP = (import.meta.env.VITE_FACTORIA_WHATSAPP as string | undefined)?.trim() || "";

/** Abre WhatsApp de FactorIA con el mensaje. Devuelve false si no hay número configurado. */
export function abrirWhatsappFactoria(texto: string, numero?: string | null): boolean {
  return abrirWhatsapp(numero?.trim() || FACTORIA_WHATSAPP, texto);
}
