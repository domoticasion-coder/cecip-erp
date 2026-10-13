/**
 * Arma el texto de contexto que recibe el Copiloto (Gemini). Es una función pura:
 * la usan la API real (con datos de Supabase) y el modo demo (con la base local).
 */
import { catalogoComerciaTexto, type BloqueConvenio, type CursoIec, type OfertaComercia, type PromocionComercia, type SeccionConocimiento, type ServicioIec } from "./comercia.js";

export interface DatosCopiloto {
  cfg: any | null;
  socio: any | null; // de socios_resumen
  cuotas: any[]; // de cuotas_detalle (no anuladas, más recientes primero)
  comunicados: any[];
  eventos: any[];
  conocimiento: Pick<SeccionConocimiento, "titulo" | "contenido">[];
  ofertas: OfertaComercia[];
  servicios: ServicioIec[];
  cursos: CursoIec[];
  promociones: PromocionComercia[];
  convenio: BloqueConvenio[];
  novedades?: { titulo: string; cuerpo: string }[];
}

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
const fechaAR = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("es-AR");

export function armarContexto({ cfg: c, socio: s, cuotas, comunicados, eventos, conocimiento, ofertas, servicios, cursos, promociones, convenio, novedades = [] }: DatosCopiloto): string {
  const partes: string[] = [`FECHA DE HOY: ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`];

  if (conocimiento.length) {
    partes.push("CONOCIMIENTO INSTITUCIONAL DEL CECIP:\n" +
      conocimiento.map((k) => `${k.titulo.toUpperCase()}\n${k.contenido.trim()}`).join("\n\n"));
  }

  if (c) {
    const transf = [c.banco && `Banco: ${c.banco}`, c.titular && `Titular: ${c.titular}`, c.cbu && `CBU: ${c.cbu}`, c.alias && `Alias: ${c.alias}`].filter(Boolean).join(" · ");
    partes.push(`COBRANZA: la cuota social vence el día ${c.dia_vencimiento} de cada mes. Interés por mora: ${c.interes_mensual}% mensual proporcional por día de atraso.` +
      " Formas de pago: online con Mercado Pago desde 'Mis cuotas' del portal (tarjeta, débito, dinero en cuenta), o transferencia" +
      (transf ? ` (${transf})` : "") + " enviando el comprobante a la administración. Los recibos se descargan desde 'Mis cuotas'.");
  }

  if (s) {
    const pendientes = cuotas.filter((x) => x.estado === "pendiente");
    const deuda = pendientes.reduce((a, x) => a + Number(x.total), 0);
    const pagadas = cuotas.filter((x) => x.estado === "pagada").slice(0, 3);
    partes.push(
      `SOCIO QUE CONSULTA: ${s.nombre_comercial || s.razon_social} (razón social ${s.razon_social})` +
      `${s.numero_socio ? `, socio N° ${s.numero_socio}` : ""}, categoría ${s.categoria_nombre || "sin asignar"}` +
      `${s.cuota_mensual ? ` (cuota mensual ${pesos(Number(s.cuota_mensual))})` : ""}, estado ${s.estado}, socio desde ${fechaAR(s.fecha_alta)}.\n` +
      (pendientes.length
        ? `Deuda actual: ${pesos(deuda)}. Cuotas pendientes:\n` + pendientes.map((x) => `- ${x.concepto}: ${pesos(Number(x.total))}, vence ${fechaAR(x.vencimiento)}${x.situacion === "vencida" ? " (VENCIDA)" : ""}`).join("\n")
        : "No tiene cuotas pendientes: está al día.") +
      (pagadas.length ? "\nÚltimos pagos:\n" + pagadas.map((x) => `- ${x.concepto}: pagada el ${fechaAR(x.fecha_pago)}`).join("\n") : "")
    );
  }

  if (comunicados.length) {
    partes.push("COMUNICADOS OFICIALES RECIENTES:\n" + comunicados.map((x) =>
      `- [${fechaAR(x.fecha_publicacion)}] ${x.titulo}: ${String(x.cuerpo).replace(/\s+/g, " ").slice(0, 500)}`).join("\n"));
  }

  partes.push(eventos.length
    ? "PRÓXIMOS EVENTOS Y CAPACITACIONES (inscripción desde la sección 'Eventos y capacitaciones' del portal):\n" + eventos.map((x) =>
        `- ${x.titulo} (${x.tipo === "capacitacion" ? "capacitación" : "evento"}): ${new Date(x.fecha_inicio).toLocaleString("es-AR", { dateStyle: "full", timeStyle: "short" })}, ${x.modalidad === "virtual" ? "virtual" : x.lugar || "a confirmar"}, ${Number(x.costo) > 0 ? pesos(Number(x.costo)) : "sin costo"}${x.inscripcion_abierta ? "" : " (inscripción cerrada)"}. ${x.descripcion ? String(x.descripcion).slice(0, 200) : ""}`).join("\n")
    : "PRÓXIMOS EVENTOS: no hay eventos publicados por ahora.");

  partes.push(catalogoComerciaTexto(ofertas, servicios, cursos, c?.comercia_url_adhesion, promociones, convenio, novedades));
  return partes.join("\n\n");
}
