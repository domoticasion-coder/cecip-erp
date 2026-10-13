/**
 * Tipos del contenido de ComercIA (convenio CeCIP + IEC + FactorIA).
 * El contenido vive en la base de datos y se edita desde ERP > Contenido.
 * Lo usan el portal (src), el ERP y el Copiloto (api).
 */

export interface OfertaComercia {
  id: string;
  titulo: string;
  etiqueta: string | null;
  problema: string | null;
  solucion: string;
  incluye: string[];
  icono: string;
  destacada: boolean;
  activa: boolean;
  orden: number;
}

export interface ServicioIec {
  id: string;
  nombre: string;
  subtitulo: string | null;
  descripcion: string | null;
  icono: string;
  subtipos: string[];
  activo: boolean;
  orden: number;
}

export interface CursoIec {
  id: string;
  nombre: string;
  subtitulo: string | null;
  duracion: string | null;
  frecuencia: string | null;
  modalidad: string | null;
  lugar: string | null;
  requisitos: string | null;
  salida_laboral: string | null;
  temario: string[];
  activo: boolean;
  orden: number;
}

export interface PromocionComercia {
  id: string;
  titulo: string;
  descuento: string | null;
  descripcion: string | null;
  condiciones: string | null;
  vigente_hasta: string | null;
  destacada: boolean;
  activa: boolean;
  orden: number;
}

export type TipoBloqueConvenio = "parte" | "eje" | "beneficio" | "paso" | "pregunta";

export interface BloqueConvenio {
  id: string;
  tipo: TipoBloqueConvenio;
  titulo: string;
  texto: string | null;
  icono: string;
  activo: boolean;
  orden: number;
}

export interface SeccionConocimiento {
  id: string;
  titulo: string;
  contenido: string;
  activo: boolean;
  orden: number;
}

/** Íconos disponibles para ofertas y servicios (nombres de lucide-react) */
export const ICONOS_CONTENIDO = [
  "Store", "Zap", "Search", "Wrench", "BadgePercent", "Shield", "Flame", "Megaphone",
  "GraduationCap", "Hammer", "Smartphone", "Globe", "Camera", "Truck", "Sparkles", "Briefcase", "MessageCircle", "Gift", "Rocket", "Users",
] as const;

/** Resumen en texto del catálogo para el Copiloto */
export function catalogoComerciaTexto(
  ofertas: Pick<OfertaComercia, "titulo" | "solucion" | "incluye">[],
  servicios: Pick<ServicioIec, "nombre" | "descripcion" | "subtipos">[],
  cursos: Pick<CursoIec, "nombre" | "duracion" | "frecuencia" | "modalidad" | "lugar">[],
  urlAdhesion?: string | null,
  promociones: Pick<PromocionComercia, "titulo" | "descuento" | "descripcion" | "condiciones" | "vigente_hasta">[] = [],
  convenio: Pick<BloqueConvenio, "tipo" | "titulo" | "texto">[] = [],
  novedades: { titulo: string; cuerpo: string }[] = []
): string {
  const lineas = [
    "COMERCIA PARANÁ (convenio CeCIP + FactorIA + IEC Services): programa que transforma los comercios de Paraná en sucursales virtuales 24/7, con búsqueda inteligente para vecinos y respaldo técnico presencial. Los socios piden información desde la sección ComercIA del portal (botón 'Pedir información', que abre WhatsApp de FactorIA)." +
      (urlAdhesion ? ` Formulario de adhesión: ${urlAdhesion}` : ""),
  ];
  if (novedades.length) lineas.push("NOVEDADES RECIENTES DE COMERCIA:", ...novedades.map((n) => `- ${n.titulo}: ${n.cuerpo}`));
  const porTipo = (t: TipoBloqueConvenio) => convenio.filter((b) => b.tipo === t);
  if (porTipo("parte").length) lineas.push("QUIÉNES PARTICIPAN DEL CONVENIO:", ...porTipo("parte").map((b) => `- ${b.titulo}: ${b.texto || ""}`));
  if (porTipo("eje").length) lineas.push("EJES DEL PROGRAMA COMERCIA INTELIGENTE:", ...porTipo("eje").map((b, i) => `${i + 1}) ${b.titulo}: ${b.texto || ""}`));
  if (porTipo("beneficio").length) lineas.push("QUÉ IMPLICA EL CONVENIO PARA EL COMERCIO:", ...porTipo("beneficio").map((b) => `- ${b.titulo}: ${b.texto || ""}`));
  if (porTipo("paso").length) lineas.push("CÓMO SUMARSE (PASOS):", ...porTipo("paso").map((b, i) => `${i + 1}. ${b.titulo}: ${b.texto || ""}`));
  if (porTipo("pregunta").length) lineas.push("PREGUNTAS FRECUENTES DEL CONVENIO:", ...porTipo("pregunta").map((b) => `- ${b.titulo} ${b.texto || ""}`));
  if (promociones.length) {
    lineas.push("PROMOCIONES VIGENTES DEL CONVENIO PARA SOCIOS:", ...promociones.map((p) =>
      `- ${p.descuento ? p.descuento + ": " : ""}${p.titulo}. ${p.descripcion || ""}${p.condiciones ? ` Condiciones: ${p.condiciones}` : ""}${p.vigente_hasta ? ` Vigente hasta el ${p.vigente_hasta.split("-").reverse().join("/")}.` : ""}`));
  }
  if (ofertas.length) {
    lineas.push("OFERTAS DE COMERCIA PARA SOCIOS:", ...ofertas.map((o) => `- ${o.titulo}: ${o.solucion}${o.incluye?.length ? ` Incluye: ${o.incluye.join(", ")}.` : ""}`));
  }
  if (servicios.length) {
    lineas.push("IEC SERVICES (servicios técnicos y profesionales):", ...servicios.map((s) => `- ${s.nombre}: ${s.descripcion || ""}${s.subtipos?.length ? ` (${s.subtipos.join(", ")})` : ""}`));
  }
  if (cursos.length) {
    lineas.push("CURSOS IEC (se pide cupo, no hay turnos por hora):", ...cursos.map((c) =>
      `- ${c.nombre}: ${[c.duracion, c.frecuencia, c.modalidad].filter(Boolean).join(", ")}.${c.lugar ? ` ${c.lugar}.` : ""}`));
  }
  return lineas.join("\n");
}
