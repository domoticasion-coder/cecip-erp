import { HttpError, env } from "./core.js";

export interface EmailMessage {
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  to: string;
  ok: boolean;
  error?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convierte texto plano en HTML simple: párrafos, saltos de línea y links clickeables. */
export function textToHtml(text: string): string {
  return escapeHtml(text.trim())
    .split(/\n{2,}/)
    .map((p) =>
      `<p style="margin:0 0 14px">${p
        .replace(/\n/g, "<br>")
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1d4ed8">$1</a>')}</p>`
    )
    .join("");
}

export function emailLayout(opts: {
  titulo: string;
  cuerpoHtml: string;
  boton?: { texto: string; url: string };
  pie?: string;
  imagenUrl?: string | null;
}): string {
  const logo = `${env.portalUrl()}/logo.png`;
  const boton = opts.boton
    ? `<p style="margin:24px 0"><a href="${opts.boton.url}" style="background:#0f3d75;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(opts.boton.texto)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0f3d75;padding:18px 28px"><img src="${logo}" alt="CeCIP Paraná" height="40" style="display:block;height:40px"></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 18px;color:#0f3d75">${escapeHtml(opts.titulo)}</h1>
${opts.imagenUrl && /^https:\/\//.test(opts.imagenUrl) ? `<img src="${escapeHtml(opts.imagenUrl)}" alt="" style="display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 18px">` : ""}
${opts.cuerpoHtml}
${boton}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#64748b">
${opts.pie ? escapeHtml(opts.pie) + "<br>" : ""}Centro Comercial e Industrial de Paraná · <a href="${env.portalUrl()}" style="color:#64748b">Portal de socios</a>
</td></tr></table></td></tr></table></body></html>`;
}

/**
 * Envía emails con Resend en lotes de hasta 100. Devuelve el resultado de cada mensaje, en el mismo
 * orden. Las direcciones inválidas (por ejemplo con tildes o espacios invisibles copiados de un Excel)
 * quedan con error sin enviarse, para que Resend no rechace el lote entero; si igual rechaza un lote,
 * se reintenta de a uno para que solo falle el que tiene el problema.
 */
export async function sendEmails(messages: EmailMessage[]): Promise<SendResult[]> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new HttpError(500, "El envío de emails no está configurado (RESEND_API_KEY / EMAIL_FROM).");
  }
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;
  const cuerpo = (m: EmailMessage) => ({
    from, to: [m.to.trim()], cc: m.cc?.length ? m.cc : undefined, subject: m.subject, html: m.html, text: m.text, reply_to: replyTo,
  });

  const results: SendResult[] = messages.map((m) => ({ to: m.to, ok: false, error: "No enviado" }));
  const validos: number[] = [];
  messages.forEach((m, i) => {
    if (!emailValido(m.to)) {
      results[i] = { to: m.to, ok: false, error: "Dirección de email inválida (revisá tildes, ñ o espacios en la ficha del socio)." };
      return;
    }
    // las copias inválidas se descartan sin frenar el envío principal
    m.cc = (m.cc || []).map((c) => c.trim()).filter((c) => emailValido(c));
    validos.push(i);
  });

  const enviarUno = async (i: number) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo(messages[i])),
      });
      results[i] = res.ok ? { to: messages[i].to, ok: true } : { to: messages[i].to, ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    } catch (err) {
      results[i] = { to: messages[i].to, ok: false, error: String(err) };
    }
  };

  for (let k = 0; k < validos.length; k += 100) {
    const lote = validos.slice(k, k + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(lote.map((i) => cuerpo(messages[i]))),
      });
      if (res.ok) {
        lote.forEach((i) => (results[i] = { to: messages[i].to, ok: true }));
      } else if (res.status === 422 || res.status === 400) {
        // algún mensaje del lote tiene un problema: de a uno, así solo falla ese
        for (const i of lote) await enviarUno(i);
      } else {
        const body = await res.text();
        lote.forEach((i) => (results[i] = { to: messages[i].to, ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` }));
      }
    } catch (err) {
      lote.forEach((i) => (results[i] = { to: messages[i].to, ok: false, error: String(err) }));
    }
  }
  return results;
}

/** Email válido: sin espacios, con @ y dominio, y solo caracteres ASCII (las direcciones no admiten tildes ni ñ). */
export const emailValido = (e?: string | null): e is string => !!e && /^[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+$/.test(e.trim()) && !/@.*@/.test(e.trim());
