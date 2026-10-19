/**
 * MODO DEMO: reemplazo de las funciones /api. No se envían emails ni se contacta a Mercado Pago:
 * los envíos se registran en el historial como si hubieran salido y los links llevan a un
 * checkout de prueba (/portal/demo-pago).
 */
import { PORTAL_URL } from "../lib/appMode";
import { lit, rpc, sqlComo, usuarioActual } from "./demoClient";
import type { Identidad } from "./demoDb";
import { armarContexto } from "../../shared/copilotContexto";
import { armarContextoErp } from "../../shared/copilotErp";
import { rolCopiloto, tienePermiso } from "../../shared/roles";

const SERVICIO: Identidad = { userId: null, role: "service_role" };
const SUPER: Identidad = { userId: null, role: "postgres" };

async function q(who: Identidad, sql: string) {
  const { rows, error } = await sqlComo(who, sql);
  if (error) throw new Error(error.message);
  return rows;
}

const ids = (arr?: string[]) => `(${(arr || []).map(lit).join(",") || "null"})`;

// Cola de emails: plan gratis de Resend (100 por día) menos 10 reservados para envíos individuales
const CUPO_COLA_DEMO = 90;

async function usadosHoyDemo(): Promise<number> {
  const [r] = await q(SERVICIO, "select coalesce(sum(1 + copias), 0)::int as n from envios where canal = 'email' and estado = 'enviado' and created_at >= date_trunc('day', now())");
  return r.n;
}

/** Envía (simula) los pendientes de la cola que entren en el cupo de hoy */
async function procesarColaDemo() {
  const cupo = Math.max(0, CUPO_COLA_DEMO - (await usadosHoyDemo()));
  let enviados = 0;
  if (cupo > 0) {
    const filas = await q(SERVICIO, `update email_cola set estado = 'enviado', procesado_at = now()
      where id in (select id from email_cola where estado = 'pendiente' order by created_at, id limit ${cupo}) returning *`);
    if (filas.length) {
      await q(SERVICIO, `insert into envios (socio_id, comunicado_id, canal, tipo, asunto, destinatario, created_by) values ${filas
        .map((f: any) => `(${lit(f.socio_id)}, ${lit(f.comunicado_id)}, 'email', ${lit(f.tipo)}, ${lit(f.asunto + " (DEMO: no enviado)")}, ${lit(f.destinatario)}, ${lit(f.created_by)})`).join(", ")}`);
    }
    enviados = filas.length;
  }
  const [p] = await q(SERVICIO, "select count(*)::int as n from email_cola where estado = 'pendiente'");
  return { enviados, errores: 0, pendientes: p.n, cupo_restante: Math.max(0, cupo - enviados) };
}

export async function demoApi(path: string, body: any = {}): Promise<any> {
  await new Promise((r) => setTimeout(r, 350)); // simula la demora de red
  const yo = usuarioActual();
  if (!yo) throw new Error("No autenticado.");
  const comoYo: Identidad = { userId: yo.id, role: "authenticated" };

  switch (path) {
    case "pagos/link": {
      const [mi] = await q(comoYo, "select my_socio_id() as id");
      const socioId = mi?.id || body.socio_id;
      if (!socioId) throw new Error("No tenés un socio asociado.");
      let sql = `select id, total from cuotas_detalle where socio_id = ${lit(socioId)} and estado = 'pendiente'`;
      if (body.cuota_ids?.length) sql += ` and id in ${ids(body.cuota_ids)}`;
      const cuotas = await q(SERVICIO, sql);
      if (!cuotas.length) throw new Error("No hay cuotas pendientes para cobrar.");
      const total = Math.round(cuotas.reduce((a: number, c: any) => a + Number(c.total), 0) * 100) / 100;
      const url = `${PORTAL_URL}/demo-pago?ids=${cuotas.map((c: any) => c.id).join(",")}`;
      return { id: "demo", url, total, cuotas: cuotas.length };
    }

    case "pagos/verificar":
      return { estado: "demo" };

    case "cobranzas/recordatorio": {
      let sql = `select s.id, s.email, coalesce(s.nombre_comercial, s.razon_social) as nombre, count(c.id) as n
        from socios s join cuotas c on c.socio_id = s.id and c.estado = 'pendiente'
        where s.id in ${ids(body.socio_ids)}`;
      if (body.cuota_ids?.length) sql += ` and c.id in ${ids(body.cuota_ids)}`;
      sql += " group by s.id";
      const socios = await q(SERVICIO, sql);
      const con = socios.filter((s: any) => s.email);
      if (con.length) {
        await q(SERVICIO, `insert into envios (socio_id, canal, tipo, asunto, destinatario, created_by) values ${con
          .map((s: any) => `(${lit(s.id)}, 'email', 'recordatorio', 'Recordatorio de cuota (DEMO: no enviado)', ${lit(s.email)}, ${lit(yo.id)})`).join(", ")}`);
        await q(SERVICIO, `update cuotas set ultimo_recordatorio = now() where estado = 'pendiente' and socio_id in ${ids(con.map((s: any) => s.id))}`);
      }
      return { enviados: con.length, errores: socios.filter((s: any) => !s.email).map((s: any) => ({ socio: s.nombre, error: "Sin email válido" })) };
    }

    case "comunicaciones/enviar": {
      if (body.para !== undefined) {
        const dirs = String(body.para).split(/[\s,;]+/).map((e: string) => e.trim()).filter(Boolean);
        if (!dirs.length) throw new Error("Escribí el email del destinatario.");
        if (!body.asunto?.trim() || !body.cuerpo?.trim()) throw new Error("Completá asunto y mensaje.");
        await q(SERVICIO, `insert into envios (canal, tipo, asunto, destinatario, created_by) values ${dirs
          .map((d: string) => `('email', 'manual', ${lit(body.asunto + " (DEMO: no enviado)")}, ${lit(d)}, ${lit(yo.id)})`).join(", ")}`);
        return { enviados: dirs.length, errores: [] };
      }
      const socios = await q(SERVICIO, `select id, email, coalesce(nombre_comercial, razon_social) as nombre from socios where id in ${ids(body.socio_ids)}`);
      const con = socios.filter((s: any) => s.email);
      // Igual que en producción: todo pasa por la cola con cupo diario
      const [{ lote }] = await q(SERVICIO, "select gen_random_uuid() as lote");
      if (con.length) {
        await q(SERVICIO, `insert into email_cola (lote_id, socio_id, comunicado_id, tipo, destinatario, asunto, texto, html, created_by, created_at) values ${con
          .map((s: any, i: number) => `(${lit(lote)}, ${lit(s.id)}, ${lit(body.comunicado_id || null)}, ${lit(body.comunicado_id ? "comunicado" : "manual")}, ${lit(s.email)},
            ${lit(body.asunto)}, ${lit(body.cuerpo)}, '<p>demo</p>', ${lit(yo.id)}, now() + interval '${i} milliseconds')`).join(", ")}`);
        await procesarColaDemo();
      }
      const [r] = await q(SERVICIO, `select count(*) filter (where estado = 'enviado')::int as enviados, count(*) filter (where estado = 'pendiente')::int as pendientes from email_cola where lote_id = ${lit(lote)}`);
      return { ...r, cupo_diario: CUPO_COLA_DEMO, errores: socios.filter((s: any) => !s.email).map((s: any) => ({ socio: s.nombre, error: "Sin email válido" })) };
    }

    case "integraciones/cola-emails": {
      const usados = await usadosHoyDemo();
      return { limite_diario: 100, cupo_cola: CUPO_COLA_DEMO, usados_hoy: usados, cupo_restante: Math.max(0, CUPO_COLA_DEMO - usados) };
    }

    case "integraciones/cola-emails-procesar":
      return procesarColaDemo();

    case "integraciones/cola-emails-cancelar": {
      const filas = await q(SERVICIO, `update email_cola set estado = 'cancelado', procesado_at = now() where estado = 'pendiente'
        ${body.lote_id ? `and lote_id = ${lit(body.lote_id)}` : ""} returning id`);
      return { cancelados: filas.length };
    }

    case "accesos/resolver": {
      const r = await rpc("resolver_acceso", {
        p_user_id: body.user_id, p_aprobar: body.aprobar, p_socio_id: body.socio_id || null, p_motivo: body.motivo || null,
      }, comoYo);
      if (r.error) throw new Error(r.error.message);
      return { ok: true, email_enviado: true };
    }

    case "staff/invitar": {
      const [st] = await q(comoYo, "select rol from staff where user_id = auth.uid()");
      if (st?.rol !== "admin") throw new Error("Solo un administrador puede invitar personal.");
      if (!body.nombre?.trim() || !body.email?.trim()) throw new Error("Completá nombre y email.");
      const [u] = await q(SUPER, `insert into auth.users (email) values (${lit(body.email.trim().toLowerCase())}) returning id`);
      await q(SUPER, `insert into staff (user_id, nombre, email, rol) values (${lit(u.id)}, ${lit(body.nombre.trim())}, ${lit(body.email.trim().toLowerCase())}, ${lit(body.rol)})`);
      return { ok: true };
    }

    case "comercia/difundir": {
      const [st] = await q(comoYo, "select rol from staff where user_id = auth.uid()");
      if (!["comercia", "admin"].includes(st?.rol)) throw new Error("Solo el equipo de ComercIA puede hacer esta difusión.");
      let sql = "select id, email from socios where estado = 'activo' and email is not null";
      if (body.rubro?.trim()) sql += ` and rubro ilike ${lit("%" + body.rubro.trim() + "%")}`;
      if (body.categoria_id) sql += ` and categoria_id = ${lit(body.categoria_id)}`;
      const socios = await q(SERVICIO, sql);
      if (body.soloContar) return { destinatarios: socios.length };
      if (!body.asunto?.trim() || !body.cuerpo?.trim()) throw new Error("Completá asunto y mensaje.");
      if (socios.length) {
        await q(SERVICIO, `insert into envios (socio_id, canal, tipo, asunto, destinatario, created_by) values ${socios
          .map((s: any) => `(${lit(s.id)}, 'email', 'comercia', ${lit(body.asunto + " (DEMO: no enviado)")}, ${lit(s.email)}, ${lit(yo.id)})`).join(", ")}`);
      }
      return { enviados: socios.length, errores: 0 };
    }

    // Facturación ARCA vía n8n: en la demo se simula la respuesta con un CAE de prueba
    case "integraciones/estado":
      return {
        facturas: true, banco: true, secreto: true,
        callback_facturas: `${window.location.origin}/api/integraciones/facturas-callback (DEMO)`,
        endpoint_banco: `${window.location.origin}/api/integraciones/banco-movimientos (DEMO)`,
      };

    case "integraciones/facturas-procesar": {
      const [st] = await q(comoYo, "select rol from staff where user_id = auth.uid()");
      if (!tienePermiso(st?.rol, ["tesoreria"])) throw new Error("Tu rol no tiene permiso para esta acción.");
      let sql = "select id, receptor_cuit, punto_venta, tipo from facturas";
      sql += body.ids?.length ? ` where id in ${ids(body.ids)} and estado in ('en_cola', 'error')` : " where estado = 'en_cola'";
      const facturas = await q(SERVICIO, sql + " order by created_at limit 40");
      let emitidas = 0, errores = 0;
      for (const f of facturas) {
        const cuit = String(f.receptor_cuit || "").replace(/\D/g, "");
        if (cuit && cuit.length !== 11) {
          errores++;
          await q(SERVICIO, `update facturas set estado = 'error', intentos = intentos + 1, error = '10015: El documento del receptor no es válido (DEMO)' where id = ${lit(f.id)}`);
          continue;
        }
        emitidas++;
        await q(SERVICIO, `update facturas set estado = 'emitida', intentos = intentos + 1, enviada_at = now(), emitida_at = now(), error = null,
          numero = coalesce((select max(numero) from facturas where tipo = ${lit(f.tipo)}), 1000) + 1,
          punto_venta = coalesce(punto_venta, 3),
          cae = '7' || lpad((floor(random() * 1e13))::bigint::text, 13, '0'), cae_vencimiento = current_date + 10
          where id = ${lit(f.id)}`);
      }
      return { enviadas: facturas.length, emitidas, errores };
    }

    case "integraciones/banco-sincronizar": {
      const hoy = new Date().toISOString().slice(0, 10);
      const socios = await q(SERVICIO, `select s.razon_social, s.cuit, c.total from cuotas_detalle c join socios s on s.id = c.socio_id
        where c.estado = 'pendiente' and s.cuit is not null order by random() limit 3`);
      const filas = [
        ...socios.map((s: any, i: number) => `('Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-${Date.now()}-${i}', '${hoy}',
          ${lit("TRANSFERENCIA RECIBIDA " + s.razon_social)}, ${Number(s.total)}, ${lit(s.razon_social)}, ${lit(s.cuit)})`),
        `('Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-${Date.now()}-c', '${hoy}', 'COMISION MANTENIMIENTO CUENTA', -8450, null, null)`,
      ];
      const nuevos = await q(SERVICIO, `insert into banco_movimientos (banco, cuenta_id, id_externo, fecha, descripcion, monto, contraparte_nombre, contraparte_cuit)
        values ${filas.join(", ")} on conflict do nothing returning id`);
      return { recibidos: filas.length, nuevos: nuevos.length };
    }

    case "comunicaciones/variantes": {
      const res = await fetch("/dev-api/variantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: body.mensaje, cantidad: body.cantidad }),
      }).catch(() => null);
      if (!res || res.status === 503) throw new Error("Para generar variantes con IA cargá GEMINI_API_KEY en el archivo .env (o escribí las variantes a mano).");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudieron generar variantes.");
      return json;
    }

    case "copilot": {
      if (body.ambito === "erp") return { respuesta: await copilotoErp(comoYo, body) };
      const real = await copilotoGemini(comoYo, body);
      if (real) return { respuesta: real };
      return { respuesta: await copilotoDemo(comoYo, String(body.pregunta || "")) };
    }
  }
  throw new Error(`Función no disponible en demo: ${path}`);
}

/**
 * Si hay GEMINI_API_KEY en el .env, la demo usa la IA real: arma el mismo contexto que la versión
 * de producción (con los datos de la base de ejemplo) y lo envía al servidor local de desarrollo.
 * Devuelve null si no hay clave configurada.
 */
async function copilotoGemini(comoYo: Identidad, body: any): Promise<string | null> {
  const [mi] = await q(comoYo, "select my_socio_id() as id");
  const socioId = mi?.id ? lit(mi.id) : "null";
  const [cfg, socio, cuotas, comunicados, eventos, conocimiento, ofertas, servicios, cursos, promociones, convenio, novedades] = await Promise.all([
    q(SERVICIO, "select * from configuracion where id = 1"),
    q(SERVICIO, `select * from socios_resumen where id = ${socioId}`),
    q(SERVICIO, `select concepto, vencimiento, total, situacion, estado, fecha_pago from cuotas_detalle where socio_id = ${socioId} and estado <> 'anulada' order by vencimiento desc limit 12`),
    q(SERVICIO, "select titulo, cuerpo, fecha_publicacion from comunicados where publicado order by fecha_publicacion desc limit 8"),
    q(SERVICIO, "select titulo, descripcion, tipo, fecha_inicio, lugar, modalidad, costo, cupo, inscripcion_abierta from eventos where publicado and fecha_inicio >= now() order by fecha_inicio limit 10"),
    q(SERVICIO, "select titulo, contenido from conocimiento_cecip where activo order by orden"),
    q(SERVICIO, "select * from comercia_ofertas where activa order by orden"),
    q(SERVICIO, "select * from iec_servicios where activo order by orden"),
    q(SERVICIO, "select * from iec_cursos where activo order by orden"),
    q(SERVICIO, "select * from comercia_promociones where activa and (vigente_hasta is null or vigente_hasta >= current_date) order by orden"),
    q(SERVICIO, "select * from comercia_convenio where activo order by orden"),
    q(SERVICIO, "select titulo, cuerpo from comercia_novedades where publicada order by orden limit 6"),
  ]);
  const contexto = armarContexto({
    cfg: cfg[0] || null, socio: socio[0] || null, cuotas, comunicados, eventos, conocimiento, ofertas, servicios, cursos, promociones, convenio, novedades,
  });

  const res = await fetch("/dev-api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contexto, historial: body.historial || [], pregunta: body.pregunta || "" }),
  }).catch(() => null);
  if (!res || res.status === 503 || res.status === 404) return null; // sin clave: respuestas automáticas
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "No se pudo consultar a Gemini.");
  return json.respuesta;
}

/** Copiloto del ERP en la demo: mismos datos (función SQL) y la IA real si hay GEMINI_API_KEY en el .env */
async function copilotoErp(comoYo: Identidad, body: any): Promise<string> {
  const [st] = await q(comoYo, "select nombre, rol from staff where user_id = auth.uid() and activo");
  if (!st) throw new Error("Acceso solo para el personal de CeCIP.");
  const historial: { rol: string; texto: string }[] = Array.isArray(body.historial) ? body.historial : [];
  const busqueda = [body.pregunta, ...historial.filter((m) => m.rol === "usuario").slice(-2).map((m) => m.texto)].join(" ");
  const [fila] = await q(SUPER, `select datos_copiloto_erp(${lit(rolCopiloto(st.rol))}, ${lit(busqueda)}) as d`);
  const contexto = armarContextoErp(fila.d, st);
  const res = await fetch("/dev-api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contexto, historial, pregunta: body.pregunta || "", ambito: "erp" }),
  }).catch(() => null);
  if (!res || res.status === 503 || res.status === 404) {
    return "El Copiloto del ERP necesita la IA (Gemini): cargá **GEMINI_API_KEY** en el archivo .env y reiniciá la demo.\n\n" +
      `Mientras tanto, un dato del sistema: hay **${fila.d.resumen?.socios_activos ?? "—"} socios activos** y **${fila.d.resumen?.socios_morosos ?? "—"}** con cuotas vencidas.`;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "No se pudo consultar a Gemini.");
  return json.respuesta;
}

const pesosAR = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);
const fechaAR = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("es-AR");

/**
 * En la demo no hay Gemini: el Copiloto responde por palabras clave con los datos reales de la base de ejemplo.
 * En producción responde la IA (api/copilot.ts) con todo el contexto.
 */
async function copilotoDemo(comoYo: Identidad, pregunta: string): Promise<string> {
  const p = pregunta.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const nota = "\n\n(Modo demo sin IA: respuesta automática. Cargá GEMINI_API_KEY en el archivo .env y reiniciá la demo para chatear con la IA real.)";
  const [mi] = await q(comoYo, "select my_socio_id() as id");
  const [cfg] = await q(SERVICIO, "select * from configuracion where id = 1");

  if (/pag|transfer|mercado|cbu|alias/.test(p)) {
    return "Podés pagar tu cuota de dos formas:\n\n- **Online:** en **Mis cuotas**, tocá *Pagar* y abonás con Mercado Pago (tarjeta, débito o dinero en cuenta). El recibo queda disponible al instante.\n" +
      `- **Transferencia:** ${[cfg?.banco, cfg?.titular && `titular ${cfg.titular}`, cfg?.cbu && `CBU ${cfg.cbu}`, cfg?.alias && `alias ${cfg.alias}`].filter(Boolean).join(", ")}. Enviá el comprobante a la administración.` +
      `\n\nLa cuota vence el día ${cfg?.dia_vencimiento} de cada mes${Number(cfg?.interes_mensual) ? ` y después se aplica un ${cfg.interes_mensual}% mensual de interés` : ""}.` + nota;
  }
  if (/deb|deuda|vence|venc|cuota|saldo|atras/.test(p) && mi?.id) {
    const cuotas = await q(SERVICIO, `select concepto, total, vencimiento, situacion from cuotas_detalle where socio_id = ${lit(mi.id)} and estado = 'pendiente' order by vencimiento`);
    if (!cuotas.length) return "¡Estás **al día**! No tenés cuotas pendientes. Podés ver y descargar tus recibos en **Mis cuotas**." + nota;
    const total = cuotas.reduce((a: number, c: any) => a + Number(c.total), 0);
    return `Tenés **${cuotas.length} cuota(s) pendiente(s)** por un total de **${pesosAR(total)}**:\n\n` +
      cuotas.map((c: any) => `- ${c.concepto}: ${pesosAR(Number(c.total))}, vence el ${fechaAR(c.vencimiento)}${c.situacion === "vencida" ? " (vencida)" : ""}`).join("\n") +
      "\n\nPodés pagar online desde **Mis cuotas** con Mercado Pago." + nota;
  }
  if (/comercia|iec|oferta|factoria|digital|web|tecnic|electric|curso/.test(p)) {
    const ofertas = await q(SERVICIO, "select titulo, solucion from comercia_ofertas where activa order by orden");
    const servicios = await q(SERVICIO, "select nombre from iec_servicios where activo order by orden");
    return "Con **ComercIA** (convenio CeCIP + FactorIA + IEC Services) tenés estas ofertas para tu comercio:\n\n" +
      ofertas.map((o: any) => `- **${o.titulo}:** ${o.solucion}`).join("\n") +
      `\n\nY en **IEC Services**: ${servicios.map((s: any) => s.nombre).join(", ")}, además de cursos con certificación.` +
      "\n\nEntrá a la sección **ComercIA** del portal y tocá *Pedir información*: te contactan por WhatsApp desde FactorIA." + nota;
  }
  if (/capacit|evento|curso|charla|taller|inscrib/.test(p)) {
    const ev = await q(comoYo, "select titulo, fecha_inicio, lugar, modalidad, costo from eventos where publicado and fecha_inicio > now() order by fecha_inicio limit 5");
    if (!ev.length) return "Por ahora no hay eventos publicados. Te avisamos por los comunicados del portal." + nota;
    return "Estas son las próximas actividades:\n\n" + ev.map((e: any) =>
      `- **${e.titulo}**: ${new Date(e.fecha_inicio).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}, ${e.modalidad === "virtual" ? "virtual" : e.lugar}, ${Number(e.costo) > 0 ? pesosAR(Number(e.costo)) : "sin costo"}`).join("\n") +
      "\n\nTe inscribís desde **Eventos y capacitaciones**." + nota;
  }
  if (/benefic|convenio|descuento|asesor/.test(p)) {
    return "Como socio del CeCIP tenés, entre otros beneficios:\n\n- Asesoramiento legal, laboral, contable e impositivo gratuito.\n- Informes comerciales (Veraz, Nosis) a tarifa bonificada.\n- Capacitaciones gratuitas o bonificadas con certificado.\n- Uso bonificado del salón de actos y salas de reunión.\n- Bolsa de empleo sin costo de agencia.\n- Convenios y descuentos, y el programa **ComercIA** para digitalizar tu comercio." + nota;
  }
  if (/sede|direcc|horario|telefono|donde|contacto|email|whatsapp/.test(p)) {
    return "La sede del CeCIP está en **25 de Mayo 28, 1º piso, Paraná**. Atiende de **lunes a viernes de 9 a 17 hs**.\n\n- Teléfono: (0343) 431-2785\n- WhatsApp: 343 457-5070\n- Email: info@centrocomercialparana.com.ar" + nota;
  }
  return "Puedo ayudarte con tu **estado de cuenta y cuotas**, **cómo pagar**, los **beneficios para socios**, **eventos y capacitaciones**, la **sede y horarios** y las **ofertas de ComercIA e IEC Services**. ¿Sobre cuál querés saber?" + nota;
}

/** Acredita las cuotas como si Mercado Pago hubiera aprobado el pago */
export async function demoAcreditarPago(cuotaIds: string[]) {
  const cuotas = await q(SERVICIO, `select id, total from cuotas_detalle where estado = 'pendiente' and id in ${ids(cuotaIds)}`);
  const ref = "MP DEMO-" + Date.now();
  for (const c of cuotas) {
    const r = await rpc("registrar_pago", { p_cuota_id: c.id, p_metodo: "Mercado Pago", p_cuenta_id: null, p_fecha: new Date().toISOString().slice(0, 10), p_referencia: ref, p_monto: c.total }, SERVICIO);
    if (r.error) throw new Error(r.error.message);
  }
  return cuotas.length;
}

export async function demoResumenPago(cuotaIds: string[]) {
  return q(SERVICIO, `select id, concepto, total, coalesce(nombre_comercial, razon_social) as socio, estado
    from cuotas_detalle where id in ${ids(cuotaIds)} order by vencimiento`);
}
