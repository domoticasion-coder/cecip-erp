/**
 * MODO DEMO: base PostgreSQL en el navegador (PGlite) con el MISMO esquema, permisos (RLS)
 * y funciones que Supabase, cargada con datos de ejemplo. Solo se usa con `npm run demo`.
 * Los datos viven en memoria: al recargar la página se regeneran.
 */
import { PGlite } from "@electric-sql/pglite";
import esquema from "../../supabase/migrations/001_esquema.sql?raw";
import padron from "../../supabase/migrations/002_padron_inicial.sql?raw";
import cambios005 from "../../supabase/migrations/005_cobros_alquileres_facturacion.sql?raw";
import padron2026 from "../../supabase/migrations/006_padron_2026.sql?raw";
import capacitaciones008 from "../../supabase/migrations/008_capacitaciones.sql?raw";
import copiloto009 from "../../supabase/migrations/009_copiloto_erp.sql?raw";
import salones010 from "../../supabase/migrations/010_alquiler_salones.sql?raw";
import colaEmails011 from "../../supabase/migrations/011_cola_emails.sql?raw";
import roles012 from "../../supabase/migrations/012_roles.sql?raw";
import valores013 from "../../supabase/migrations/013_valores_anteriores_y_retenciones.sql?raw";
import canales014 from "../../supabase/migrations/014_canales.sql?raw";
import whatsapp015 from "../../supabase/migrations/015_whatsapp_socios.sql?raw";

export const DEMO_USERS = {
  admin: { id: "00000000-0000-4000-8000-0000000000a1", email: "admin@cecip.demo", nombre: "Carla Gómez", rol: "admin" },
  tesoreria: { id: "00000000-0000-4000-8000-0000000000a2", email: "tesoreria@cecip.demo", nombre: "Esteban Peralta", rol: "tesoreria" },
  atencion: { id: "00000000-0000-4000-8000-0000000000a3", email: "atencion@cecip.demo", nombre: "Clara Viggiano", rol: "atencion" },
  comercia: { id: "00000000-0000-4000-8000-0000000000a4", email: "comercia@cecip.demo", nombre: "Equipo ComercIA", rol: "comercia" },
  administracion: { id: "00000000-0000-4000-8000-0000000000a5", email: "administracion@cecip.demo", nombre: "Laura Bertoni", rol: "administracion" },
  prensa: { id: "00000000-0000-4000-8000-0000000000a6", email: "prensa@cecip.demo", nombre: "Martín Sosa", rol: "prensa" },
  presidente: { id: "00000000-0000-4000-8000-0000000000a7", email: "presidente@cecip.demo", nombre: "Roberto Ferrari", rol: "presidente" },
  prosecretario: { id: "00000000-0000-4000-8000-0000000000a8", email: "prosecretario@cecip.demo", nombre: "Silvia Retamar", rol: "prosecretario" },
  comision: { id: "00000000-0000-4000-8000-0000000000a9", email: "comision@cecip.demo", nombre: "Diego Acosta", rol: "comision" },
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

-- Categoría, forma de pago y meses pagos/adeudados vienen del Excel 2026 (migración 006)
update configuracion set facturacion_auto = true, factura_punto_venta = 3, factura_condicion_emisor = 'exento' where id = 1;
update socios set fecha_alta = date '2015-01-01' + (abs(hashtext(razon_social)) % 3500);
update socios set cuit = null where cuit in ('30-71234567-1', '30-70987654-3');
update socios set cuit = '30-71234567-1', contacto_nombre = 'Juan Pérez', estado = 'activo' where numero_socio = 1960;
update socios set cuit = '30-70987654-3', estado = 'activo' where numero_socio = 2611;

-- Cuotas del mes anterior y del actual que todavía no estaban en el Excel (como lo haría Tesorería)
select set_config('request.jwt.claim.sub', '${U.admin.id}', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select generar_cuotas((date_trunc('month', current_date) - (k || ' months')::interval)::date,
                      (date_trunc('month', current_date) - (k || ' months')::interval)::date + 9)
from generate_series(1, 0, -1) k;

-- Pagos de ejemplo (como si entraran por caja, transferencia y Mercado Pago)
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $$
declare c record; h int; perfil int; meses int; pagar boolean; f date;
begin
  for c in select id, socio_id, periodo, vencimiento from cuotas where tipo = 'cuota_social' and not importada order by periodo, id loop
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

// Datos de ejemplo de alquileres, facturación, banco y formularios públicos (migración 005)
const SEED_005 = `
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- Alquileres: los tres inmuebles del CeCIP
update inmuebles set nombre = 'Local planta baja', direccion = '25 de Mayo 28, PB (DEMO)', descripcion = 'Local comercial a la calle' where orden = 1;
update inmuebles set nombre = 'Oficina 1° piso', direccion = '25 de Mayo 28, 1° piso, of. 3 (DEMO)' where orden = 2;
update inmuebles set nombre = 'Salón de eventos', direccion = 'Urquiza 1050 (DEMO)', descripcion = 'Alquiler mensual a una academia' where orden = 3;
insert into alquiler_contratos (inmueble_id, inquilino_nombre, inquilino_cuit, inquilino_condicion_iva, inquilino_email, inquilino_telefono,
  fecha_inicio, fecha_fin, monto_mensual, dia_vencimiento, ajuste_indice, ajuste_cada_meses, proximo_ajuste, deposito)
values
  ((select id from inmuebles where orden = 1), 'Farmacia del Centro SRL', '30-71555666-2', 'RI', 'administracion@farmaciacentro.demo', '343 455-1122',
   date_trunc('month', current_date)::date - interval '10 months', date_trunc('month', current_date)::date + interval '26 months', 850000, 10, 'icl', 6,
   date_trunc('month', current_date)::date + interval '2 months', 1700000),
  ((select id from inmuebles where orden = 2), 'Estudio Contable Ríos & Asoc.', '20-28777888-5', 'Monotributo', 'estudio@rios.demo', '343 466-7788',
   date_trunc('month', current_date)::date - interval '6 months', null, 320000, 5, 'ipc', 3, current_date - 3, 640000),
  ((select id from inmuebles where orden = 3), 'Academia de Danza Ritmo', '27-30111222-4', 'Monotributo', 'ritmo@academia.demo', '343 412-3344',
   date_trunc('month', current_date)::date - interval '3 months', null, 410000, 10, 'porcentaje', 4, date_trunc('month', current_date)::date + interval '1 month', null);
update alquiler_contratos set ajuste_porcentaje = 15 where ajuste_indice = 'porcentaje';

select set_config('request.jwt.claim.sub', '${U.admin.id}', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select generar_alquileres((date_trunc('month', current_date) - (k || ' months')::interval)::date) from generate_series(2, 0, -1) k;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select registrar_pago_alquiler(id, 'Transferencia', (select id from cuentas where nombre = 'Banco Santander'), vencimiento - 2)
from alquiler_cargos where vencimiento < date_trunc('month', current_date)
  and contrato_id <> (select id from alquiler_contratos where inquilino_nombre like 'Academia%');

-- Facturas: las de los cobros de ejemplo quedan emitidas con CAE (en producción las emite n8n en ARCA)
update facturas f set estado = 'emitida', punto_venta = 3, numero = x.n, cae = '7' || lpad((x.n * 7919)::text, 13, '0'),
  cae_vencimiento = f.fecha + 10, enviada_at = f.created_at, emitida_at = f.created_at
from (select id, 1000 + row_number() over (order by created_at, id) as n from facturas) x where x.id = f.id;
update facturas set estado = 'en_cola', numero = null, cae = null, cae_vencimiento = null, emitida_at = null
where id in (select id from facturas order by created_at desc, id limit 2);
update facturas set estado = 'error', numero = null, cae = null, cae_vencimiento = null, emitida_at = null,
  error = '10015: El documento del receptor no es válido (DEMO)'
where id = (select id from facturas where estado = 'emitida' order by created_at desc, id limit 1);

-- Movimientos de la cuenta Santander (como si los trajera n8n): créditos de socios y gastos bancarios
insert into banco_movimientos (banco, cuenta_id, id_externo, fecha, descripcion, monto, saldo, referencia, contraparte_nombre, contraparte_cuit)
select 'Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-' || row_number() over (), current_date - ((row_number() over ()) % 6)::int,
       'TRANSFERENCIA RECIBIDA ' || s.razon_social, c.total, null, 'TRF' || (900000 + row_number() over ()), s.razon_social, s.cuit
from (select distinct on (socio_id) socio_id, total from cuotas_detalle where estado = 'pendiente' and tipo = 'cuota_social' order by socio_id, vencimiento) c
join socios s on s.id = c.socio_id and s.cuit is not null
order by s.razon_social limit 4;
insert into banco_movimientos (banco, cuenta_id, id_externo, fecha, descripcion, monto, saldo, referencia) values
  ('Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-COM', current_date - 2, 'COMISION MANTENIMIENTO CUENTA EMPRESA', -12850, 4825300, 'COM102'),
  ('Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-IMP', current_date - 2, 'IMPUESTO LEY 25413 DEBITOS', -2310.55, 4838150, 'IMP77'),
  ('Santander', (select id from cuentas where nombre = 'Banco Santander'), 'DEMO-ALQ', current_date - 1, 'TRANSFERENCIA RECIBIDA ACADEMIA DE DANZA RITMO', 410000, 5248150, 'TRF55511');

-- Formulario público de inscripción para no socios
select set_config('request.jwt.claims', '', false);
reset role;
update eventos set formulario_publico = true, imagen_url = null,
  preguntas = '[{"id":"rubro","etiqueta":"¿A qué rubro pertenece tu empresa?","tipo":"opciones","opciones":["Comercio","Industria","Servicios","Otro"],"requerida":true},{"id":"empleados","etiqueta":"¿Tenés empleados a cargo?","tipo":"si_no","requerida":false}]'
where titulo = 'Liquidación de sueldos para comercios';
insert into inscripciones (evento_id, asistente_nombre, asistente_email, asistente_telefono, empresa, es_socio, origen, respuestas)
select id, x.nombre, x.email, x.tel, x.empresa, false, 'publico', x.resp::jsonb
from eventos, (values
  ('Lucía Benítez', 'lucia.benitez@mail.demo', '343 600-1111', 'Kiosco La Esquina', '{"rubro":"Comercio","empleados":"No"}'),
  ('Martín Acosta', 'martin@panaderia.demo', '343 600-2222', 'Panadería San Martín', '{"rubro":"Industria","empleados":"Sí"}'),
  ('Carolina Díaz', 'caro.diaz@mail.demo', null, null, '{"rubro":"Servicios"}')
) as x(nombre, email, tel, empresa, resp)
where titulo = 'Liquidación de sueldos para comercios';
`;

// Docentes, cursada, inscripciones con facturación y pagos a docentes (migración 008)
const SEED_008 = `
insert into docentes (nombre, cuit, condicion_iva, email, telefono, especialidad, alias, honorario_sugerido) values
  ('Laura Méndez', '27-22333444-5', 'Monotributo', 'laura.mendez@docente.demo', '343 455-9001', 'Liquidación de sueldos y laboral', 'LAURA.MENDEZ.MP', 25000),
  ('Martín Sosa', '20-28999111-3', 'Monotributo', 'martin.sosa@docente.demo', '343 455-9002', 'Marketing digital y redes', 'MSOSA.DIGITAL', 22000),
  ('Gabriela Ruiz', '27-30555666-1', 'RI', 'gabriela.ruiz@docente.demo', '343 455-9003', 'Impuestos y facturación', null, 30000);

update eventos set docente_id = (select id from docentes where nombre = 'Laura Méndez'), dias_semana = '{2,4}', hora_inicio = '18:00', hora_fin = '20:00',
  cantidad_clases = 8, precio_no_socio = 25000, honorario_tipo = 'por_clase', honorario_monto = 25000,
  fecha_fin = fecha_inicio + interval '25 days'
where titulo = 'Liquidación de sueldos para comercios';
update eventos set docente_id = (select id from docentes where nombre = 'Martín Sosa'), dias_semana = '{3}', hora_inicio = '19:00', hora_fin = '21:00',
  cantidad_clases = 4, costo = 0, precio_no_socio = 12000, honorario_tipo = 'total', honorario_monto = 90000, formulario_publico = true,
  fecha_fin = fecha_inicio + interval '21 days'
where titulo = 'Ventas por redes sociales';
update eventos set docente_id = (select id from docentes where nombre = 'Gabriela Ruiz'), cantidad_clases = 1, hora_inicio = '18:00', hora_fin = '20:00',
  honorario_tipo = 'total', honorario_monto = 60000
where titulo = 'Charla: Facturación electrónica';

-- Inscripciones: precio según socio / no socio y algunos cobros
update inscripciones i set monto = case when i.socio_id is not null then e.costo else coalesce(e.precio_no_socio, e.costo) end,
  estado_pago = case when (case when i.socio_id is not null then e.costo else coalesce(e.precio_no_socio, e.costo) end) > 0 then 'pendiente' else 'sin_cargo' end
from eventos e where e.id = i.evento_id and e.tipo = 'capacitacion';
update inscripciones set cuit = '27-30111222-4', razon_social = 'BENÍTEZ LUCÍA', condicion_iva = 'Monotributo' where asistente_email = 'lucia.benitez@mail.demo';
update inscripciones set cuit = '20-25444333-9', razon_social = 'PANADERÍA SAN MARTÍN SRL', condicion_iva = 'RI' where asistente_email = 'martin@panaderia.demo';

select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select registrar_pago_inscripcion(i.id, 'Transferencia', null, current_date - 1)
from inscripciones i join eventos e on e.id = i.evento_id
where e.titulo = 'Liquidación de sueldos para comercios' and i.estado_pago = 'pendiente'
  and (i.origen = 'publico' and i.asistente_email <> 'caro.diaz@mail.demo' or abs(hashtext(i.id::text)) % 3 = 0);
-- Las facturas de estos cobros quedan emitidas (en producción las emite n8n en ARCA)
update facturas f set estado = 'emitida', punto_venta = 3, numero = 2000 + x.n, cae = '7' || lpad(((2000 + x.n) * 7919)::text, 13, '0'),
  cae_vencimiento = f.fecha + 10, enviada_at = now(), emitida_at = now()
from (select id, row_number() over (order by created_at, id) as n from facturas where origen = 'inscripcion') x where x.id = f.id;

-- Pagos a docentes
select set_config('request.jwt.claim.sub', '${U.admin.id}', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select registrar_pago_docente((select id from docentes where nombre = 'Gabriela Ruiz'), (select id from eventos where titulo = 'Charla: Facturación electrónica'),
  60000, 'Honorarios charla Facturación electrónica', 1, current_date - 14, 'Transferencia', null, 'Factura A 0002-00000415');
select registrar_pago_docente((select id from docentes where nombre = 'Laura Méndez'), null, 40000, 'Taller de liquidación (curso anterior)', 2,
  current_date - 60, 'Transferencia', null, 'Factura C 0001-00000087');
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);
`;

// Salón de alquiler temporal con reservas de ejemplo (migración 010)
const SEED_010 = `
update inmuebles set tipo = 'local' where orden = 1;
update inmuebles set tipo = 'oficina' where orden = 2;
update inmuebles set tipo = 'salon', capacidad = 60 where orden = 3;
insert into inmuebles (nombre, direccion, descripcion, tipo, capacidad, tarifa_hora, tarifa_dia, tarifa_socio_descuento, orden)
values ('Salón auditorio', '25 de Mayo 28, 2° piso (DEMO)', 'Auditorio con proyector y sonido, para eventos, capacitaciones y reuniones', 'salon', 120, 25000, 160000, 20, 4);

select set_config('request.jwt.claim.sub', '${U.admin.id}', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select crear_reserva((select id from inmuebles where nombre = 'Salón auditorio'), 'Estudio Jurídico Paz & Asoc.', current_date + 3, null, '18:00', '21:00',
  75000, 0, 'Charla para clientes', 50, null, '30-71999888-2', 'RI', 'eventos@pazasoc.demo', '343 470-1122');
select crear_reserva((select id from inmuebles where nombre = 'Salón auditorio'), 'Lucía Fernández', current_date + 9, null, '20:00', '23:59',
  100000, 30000, 'Cumpleaños de 15', 90, null, '27-38111222-6', 'Consumidor final', null, '343 512-3344');
select crear_reserva((select id from inmuebles where nombre = 'Salón auditorio'), s.razon_social, current_date + 16, current_date + 17, null, null,
  256000, 50000, 'Jornada de capacitación interna', 40, s.id, s.cuit, s.condicion_iva, s.email, s.whatsapp)
from socios s where s.numero_socio = 2075;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select registrar_pago_alquiler(c.id, 'Transferencia', null, current_date - 1)
from alquiler_cargos c join alquiler_contratos k on k.id = c.contrato_id
where k.modalidad = 'temporal' and (k.inquilino_nombre like 'Estudio Jurídico%' or c.concepto like 'Seña%');
update facturas f set estado = 'emitida', punto_venta = 3, numero = 3000 + x.n, cae = '7' || lpad(((3000 + x.n) * 7919)::text, 13, '0'),
  cae_vencimiento = f.fecha + 10, enviada_at = now(), emitida_at = now()
from (select id, row_number() over (order by created_at, id) as n from facturas where estado = 'en_cola' and origen = 'alquiler') x where x.id = f.id;
select set_config('request.jwt.claims', '', false);
`;

// Personal de ejemplo con los roles de la migración 012
const ROLES_012 = ["administracion", "prensa", "presidente", "prosecretario", "comision"] as const;
const SEED_012 = `
insert into auth.users (id, email) values ${ROLES_012.map((k) => `('${U[k].id}', '${U[k].email}')`).join(", ")};
insert into staff (user_id, nombre, email, rol) values ${ROLES_012.map((k) => `('${U[k].id}', '${U[k].nombre}', '${U[k].email}', '${k}')`).join(", ")};
`;

// Canales (migración 014): conversaciones de ejemplo de WhatsApp y email con cada caso
const SEED_014 = `
do $$
declare
  s1 uuid := (select socio_id from socio_usuarios where user_id = '${U.socio.id}');
  s2 uuid := (select s.id from socios s where s.estado = 'activo' and s.email is not null and s.id <> coalesce(s1, gen_random_uuid())
    and exists (select 1 from cuotas c where c.socio_id = s.id and c.estado = 'pendiente' and c.tipo = 'cuota_social') order by s.razon_social offset 3 limit 1);
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; m4 uuid;
begin
  -- 1) Socio por WhatsApp: consulta su deuda, pide el link y el recibo
  insert into conversaciones (nombre, telefono, socio_id, etapa, interes, area, resumen, ultimo_canal, ultimo_mensaje_at, ultimo_entrante_at, no_leidos)
  values ('Juan Pérez', '5493434314448', s1, 'Socio', 'Pagos y cuotas', 'tesoreria', 'Consultó su deuda, pidió el link de pago y el último recibo.', 'whatsapp', now() - interval '25 minutes', now() - interval '27 minutes', 1)
  returning id into c1;
  insert into mensajes (conversacion_id, canal, direccion, autor, cuerpo, created_at) values
    (c1, 'whatsapp', 'entrante', 'contacto', 'Hola! cuánto debo de las cuotas?', now() - interval '31 minutes'),
    (c1, 'whatsapp', 'saliente', 'ia', E'¡Hola Juan! 👋 Te paso el estado de cuenta de *25 de Junio S.A.*:\\n- Cuota social Septiembre-Octubre 2026: $ 16.000 (vencida)\\n\\nDeuda total: *$ 16.000*. ¿Querés que te mande el link para pagarla con Mercado Pago?', now() - interval '30 minutes'),
    (c1, 'whatsapp', 'entrante', 'contacto', 'si dale, y mandame el recibo del pago anterior', now() - interval '28 minutes'),
    (c1, 'whatsapp', 'saliente', 'ia', 'Recibo de Cuota social Julio-Agosto 2026', now() - interval '27 minutes'),
    (c1, 'whatsapp', 'saliente', 'ia', E'¡Listo! Te mandé el recibo en PDF 📄\\n\\nY acá tenés el link para pagar los $ 16.000: https://mpago.la/demo-cecip\\nCuando se acredite te llega la confirmación.', now() - interval '26 minutes'),
    (c1, 'whatsapp', 'entrante', 'contacto', '🎤 Perfecto, gracias. Una consulta más, ¿hay alguna capacitación de facturación electrónica este mes?', now() - interval '25 minutes');
  update mensajes set adjunto_nombre = 'Recibo-000124.pdf', adjunto_mime = 'application/pdf', media_tipo = 'documento' where conversacion_id = c1 and cuerpo like 'Recibo de%';
  update mensajes set media_tipo = 'audio' where conversacion_id = c1 and cuerpo like '🎤%';

  -- 2) No socio que quiere asociarse (pipeline: Alta en trámite, derivado a Secretaría)
  insert into conversaciones (nombre, telefono, empresa, etapa, interes, area, resumen, acepta_novedades, ultimo_canal, ultimo_mensaje_at, ultimo_entrante_at, no_leidos)
  values ('Lucía Benítez', '5493415550199', 'Panadería La Espiga', 'Alta en trámite', 'Asociarse', 'secretaria', 'Quiere asociar su panadería (CUIT 27-30111222-4, rubro gastronomía). Derivada a Secretaría para completar el alta.', true, 'whatsapp', now() - interval '2 hours', now() - interval '2 hours 2 minutes', 0)
  returning id into c2;
  insert into mensajes (conversacion_id, canal, direccion, autor, cuerpo, created_at) values
    (c2, 'whatsapp', 'entrante', 'contacto', 'Buenas! tengo una panadería y quería saber qué beneficios tiene asociarse', now() - interval '2 hours 10 minutes'),
    (c2, 'whatsapp', 'saliente', 'ia', E'¡Hola! Gracias por escribirle al CeCIP 😊 Asociarte te da:\\n- Representación ante el municipio y la provincia\\n- Capacitaciones sin cargo o con descuento\\n- Difusión de tu comercio y el programa ComercIA\\n- Salones con tarifa preferencial\\n\\nLa cuota depende de la categoría (desde $ 4.000 por mes). ¿Cómo se llama tu panadería?', now() - interval '2 hours 9 minutes'),
    (c2, 'whatsapp', 'entrante', 'contacto', 'Panadería La Espiga, soy Lucía. Me quiero asociar! CUIT 27-30111222-4', now() - interval '2 hours 3 minutes'),
    (c2, 'whatsapp', 'saliente', 'ia', E'¡Genial, Lucía! Ya le pasé tus datos a Secretaría para completar el alta: te van a escribir en breve. ¿Querés recibir las novedades del CeCIP por WhatsApp?', now() - interval '2 hours 2 minutes'),
    (c2, 'whatsapp', 'entrante', 'contacto', 'Sí, dale!', now() - interval '2 hours 1 minute'),
    (c2, 'whatsapp', 'saliente', 'ia', '¡Listo! Te vamos a avisar de capacitaciones y eventos. Escribí BAJA cuando quieras dejar de recibirlas.', now() - interval '2 hours');

  -- 3) No socio que consulta por un salón
  insert into conversaciones (nombre, telefono, etapa, interes, area, resumen, ultimo_canal, ultimo_mensaje_at, ultimo_entrante_at, no_leidos)
  values ('Martín Godoy', '5493436120044', 'Interesado', 'Alquiler de salón', 'administracion', 'Quiere el salón para 60 personas el sábado 14/11 de 20 a 2 h (cumpleaños).', 'whatsapp', now() - interval '5 hours', now() - interval '5 hours', 2)
  returning id into c3;
  insert into mensajes (conversacion_id, canal, direccion, autor, cuerpo, created_at) values
    (c3, 'whatsapp', 'entrante', 'contacto', 'Hola, alquilan salón para un cumple de 60 personas? sería el sábado 14/11', now() - interval '5 hours 6 minutes'),
    (c3, 'whatsapp', 'saliente', 'ia', E'¡Hola! Sí 🙌 El *Salón auditorio* tiene capacidad para 120 personas y el sábado 14/11 está libre. ¿En qué horario lo necesitarías?', now() - interval '5 hours 5 minutes'),
    (c3, 'whatsapp', 'entrante', 'contacto', 'De 20 a 2 de la mañana', now() - interval '5 hours 1 minute'),
    (c3, 'whatsapp', 'saliente', 'ia', 'Perfecto, le paso tu consulta a Administración para que te confirme la tarifa y la seña. ¡Te escriben en un rato!', now() - interval '5 hours');

  -- 4) Socio por email con comprobante de transferencia (queda para conciliar en Tesorería)
  insert into conversaciones (nombre, email, socio_id, etapa, interes, area, resumen, ultimo_canal, ultimo_mensaje_at, ultimo_entrante_at, no_leidos)
  values ('Administración', (select email from socios where id = s2), s2, 'Socio', 'Pagos y cuotas', 'tesoreria', 'Envía el comprobante de la transferencia de la cuota de octubre.', 'email', now() - interval '50 minutes', now() - interval '50 minutes', 1)
  returning id into c4;
  insert into mensajes (conversacion_id, canal, direccion, autor, asunto, cuerpo, adjunto_nombre, adjunto_mime, media_tipo, analisis, created_at) values
    (c4, 'email', 'entrante', 'contacto', 'Pago cuota octubre', E'Buenas tardes,\\nAdjunto el comprobante de la transferencia de la cuota de octubre.\\nSaludos.', 'Comprobante-transferencia.pdf', 'application/pdf', 'documento',
     '{"tipo":"comprobante_pago","area":"tesoreria","prioridad":"normal","resumen":"Comprobante de transferencia por la cuota de octubre.","respuesta_sugerida":"¡Gracias! Recibimos el comprobante; Tesorería lo concilia y te enviamos el recibo."}', now() - interval '50 minutes')
    returning id into m4;
  insert into comprobantes_recibidos (conversacion_id, mensaje_id, socio_id, canal, monto, fecha, emisor, referencia, archivo_nombre, archivo_mime, analisis)
  values (c4, m4, s2, 'email', (select monto from cuotas where socio_id = s2 and estado = 'pendiente' and tipo = 'cuota_social' order by vencimiento limit 1), current_date - 1, 'Banco Nación', '000245871', 'Comprobante-transferencia.pdf', 'application/pdf', '{"tipo":"comprobante_pago"}');

  -- 5) Email automático (publicidad): queda cerrado, sin molestar
  insert into conversaciones (nombre, email, etapa, ultimo_canal, ultimo_mensaje_at, estado, resumen)
  values ('Newsletter Proveedores', 'novedades@proveedor-ejemplo.com', 'Nuevo', 'email', now() - interval '1 day', 'cerrada', 'Email automático o masivo.')
  returning id into c5;
  insert into mensajes (conversacion_id, canal, direccion, autor, asunto, cuerpo, analisis, created_at) values
    (c5, 'email', 'entrante', 'contacto', '¡Ofertas de la semana!', 'Conocé nuestras promociones…', '{"tipo":"publicidad","resumen":"Email automático o masivo."}', now() - interval '1 day');

  -- 6) Alguien del personal consultando el Copiloto por WhatsApp
  insert into staff_whatsapp (user_id, telefono) values ('${U.administracion.id}', '5493435009988') on conflict do nothing;
  insert into conversaciones (nombre, telefono, staff_user_id, etapa, ultimo_canal, ultimo_mensaje_at)
  values ('${U.administracion.nombre}', '5493435009988', '${U.administracion.id}', 'Nuevo', 'whatsapp', now() - interval '3 hours')
  returning id into c6;
  insert into mensajes (conversacion_id, canal, direccion, autor, cuerpo, created_at) values
    (c6, 'whatsapp', 'entrante', 'contacto', '¿cuántos socios tienen cuotas vencidas?', now() - interval '3 hours 1 minute'),
    (c6, 'whatsapp', 'saliente', 'ia', E'Hoy hay *38 socios* con cuotas vencidas, por *$ 1.284.000* en total.\\nLos de mayor deuda están en *Cobranzas y morosos* del ERP.', now() - interval '3 hours');

  -- último mensaje de cada conversación (para la lista de la Bandeja)
  update conversaciones c set ultimo_mensaje = left(regexp_replace(coalesce(nullif(m.cuerpo, ''), '📎 ' || m.adjunto_nombre), '\\s+', ' ', 'g'), 200)
  from (select distinct on (conversacion_id) conversacion_id, cuerpo, adjunto_nombre from mensajes order by conversacion_id, created_at desc) m
  where m.conversacion_id = c.id;
end $$;
`;

// La base se guarda en el navegador (IndexedDB) para que los cambios sobrevivan al pasar
// del ERP al portal o al checkout. "Reiniciar demo" la borra y la vuelve a generar.
const IDB_NAME = "cecip-demo-v21";
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
        await db.exec(cambios005);
        // En la demo BANCOS y S tienen valor para que se vean sus cuotas (en producción se cargan en Configuración)
        await db.exec(`update categorias set cuota_mensual = 20000 where nombre = 'BANCOS'; update categorias set cuota_mensual = 3000 where nombre = 'S';`);
        await db.exec(padron2026);
        await db.exec(SEED);
        await db.exec(SEED_005);
        await db.exec(capacitaciones008);
        await db.exec(SEED_008);
        await db.exec(salones010);
        await db.exec(copiloto009);
        await db.exec(SEED_010);
        await db.exec(colaEmails011);
        await db.exec(roles012);
        await db.exec(SEED_012);
        await db.exec(valores013);
        await db.exec(canales014);
        await db.exec(SEED_014);
        await db.exec(whatsapp015);
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
