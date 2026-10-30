/**
 * Roles del personal del ERP y qué puede hacer cada uno.
 *
 * Cada rol tiene:
 *  - permisos: lo que puede MODIFICAR. Son grupos de permisos que también usa la base de datos
 *    (has_role / permisos_rol en la migración 012), así pantalla, API y base piden lo mismo.
 *      tesoreria  cobros, cuotas, caja, banco, facturación, alquileres, pagos a docentes
 *      atencion   socios, accesos al portal, recordatorios de cobranza
 *      prensa     comunicados, emails y WhatsApp, eventos, capacitaciones, contenido del portal
 *      comercia   equipo externo de ComercIA (solo sus secciones)
 *  - secciones: lo que puede VER en el menú. Los roles sin permisos (Presidente, Comisión
 *    directiva) ven sus secciones en modo consulta.
 *
 * Si se agrega un rol acá, agregarlo también en la migración 012 (permisos_rol y el check de staff.rol).
 */

export type Rol =
  | "admin" | "administracion" | "prensa" | "presidente" | "prosecretario" | "comision"
  | "tesoreria" | "atencion" | "comercia";

export type Permiso = "tesoreria" | "atencion" | "prensa" | "comercia";

export type Seccion =
  | "/" | "/copiloto" | "/socios" | "/cuotas" | "/cobranzas" | "/tesoreria" | "/facturacion" | "/alquileres"
  | "/bandeja" | "/bolsa" | "/comunicacion" | "/eventos" | "/capacitaciones" | "/convenios" | "/actividad" | "/comercia" | "/contenido" | "/difusion" | "/accesos" | "/configuracion";

const TODAS: Seccion[] = [
  "/", "/copiloto", "/socios", "/cuotas", "/cobranzas", "/tesoreria", "/facturacion", "/alquileres",
  "/bandeja", "/bolsa", "/comunicacion", "/eventos", "/capacitaciones", "/convenios", "/actividad", "/comercia", "/contenido", "/difusion", "/accesos", "/configuracion",
];
const sin = (...quitar: Seccion[]) => TODAS.filter((s) => !quitar.includes(s));

export interface InfoRol {
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
  secciones: Seccion[];
  /** Ve montos de tesorería, facturación y alquileres (lo usa también el Copiloto) */
  finanzas: boolean;
  /** Se ofrece al crear usuarios nuevos (los roles anteriores quedan por compatibilidad) */
  vigente: boolean;
}

export const ROLES_INFO: Record<Rol, InfoRol> = {
  admin: {
    nombre: "Administrador del sistema",
    descripcion: "Acceso total, incluida la configuración y el alta de usuarios.",
    permisos: ["tesoreria", "atencion", "prensa", "comercia"],
    secciones: TODAS,
    finanzas: true,
    vigente: true,
  },
  administracion: {
    nombre: "Administración",
    descripcion: "Gestión diaria completa: socios, cuotas, cobros, tesorería, facturación, alquileres, comunicación, eventos y capacitaciones. No modifica la configuración ni los usuarios.",
    permisos: ["tesoreria", "atencion", "prensa"],
    secciones: sin("/difusion", "/configuracion"),
    finanzas: true,
    vigente: true,
  },
  prensa: {
    nombre: "Prensa y capacitación",
    descripcion: "Comunicados, emails y WhatsApp, eventos, cursos y docentes, y contenido del portal. Consulta el padrón de socios; no ve cuotas ni finanzas.",
    permisos: ["prensa"],
    secciones: ["/", "/copiloto", "/bandeja", "/bolsa", "/socios", "/comunicacion", "/eventos", "/capacitaciones", "/convenios", "/actividad", "/contenido"],
    finanzas: false,
    vigente: true,
  },
  presidente: {
    nombre: "Presidente",
    descripcion: "Consulta todo el sistema, incluidas las finanzas, sin modificar datos.",
    permisos: [],
    secciones: sin("/difusion", "/configuracion"),
    finanzas: true,
    vigente: true,
  },
  prosecretario: {
    nombre: "Prosecretario",
    descripcion: "Secretaría: altas y datos de socios, accesos al portal, comunicación, eventos y capacitaciones. Consulta cuotas y morosos; no ve tesorería.",
    permisos: ["atencion", "prensa"],
    secciones: ["/", "/copiloto", "/bandeja", "/bolsa", "/socios", "/cuotas", "/cobranzas", "/comunicacion", "/eventos", "/capacitaciones", "/convenios", "/actividad", "/comercia", "/contenido", "/accesos"],
    finanzas: false,
    vigente: true,
  },
  comision: {
    nombre: "Comisión directiva",
    descripcion: "Consulta el tablero, socios, cuotas y morosos, comunicados, eventos y capacitaciones, sin modificar datos. No ve tesorería ni facturación.",
    permisos: [],
    secciones: ["/", "/copiloto", "/socios", "/cuotas", "/cobranzas", "/comunicacion", "/eventos", "/capacitaciones", "/convenios", "/actividad", "/comercia"],
    finanzas: false,
    vigente: true,
  },
  tesoreria: {
    nombre: "Tesorería",
    descripcion: "Cobros, cuotas, caja, banco, facturación y alquileres.",
    permisos: ["tesoreria"],
    secciones: sin("/contenido", "/difusion", "/configuracion"),
    finanzas: true,
    vigente: false,
  },
  atencion: {
    nombre: "Atención al socio",
    descripcion: "Socios, accesos al portal, comunicación, eventos y capacitaciones.",
    permisos: ["atencion", "prensa"],
    secciones: sin("/tesoreria", "/facturacion", "/alquileres", "/difusion", "/configuracion"),
    finanzas: false,
    vigente: false,
  },
  comercia: {
    nombre: "ComercIA (IEC / FactorIA)",
    descripcion: "Equipo externo de ComercIA: solo sus secciones, sin datos internos del CeCIP.",
    permisos: ["comercia"],
    secciones: ["/copiloto", "/comercia", "/contenido", "/difusion"],
    finanzas: false,
    vigente: true,
  },
};

/** Nombre visible de cada rol */
export const ROLES = Object.fromEntries(Object.entries(ROLES_INFO).map(([k, v]) => [k, v.nombre])) as Record<Rol, string>;

/** ¿El rol puede modificar algo de alguno de estos grupos? Sin grupos = solo el administrador del sistema */
export function tienePermiso(rol: Rol | undefined | null, permisos: Permiso[] = []): boolean {
  if (!rol) return false;
  if (rol === "admin") return true;
  if (!permisos.length) return false;
  const propios = ROLES_INFO[rol]?.permisos || [];
  return permisos.some((p) => propios.includes(p));
}

/** ¿El rol ve esta sección del ERP? */
export function veSeccion(rol: Rol | undefined | null, seccion: Seccion): boolean {
  return !!rol && !!ROLES_INFO[rol]?.secciones.includes(seccion);
}

/**
 * Rol con el que se arma el contexto del Copiloto (la función de la base distingue
 * "admin" = todo, "atencion" = interno sin finanzas y "comercia" = solo ComercIA).
 */
export function rolCopiloto(rol: Rol): "admin" | "atencion" | "comercia" {
  if (rol === "comercia") return "comercia";
  return ROLES_INFO[rol]?.finanzas ? "admin" : "atencion";
}
