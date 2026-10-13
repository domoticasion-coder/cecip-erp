/**
 * MODO DEMO: base PostgreSQL en el navegador (PGlite) con el MISMO esquema, permisos (RLS)
 * y funciones que Supabase, cargada con datos de ejemplo. Solo se usa con `npm run demo`.
 * Los datos viven en memoria: al recargar la página se regeneran.
 */
import { PGlite } from "@electric-sql/pglite";
import esquema from "../../supabase/migrations/001_esquema.sql?raw";
import padron from "../../supabase/migrations/002_padron_inicial.sql?raw";

export const DEMO_USERS = {
  admin: { id: "00000000-0000-4000-8000-0000000000a1", email: "admin@cecip.demo", nombre: "Carla Gómez", rol: "admin" },
  tesoreria: { id: "00000000-0000-4000-8000-0000000000a2", email: "tesoreria@cecip.demo", nombre: "Esteban Peralta", rol: "tesoreria" },
  atencion: { id: "00000000-0000-4000-8000-0000000000a3", email: "atencion@cecip.demo", nombre: "Clara Viggiano", rol: "atencion" },
  comercia: { id: "00000000-0000-4000-8000-0000000000a4", email: "comercia@cecip.demo", nombre: "Equipo ComercIA", rol: "comercia" },
  socio: { id: "00000000-0000-4000-8000-0000000000b1", email: "socio@cecip.demo", nombre: "Juan Pérez", rol: "socio" },
} as const;

const AUTH_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const U = DEMO_USERS;

const SEED = `
insert into auth.users (id, email) values
  ('${U.admin.id}', '${U.admin.email}'), ('${U.tesoreria.id}', '${U.tesoreria.email}'), ('${U.atencion.id}', '${U.atencion.email}'), ('${U.comercia.id}', '${U.comercia.email}');
insert into staff (user_id, nombre, email, rol) values
  ('${U.admin.id}', '${U.admin.nombre}', '${U.admin.email}', 'admin'),
  ('${U.tesoreria.id}', '${U.tesoreria.nombre}', '${U.tesoreria.email}', 'tesoreria'),
  ('${U.atencion.id}', '${U.atencion.nombre}', '${U.atencion.email}', 'atencion'),
  ('${U.comercia.id}', '${U.comercia.nombre}', '${U.comercia.email}', 'comercia');

update configuracion set
  cuit = '30-50000000-7', direccion = 'Paraná, Entre Ríos', telefono = '343 400-0000',
  email = 'administracion@centrocomercialparana.com.ar', banco = 'Banco Entre Ríos (DEMO)',
  titular = 'Centro Comercial e Industrial de Paraná', cbu = '0000000000000000000000', alias = 'CECIP.DEMO',
  interes_mensual = 3, recordatorios_auto = true,
  cuenta_default_id = (select id from cuentas where nombre = 'Banco Entre Ríos')
where id = 1;

update categorias set cuota_mensual = case nombre
  when 'Pequeño Comercio' then 8000 when 'Servicios' then 10000 when 'Mediana Empresa' then 15000 else 25000 end;

-- Categoría y estado de ejemplo para cada socio
update socios s set categoria_id = (
  select id from categorias where nombre = case
    when abs(hashtext(s.razon_social)) % 20 < 12 then 'Pequeño Comercio'
    when abs(hashtext(s.razon_social)) % 20 < 16 then 'Servicios'
    when abs(hashtext(s.razon_social)) % 20 < 19 then 'Mediana Empresa'
    else 'Gran Industria' end);
update socios set estado = 'suspendido' where abs(hashtext(razon_social)) % 41 = 0;
update socios set fecha_alta = date '2015-01-01' + (abs(hashtext(razon_social)) % 3500);
update socios set cuit = '30-71234567-1', contacto_nombre = 'Juan Pérez' where numero_socio = 1960;
update socios set cuit = '30-70987654-3' where numero_socio = 2611;

-- Cuotas de los últimos 4 meses (como lo haría Tesorería)
select set_config('request.jwt.claim.sub', '${U.admin.id}', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select generar_cuotas((date_trunc('month', current_date) - (k || ' months')::interval)::date,
                      (date_trunc('month', current_date) - (k || ' months')::interval)::date + 9)
from generate_series(3, 0, -1) k;

-- Pagos de ejemplo (como si entraran por caja, transferencia y Mercado Pago)
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $$
declare c record; h int; perfil int; meses int; pagar boolean; f date;
begin
  for c in select id, socio_id, periodo, vencimiento from cuotas where tipo = 'cuota_social' order by periodo, id loop
    h := abs(hashtext(c.id::text || 'p')) % 100;
    meses := (extract(year from age(date_trunc('month', current_date), c.periodo)) * 12
              + extract(month from age(date_trunc('month', current_date), c.periodo)))::int;
    -- Perfil de cada socio: 80% paga al día, 13% se atrasa, 7% moroso
    perfil := abs(hashtext(c.socio_id::text)) % 100;
    pagar := case
      when perfil < 80 then meses > 0 or h < 90
      when perfil < 93 then meses > 1
      else meses > 3 end;
    if pagar then
      f := least(c.vencimiento + (h % 14) - 6, current_date);
      perform registrar_pago(c.id, (array['Transferencia','Mercado Pago','Efectivo','Transferencia','Mercado Pago'])[h % 5 + 1], null, f);
    end if;
  end loop;
end $$;

-- Movimientos de tesorería de ejemplo
insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, conciliado)
select (date_trunc('month', current_date) - interval '4 months')::date, 'ingreso', 'Saldo inicial',
       (select id from cuentas where nombre = n), 'Saldo inicial de la cuenta', monto, true
from (values ('Banco Entre Ríos', 9800000), ('Caja', 350000), ('Banco Nación', 1200000)) as v(n, monto);
insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, conciliado)
select (date_trunc('month', current_date) - (k || ' months')::interval)::date + d, 'egreso', cat,
       (select id from cuentas where nombre = cta), det, monto, k > 0
from generate_series(3, 0, -1) k,
     (values (4, 'Sueldos y cargas sociales', 'Banco Entre Ríos', 'Sueldos del personal', 1850000),
             (7, 'Servicios (luz, agua, internet)', 'Banco Entre Ríos', 'Energía, agua e internet de la sede', 138000),
             (9, 'Honorarios', 'Banco Entre Ríos', 'Honorarios estudio contable', 260000),
             (12, 'Mantenimiento', 'Caja', 'Mantenimiento de la sede', 45000),
             (15, 'Insumos de oficina', 'Caja', 'Librería e insumos', 18500)) as v(d, cat, cta, det, monto)
where (date_trunc('month', current_date) - (k || ' months')::interval)::date + d <= current_date;
insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto)
values (current_date - 3, 'ingreso', 'Alquiler de salón', (select id from cuentas where nombre = 'Caja'), 'Alquiler del salón auditorio', 120000);

-- Usuarios del portal: uno aprobado (para ver el portal) y dos solicitudes pendientes
insert into auth.users (id, email, raw_user_meta_data) values
  ('${U.socio.id}', '${U.socio.email}', '{"tipo":"socio","nombre":"${U.socio.nombre}","cuit":"30-71234567-1","razon_social":"25 de Junio S.A.","telefono":"343 431-4448"}'),
  (gen_random_uuid(), 'mariela@atodocolor.com.ar', '{"tipo":"socio","nombre":"Mariela Zurdo","cuit":"30-70987654-3","razon_social":"A Todo Color Pinturería","telefono":"343 500-0956"}'),
  (gen_random_uuid(), 'gerencia@nuevocomercio.com', '{"tipo":"socio","nombre":"Pablo Ríos","cuit":"20-28765432-5","razon_social":"Nuevo Comercio SRL","telefono":"343 611-2233"}');
update socio_usuarios set estado = 'aprobado', aprobado_at = now() where user_id = '${U.socio.id}';

-- Comunicación
insert into comunicados (titulo, cuerpo, publicado, destacado, fecha_publicacion) values
  ('Asamblea General Ordinaria', E'Convocamos a los socios a la Asamblea General Ordinaria que se realizará en nuestra sede.\\n\\nOrden del día:\\n1. Lectura y aprobación de la memoria y balance.\\n2. Renovación parcial de la Comisión Directiva.\\n\\nPara participar es necesario tener la cuota social al día.', true, true, now() - interval '2 days'),
  ('Nuevo convenio con Banco Entre Ríos', E'Los socios del CeCIP acceden a una línea de crédito con tasa preferencial para capital de trabajo. Consultá las condiciones en la administración.', true, false, now() - interval '9 days'),
  ('Horario de atención de la sede', E'Te recordamos que la administración atiende de lunes a viernes de 8 a 13 hs.', true, false, now() - interval '20 days'),
  ('Borrador: campaña Día del Padre', E'Texto en preparación...', false, false, null);

-- Eventos y capacitaciones
insert into eventos (titulo, descripcion, tipo, fecha_inicio, lugar, modalidad, cupo, costo, publicado) values
  ('Liquidación de sueldos para comercios', E'Capacitación práctica sobre el nuevo convenio de empleados de comercio, cargas sociales y liquidación final.', 'capacitacion', date_trunc('day', now()) + interval '6 days 21 hours', 'Sede CeCIP', 'presencial', 30, 15000, true),
  ('Ventas por redes sociales', E'Cómo vender más con Instagram y WhatsApp Business. Para dueños y empleados de comercios.', 'capacitacion', date_trunc('day', now()) + interval '13 days 22 hours', null, 'virtual', null, 0, true),
  ('Desayuno de trabajo con el Intendente', E'Encuentro de socios con autoridades municipales para tratar temas de seguridad, tasas y estacionamiento en el centro.', 'evento', date_trunc('day', now()) + interval '20 days 12 hours', 'Salón auditorio CeCIP', 'presencial', 80, 0, true),
  ('Charla: Facturación electrónica', 'Actividad realizada.', 'capacitacion', now() - interval '15 days', 'Sede CeCIP', 'presencial', null, 0, true);
insert into inscripciones (evento_id, socio_id, asistente_nombre, asistente_email)
select e.id, s.id, coalesce(s.contacto_nombre, 'Responsable de ' || s.razon_social), s.email
from eventos e, lateral (select * from socios where estado = 'activo' order by md5(e.titulo || razon_social) limit 9) s
where e.publicado;

-- ComercIA
insert into comercia_solicitudes (socio_id, servicio, detalle, presupuesto_estimado, contacto_nombre, contacto_email, contacto_telefono, estado, created_at)
select id, 'Tienda online + 3 adicionales', E'Paquete: Tienda online\\nAdicionales: Botón y catálogo de WhatsApp, Dominio .com.ar (1 año), Cobros online (Mercado Pago)\\n\\nQueremos vender pinturas online con envío a domicilio.', 386250, 'Mariela', email, '343 500-0956', 'nueva', now() - interval '1 day'
from socios where numero_socio = 2611;
insert into comercia_solicitudes (socio_id, servicio, detalle, presupuesto_estimado, contacto_nombre, contacto_email, contacto_telefono, estado, created_at)
select id, 'Sitio web PyME + 2 adicionales', E'Paquete: Sitio web PyME\\nAdicionales: Hosting (1 año), Posicionamiento en Google (SEO)', 255000, 'Gerencia', email, telefono, 'en_curso', now() - interval '6 days'
from socios where numero_socio = 2075;

-- Historial de contacto de ejemplo
insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_at)
select id, 'llamada', 'Llamó para consultar por el convenio bancario. Se le envió la información por email.', '${U.atencion.nombre}', now() - interval '5 days' from socios where numero_socio = 1960;
insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_at)
select id, 'reunion', 'Reunión en la sede: acordamos regularizar la deuda en dos pagos.', '${U.tesoreria.nombre}', now() - interval '12 days' from socios where numero_socio = 1960;
`;

// La base se guarda en el navegador (IndexedDB) para que los cambios sobrevivan al pasar
// del ERP al portal o al checkout. "Reiniciar demo" la borra y la vuelve a generar.
const IDB_NAME = "cecip-demo-v9";
let dbPromise: Promise<PGlite> | null = null;

export function getDemoDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new PGlite(`idb://${IDB_NAME}`, { relaxedDurability: false });
      await db.waitReady;
      const { rows } = await db.query<{ ok: string | null }>("select to_regclass('public.socios')::text as ok");
      if (!rows[0]?.ok) {
        await db.exec(AUTH_STUBS);
        await db.exec(esquema);
        await db.exec(padron);
        await db.exec(SEED);
      }
      await db.exec(`select set_config('request.jwt.claims', '', false); select set_config('request.jwt.claim.sub', '', false);`);
      return db;
    })();
  }
  return dbPromise;
}

/** Borra la base de la demo y recarga la página (vuelve a los datos de ejemplo) */
export async function reiniciarDemo() {
  try {
    const db = await dbPromise;
    await db?.close();
  } catch { /* ignorar */ }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(`/pglite/${IDB_NAME}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("cecip-demo-")).forEach((k) => localStorage.removeItem(k));
  } catch { /* sin storage */ }
  window.location.reload();
}

// Los resultados se devuelven con los mismos tipos que la API de Supabase (fechas como texto, numéricos como número)
const toIso = (s: string) => new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
export const PARSERS = {
  1700: (v: string) => Number(v), // numeric
  20: (v: string) => Number(v), // int8
  1082: (v: string) => v, // date
  1114: (v: string) => toIso(v + "+00"), // timestamp
  1184: (v: string) => toIso(v), // timestamptz
};

// Las consultas se serializan para que cada una corra con la identidad correcta
let cola: Promise<unknown> = Promise.resolve();

export type Identidad = { userId: string | null; role: "authenticated" | "anon" | "service_role" | "postgres" };

export function runAs<T = any>(who: Identidad, sql: string): Promise<T[]> {
  const job = cola.then(async () => {
    const db = await getDemoDb();
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [
      who.userId || "",
      JSON.stringify({ role: who.role, sub: who.userId }),
    ]);
    await db.exec(`set role ${who.role}`);
    try {
      const r = await db.query<T>(sql, [], { parsers: PARSERS });
      return r.rows;
    } finally {
      await db.exec("reset role");
    }
  });
  cola = job.catch(() => {});
  return job;
}
