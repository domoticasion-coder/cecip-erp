import { supabaseAdmin } from "./core.js";
import { emailValido, sendEmails } from "./email.js";

/**
 * Cola de emails con cupo diario.
 *
 * El plan gratis de Resend permite 100 emails por día (cada CC cuenta como uno más). Los envíos
 * masivos se guardan en "email_cola" y salen de a lo que entre en el cupo del día; el resto
 * espera y lo envía el cron diario (/api/cron/recordatorios) hasta terminar.
 *
 *  EMAIL_LIMITE_DIARIO   cupo del plan (por defecto 100; 0 = sin límite, p. ej. plan Pro)
 *  EMAIL_RESERVA_DIARIA  emails por día que la cola deja libres para los envíos individuales,
 *                        avisos de acceso, etc. (por defecto 10)
 */

export interface EmailParaCola {
  socio_id?: string | null;
  comunicado_id?: string | null;
  tipo: "comunicado" | "recordatorio" | "manual" | "comercia";
  to: string;
  cc?: string[];
  subject: string;
  text?: string;
  html: string;
  cuota_ids?: string[];
}

export interface ResultadoCola {
  /** emails que salieron en esta pasada (de este lote) */
  enviados: number;
  /** emails de este lote que quedaron esperando cupo */
  pendientes: number;
  /** emails de este lote que fallaron */
  errores: { socio: string; error: string }[];
  /** cupo que queda hoy después de esta pasada (null = sin límite) */
  cupo_restante: number | null;
  /** emails por día que puede enviar la cola (null = sin límite) */
  cupo_diario: number | null;
}

const MAX_POR_PASADA = 500; // tope por ejecución para no pasar los 60 s de Vercel

export function limitesDiarios() {
  const limite = Number(process.env.EMAIL_LIMITE_DIARIO ?? 100);
  const reserva = Number(process.env.EMAIL_RESERVA_DIARIA ?? 10);
  if (!Number.isFinite(limite) || limite <= 0) return { limite: null, cola: null };
  return { limite, cola: Math.max(0, limite - Math.max(0, reserva)) };
}

/** Inicio del día de hoy en Argentina, en ISO */
function inicioDelDia() {
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
  return new Date(`${hoy}T00:00:00-03:00`).toISOString();
}

/** Emails (incluidas las copias) que ya salieron hoy */
export async function usadosHoy(): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("envios").select("copias").eq("canal", "email").eq("estado", "enviado").gte("created_at", inicioDelDia());
  if (error) throw new Error(error.message);
  return (data || []).reduce((a, r) => a + 1 + Number(r.copias || 0), 0);
}

/** Cupo que le queda hoy a la cola (null = sin límite) */
export async function cupoRestante(): Promise<number | null> {
  const { cola, limite } = limitesDiarios();
  if (limite === null || cola === null) return null;
  return Math.max(0, cola - (await usadosHoy()));
}

/** Errores de Resend que significan "se acabó el cupo": el email vuelve a la cola */
const esFaltaDeCupo = (e?: string) => !!e && /Resend 429|quota|rate.?limit|daily/i.test(e);

/** Envía los pendientes más antiguos que entren en el cupo de hoy */
export async function procesarCola(): Promise<{ enviados: number; errores: number; pendientes: number; cupo_restante: number | null }> {
  const sb = supabaseAdmin();

  // Los que quedaron "enviando" por una ejecución que se cortó vuelven a la cola
  await sb.from("email_cola").update({ estado: "pendiente" }).eq("estado", "enviando")
    .lt("procesado_at", new Date(Date.now() - 15 * 60000).toISOString());

  let cupo = await cupoRestante();
  const tope = cupo === null ? MAX_POR_PASADA : Math.min(cupo, MAX_POR_PASADA);

  let enviados = 0, errores = 0;
  if (tope > 0) {
    const { data: candidatos, error } = await sb.from("email_cola").select("id, cc")
      .eq("estado", "pendiente").order("created_at").order("id").limit(tope);
    if (error) throw new Error(error.message);

    // Cada email consume 1 + sus copias
    const elegidos: string[] = [];
    let usa = 0;
    for (const c of candidatos || []) {
      const costo = 1 + (c.cc?.length || 0);
      if (usa + costo > tope) break;
      usa += costo;
      elegidos.push(c.id);
    }

    if (elegidos.length) {
      // Se "toman" para que dos ejecuciones simultáneas no envíen el mismo email
      const { data: filas, error: e2 } = await sb.from("email_cola")
        .update({ estado: "enviando", procesado_at: new Date().toISOString() })
        .in("id", elegidos).eq("estado", "pendiente").select("*");
      if (e2) throw new Error(e2.message);
      const lista = (filas || []).sort((a, b) => a.created_at.localeCompare(b.created_at));

      const res = lista.length
        ? await sendEmails(lista.map((f) => ({ to: f.destinatario, cc: f.cc, subject: f.asunto, text: f.texto || undefined, html: f.html })))
        : [];

      const ahora = new Date().toISOString();
      const ok: string[] = [], sinCupo: string[] = [], fallidos: { id: string; error: string }[] = [];
      res.forEach((r, i) => {
        const f = lista[i];
        if (r.ok) ok.push(f.id);
        else if (esFaltaDeCupo(r.error)) sinCupo.push(f.id);
        else fallidos.push({ id: f.id, error: (r.error || "Error de envío").slice(0, 500) });
      });

      if (ok.length) await sb.from("email_cola").update({ estado: "enviado", procesado_at: ahora, error: null }).in("id", ok);
      if (sinCupo.length) await sb.from("email_cola").update({ estado: "pendiente" }).in("id", sinCupo);
      for (const f of fallidos) await sb.from("email_cola").update({ estado: "error", procesado_at: ahora, error: f.error }).eq("id", f.id);

      // Historial de envíos (los que vuelven a la cola no se registran todavía)
      const porId = new Map(lista.map((f) => [f.id, f]));
      const logs = [...ok.map((id) => ({ id, ok: true, error: null as string | null })), ...fallidos.map((f) => ({ id: f.id, ok: false, error: f.error }))]
        .map(({ id, ok: bien, error: err }) => {
          const f = porId.get(id)!;
          return {
            socio_id: f.socio_id, comunicado_id: f.comunicado_id, canal: "email", tipo: f.tipo, asunto: f.asunto,
            destinatario: f.destinatario, estado: bien ? "enviado" : "error", error: err, created_by: f.created_by,
            copias: bien ? f.cc?.length || 0 : 0,
          };
        });
      if (logs.length) await sb.from("envios").insert(logs);

      // Recordatorios: se marca la fecha del aviso en las cuotas
      const cuotas = ok.flatMap((id) => porId.get(id)!.cuota_ids || []);
      if (cuotas.length) await sb.from("cuotas").update({ ultimo_recordatorio: ahora }).in("id", cuotas);

      enviados = ok.length;
      errores = fallidos.length;
      if (cupo !== null) cupo = sinCupo.length ? 0 : Math.max(0, cupo - ok.reduce((a, id) => a + 1 + (porId.get(id)!.cc?.length || 0), 0));
    }
  }

  const { count } = await sb.from("email_cola").select("id", { count: "exact", head: true }).in("estado", ["pendiente", "enviando"]);
  return { enviados, errores, pendientes: count || 0, cupo_restante: cupo };
}

/**
 * Guarda un envío masivo en la cola y envía enseguida lo que entre en el cupo de hoy.
 * Lo que no entra sale solo en los días siguientes.
 */
export async function encolarEmails(mensajes: EmailParaCola[], createdBy: string | null): Promise<ResultadoCola> {
  const { cola } = limitesDiarios();
  if (!mensajes.length) return { enviados: 0, pendientes: 0, errores: [], cupo_restante: await cupoRestante(), cupo_diario: cola };

  const sb = supabaseAdmin();
  const loteId = crypto.randomUUID();
  // created_at escalonado de a 1 ms para que la cola respete el orden del lote
  const base = Date.now();
  const filas = mensajes.map((m, i) => ({
    lote_id: loteId,
    socio_id: m.socio_id || null,
    comunicado_id: m.comunicado_id || null,
    tipo: m.tipo,
    destinatario: m.to,
    cc: m.cc || [],
    asunto: m.subject.slice(0, 300),
    texto: m.text || null,
    html: m.html,
    cuota_ids: m.cuota_ids || [],
    created_by: createdBy,
    created_at: new Date(base + i).toISOString(),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb.from("email_cola").insert(filas.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  const r = await procesarCola();

  const { data: lote } = await sb.from("email_cola").select("estado, destinatario, error").eq("lote_id", loteId);
  const deLote = lote || [];
  return {
    enviados: deLote.filter((f) => f.estado === "enviado").length,
    pendientes: deLote.filter((f) => f.estado === "pendiente" || f.estado === "enviando").length,
    errores: deLote.filter((f) => f.estado === "error").map((f) => ({ socio: f.destinatario, error: f.error || "Error de envío" })),
    cupo_restante: r.cupo_restante,
    cupo_diario: cola,
  };
}

/** Cancela los emails que todavía no salieron de un lote (o de todos si no se indica) */
export async function cancelarPendientes(loteId?: string): Promise<number> {
  let q = supabaseAdmin().from("email_cola").update({ estado: "cancelado", procesado_at: new Date().toISOString() }).eq("estado", "pendiente");
  if (loteId) q = q.eq("lote_id", loteId);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return data?.length || 0;
}

/**
 * Vuelve a poner en cola los emails que fallaron (de un lote o de todos), salvo los de direcciones
 * inválidas, que seguirían fallando: esos hay que corregirlos en la ficha del socio.
 */
export async function reintentarErrores(loteId?: string): Promise<{ reintentados: number; invalidos: number }> {
  let q = supabaseAdmin().from("email_cola").select("id, destinatario").eq("estado", "error");
  if (loteId) q = q.eq("lote_id", loteId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const ok = (data || []).filter((f) => emailValido(f.destinatario)).map((f) => f.id);
  for (let i = 0; i < ok.length; i += 200) {
    const { error: e2 } = await supabaseAdmin().from("email_cola").update({ estado: "pendiente", error: null, procesado_at: null }).in("id", ok.slice(i, i + 200));
    if (e2) throw new Error(e2.message);
  }
  return { reintentados: ok.length, invalidos: (data || []).length - ok.length };
}
