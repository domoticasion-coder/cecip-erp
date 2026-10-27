/**
 * Recibo de una cuota pagada en PDF (para enviarlo por WhatsApp o email).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { env, pesos } from "../core.js";
import { sb } from "./base.js";

const fecha = (d?: string | null) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-AR") : "—");

export async function reciboPdf(cuotaId: string): Promise<{ base64: string; nombre: string; mime: string; socioId: string }> {
  const { data: c } = await sb().from("cuotas").select("*").eq("id", cuotaId).maybeSingle();
  if (!c) throw new Error("No se encontró la cuota.");
  if (c.estado !== "pagada" || !c.recibo_numero) throw new Error("La cuota todavía no está pagada: no tiene recibo.");
  const [{ data: s }, { data: cfg }] = await Promise.all([
    sb().from("socios").select("razon_social, nombre_comercial, cuit, numero_socio, direccion, localidad").eq("id", c.socio_id).single(),
    sb().from("configuracion").select("cuit, direccion, telefono, email").eq("id", 1).maybeSingle(),
  ]);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 420]); // A5 apaisado
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const azul = rgb(0.06, 0.24, 0.46);
  const gris = rgb(0.4, 0.45, 0.5);
  const t = (txt: string, x: number, y: number, size = 10, font = f, color = rgb(0.1, 0.12, 0.16)) =>
    page.drawText(txt, { x, y, size, font, color });

  // Logo (si se puede bajar)
  try {
    const res = await fetch(`${env.portalUrl()}/logo.png`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const img = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()));
      const w = 120;
      page.drawImage(img, { x: 36, y: 345, width: w, height: (img.height / img.width) * w });
    }
  } catch {
    t("CeCIP", 36, 370, 22, b, azul);
  }

  t("RECIBO", 420, 380, 18, b, azul);
  t(`N° ${String(c.recibo_numero).padStart(6, "0")}`, 420, 362, 11, b);
  t(`Fecha: ${fecha(c.fecha_pago)}`, 420, 347, 10);

  t("Centro Comercial e Industrial de Paraná", 36, 322, 10, b);
  t([cfg?.cuit && `CUIT ${cfg.cuit}`, cfg?.direccion, cfg?.telefono].filter(Boolean).join(" · ") || "Paraná, Entre Ríos", 36, 308, 9, f, gris);

  page.drawLine({ start: { x: 36, y: 295 }, end: { x: 559, y: 295 }, thickness: 1, color: rgb(0.85, 0.88, 0.92) });

  t("Recibimos de", 36, 272, 9, f, gris);
  t(`${s?.razon_social || ""}${s?.nombre_comercial ? ` (${s.nombre_comercial})` : ""}`.slice(0, 80), 36, 257, 12, b);
  t([s?.numero_socio && `Socio N° ${s.numero_socio}`, s?.cuit && `CUIT ${s.cuit}`].filter(Boolean).join(" · "), 36, 243, 9, f, gris);

  t("En concepto de", 36, 215, 9, f, gris);
  t(String(c.concepto).slice(0, 80), 36, 200, 11);

  let y = 170;
  const fila = (k: string, v: string, negrita = false) => {
    t(k, 300, y, 10, negrita ? b : f);
    const ancho = (negrita ? b : f).widthOfTextAtSize(v, 10);
    t(v, 559 - ancho, y, 10, negrita ? b : f);
    y -= 16;
  };
  fila("Importe de la cuota", pesos(Number(c.monto)));
  if (Number(c.interes_cobrado)) fila("Intereses", pesos(Number(c.interes_cobrado)));
  if (Number(c.retencion)) fila("Retenciones", `- ${pesos(Number(c.retencion))}`);
  fila("Total pagado", pesos(Number(c.monto_pagado || c.monto)), true);

  t(`Forma de pago: ${c.metodo_pago || "—"}${c.referencia_pago ? ` · Ref. ${c.referencia_pago}` : ""}`, 36, 170, 9, f, gris);
  t("Documento no válido como factura.", 36, 40, 8, f, gris);

  const bytes = await pdf.save();
  return { base64: Buffer.from(bytes).toString("base64"), nombre: `Recibo-${c.recibo_numero}.pdf`, mime: "application/pdf", socioId: c.socio_id };
}
