/**
 * Lectura de archivos recibidos (WhatsApp o email) con IA: si es un comprobante de pago queda en
 * "Comprobantes recibidos" para que Tesorería lo concilie con una cuota.
 */
import { pesos } from "../core.js";
import { avisarArea, quien, sb, type Row } from "./base.js";
import { analizarJson, iaConfigurada } from "./ia.js";

export interface LecturaArchivo {
  tipo: "comprobante_pago" | "factura" | "documento" | "imagen" | "otro";
  monto: number | null;
  fecha: string | null;     // AAAA-MM-DD
  emisor: string | null;    // quién pagó / banco
  referencia: string | null;
  resumen: string;
}

const INSTRUCCIONES = `Analizás un archivo que le mandaron al Centro Comercial e Industrial de Paraná (CeCIP) por WhatsApp o email.
Decí qué es y, si es un comprobante de pago (transferencia, depósito, Mercado Pago, ticket de pago), extraé los datos.
Respondé SOLO un JSON con esta forma:
{"tipo": "comprobante_pago" | "factura" | "documento" | "imagen" | "otro",
 "monto": número o null, "fecha": "AAAA-MM-DD" o null, "emisor": "quién pagó o banco" o null,
 "referencia": "n° de operación" o null, "resumen": "una línea describiendo el archivo"}
No inventes datos: si algo no se lee, null.`;

/** Lee un PDF o imagen con la IA. Si la IA no está o falla, devuelve null. */
export async function leerArchivoIA(base64: string, mime: string, contexto = ""): Promise<LecturaArchivo | null> {
  if (!iaConfigurada() || !(mime === "application/pdf" || mime.startsWith("image/"))) return null;
  try {
    return await analizarJson<LecturaArchivo>(INSTRUCCIONES, [
      { inlineData: { mimeType: mime, data: base64 } },
      { text: contexto ? `Texto que acompañaba el archivo: ${contexto.slice(0, 1500)}` : "Sin texto adicional." },
    ]);
  } catch (err: any) {
    console.error("[canales] no se pudo leer el archivo:", err?.message || err);
    return null;
  }
}

/** Registra un comprobante para conciliar y avisa a Tesorería. */
export async function registrarComprobante(p: {
  conv: Row; socio: Row | null; mensajeId: string | null; canal: "whatsapp" | "email";
  lectura: LecturaArchivo | null; archivo: { ruta: string; nombre: string; mime: string } | null;
}) {
  const l = p.lectura;
  const { data, error } = await sb().from("comprobantes_recibidos").insert({
    conversacion_id: p.conv.id, mensaje_id: p.mensajeId, socio_id: p.socio?.id || p.conv.socio_id || null, canal: p.canal,
    monto: l?.monto ?? null, fecha: l?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) ? l.fecha : null,
    emisor: l?.emisor ?? null, referencia: l?.referencia ?? null,
    archivo_path: p.archivo?.ruta ?? null, archivo_nombre: p.archivo?.nombre ?? null, archivo_mime: p.archivo?.mime ?? null,
    analisis: l,
  }).select("id").single();
  if (error) throw new Error(error.message);
  await sb().from("conversaciones").update({ area: "tesoreria", interes: "Pagos y cuotas" }).eq("id", p.conv.id);
  await avisarArea("tesoreria", `🧾 Comprobante de pago recibido por ${p.canal === "email" ? "email" : "WhatsApp"} de ${quien(p.conv, p.socio)}${l?.monto ? ` por ${pesos(l.monto)}` : ""}.\nConcilialo en *Bandeja → Comprobantes* del ERP.`);
  return data?.id as string;
}
