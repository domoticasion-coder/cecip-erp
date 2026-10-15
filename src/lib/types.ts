export type Rol = "admin" | "tesoreria" | "atencion" | "comercia";

export const ROLES: Record<Rol, string> = {
  admin: "Administrador",
  tesoreria: "Tesorería",
  atencion: "Atención al socio",
  comercia: "ComercIA (IEC / FactorIA)",
};

export interface Staff {
  user_id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  created_at: string;
}

export interface Categoria {
  id: string;
  nombre: string;
  cuota_mensual: number;
  descripcion: string | null;
  orden: number;
}

export interface Cuenta {
  id: string;
  nombre: string;
  tipo: "banco" | "caja" | "billetera";
  activa: boolean;
  orden: number;
}

export interface Configuracion {
  id: 1;
  nombre_institucion: string;
  cuit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  titular: string | null;
  cbu: string | null;
  alias: string | null;
  interes_mensual: number;
  dia_vencimiento: number;
  recordatorios_auto: boolean;
  dias_aviso: number;
  cuenta_mp_id: string | null;
  cuenta_default_id: string | null;
  factoria_whatsapp: string | null;
  wa_limite_diario: number;
  wa_espera_min: number;
  wa_espera_max: number;
  comercia_url_adhesion: string | null;
  facturacion_auto: boolean;
  factura_condicion_emisor: "exento" | "monotributo" | "ri";
  factura_punto_venta: number | null;
  factura_iva_alicuota: number;
}

export type CodigoPeriodicidad = "mensual" | "bimestral" | "trimestral" | "semestral" | "anual";

export interface Periodicidad {
  codigo: CodigoPeriodicidad;
  nombre: string;
  meses: number;
  descuento: number;
  orden: number;
}

export type CondicionIva = "RI" | "Monotributo" | "Exento" | "Consumidor final";
export const CONDICIONES_IVA: CondicionIva[] = ["RI", "Monotributo", "Exento", "Consumidor final"];

export type Seguimiento = "posible_baja" | "deuda_reciente" | "deuda_condonada" | "cobrador";
export const SEGUIMIENTOS: Record<Seguimiento, { label: string; tone: "amber" | "red" | "green" | "blue" }> = {
  posible_baja: { label: "Posible baja", tone: "amber" },
  deuda_reciente: { label: "Deuda reciente", tone: "red" },
  deuda_condonada: { label: "Deuda condonada", tone: "green" },
  cobrador: { label: "Cobra el CeCIP (cobrador)", tone: "blue" },
};

export type EstadoSocio = "activo" | "suspendido" | "baja";

export interface Socio {
  id: string;
  numero_socio: number | null;
  razon_social: string;
  nombre_comercial: string | null;
  cuit: string | null;
  rubro: string | null;
  categoria_id: string | null;
  estado: EstadoSocio;
  contacto_nombre: string | null;
  email: string | null;
  whatsapp: string | null;
  telefono: string | null;
  direccion: string | null;
  localidad: string | null;
  fecha_alta: string;
  observaciones: string | null;
  whatsapp_baja: boolean;
  periodicidad: CodigoPeriodicidad;
  condicion_iva: CondicionIva | null;
  emails_extra: string | null;
  seguimiento: Seguimiento | null;
  facturar_auto: boolean;
  created_at: string;
}

export interface SocioResumen extends Socio {
  categoria_nombre: string | null;
  cuota_mensual: number | null;
  periodicidad_nombre: string | null;
  periodicidad_meses: number | null;
  cuota_periodo: number | null;
  deuda: number;
  cuotas_pendientes: number;
  cuotas_vencidas: number;
  max_dias_atraso: number;
}

export interface SocioNota {
  id: string;
  socio_id: string;
  tipo: "nota" | "llamada" | "reunion" | "email" | "whatsapp" | "pago" | "sistema";
  texto: string;
  autor_nombre: string | null;
  created_at: string;
}

export interface SocioUsuario {
  user_id: string;
  socio_id: string | null;
  nombre: string | null;
  email: string;
  telefono: string | null;
  cuit_declarado: string | null;
  razon_social_declarada: string | null;
  estado: "pendiente" | "aprobado" | "rechazado";
  motivo_rechazo: string | null;
  created_at: string;
}

export type EstadoCuota = "pendiente" | "pagada" | "anulada";

export interface Cuota {
  id: string;
  socio_id: string;
  tipo: "cuota_social" | "otro";
  periodo: string | null;
  periodo_hasta: string | null;
  meses: number;
  importada: boolean;
  concepto: string;
  monto: number;
  vencimiento: string;
  estado: EstadoCuota;
  fecha_pago: string | null;
  metodo_pago: string | null;
  monto_pagado: number | null;
  interes_cobrado: number | null;
  referencia_pago: string | null;
  recibo_numero: number | null;
  cuenta_id: string | null;
  ultimo_recordatorio: string | null;
  created_at: string;
}

export interface CuotaDetalle extends Cuota {
  razon_social: string;
  nombre_comercial: string | null;
  numero_socio: number | null;
  socio_email: string | null;
  socio_whatsapp: string | null;
  dias_atraso: number;
  interes: number;
  total: number;
  situacion: "pendiente" | "vencida" | "pagada" | "anulada";
}

export interface Movimiento {
  id: string;
  fecha: string;
  tipo: "ingreso" | "egreso";
  categoria: string;
  cuenta_id: string | null;
  detalle: string;
  monto: number;
  comprobante: string | null;
  cuota_id: string | null;
  alquiler_cargo_id: string | null;
  conciliado: boolean;
  created_at: string;
}

export interface Comunicado {
  id: string;
  titulo: string;
  cuerpo: string;
  publicado: boolean;
  destacado: boolean;
  imagen_url: string | null;
  fecha_publicacion: string | null;
  created_at: string;
}

export interface Envio {
  id: string;
  socio_id: string | null;
  comunicado_id: string | null;
  canal: "email" | "whatsapp";
  tipo: "comunicado" | "recordatorio" | "manual" | "acceso";
  asunto: string | null;
  destinatario: string | null;
  estado: "enviado" | "error";
  error: string | null;
  created_at: string;
}

export interface Evento {
  id: string;
  titulo: string;
  descripcion: string | null;
  tipo: "evento" | "capacitacion";
  fecha_inicio: string;
  fecha_fin: string | null;
  lugar: string | null;
  modalidad: "presencial" | "virtual" | "mixta";
  link: string | null;
  cupo: number | null;
  costo: number;
  publicado: boolean;
  inscripcion_abierta: boolean;
  imagen_url: string | null;
  slug: string | null;
  formulario_publico: boolean;
  preguntas: PreguntaFormulario[];
  created_at: string;
}

export interface PreguntaFormulario {
  id: string;
  etiqueta: string;
  tipo: "texto" | "opciones" | "si_no";
  opciones?: string[];
  requerida: boolean;
}

export interface Inscripcion {
  id: string;
  evento_id: string;
  socio_id: string | null;
  asistente_nombre: string;
  asistente_email: string | null;
  asistente_telefono: string | null;
  empresa: string | null;
  cuit: string | null;
  es_socio: boolean;
  respuestas: Record<string, string>;
  origen: "portal" | "erp" | "publico";
  asistio: boolean;
  created_at: string;
}

export interface ComerciaSolicitud {
  id: string;
  socio_id: string;
  servicio: string;
  detalle: string | null;
  presupuesto_estimado: number | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  estado: "nueva" | "en_curso" | "cerrada" | "descartada";
  notas_internas: string | null;
  created_at: string;
}

export const METODOS_PAGO = ["Efectivo", "Transferencia", "Mercado Pago", "Tarjeta de débito", "Tarjeta de crédito", "Cheque"] as const;

export const CATEGORIAS_MOVIMIENTO = {
  ingreso: ["Saldo inicial", "Cuotas sociales","Eventos y capacitaciones", "Alquileres", "Alquiler de salón", "Convenios", "Donaciones", "Otros ingresos"],
  egreso: ["Sueldos y cargas sociales", "Servicios (luz, agua, internet)", "Alquiler", "Mantenimiento", "Honorarios", "Impuestos y tasas", "Eventos", "Insumos de oficina", "Comisiones bancarias", "Otros egresos"],
};

export interface WaCampana {
  id: string;
  nombre: string;
  mensaje_base: string;
  variantes: string[];
  estado: "activa" | "pausada" | "finalizada";
  total: number;
  origen: "cecip" | "comercia";
  imagen_url: string | null;
  created_at: string;
}

export interface WaMensaje {
  id: string;
  campana_id: string;
  socio_id: string | null;
  nombre: string;
  telefono: string;
  mensaje: string;
  usa_link_pago: boolean;
  orden: number;
  estado: "pendiente" | "enviado" | "omitido";
  enviado_at: string | null;
}

export interface Inmueble {
  id: string;
  nombre: string;
  direccion: string | null;
  descripcion: string | null;
  activo: boolean;
  orden: number;
}

export type AjusteIndice = "ninguno" | "ipc" | "icl" | "casa_propia" | "porcentaje";
export const AJUSTES: Record<AjusteIndice, string> = {
  ninguno: "Sin ajuste",
  ipc: "IPC (INDEC)",
  icl: "ICL (BCRA)",
  casa_propia: "Casa Propia",
  porcentaje: "Porcentaje fijo",
};

export interface AlquilerContrato {
  id: string;
  inmueble_id: string;
  inquilino_nombre: string;
  inquilino_cuit: string | null;
  inquilino_condicion_iva: CondicionIva | null;
  inquilino_email: string | null;
  inquilino_telefono: string | null;
  inquilino_domicilio: string | null;
  socio_id: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  monto_mensual: number;
  dia_vencimiento: number;
  ajuste_indice: AjusteIndice;
  ajuste_cada_meses: number | null;
  ajuste_porcentaje: number | null;
  proximo_ajuste: string | null;
  deposito: number | null;
  facturar: boolean;
  estado: "vigente" | "finalizado";
  observaciones: string | null;
  created_at: string;
}

export interface AlquilerCargo {
  id: string;
  contrato_id: string;
  tipo: "alquiler" | "expensas" | "servicios" | "otro";
  periodo: string | null;
  concepto: string;
  monto: number;
  vencimiento: string;
  estado: EstadoCuota;
  fecha_pago: string | null;
  metodo_pago: string | null;
  monto_pagado: number | null;
  referencia_pago: string | null;
  cuenta_id: string | null;
  recibo_numero: number | null;
  created_at: string;
  // de la vista alquiler_cargos_detalle
  inmueble_id: string;
  inmueble_nombre: string;
  inquilino_nombre: string;
  inquilino_email: string | null;
  inquilino_telefono: string | null;
  dias_atraso: number;
  situacion: "pendiente" | "vencida" | "pagada" | "anulada";
}

export type EstadoFactura = "en_cola" | "enviada" | "emitida" | "error" | "anulada";
export const ESTADOS_FACTURA: Record<EstadoFactura, { label: string; tone: "gray" | "blue" | "green" | "red" | "amber" }> = {
  en_cola: { label: "En cola", tone: "amber" },
  enviada: { label: "Enviada a ARCA", tone: "blue" },
  emitida: { label: "Emitida", tone: "green" },
  error: { label: "Con error", tone: "red" },
  anulada: { label: "Anulada", tone: "gray" },
};

export interface Factura {
  id: string;
  origen: "cuota" | "alquiler" | "manual";
  cuota_id: string | null;
  cargo_id: string | null;
  socio_id: string | null;
  contrato_id: string | null;
  receptor_nombre: string;
  receptor_cuit: string | null;
  receptor_condicion_iva: string;
  receptor_domicilio: string | null;
  receptor_email: string | null;
  tipo: "A" | "B" | "C";
  punto_venta: number | null;
  numero: number | null;
  fecha: string;
  concepto: string;
  neto: number;
  iva_alicuota: number;
  iva: number;
  total: number;
  estado: EstadoFactura;
  cae: string | null;
  cae_vencimiento: string | null;
  pdf_url: string | null;
  error: string | null;
  intentos: number;
  enviada_at: string | null;
  emitida_at: string | null;
  created_at: string;
}

export interface BancoMovimiento {
  id: string;
  banco: string;
  cuenta_id: string | null;
  id_externo: string;
  fecha: string;
  descripcion: string;
  monto: number;
  saldo: number | null;
  referencia: string | null;
  contraparte_nombre: string | null;
  contraparte_cuit: string | null;
  estado: "nuevo" | "conciliado" | "ignorado";
  movimiento_id: string | null;
  cuota_id: string | null;
  cargo_id: string | null;
  created_at: string;
}
