/**
 * Contexto del Copiloto del ERP (personal del CeCIP). Función pura: recibe lo que devuelve
 * la función SQL datos_copiloto_erp y lo convierte en texto para Gemini.
 * La usan la API real y el modo demo.
 */
import { catalogoComerciaTexto } from "./comercia.js";
import { ROLES as NOMBRES_ROLES, ROLES_INFO, veSeccion, type Rol, type Seccion } from "./roles.js";

const pesos = (n: unknown) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(n || 0));
const fechaAR = (d: unknown) => (d ? new Date(String(d).length === 10 ? d + "T12:00:00" : String(d)).toLocaleDateString("es-AR") : "—");
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const ROLES: Record<string, string> = NOMBRES_ROLES;

/** Mapa del ERP para responder "¿cómo hago...?": cada línea se muestra solo a quien ve esas secciones */
const GUIA_ERP: [Seccion[], string][] = [
  [["/"], "Inicio: resumen y avisos (deuda vencida, facturas con error, alquileres vencidos, banco sin conciliar)."],
  [["/socios"], "Socios: padrón con filtros (categoría, forma de pago, seguimiento), ficha con cuenta corriente, facturación, historial de contacto y acceso al portal. \"Nuevo socio\", \"Importar\" (Excel/CSV), selección múltiple para asignar categoría o forma de pago."],
  [["/cuotas"], "Cuotas: \"Generar cuotas del mes\" (a cada socio le genera el período de su forma de pago: mensual, bimestral, trimestral, semestral o anual, sin duplicar), cobrar, link de pago de Mercado Pago, recordatorios por email, recibos."],
  [["/cobranzas"], "Cobranzas y morosos: lista de deudores y envío masivo de recordatorios."],
  [["/tesoreria"], "Tesorería y banco: movimientos de caja y bancos; pestaña \"Banco Santander\" para sincronizar, importar el extracto y conciliar (imputar a cuotas o alquileres)."],
  [["/facturacion"], "Facturación: comprobantes emitidos en ARCA vía n8n, cola y errores (reintentar); pestaña \"Conexión ARCA / n8n\"."],
  [["/alquileres"], "Alquileres: cobros (mensuales y de reservas), pestaña \"Salones y reservas\" para alquileres temporales por día u horas (con seña, calendario y control de superposición) y \"Inmuebles y contratos\" para contratos mensuales y ajustes (ICL, IPC, porcentaje)."],
  [["/bandeja"], "Bandeja: conversaciones de WhatsApp y email con socios y contactos (la IA responde y deriva; el personal responde a mano con texto, PDF, imágenes o recibos), pipeline de contactos y comprobantes de pago recibidos para conciliar."],
  [["/bolsa"], "Bolsa de empleo: currículums que llegan desde la web del CeCIP; se descargan, se muestran a los socios (Portal) o se archivan, y se ve qué comercios se interesaron."],
  [["/comunicacion"], "Comunicación: comunicados del portal (con imagen), email individual, email masivo (con cola de envío por cupo diario), campañas de WhatsApp con mensajes variados y espera entre envíos, historial."],
  [["/eventos"], "Eventos: charlas y actividades, formulario público para no socios."],
  [["/capacitaciones"], "Capacitaciones: cursos (docente, días, horario, clases, precios socio/no socio, honorarios), inscriptos con datos de facturación, cobro y factura, pestañas Docentes y Pagos a docentes."],
  [["/comercia", "/contenido", "/difusion"], "ComercIA, Contenido del portal, Difusión ComercIA: convenio CeCIP + IEC + FactorIA."],
  [["/accesos"], "Accesos al portal: aprobar o rechazar socios que se registran."],
  [["/configuracion"], "Configuración: valores de cuota por categoría y descuentos por forma de pago, interés por mora, datos de la institución, cuentas y personal."],
];

const NOMBRE_SECCION: Record<Seccion, string> = {
  "/": "Inicio", "/copiloto": "Copiloto", "/bandeja": "Bandeja", "/bolsa": "Bolsa de empleo", "/socios": "Socios", "/cuotas": "Cuotas", "/cobranzas": "Cobranzas y morosos",
  "/tesoreria": "Tesorería y banco", "/facturacion": "Facturación", "/alquileres": "Alquileres", "/comunicacion": "Comunicación",
  "/eventos": "Eventos", "/capacitaciones": "Capacitaciones", "/comercia": "ComercIA", "/contenido": "Contenido del portal",
  "/difusion": "Difusión ComercIA", "/accesos": "Accesos al portal", "/configuracion": "Configuración",
};

/** Qué secciones del ERP habilitan cada bloque de datos del contexto (los que no figuran los reciben todos) */
const DATOS_POR_SECCION: Record<string, Seccion[]> = {
  resumen: ["/cuotas"], cfg: ["/cuotas"], categorias: ["/cuotas"], periodicidades: ["/cuotas"], cuotas_mes: ["/cuotas"],
  socios_por_estado: ["/socios"], socios_por_pago: ["/socios"], seguimiento: ["/socios"], socios_mencionados: ["/socios"],
  morosos: ["/cobranzas"],
  eventos: ["/eventos", "/capacitaciones"], docentes: ["/capacitaciones"], pagos_docentes: ["/capacitaciones"],
  alquileres: ["/alquileres"], reservas: ["/alquileres"], facturas: ["/facturacion"], tesoreria: ["/tesoreria"],
  comunicados: ["/comunicacion"], accesos_pendientes: ["/accesos"], personal: ["/configuracion"],
  solicitudes_comercia: ["/comercia"], ofertas: ["/comercia"], servicios: ["/comercia"], cursos_iec: ["/comercia"],
  promociones: ["/comercia"], convenio: ["/comercia"], novedades: ["/comercia"],
};

/** Deja en los datos solo lo que corresponde a las secciones del rol */
function filtrarPorRol(d: any, rol: Rol): any {
  const out: any = {};
  for (const [k, v] of Object.entries(d || {})) {
    const secs = DATOS_POR_SECCION[k];
    if (!secs || secs.some((x) => veSeccion(rol, x))) out[k] = v;
  }
  // Quien ve socios pero no cuotas (Prensa y capacitación) recibe la ficha sin deuda ni pagos
  if (out.socios_mencionados && !veSeccion(rol, "/cuotas")) {
    out.socios_mencionados = out.socios_mencionados.map((s: any) => ({
      ...s, deuda: undefined, pendientes: undefined, ultimo_pago: undefined, cuota_periodo: undefined, sin_finanzas: true,
    }));
  }
  if (!ROLES_INFO[rol]?.finanzas) {
    if (out.eventos) out.eventos = out.eventos.map((e: any) => ({ ...e, honorario_previsto: null, pagado_docente: null }));
    delete out.pagos_docentes;
  }
  return out;
}

export function armarContextoErp(datos: any, quien: { nombre: string; rol: string }): string {
  // Un rol desconocido recibe lo mínimo (como Comisión directiva)
  const rol = (quien.rol in ROLES_INFO ? quien.rol : "comision") as Rol;
  const d = filtrarPorRol(datos, rol);
  const secciones = ROLES_INFO[rol].secciones.filter((x) => x !== "/copiloto");
  const p: string[] = [
    `FECHA DE HOY: ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
    `QUIEN CONSULTA: ${quien.nombre}, rol ${ROLES[rol] || rol}. ${ROLES_INFO[rol].descripcion}`,
    `SECCIONES DEL ERP DE SU ROL: ${secciones.map((x) => NOMBRE_SECCION[x]).join(", ")}. ` +
      `${ROLES_INFO[rol].permisos.length ? "" : "Su rol es de solo consulta: no puede modificar datos. "}` +
      "Cualquier otra área del ERP NO corresponde a su rol.",
  ];

  if (d.conocimiento?.length) {
    p.push("CONOCIMIENTO INSTITUCIONAL DEL CECIP:\n" + d.conocimiento.map((k: any) => `${String(k.titulo).toUpperCase()}\n${String(k.contenido).trim()}`).join("\n\n"));
  }
  const guia = GUIA_ERP.filter(([secs]) => secs.some((x) => veSeccion(rol, x))).map(([, t]) => `- ${t}`);
  if (guia.length) p.push("GUÍA DEL ERP (solo las secciones de su rol):\n" + guia.join("\n"));

  const c = d.cfg;
  if (c && d.resumen) {
    p.push(`CONFIGURACIÓN: vencimiento de cuota día ${c.dia_vencimiento}; interés por mora ${c.interes_mensual}% mensual; recordatorios automáticos ${c.recordatorios_auto ? "activados" : "desactivados"}; ` +
      `facturación automática ${c.facturacion_auto ? "activada" : "desactivada"} (CeCIP ${c.factura_condicion_emisor}, punto de venta ${c.factura_punto_venta || "sin cargar"}). ` +
      `Transferencias: ${[c.banco, c.titular, c.cbu && `CBU ${c.cbu}`, c.alias && `alias ${c.alias}`].filter(Boolean).join(" · ") || "sin datos"}.`);
  }

  const r = d.resumen;
  if (r) {
    p.push(`RESUMEN ACTUAL: ${r.socios_activos} socios activos; ${r.socios_morosos} con cuotas vencidas; deuda total ${pesos(r.deuda_total)} (vencida ${pesos(r.deuda_vencida)}); ` +
      `cobrado este mes ${pesos(r.cobrado_mes)}; cuotas del mes ${pesos(r.facturado_mes)} (cobrado ${pesos(r.cobrado_mes_cuotas)}); ` +
      `solicitudes de acceso al portal pendientes ${r.accesos_pendientes}; consultas ComercIA nuevas ${r.comercia_nuevas}; ` +
      `alquileres vencidos sin cobrar ${r.alquileres_pendientes}; facturas con error ${r.facturas_con_error}; movimientos del banco sin conciliar ${r.banco_sin_conciliar}.`);
  }
  if (d.categorias) {
    const per = (d.periodicidades || []).map((x: any) => `${x.nombre} ${Number(x.descuento) ? `-${x.descuento}%` : "sin descuento"}`).join(", ");
    p.push("CATEGORÍAS (valor mensual · socios activos): " + d.categorias.map((x: any) => `${x.nombre} ${Number(x.cuota_mensual) ? pesos(x.cuota_mensual) : "SIN VALOR"} · ${x.socios_activos}`).join("; ") +
      `. Formas de pago: ${per}. Importe de cada cuota = valor mensual × meses del período − descuento.`);
  }
  if (d.socios_por_estado) {
    p.push(`SOCIOS POR ESTADO: ${Object.entries(d.socios_por_estado).map(([k, v]) => `${k} ${v}`).join(", ")}. ` +
      `ACTIVOS POR FORMA DE PAGO: ${Object.entries(d.socios_por_pago || {}).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  }
  if (d.seguimiento?.length) {
    p.push("MARCAS DE SEGUIMIENTO:\n" + d.seguimiento.map((x: any) => `- ${x.seguimiento} (${x.n}): ${String(x.socios).slice(0, 600)}`).join("\n"));
  }
  if (d.cuotas_mes) p.push(`CUOTAS QUE CUBREN ESTE MES: ${d.cuotas_mes.emitidas} (${d.cuotas_mes.pagadas} pagadas), importe ${pesos(d.cuotas_mes.importe)}, cobrado ${pesos(d.cuotas_mes.cobrado)}.`);
  if (d.morosos?.length) {
    p.push("SOCIOS CON MÁS DEUDA VENCIDA (hasta 30):\n" + d.morosos.map((x: any) =>
      `- ${x.socio}${x.numero_socio ? ` (N° ${x.numero_socio})` : ""}: ${pesos(x.deuda)}, ${x.cuotas_vencidas} vencidas, ${x.max_dias_atraso} días de atraso${x.telefono ? `, tel ${x.telefono}` : ""}${x.email ? `, ${x.email}` : ""}`).join("\n"));
  }
  if (d.socios_mencionados?.length) {
    p.push("SOCIOS MENCIONADOS EN LA CONSULTA (detalle):\n" + d.socios_mencionados.map((s: any) =>
      `- ${s.razon_social}${s.nombre_comercial ? ` ("${s.nombre_comercial}")` : ""}, N° ${s.numero_socio ?? "—"}, CUIT ${s.cuit || "—"} (${s.condicion_iva || "IVA sin dato"}), rubro ${s.rubro || "—"}, estado ${s.estado}` +
      `${s.seguimiento ? ` [${s.seguimiento}]` : ""}, categoría ${s.categoria_nombre || "sin categoría"}, paga ${s.periodicidad_nombre || "—"}${s.cuota_periodo ? ` (${pesos(s.cuota_periodo)} por período)` : ""}, socio desde ${fechaAR(s.fecha_alta)}. ` +
      `Contacto: ${[s.contacto_nombre, s.telefono, s.email].filter(Boolean).join(" · ") || "sin datos"}. Dirección: ${s.direccion || "—"}. ` +
      (s.sin_finanzas ? "" : `Deuda ${pesos(s.deuda)}${(s.pendientes || []).length ? ": " + s.pendientes.map((c: any) => `${c.concepto} ${pesos(c.total)} vence ${fechaAR(c.vence)}${c.situacion === "vencida" ? " (vencida)" : ""}`).join("; ") : " (al día)"}. ` +
      `${s.ultimo_pago ? `Último pago: ${s.ultimo_pago.concepto} el ${fechaAR(s.ultimo_pago.fecha)} por ${pesos(s.ultimo_pago.monto)} (${s.ultimo_pago.metodo}).` : "Sin pagos registrados en el sistema."}`) +
      `${s.observaciones ? ` Observaciones: ${String(s.observaciones).slice(0, 300)}` : ""}`).join("\n"));
  } else if (d.socios_por_estado) {
    p.push("Si preguntan por un socio puntual que no aparece en este contexto, pedí que escriban su razón social, nombre de fantasía o N° de socio (o que lo busquen en Socios).");
  }
  if (d.eventos?.length) {
    p.push("EVENTOS Y CAPACITACIONES (desde hace 30 días):\n" + d.eventos.map((e: any) =>
      `- ${e.titulo} (${e.tipo === "capacitacion" ? "capacitación" : "evento"}${e.cancelado ? ", CANCELADA" : ""}): ${new Date(e.fecha_inicio).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}` +
      `${e.cantidad_clases > 1 ? `, ${e.cantidad_clases} clases${e.dias_semana?.length ? ` los ${e.dias_semana.map((x: number) => DIAS[x - 1]).join("/")}` : ""}${e.hora_inicio ? ` ${String(e.hora_inicio).slice(0, 5)}-${String(e.hora_fin || "").slice(0, 5)}` : ""}` : ""}` +
      `, ${e.modalidad}${e.lugar ? ` en ${e.lugar}` : ""}, socios ${Number(e.costo) ? pesos(e.costo) : "sin cargo"}${e.precio_no_socio !== null && Number(e.precio_no_socio) !== Number(e.costo) ? `, no socios ${pesos(e.precio_no_socio)}` : ""}` +
      `${e.docente ? `, docente ${e.docente}` : ""}; inscriptos ${e.inscriptos}${e.cupo ? `/${e.cupo}` : ""}${e.recaudado !== null && e.recaudado !== undefined ? `, recaudado ${pesos(e.recaudado)}, a cobrar ${pesos(e.a_cobrar)}` : ""}` +
      `${e.honorario_previsto !== null && e.honorario_previsto !== undefined ? `, honorario previsto ${pesos(e.honorario_previsto)} (pagado ${pesos(e.pagado_docente)})` : ""}` +
      `${e.publicado ? "" : ", no publicado"}${e.inscripcion_abierta ? "" : ", inscripción cerrada"}${e.formulario_publico ? ", con formulario público" : ""}.`).join("\n"));
  }
  if (d.docentes?.length) {
    p.push("DOCENTES: " + d.docentes.map((x: any) => `${x.nombre}${x.especialidad ? ` (${x.especialidad})` : ""}${x.activo ? "" : " [inactivo]"}${x.total_pagado !== null && x.total_pagado !== undefined ? `, pagado ${pesos(x.total_pagado)}` : ""}${x.telefono ? `, tel ${x.telefono}` : ""}`).join("; ") + ".");
  }
  if (d.pagos_docentes?.length) {
    p.push("ÚLTIMOS PAGOS A DOCENTES:\n" + d.pagos_docentes.map((x: any) => `- ${fechaAR(x.fecha)} ${x.docente}: ${x.concepto} ${pesos(x.monto)} (${x.metodo_pago || "—"})`).join("\n"));
  }
  if (d.alquileres?.length) {
    p.push("ALQUILERES:\n" + d.alquileres.map((a: any) => a.inquilino_nombre
      ? `- ${a.inmueble}: ${a.inquilino_nombre}, ${pesos(a.monto_mensual)}/mes, vence el día ${a.dia_vencimiento}, ajuste ${a.ajuste_indice}${a.proximo_ajuste ? ` (próximo ${fechaAR(a.proximo_ajuste)})` : ""}${a.fecha_fin ? `, contrato hasta ${fechaAR(a.fecha_fin)}` : ""}; adeudado ${pesos(a.adeudado)}${Number(a.vencidos) ? ` (${a.vencidos} vencidos)` : ""}`
      : `- ${a.inmueble}: sin contrato vigente`).join("\n"));
  }
  if (d.reservas?.length) {
    p.push("RESERVAS TEMPORALES DE SALONES (desde hace 7 días):\n" + d.reservas.map((x: any) =>
      `- ${fechaAR(x.desde)}${x.hasta && x.hasta !== x.desde ? ` al ${fechaAR(x.hasta)}` : ""}${x.hora_inicio ? ` ${String(x.hora_inicio).slice(0, 5)}-${String(x.hora_fin || "").slice(0, 5)} hs` : " (todo el día)"}` +
      ` · ${x.inmueble} · ${x.cliente}${x.motivo ? ` (${x.motivo})` : ""}${x.personas ? `, ${x.personas} personas` : ""}: ${pesos(x.precio)}` +
      `${Number(x.pendiente) ? `, falta cobrar ${pesos(x.pendiente)}` : ", cobrado"}${x.contacto ? `, contacto ${x.contacto}` : ""}`).join("\n"));
  }
  if (d.facturas) {
    p.push(`FACTURACIÓN: comprobantes por estado ${Object.entries(d.facturas.por_estado || {}).map(([k, v]) => `${k} ${v}`).join(", ") || "ninguno"}; emitido este mes ${pesos(d.facturas.emitidas_mes)}.` +
      (d.facturas.con_error?.length ? " Con error: " + d.facturas.con_error.map((f: any) => `${f.receptor} (${f.concepto}): ${f.error}`).join("; ") : ""));
  }
  if (d.tesoreria) {
    const t = d.tesoreria;
    p.push(`TESORERÍA: saldos ${(t.saldos || []).map((s: any) => `${s.cuenta} ${pesos(s.saldo)}`).join(", ")}. ` +
      `Este mes: ${(t.mes || []).map((m: any) => `${m.tipo} ${m.categoria} ${pesos(m.total)}`).join("; ") || "sin movimientos"}. ` +
      `Banco Santander sin conciliar: ${t.banco_sin_conciliar?.cantidad || 0} movimientos (créditos ${pesos(t.banco_sin_conciliar?.creditos)}, débitos ${pesos(t.banco_sin_conciliar?.debitos)}).`);
  }
  if (d.comunicados?.length) {
    p.push("ÚLTIMOS COMUNICADOS:\n" + d.comunicados.map((x: any) => `- [${fechaAR(x.fecha)}] ${x.titulo}${x.publicado ? "" : " (borrador)"}: ${String(x.cuerpo).replace(/\s+/g, " ")}`).join("\n"));
  }
  if (d.accesos_pendientes?.length) {
    p.push("SOLICITUDES DE ACCESO AL PORTAL PENDIENTES: " + d.accesos_pendientes.map((x: any) => `${x.nombre || x.email} (${x.razon_social_declarada || "—"}, CUIT ${x.cuit_declarado || "—"})`).join("; ") + ".");
  }
  if (d.personal?.length) p.push("PERSONAL DEL ERP: " + d.personal.map((x: any) => `${x.nombre} (${ROLES[x.rol] || x.rol})`).join(", ") + ".");
  if (d.solicitudes_comercia?.length) {
    p.push("ÚLTIMAS CONSULTAS DE SOCIOS A COMERCIA:\n" + d.solicitudes_comercia.map((x: any) =>
      `- ${fechaAR(x.fecha)} ${x.socio_nombre || "socio"}: ${x.servicio} [${x.estado}]${x.presupuesto_estimado ? ` ~${pesos(x.presupuesto_estimado)}` : ""}`).join("\n"));
  }
  if (veSeccion(rol, "/comercia")) {
    p.push(catalogoComerciaTexto(d.ofertas || [], d.servicios || [], d.cursos_iec || [], datos?.cfg?.comercia_url_adhesion, d.promociones || [], d.convenio || [], d.novedades || []));
  }
  return p.join("\n\n");
}

export const INSTRUCCIONES_ERP = `Sos el Copiloto CeCIP del ERP administrativo del Centro Comercial e Industrial de Paraná: el asistente con IA del personal.
Cada persona tiene un rol (ver QUIEN CONSULTA y SECCIONES DEL ERP DE SU ROL) y vos sos el asistente de ESE rol: ayudás solo con el trabajo de sus secciones (sus datos y cómo hacer algo en ellas) y con tareas generales relacionadas con ese trabajo (redactar emails, mensajes de WhatsApp o comunicados, resumir, calcular, ordenar ideas).

REGLAS
1. Para datos del CeCIP (socios, montos, fechas, personas, saldos) usá SOLO el CONTEXTO. Si un dato no está, decilo y sugerí dónde verlo en el ERP. Nunca inventes cifras, nombres, CUIT ni teléfonos.
2. Para temas generales podés usar tu conocimiento, aclarando cuando algo conviene confirmarlo con el contador o un profesional (impuestos, ARCA, leyes laborales).
3. El contexto ya está filtrado según el rol de quien pregunta: no supongas datos que no figuran.
   Si preguntan por un área o un dato que no es de su rol (por ejemplo tesorería, deudas o facturación para alguien de Prensa y capacitación), NO respondas ni estimes nada: decí amablemente que esa información no está disponible para su rol y que la consulte con Administración. Tampoco expliques cómo se hace algo en secciones que no son de su rol.
4. Para "¿cómo hago...?" indicá el camino exacto en el ERP (sección → pestaña → botón), según la GUÍA DEL ERP. Si su rol es de solo consulta, aclaralo cuando pregunten cómo modificar algo.
5. Si piden redactar un mensaje para socios, usá un tono cordial y profesional (trato de "vos") y, si es para WhatsApp, breve. Podés usar variables como {{nombre}} o {{deuda}} si es para una campaña.
6. Español rioplatense, claro y directo. Usá listas con "- " y **negritas** puntuales; cuando compares varios ítems podés usar una lista numerada. Sin tablas.`;
