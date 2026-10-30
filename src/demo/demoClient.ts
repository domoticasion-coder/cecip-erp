/**
 * MODO DEMO: imitación del cliente de Supabase que traduce las consultas a SQL y las ejecuta
 * en la base local (PGlite) con la identidad del usuario actual, así los permisos (RLS) son los reales.
 * Cubre solo las operaciones que usa esta aplicación.
 */
import { DEMO_USERS, runAs, type Identidad } from "./demoDb";
import { appMode } from "../lib/appMode";

type Result = { data: any; error: { message: string; code?: string } | null; count?: number | null };

const ident = (c: string) => {
  const t = c.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`Columna inválida: ${c}`);
  return t;
};

export function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  // Listas de texto (columnas text[]); las listas de objetos van como JSON (columnas jsonb)
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
    return v.length ? `array[${v.map(lit).join(", ")}]::text[]` : "'{}'";
  }
  // Listas de números (columnas int[], ej. días de la semana)
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number")) return `array[${v.map(lit).join(", ")}]::int[]`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Columnas jsonb que reciben listas (una lista vacía tiene que ir como [] y no como {} de text[])
const JSONB_COLS = new Set(["preguntas", "items", "respuestas", "mensajes"]);
const litCol = (col: string, v: unknown) =>
  JSONB_COLS.has(col) && v !== null && v !== undefined ? `'${JSON.stringify(v).replace(/'/g, "''")}'` : lit(v);

// ---------------------------------------------------------------------------
// Sesión simulada
// ---------------------------------------------------------------------------

type DemoUser = { id: string; email: string };
export const DEMO_PASSWORD = "demo1234";
const storageKey = `cecip-demo-${appMode.app}-user`;

function leerUsuario(): DemoUser | null {
  try {
    const v = localStorage.getItem(storageKey);
    if (v) return JSON.parse(v);
  } catch { /* sin storage */ }
  return null; // la demo empieza en la pantalla de ingreso
}

let usuario: DemoUser | null = leerUsuario();
const listeners = new Set<(event: string, session: any) => void>();
const sesion = () => (usuario ? { access_token: "demo", user: { id: usuario.id, email: usuario.email } } : null);

function cambiarUsuario(u: DemoUser | null) {
  usuario = u;
  try {
    if (u) localStorage.setItem(storageKey, JSON.stringify(u));
    else localStorage.removeItem(storageKey);
  } catch { /* sin storage */ }
  const s = sesion();
  listeners.forEach((cb) => cb(u ? "SIGNED_IN" : "SIGNED_OUT", s));
}

/** Cambia el usuario de la demo (para probar los distintos roles) */
export function demoEntrarComo(key: keyof typeof DEMO_USERS) {
  const u = DEMO_USERS[key];
  cambiarUsuario({ id: u.id, email: u.email });
}

const identidad = (): Identidad => (usuario ? { userId: usuario.id, role: "authenticated" } : { userId: null, role: "anon" });

async function ejecutar(sql: string, who: Identidad = identidad()): Promise<{ rows: any[]; error: Result["error"] }> {
  try {
    return { rows: await runAs(who, sql), error: null };
  } catch (e) {
    const msg = (e as Error).message;
    console.warn("[demo SQL]", msg, "\n", sql);
    return { rows: [], error: { message: msg } };
  }
}

// ---------------------------------------------------------------------------
// Constructor de consultas (subconjunto de PostgREST)
// ---------------------------------------------------------------------------

const EMBEDS: Record<string, Record<string, { kind: "count" | "one"; fk: string }>> = {
  eventos: { inscripciones: { kind: "count", fk: "evento_id" } },
  comercia_solicitudes: { socios: { kind: "one", fk: "socio_id" } },
};

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

function condicion(c: string): string {
  if (c.startsWith("and(")) return "(" + splitTop(c.slice(4, -1)).map(condicion).join(" and ") + ")";
  if (c.startsWith("or(")) return "(" + splitTop(c.slice(3, -1)).map(condicion).join(" or ") + ")";
  const [col, op, ...rest] = c.split(".");
  const val = rest.join(".");
  const ops: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  if (op === "is") return `${ident(col)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`;
  if (ops[op]) return `${ident(col)} ${ops[op]} ${lit(val)}`;
  throw new Error(`Operador no soportado en demo: ${op}`);
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private cols = "*";
  private returning: string | null = null;
  private head = false;
  private wantCount = false;
  private filters: string[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private off = 0;
  private one: "single" | "maybe" | null = null;
  private payload: any;
  private conflicto: { cols: string[]; ignorar: boolean } | null = null;

  constructor(private table: string) {
    ident(table);
  }

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.cols = cols;
      this.head = !!opts?.head;
      this.wantCount = !!opts?.count;
    } else this.returning = cols;
    return this;
  }
  insert(v: any) { this.op = "insert"; this.payload = Array.isArray(v) ? v : [v]; return this; }
  upsert(v: any, o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.insert(v);
    this.conflicto = { cols: (o?.onConflict || "id").split(",").map(ident), ignorar: !!o?.ignoreDuplicates };
    return this;
  }
  update(v: any) { this.op = "update"; this.payload = v; return this; }
  delete() { this.op = "delete"; return this; }

  eq(c: string, v: unknown) { this.filters.push(v === null ? `${ident(c)} is null` : `${ident(c)} = ${lit(v)}`); return this; }
  neq(c: string, v: unknown) { this.filters.push(`${ident(c)} <> ${lit(v)}`); return this; }
  gt(c: string, v: unknown) { this.filters.push(`${ident(c)} > ${lit(v)}`); return this; }
  gte(c: string, v: unknown) { this.filters.push(`${ident(c)} >= ${lit(v)}`); return this; }
  lt(c: string, v: unknown) { this.filters.push(`${ident(c)} < ${lit(v)}`); return this; }
  lte(c: string, v: unknown) { this.filters.push(`${ident(c)} <= ${lit(v)}`); return this; }
  is(c: string, v: null | boolean) { this.filters.push(`${ident(c)} is ${v === null ? "null" : v}`); return this; }
  in(c: string, arr: unknown[]) { this.filters.push(arr.length ? `${ident(c)} in (${arr.map(lit).join(",")})` : "false"); return this; }
  or(expr: string) { this.filters.push("(" + splitTop(expr).map(condicion).join(" or ") + ")"); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push(`${ident(c)} ${o?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.off = a; this.lim = b - a + 1; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  private where() {
    return this.filters.length ? ` where ${this.filters.join(" and ")}` : "";
  }

  private selectList(): string {
    return splitTop(this.cols).map((c) => {
      if (c === "*") return "t.*";
      const m = c.match(/^([a-z_]+)\((.*)\)$/);
      if (m) {
        const emb = EMBEDS[this.table]?.[m[1]];
        if (!emb) throw new Error(`Relación no soportada en demo: ${c}`);
        if (emb.kind === "count") {
          return `(select json_build_array(json_build_object('count', count(*))) from public.${m[1]} x where x.${emb.fk} = t.id) as ${m[1]}`;
        }
        const campos = splitTop(m[2]).map((f) => `'${ident(f)}', x.${ident(f)}`).join(", ");
        return `(select json_build_object(${campos}) from public.${m[1]} x where x.id = t.${emb.fk}) as ${m[1]}`;
      }
      return `t.${ident(c)}`;
    }).join(", ");
  }

  private returningList(): string {
    if (!this.returning || this.returning === "*") return "*";
    return splitTop(this.returning).map(ident).join(", ");
  }

  private build(): string {
    const t = `public.${this.table}`;
    switch (this.op) {
      case "select": {
        if (this.head) return `select count(*)::int as n from ${t} t${this.where()}`;
        let sql = `select ${this.selectList()} from ${t} t${this.where()}`;
        if (this.orders.length) sql += ` order by ${this.orders.join(", ")}`;
        if (this.lim !== null) sql += ` limit ${this.lim}`;
        if (this.off) sql += ` offset ${this.off}`;
        return sql;
      }
      case "insert": {
        const cols = [...new Set(this.payload.flatMap((r: object) => Object.keys(r)))] as string[];
        const values = this.payload.map((r: any) => `(${cols.map((c) => (c in r ? litCol(c, r[c]) : "default")).join(", ")})`).join(", ");
        let conflicto = "";
        if (this.conflicto) {
          const otras = cols.filter((c) => !this.conflicto!.cols.includes(c));
          conflicto = ` on conflict (${this.conflicto.cols.join(", ")}) ` +
            (this.conflicto.ignorar || !otras.length ? "do nothing" : `do update set ${otras.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`);
        }
        return `insert into ${t} (${cols.map(ident).join(", ")}) values ${values}${conflicto} returning ${this.returningList()}`;
      }
      case "update": {
        const sets = Object.entries(this.payload).map(([k, v]) => `${ident(k)} = ${litCol(k, v)}`).join(", ");
        return `update ${t} set ${sets}${this.where()} returning ${this.returningList()}`;
      }
      case "delete":
        return `delete from ${t}${this.where()} returning ${this.returningList()}`;
    }
  }

  async run(): Promise<Result> {
    let sql: string;
    try { sql = this.build(); } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
    const { rows, error } = await ejecutar(sql);
    if (error) return { data: null, error };
    if (this.op === "select" && this.head) return { data: null, error: null, count: rows[0]?.n ?? 0 };
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.one) {
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0 && this.one === "maybe") return { data: null, error: null };
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    return { data: rows, error: null, count: this.wantCount ? rows.length : null };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, ko);
  }
}

// ---------------------------------------------------------------------------
// Funciones (RPC)
// ---------------------------------------------------------------------------

const RPC_TIPO: Record<string, "scalar" | "row" | "set"> = {
  generar_cuotas: "scalar",
  resumen_dashboard: "scalar",
  registrar_pago: "row",
  conversacion_leida: "scalar",
  anular_pago: "row",
  resolver_acceso: "row",
  inscriptos_por_evento: "set",
  destinatarios_comercia: "set",
  marcar_baja_whatsapp: "scalar",
  actualizar_ajustes_comercia: "scalar",
  cuotas_a_generar: "set",
  recalcular_cuotas_pendientes: "scalar",
  generar_alquileres: "scalar",
  registrar_pago_alquiler: "row",
  anular_pago_alquiler: "row",
  facturar: "scalar",
  conciliar_banco: "row",
  evento_publico: "scalar",
  inscribir_publico: "scalar",
  registrar_pago_docente: "row",
  anular_pago_docente: "scalar",
  registrar_pago_inscripcion: "row",
  anular_pago_inscripcion: "row",
  cargar_inscripcion_a_cuenta: "row",
  facturar_inscripcion: "scalar",
  crear_reserva: "scalar",
  cancelar_reserva: "scalar",
  registrar_actividad_portal: "scalar",
  web_contenido: "scalar",
};

export async function rpc(name: string, params: Record<string, unknown> = {}, who?: Identidad): Promise<Result> {
  const tipo = RPC_TIPO[name];
  if (!tipo) return { data: null, error: { message: `Función no disponible en demo: ${name}` } };
  const args = Object.entries(params).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(", ");
  const sql = tipo === "scalar" ? `select public.${name}(${args}) as r` : `select * from public.${name}(${args})`;
  const { rows, error } = await ejecutar(sql, who);
  if (error) return { data: null, error };
  if (tipo === "scalar") return { data: rows[0]?.r ?? null, error: null };
  if (tipo === "row") return { data: rows[0] ?? null, error: null };
  return { data: rows, error: null };
}

/** Consulta directa (usada por las funciones /api simuladas) */
export const sqlComo = (who: Identidad, sql: string) => ejecutar(sql, who);
export const usuarioActual = () => usuario;

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const imagenesDemo = new Map<string, string>();

export function createDemoClient() {
  return {
    from: (table: string) => new Query(table),
    rpc: (name: string, params?: Record<string, unknown>) => rpc(name, params),
    // Imágenes: en la demo se guardan como data URL dentro de la base local (no se suben a ningún servidor)
    storage: {
      from: (_bucket: string) => ({
        async upload(path: string, file: Blob) {
          const url = await new Promise<string>((ok, ko) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.onerror = () => ko(r.error);
            r.readAsDataURL(file);
          });
          imagenesDemo.set(path, url);
          return { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: imagenesDemo.get(path) || "" } }),
        // CV y archivos privados: en la demo se abren desde la copia local
        async createSignedUrl(path: string) {
          const url = imagenesDemo.get(path);
          return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: "Archivo de ejemplo sin contenido" } };
        },
        async remove(paths: string[]) { paths.forEach((x) => imagenesDemo.delete(x)); return { data: [], error: null }; },
      }),
    },
    auth: {
      getSession: async () => ({ data: { session: sesion() }, error: null }),
      onAuthStateChange(cb: (event: string, session: any) => void) {
        listeners.add(cb);
        setTimeout(() => cb("INITIAL_SESSION", sesion()), 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        await new Promise((r) => setTimeout(r, 400));
        const u = Object.values(DEMO_USERS).find((x) => x.email === email.trim().toLowerCase());
        if (!u || password !== DEMO_PASSWORD) {
          return { data: { session: null }, error: { message: "Invalid login credentials" } };
        }
        cambiarUsuario({ id: u.id, email: u.email });
        return { data: { session: sesion() }, error: null };
      },
      async signOut() { cambiarUsuario(null); return { error: null }; },
      async updateUser() { return { data: { user: usuario }, error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async signUp() { return { data: { user: { identities: [{}] }, session: null }, error: null }; },
    },
  };
}
