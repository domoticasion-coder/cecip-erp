import { HttpError, env } from "./core.js";

export interface EmailMessage {
  to: string;
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
${opts.cuerpoHtml}
${boton}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#64748b">
${opts.pie ? escapeHtml(opts.pie) + "<br>" : ""}Centro Comercial e Industrial de Paraná · <a href="${env.portalUrl()}" style="color:#64748b">Portal de socios</a>
</td></tr></table></td></tr></table></body></html>`;
}

/** Envía emails con Resend en lotes de hasta 100. Devuelve el resultado de cada destinatario. */
export async function sendEmails(messages: EmailMessage[]): Promise<SendResult[]> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new HttpError(500, "El envío de emails no está configurado (RESEND_API_KEY / EMAIL_FROM).");
  }
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;

  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((m) => ({
            from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            reply_to: replyTo,
          }))
        ),
      });
      if (!res.ok) {
        const body = await res.text();
        chunk.forEach((m) => results.push({ to: m.to, ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` }));
      } else {
        chunk.forEach((m) => results.push({ to: m.to, ok: true }));
      }
    } catch (err) {
      chunk.forEach((m) => results.push({ to: m.to, ok: false, error: String(err) }));
    }
  }
  return results;
}

export const emailValido = (e?: string | null): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
