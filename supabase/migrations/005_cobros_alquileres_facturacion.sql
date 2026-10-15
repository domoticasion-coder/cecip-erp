-- =============================================================================
-- CeCIP · Actualización 005
--   1. Periodicidad de cobro por socio (mensual, bimestral, trimestral, semestral, anual)
--   2. Categorías BANCOS, AA, A, B, C, S, JE/ME
--   3. Alquileres (inmuebles, contratos, cobros)
--   4. Facturación electrónica (ARCA a través de n8n)
--   5. Movimientos bancarios (Santander a través de n8n o extracto)
--   6. Imágenes en comunicados, campañas y eventos
--   7. Formularios públicos de inscripción a eventos (para no socios)
--
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 001, 002 y 003.
-- Se puede volver a ejecutar sin problema (por ejemplo si una ejecución anterior quedó a medias).
-- Después ejecutar 006_padron_2026.sql (importa el Excel "Registro de Asociados 2026").
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PERIODICIDAD DE COBRO
-- -----------------------------------------------------------------------------

create table if not exists public.periodicidades (
  codigo text primary key check (codigo in ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual')),
  nombre text not null,
  meses int not null check (meses in (1, 2, 3, 6, 12)),
  descuento numeric(5,2) not null default 0 check (descuento between 0 and 100), -- % sobre el valor mensual
  orden int not null default 0
);

-- Descuentos tomados del Excel 2026 (anual 12%, semestral 6%, trimestral 3%). Se editan en Configuración.
insert into public.periodicidades (codigo, nombre, meses, descuento, orden) values
  ('mensual', 'Mensual', 1, 0, 1),
  ('bimestral', 'Bimestral', 2, 0, 2),
  ('trimestral', 'Trimestral', 3, 3, 3),
  ('semestral', 'Semestral', 6, 6, 4),
  ('anual', 'Anual', 12, 12, 5)
on conflict (codigo) do nothing;

alter table public.socios
  add column if not exists periodicidad text not null default 'mensual' references public.periodicidades(codigo),
  add column if not exists condicion_iva text check (condicion_iva in ('RI', 'Monotributo', 'Exento', 'Consumidor final')),
  add column if not exists emails_extra text, -- otros emails de la empresa (separados por coma)
  -- Marca de seguimiento (los colores del Excel de Tesorería)
  add column if not exists seguimiento text check (seguimiento in ('posible_baja', 'deuda_reciente', 'deuda_condonada', 'cobrador')),
  add column if not exists facturar_auto boolean not null default true; -- emitir factura al cobrarle (si la facturación automática está activa)

-- Cada cuota social cubre uno o varios meses (de periodo a periodo_hasta)
alter table public.cuotas
  add column if not exists periodo_hasta date,
  add column if not exists meses int not null default 1 check (meses between 1 and 12),
  add column if not exists importada boolean not null default false; -- vino del Excel (no generó movimiento en tesorería)
update public.cuotas set periodo_hasta = periodo where periodo is not null and periodo_hasta is null;

-- -----------------------------------------------------------------------------
-- 2. CATEGORÍAS
-- -----------------------------------------------------------------------------

-- Se reemplazan las categorías de ejemplo por las del CeCIP (valor de la cuota MENSUAL).
-- BANCOS y S quedan en $0 porque no figuran en la tabla de precios: completarlos en
-- ERP > Configuración > Categorías (y después "Recalcular cuotas pendientes").
delete from public.categorias where nombre in ('Pequeño Comercio', 'Servicios', 'Mediana Empresa', 'Gran Industria');
insert into public.categorias (nombre, cuota_mensual, descripcion, orden) values
  ('BANCOS', 0, 'Entidades bancarias y financieras', 1),
  ('AA', 10000, null, 2),
  ('A', 8000, null, 3),
  ('B', 6000, null, 4),
  ('C', 5000, null, 5),
  ('S', 0, 'Socio social', 6),
  ('JE/ME', 4000, null, 7)
on conflict (nombre) do update set cuota_mensual = excluded.cuota_mensual, orden = excluded.orden;

-- -----------------------------------------------------------------------------
-- 3. FUNCIONES DE PERÍODOS Y GENERACIÓN DE CUOTAS
-- -----------------------------------------------------------------------------

-- Primer mes del período que contiene a p_fecha (bimestres, trimestres, etc. del año calendario)
create or replace function public.inicio_periodo(p_fecha date, p_meses int) returns date
language sql immutable as $$
  select make_date(extract(year from p_fecha)::int,
                   ((extract(month from p_fecha)::int - 1) / greatest(p_meses, 1)) * greatest(p_meses, 1) + 1, 1)
$$;

create or replace function public.meses_entre(p_desde date, p_hasta date) returns int
language sql immutable as $$
  select (extract(year from p_hasta)::int * 12 + extract(month from p_hasta)::int)
       - (extract(year from p_desde)::int * 12 + extract(month from p_desde)::int) + 1
$$;

-- "Octubre 2026", "5° bimestre 2026 (sep-oct)", "2° semestre 2026", "Año 2026", "Enero a Junio 2026"
create or replace function public.etiqueta_periodo(p_desde date, p_meses int) returns text
language sql immutable as $$
  select case
    when p_meses <= 1 then nombre_mes(p_desde)
    when p_meses = 12 and extract(month from p_desde)::int = 1 then 'Año ' || extract(year from p_desde)::int
    when p_meses in (2, 3, 6) and (extract(month from p_desde)::int - 1) % p_meses = 0 then
      ((extract(month from p_desde)::int - 1) / p_meses + 1) || '° '
      || case p_meses when 2 then 'bimestre' when 3 then 'trimestre' else 'semestre' end
      || ' ' || extract(year from p_desde)::int
      || case when p_meses < 6 then ' (' || lower(left(split_part(nombre_mes(p_desde), ' ', 1), 3)) || '-'
              || lower(left(split_part(nombre_mes((p_desde + make_interval(months => p_meses - 1))::date), ' ', 1), 3)) || ')'
         else '' end
    else split_part(nombre_mes(p_desde), ' ', 1) || ' a ' || nombre_mes((p_desde + make_interval(months => p_meses - 1))::date)
  end
$$;

-- Importe de una cuota: valor mensual de la categoría x meses, menos el descuento de la periodicidad
create or replace function public.importe_cuota(p_mensual numeric, p_meses int, p_descuento numeric) returns numeric
language sql immutable as $$
  select round(coalesce(p_mensual, 0) * p_meses * (1 - coalesce(p_descuento, 0) / 100), 2)
$$;

-- Qué cuotas se generarían para el mes indicado: a cada socio activo se le cobra el período
-- (según su periodicidad) que contiene ese mes, salvo los meses que ya tenga cubiertos.
-- Así se puede generar todos los meses sin duplicar: a un socio anual solo se le genera en enero.
create or replace function public.cuotas_a_generar(p_periodo date)
returns table (socio_id uuid, desde date, hasta date, meses int, monto numeric, concepto text)
language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  v_ini date;
  v_fin date;
  v_desde date;
  v_cubierto date;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para generar cuotas.';
  end if;
  for s in
    select so.id, cat.cuota_mensual, p.meses as pm, p.descuento
    from socios so
    join categorias cat on cat.id = so.categoria_id
    join periodicidades p on p.codigo = so.periodicidad
    where so.estado = 'activo' and cat.cuota_mensual > 0
    order by so.razon_social
  loop
    v_ini := inicio_periodo(p_periodo, s.pm);
    v_fin := (v_ini + make_interval(months => s.pm - 1))::date;
    select max(coalesce(c.periodo_hasta, c.periodo)) into v_cubierto
    from cuotas c
    where c.socio_id = s.id and c.tipo = 'cuota_social' and c.estado <> 'anulada'
      and c.periodo <= v_fin and coalesce(c.periodo_hasta, c.periodo) >= v_ini;
    v_desde := case when v_cubierto is null then v_ini else (v_cubierto + interval '1 month')::date end;
    continue when v_desde > v_fin;
    socio_id := s.id;
    desde := v_desde;
    hasta := v_fin;
    meses := meses_entre(v_desde, v_fin);
    monto := importe_cuota(s.cuota_mensual, meses_entre(v_desde, v_fin), s.descuento);
    concepto := 'Cuota social ' || etiqueta_periodo(v_desde, meses_entre(v_desde, v_fin));
    return next;
  end loop;
end $$;

create or replace function public.generar_cuotas(p_periodo date, p_vencimiento date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para generar cuotas.';
  end if;
  insert into cuotas (socio_id, tipo, periodo, periodo_hasta, meses, concepto, monto, vencimiento, created_by)
  select g.socio_id, 'cuota_social', g.desde, g.hasta, g.meses, g.concepto, g.monto, p_vencimiento, auth.uid()
  from cuotas_a_generar(p_periodo) g;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Actualiza el importe de las cuotas sociales PENDIENTES al valor actual de la categoría y
-- periodicidad de cada socio (por ejemplo después de un aumento). No toca cuotas pagadas
-- ni las que tienen un link de pago activo.
create or replace function public.recalcular_cuotas_pendientes(p_categoria uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos.';
  end if;
  update cuotas c set monto = importe_cuota(cat.cuota_mensual, c.meses, p.descuento)
  from socios s
  join categorias cat on cat.id = s.categoria_id
  join periodicidades p on p.codigo = s.periodicidad
  where c.socio_id = s.id and c.tipo = 'cuota_social' and c.estado = 'pendiente'
    and cat.cuota_mensual > 0
    and (p_categoria is null or s.categoria_id = p_categoria)
    and c.monto <> importe_cuota(cat.cuota_mensual, c.meses, p.descuento)
    and not exists (
      select 1 from links_pago l
      where l.estado = 'activo' and l.items @> jsonb_build_array(jsonb_build_object('cuota_id', c.id::text))
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.cuotas_a_generar(date) from public, anon;
revoke execute on function public.recalcular_cuotas_pendientes(uuid) from public, anon;

-- Vistas: se recrean para incluir las columnas nuevas
drop view if exists public.socios_resumen;
drop view if exists public.cuotas_detalle;

create view public.cuotas_detalle with (security_invoker = true) as
select
  c.*,
  s.razon_social,
  s.nombre_comercial,
  s.numero_socio,
  s.email as socio_email,
  s.whatsapp as socio_whatsapp,
  case when c.estado = 'pendiente' and current_date > c.vencimiento
       then current_date - c.vencimiento else 0 end as dias_atraso,
  case when c.estado = 'pendiente' then public.interes_a_fecha(c.monto, c.vencimiento, current_date)
       when c.estado = 'pagada' then coalesce(c.interes_cobrado, 0)
       else 0 end as interes,
  case when c.estado = 'pendiente' then c.monto + public.interes_a_fecha(c.monto, c.vencimiento, current_date)
       when c.estado = 'pagada' then coalesce(c.monto_pagado, c.monto)
       else c.monto end as total,
  case when c.estado = 'pendiente' and current_date > c.vencimiento then 'vencida' else c.estado end as situacion
from public.cuotas c
join public.socios s on s.id = c.socio_id;

create view public.socios_resumen with (security_invoker = true) as
select
  s.*,
  cat.nombre as categoria_nombre,
  cat.cuota_mensual,
  per.nombre as periodicidad_nombre,
  per.meses as periodicidad_meses,
  case when cat.cuota_mensual > 0 then public.importe_cuota(cat.cuota_mensual, per.meses, per.descuento) end as cuota_periodo,
  coalesce(d.deuda, 0) as deuda,
  coalesce(d.pendientes, 0) as cuotas_pendientes,
  coalesce(d.vencidas, 0) as cuotas_vencidas,
  coalesce(d.max_atraso, 0) as max_dias_atraso
from public.socios s
left join public.categorias cat on cat.id = s.categoria_id
left join public.periodicidades per on per.codigo = s.periodicidad
left join lateral (
  select sum(cd.total) as deuda,
         count(*) as pendientes,
         count(*) filter (where cd.situacion = 'vencida') as vencidas,
         max(cd.dias_atraso) as max_atraso
  from public.cuotas_detalle cd
  where cd.socio_id = s.id and cd.estado = 'pendiente'
) d on true;

alter table public.periodicidades enable row level security;
drop policy if exists per_select on public.periodicidades;
create policy per_select on public.periodicidades for select to authenticated
  using (is_staff() or my_socio_id() is not null);
drop policy if exists per_write on public.periodicidades;
create policy per_write on public.periodicidades for all to authenticated
  using (has_role(array[]::text[])) with check (has_role(array[]::text[]));


-- -----------------------------------------------------------------------------
-- 4. ALQUILERES
-- -----------------------------------------------------------------------------

create table if not exists public.inmuebles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  direccion text,
  descripcion text,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.alquiler_contratos (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid not null references public.inmuebles(id) on delete restrict,
  inquilino_nombre text not null,
  inquilino_cuit text,
  inquilino_condicion_iva text check (inquilino_condicion_iva in ('RI', 'Monotributo', 'Exento', 'Consumidor final')),
  inquilino_email text,
  inquilino_telefono text,
  inquilino_domicilio text,
  socio_id uuid references public.socios(id) on delete set null, -- si el inquilino es socio
  fecha_inicio date not null,
  fecha_fin date,
  monto_mensual numeric(12,2) not null check (monto_mensual > 0),
  dia_vencimiento int not null default 10 check (dia_vencimiento between 1 and 28),
  ajuste_indice text not null default 'ninguno' check (ajuste_indice in ('ninguno', 'ipc', 'icl', 'casa_propia', 'porcentaje')),
  ajuste_cada_meses int check (ajuste_cada_meses is null or ajuste_cada_meses between 1 and 24),
  ajuste_porcentaje numeric(6,2),
  proximo_ajuste date,
  deposito numeric(12,2),
  facturar boolean not null default true,
  estado text not null default 'vigente' check (estado in ('vigente', 'finalizado')),
  observaciones text,
  created_at timestamptz not null default now()
);
create unique index if not exists alquiler_contrato_vigente on public.alquiler_contratos(inmueble_id) where estado = 'vigente';

create table if not exists public.alquiler_cargos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.alquiler_contratos(id) on delete restrict,
  tipo text not null default 'alquiler' check (tipo in ('alquiler', 'expensas', 'servicios', 'otro')),
  periodo date, -- primer día del mes (solo alquiler)
  concepto text not null,
  monto numeric(12,2) not null check (monto > 0),
  vencimiento date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  fecha_pago date,
  metodo_pago text,
  monto_pagado numeric(12,2),
  referencia_pago text,
  cuenta_id uuid references public.cuentas(id) on delete set null,
  recibo_numero bigint unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists alquiler_cargo_mes on public.alquiler_cargos(contrato_id, periodo)
  where tipo = 'alquiler' and estado <> 'anulada';
create index if not exists alquiler_cargos_estado_idx on public.alquiler_cargos(estado, vencimiento);

alter table public.movimientos add column if not exists alquiler_cargo_id uuid references public.alquiler_cargos(id) on delete set null;

create or replace view public.alquiler_cargos_detalle with (security_invoker = true) as
select
  c.*,
  k.inmueble_id,
  i.nombre as inmueble_nombre,
  k.inquilino_nombre,
  k.inquilino_email,
  k.inquilino_telefono,
  case when c.estado = 'pendiente' and current_date > c.vencimiento then current_date - c.vencimiento else 0 end as dias_atraso,
  case when c.estado = 'pendiente' and current_date > c.vencimiento then 'vencida' else c.estado end as situacion
from public.alquiler_cargos c
join public.alquiler_contratos k on k.id = c.contrato_id
join public.inmuebles i on i.id = k.inmueble_id;

-- Genera el alquiler del mes de cada contrato vigente
create or replace function public.generar_alquileres(p_periodo date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_periodo date := date_trunc('month', p_periodo)::date;
  v_count int;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para generar alquileres.';
  end if;
  insert into alquiler_cargos (contrato_id, tipo, periodo, concepto, monto, vencimiento, created_by)
  select k.id, 'alquiler', v_periodo, 'Alquiler ' || i.nombre || ' - ' || nombre_mes(v_periodo),
         k.monto_mensual, make_date(extract(year from v_periodo)::int, extract(month from v_periodo)::int, k.dia_vencimiento),
         auth.uid()
  from alquiler_contratos k
  join inmuebles i on i.id = k.inmueble_id
  where k.estado = 'vigente'
    and k.fecha_inicio < (v_periodo + interval '1 month')::date
    and (k.fecha_fin is null or k.fecha_fin >= v_periodo)
    and not exists (
      select 1 from alquiler_cargos c
      where c.contrato_id = k.id and c.periodo = v_periodo and c.tipo = 'alquiler' and c.estado <> 'anulada'
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.registrar_pago_alquiler(
  p_cargo_id uuid,
  p_metodo text,
  p_cuenta_id uuid default null,
  p_fecha date default current_date,
  p_referencia text default null,
  p_monto numeric default null
) returns public.alquiler_cargos
language plpgsql security definer set search_path = public as $$
declare
  c alquiler_cargos;
  v_cuenta uuid;
  v_inquilino text;
begin
  if not (is_service() or has_role(array['tesoreria'])) then
    raise exception 'No tenés permisos para registrar pagos.';
  end if;
  select * into c from alquiler_cargos where id = p_cargo_id for update;
  if not found then raise exception 'Cargo inexistente.'; end if;
  if c.estado = 'pagada' then return c; end if;
  if c.estado = 'anulada' then raise exception 'El cargo está anulado.'; end if;

  v_cuenta := coalesce(p_cuenta_id, (select cuenta_default_id from configuracion where id = 1));
  update alquiler_cargos set
    estado = 'pagada', fecha_pago = coalesce(p_fecha, current_date), metodo_pago = p_metodo,
    monto_pagado = coalesce(p_monto, c.monto), referencia_pago = p_referencia, cuenta_id = v_cuenta,
    recibo_numero = nextval('recibo_seq')
  where id = c.id returning * into c;

  select inquilino_nombre into v_inquilino from alquiler_contratos where id = c.contrato_id;
  insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, alquiler_cargo_id, comprobante, created_by)
  values (c.fecha_pago, 'ingreso', 'Alquileres', v_cuenta, c.concepto || ' - ' || v_inquilino,
          c.monto_pagado, c.id, 'Recibo N° ' || c.recibo_numero, auth.uid());
  return c;
end $$;

create or replace function public.anular_pago_alquiler(p_cargo_id uuid)
returns public.alquiler_cargos language plpgsql security definer set search_path = public as $$
declare c alquiler_cargos;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para anular pagos.';
  end if;
  select * into c from alquiler_cargos where id = p_cargo_id for update;
  if not found or c.estado <> 'pagada' then raise exception 'El cargo no está pagado.'; end if;
  delete from movimientos where alquiler_cargo_id = c.id;
  update alquiler_cargos set estado = 'pendiente', fecha_pago = null, metodo_pago = null, monto_pagado = null,
    referencia_pago = null, cuenta_id = null, recibo_numero = null
  where id = c.id returning * into c;
  return c;
end $$;

revoke execute on function public.generar_alquileres(date) from public, anon;
revoke execute on function public.registrar_pago_alquiler(uuid, text, uuid, date, text, numeric) from public, anon;
revoke execute on function public.anular_pago_alquiler(uuid) from public, anon;

alter table public.inmuebles enable row level security;
alter table public.alquiler_contratos enable row level security;
alter table public.alquiler_cargos enable row level security;
drop policy if exists inm_select on public.inmuebles;
create policy inm_select on public.inmuebles for select to authenticated using (is_staff());
drop policy if exists inm_write on public.inmuebles;
create policy inm_write on public.inmuebles for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));
drop policy if exists contr_select on public.alquiler_contratos;
create policy contr_select on public.alquiler_contratos for select to authenticated using (is_staff());
drop policy if exists contr_write on public.alquiler_contratos;
create policy contr_write on public.alquiler_contratos for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));
drop policy if exists cargos_select on public.alquiler_cargos;
create policy cargos_select on public.alquiler_cargos for select to authenticated using (is_staff());
drop policy if exists cargos_write on public.alquiler_cargos;
create policy cargos_write on public.alquiler_cargos for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));

-- Los tres inmuebles que alquila el CeCIP (completar nombre y dirección en ERP > Alquileres)
insert into public.inmuebles (nombre, orden)
select v.nombre, v.orden from (values ('Inmueble 1', 1), ('Inmueble 2', 2), ('Inmueble 3', 3)) as v(nombre, orden)
where not exists (select 1 from public.inmuebles);


-- -----------------------------------------------------------------------------
-- 5. FACTURACIÓN ELECTRÓNICA (ARCA vía n8n)
-- El ERP deja cada factura "en cola"; el servidor la envía al webhook de n8n, que la
-- emite en ARCA (WSFE) y devuelve el CAE al endpoint /api/facturas/callback.
-- -----------------------------------------------------------------------------

alter table public.configuracion
  add column if not exists facturacion_auto boolean not null default false, -- facturar automáticamente cada cobro
  add column if not exists factura_condicion_emisor text not null default 'exento'
    check (factura_condicion_emisor in ('exento', 'monotributo', 'ri')),
  add column if not exists factura_punto_venta int check (factura_punto_venta is null or factura_punto_venta between 1 and 99998),
  add column if not exists factura_iva_alicuota numeric(5,2) not null default 21;

create table if not exists public.facturas (
  id uuid primary key default gen_random_uuid(),
  origen text not null default 'manual' check (origen in ('cuota', 'alquiler', 'manual')),
  cuota_id uuid references public.cuotas(id) on delete set null,
  cargo_id uuid references public.alquiler_cargos(id) on delete set null,
  socio_id uuid references public.socios(id) on delete set null,
  contrato_id uuid references public.alquiler_contratos(id) on delete set null,
  receptor_nombre text not null,
  receptor_cuit text,
  receptor_condicion_iva text not null default 'Consumidor final',
  receptor_domicilio text,
  receptor_email text,
  tipo text not null default 'C' check (tipo in ('A', 'B', 'C')),
  punto_venta int,
  numero bigint,
  fecha date not null default current_date,
  concepto text not null,
  neto numeric(12,2) not null,
  iva_alicuota numeric(5,2) not null default 0,
  iva numeric(12,2) not null default 0,
  total numeric(12,2) not null check (total > 0),
  -- en_cola: esperando envío · enviada: n8n la recibió · emitida: tiene CAE · error: ARCA la rechazó
  estado text not null default 'en_cola' check (estado in ('en_cola', 'enviada', 'emitida', 'error', 'anulada')),
  cae text,
  cae_vencimiento date,
  pdf_url text,
  error text,
  intentos int not null default 0,
  enviada_at timestamptz,
  emitida_at timestamptz,
  respuesta jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists facturas_cuota_unica on public.facturas(cuota_id) where cuota_id is not null and estado <> 'anulada';
create unique index if not exists facturas_cargo_unica on public.facturas(cargo_id) where cargo_id is not null and estado <> 'anulada';
create index if not exists facturas_estado_idx on public.facturas(estado, created_at desc);
create index if not exists facturas_socio_idx on public.facturas(socio_id);

-- Tipo de comprobante según la condición del CeCIP y la del receptor
create or replace function public.tipo_factura(p_receptor text) returns text
language sql stable set search_path = public as $$
  select case
    when (select factura_condicion_emisor from configuracion where id = 1) = 'ri' then
      case when p_receptor in ('RI', 'Monotributo') then 'A' else 'B' end
    else 'C' end
$$;

-- Arma la factura de un cobro y la deja en cola (no verifica permisos: la llaman los triggers y facturar())
create or replace function public.encolar_factura(p_cuota uuid, p_cargo uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_tipo text;
  v_al numeric;
  v_total numeric;
  v_concepto text;
  v_nombre text; v_cuit text; v_iva text; v_dom text; v_mail text;
  v_socio uuid; v_contrato uuid;
begin
  select id into v_id from facturas
  where estado <> 'anulada' and ((p_cuota is not null and cuota_id = p_cuota) or (p_cargo is not null and cargo_id = p_cargo));
  if v_id is not null then return v_id; end if;

  if p_cuota is not null then
    select coalesce(c.monto_pagado, c.monto), c.concepto, s.razon_social, s.cuit, s.condicion_iva, s.direccion, s.email, s.id
      into v_total, v_concepto, v_nombre, v_cuit, v_iva, v_dom, v_mail, v_socio
    from cuotas c join socios s on s.id = c.socio_id where c.id = p_cuota;
  else
    select coalesce(c.monto_pagado, c.monto), c.concepto, k.inquilino_nombre, k.inquilino_cuit, k.inquilino_condicion_iva,
           k.inquilino_domicilio, k.inquilino_email, k.socio_id, k.id
      into v_total, v_concepto, v_nombre, v_cuit, v_iva, v_dom, v_mail, v_socio, v_contrato
    from alquiler_cargos c join alquiler_contratos k on k.id = c.contrato_id where c.id = p_cargo;
  end if;
  if v_total is null or v_total <= 0 then return null; end if;

  v_iva := coalesce(v_iva, case when length(solo_digitos(v_cuit)) = 11 then 'RI' else 'Consumidor final' end);
  v_tipo := tipo_factura(v_iva);
  v_al := case when v_tipo = 'C' then 0 else (select factura_iva_alicuota from configuracion where id = 1) end;

  insert into facturas (origen, cuota_id, cargo_id, socio_id, contrato_id, receptor_nombre, receptor_cuit,
                        receptor_condicion_iva, receptor_domicilio, receptor_email, tipo, punto_venta, concepto,
                        neto, iva_alicuota, iva, total, created_by)
  values (case when p_cuota is not null then 'cuota' else 'alquiler' end, p_cuota, p_cargo, v_socio, v_contrato,
          v_nombre, v_cuit, v_iva, v_dom, v_mail, v_tipo, (select factura_punto_venta from configuracion where id = 1),
          v_concepto, round(v_total / (1 + v_al / 100), 2), v_al, v_total - round(v_total / (1 + v_al / 100), 2),
          v_total, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.encolar_factura(uuid, uuid) from public, anon, authenticated;

-- Botón "Facturar" del ERP (cuotas o alquileres ya cobrados)
create or replace function public.facturar(p_cuota uuid default null, p_cargo uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para facturar.';
  end if;
  if (p_cuota is null) = (p_cargo is null) then
    raise exception 'Indicá una cuota o un cargo de alquiler.';
  end if;
  return encolar_factura(p_cuota, p_cargo);
end $$;
revoke execute on function public.facturar(uuid, uuid) from public, anon;

-- Facturación automática: al cobrarse una cuota o un alquiler queda la factura en cola
create or replace function public.tg_facturar_cobro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pagada' and old.estado is distinct from 'pagada'
     and coalesce((select facturacion_auto from configuracion where id = 1), false) then
    if tg_table_name = 'cuotas' then
      if coalesce((select facturar_auto from socios where id = new.socio_id), true) then
        perform encolar_factura(new.id, null);
      end if;
    elsif coalesce((select facturar from alquiler_contratos where id = new.contrato_id), true) then
      perform encolar_factura(null, new.id);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_facturar_cobro() from public, anon, authenticated;

drop trigger if exists cuotas_facturar on public.cuotas;
create trigger cuotas_facturar after update of estado on public.cuotas
  for each row execute function public.tg_facturar_cobro();
drop trigger if exists alquiler_cargos_facturar on public.alquiler_cargos;
create trigger alquiler_cargos_facturar after update of estado on public.alquiler_cargos
  for each row execute function public.tg_facturar_cobro();

alter table public.facturas enable row level security;
drop policy if exists fact_select on public.facturas;
create policy fact_select on public.facturas for select to authenticated
  using (is_staff() or (estado = 'emitida' and socio_id = my_socio_id() and origen = 'cuota'));
drop policy if exists fact_insert on public.facturas;
create policy fact_insert on public.facturas for insert to authenticated with check (has_role(array['tesoreria']));
drop policy if exists fact_update on public.facturas;
create policy fact_update on public.facturas for update to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));
drop policy if exists fact_delete on public.facturas;
create policy fact_delete on public.facturas for delete to authenticated
  using (has_role(array['tesoreria']) and estado in ('en_cola', 'error'));


-- -----------------------------------------------------------------------------
-- 6. MOVIMIENTOS BANCARIOS (Santander)
-- Llegan desde n8n (API de Santander) a /api/banco/movimientos o se importan desde el
-- extracto CSV. Tesorería los concilia: imputándolos a una cuota, a un alquiler o
-- registrándolos como ingreso / egreso.
-- -----------------------------------------------------------------------------

insert into public.cuentas (nombre, tipo, orden) values ('Banco Santander', 'banco', 5) on conflict (nombre) do nothing;

create table if not exists public.banco_movimientos (
  id uuid primary key default gen_random_uuid(),
  banco text not null default 'Santander',
  cuenta_id uuid references public.cuentas(id) on delete set null,
  id_externo text not null, -- identificador del banco (evita duplicados al sincronizar)
  fecha date not null,
  descripcion text not null,
  monto numeric(14,2) not null, -- positivo = crédito (entra plata), negativo = débito
  saldo numeric(14,2),
  referencia text,
  contraparte_nombre text,
  contraparte_cuit text,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'conciliado', 'ignorado')),
  movimiento_id uuid references public.movimientos(id) on delete set null,
  cuota_id uuid references public.cuotas(id) on delete set null,
  cargo_id uuid references public.alquiler_cargos(id) on delete set null,
  conciliado_por uuid references auth.users(id) on delete set null,
  conciliado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (banco, id_externo)
);
create index if not exists banco_mov_fecha_idx on public.banco_movimientos(fecha desc);

-- Concilia un movimiento del banco. Indicar UNA opción: cuota, cargo de alquiler o categoría de tesorería.
create or replace function public.conciliar_banco(
  p_mov uuid,
  p_cuota uuid default null,
  p_cargo uuid default null,
  p_categoria text default null,
  p_detalle text default null
) returns public.banco_movimientos
language plpgsql security definer set search_path = public as $$
declare
  b banco_movimientos;
  v_cuenta uuid;
  v_mov uuid;
  v_ref text;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para conciliar.';
  end if;
  select * into b from banco_movimientos where id = p_mov for update;
  if not found then raise exception 'Movimiento inexistente.'; end if;
  if b.estado = 'conciliado' then raise exception 'El movimiento ya está conciliado.'; end if;
  v_cuenta := coalesce(b.cuenta_id, (select id from cuentas where nombre = 'Banco ' || b.banco limit 1));
  v_ref := left(b.banco || ' ' || coalesce(b.referencia, b.id_externo), 120);

  if p_cuota is not null then
    if b.monto <= 0 then raise exception 'Solo se imputan a cuotas los créditos (ingresos).'; end if;
    perform registrar_pago(p_cuota, 'Transferencia', v_cuenta, b.fecha, v_ref, b.monto);
    select id into v_mov from movimientos where cuota_id = p_cuota order by created_at desc limit 1;
  elsif p_cargo is not null then
    if b.monto <= 0 then raise exception 'Solo se imputan a alquileres los créditos (ingresos).'; end if;
    perform registrar_pago_alquiler(p_cargo, 'Transferencia', v_cuenta, b.fecha, v_ref, b.monto);
    select id into v_mov from movimientos where alquiler_cargo_id = p_cargo order by created_at desc limit 1;
  elsif p_categoria is not null then
    insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, comprobante, conciliado, created_by)
    values (b.fecha, case when b.monto > 0 then 'ingreso' else 'egreso' end, p_categoria, v_cuenta,
            coalesce(nullif(trim(p_detalle), ''), b.descripcion), abs(b.monto), v_ref, true, auth.uid())
    returning id into v_mov;
  else
    raise exception 'Elegí cómo conciliar el movimiento.';
  end if;

  update movimientos set conciliado = true where id = v_mov;
  update banco_movimientos set estado = 'conciliado', movimiento_id = v_mov, cuota_id = p_cuota, cargo_id = p_cargo,
    conciliado_por = auth.uid(), conciliado_at = now()
  where id = b.id returning * into b;
  return b;
end $$;
revoke execute on function public.conciliar_banco(uuid, uuid, uuid, text, text) from public, anon;

alter table public.banco_movimientos enable row level security;
drop policy if exists banco_select on public.banco_movimientos;
create policy banco_select on public.banco_movimientos for select to authenticated using (has_role(array['tesoreria']));
drop policy if exists banco_write on public.banco_movimientos;
create policy banco_write on public.banco_movimientos for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));


-- -----------------------------------------------------------------------------
-- 7. IMÁGENES EN LA COMUNICACIÓN
-- -----------------------------------------------------------------------------

alter table public.comunicados add column if not exists imagen_url text;
alter table public.comercia_novedades add column if not exists imagen_url text;
alter table public.wa_campanas add column if not exists imagen_url text;
alter table public.eventos add column if not exists imagen_url text;

-- Bucket público "imagenes" de Supabase Storage (solo el personal puede subir y borrar)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('imagenes', 'imagenes', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
      on conflict (id) do nothing $q$;
    perform set_config('cecip.bucket', 'ok', false);
    begin
      execute 'drop policy if exists imagenes_subida on storage.objects';
      execute 'drop policy if exists imagenes_borrado on storage.objects';
      execute $q$
        create policy imagenes_subida on storage.objects for insert to authenticated
        with check (bucket_id = 'imagenes' and (public.is_staff() or public.has_role(array['comercia']))) $q$;
      execute $q$
        create policy imagenes_borrado on storage.objects for delete to authenticated
        using (bucket_id = 'imagenes' and (public.is_staff() or public.has_role(array['comercia']))) $q$;
    exception when insufficient_privilege then
      raise notice 'No se pudieron crear los permisos del bucket "imagenes": crealos en Storage > Policies (ver README).';
    end;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 8. FORMULARIOS PÚBLICOS DE INSCRIPCIÓN A EVENTOS (no socios)
-- -----------------------------------------------------------------------------

alter table public.eventos
  add column if not exists slug text unique,
  add column if not exists formulario_publico boolean not null default false,
  -- Preguntas extra del formulario: [{ "id": "p1", "etiqueta": "...", "tipo": "texto"|"opciones"|"si_no", "opciones": [], "requerida": true }]
  add column if not exists preguntas jsonb not null default '[]';

alter table public.inscripciones
  add column if not exists empresa text,
  add column if not exists cuit text,
  add column if not exists es_socio boolean not null default true,
  add column if not exists respuestas jsonb not null default '{}',
  add column if not exists origen text not null default 'portal' check (origen in ('portal', 'erp', 'publico'));
create unique index if not exists inscripciones_email_unico on public.inscripciones(evento_id, lower(asistente_email))
  where asistente_email is not null and socio_id is null;

create or replace function public.slug_texto(t text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public.tg_evento_slug() returns trigger language plpgsql as $$
begin
  if coalesce(new.slug, '') = '' then
    new.slug := left(slug_texto(new.titulo), 50) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
  end if;
  return new;
end $$;
drop trigger if exists eventos_slug on public.eventos;
create trigger eventos_slug before insert or update on public.eventos
  for each row execute function public.tg_evento_slug();
update public.eventos set slug = null where slug is null; -- completa el slug de los eventos existentes

-- Datos públicos del evento para el formulario (sin login)
create or replace function public.evento_publico(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'titulo', e.titulo, 'descripcion', e.descripcion, 'tipo', e.tipo,
    'fecha_inicio', e.fecha_inicio, 'fecha_fin', e.fecha_fin, 'lugar', e.lugar, 'modalidad', e.modalidad,
    'costo', e.costo, 'cupo', e.cupo, 'imagen_url', e.imagen_url, 'preguntas', e.preguntas,
    'cupo_disponible', case when e.cupo is null then null
                            else greatest(e.cupo - (select count(*) from inscripciones i where i.evento_id = e.id), 0) end,
    'abierta', e.inscripcion_abierta and e.fecha_inicio > now()
               and (e.cupo is null or (select count(*) from inscripciones i where i.evento_id = e.id) < e.cupo)
  )
  from eventos e
  where e.slug = p_slug and e.formulario_publico
$$;

create or replace function public.inscribir_publico(
  p_slug text,
  p_nombre text,
  p_email text,
  p_telefono text default null,
  p_empresa text default null,
  p_cuit text default null,
  p_respuestas jsonb default '{}'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  e eventos;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_socio uuid;
  v_preg jsonb;
begin
  select * into e from eventos where slug = p_slug and formulario_publico;
  if not found then raise exception 'El formulario no existe o ya no está disponible.'; end if;
  if not e.inscripcion_abierta or e.fecha_inicio <= now() then
    raise exception 'La inscripción para esta actividad está cerrada.';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Completá tu nombre y apellido.'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Ingresá un email válido.'; end if;
  if length(coalesce(p_respuestas, '{}')::text) > 8000 then raise exception 'Las respuestas son demasiado largas.'; end if;

  for v_preg in select * from jsonb_array_elements(coalesce(e.preguntas, '[]'::jsonb)) loop
    if coalesce((v_preg ->> 'requerida')::boolean, false)
       and coalesce(trim(coalesce(p_respuestas, '{}'::jsonb) ->> (v_preg ->> 'id')), '') = '' then
      raise exception 'Falta responder: %', v_preg ->> 'etiqueta';
    end if;
  end loop;

  if exists (select 1 from inscripciones where evento_id = e.id and lower(asistente_email) = v_email) then
    raise exception 'Ya hay una inscripción con ese email para esta actividad.';
  end if;

  if length(solo_digitos(p_cuit)) = 11 then
    select id into v_socio from socios where solo_digitos(cuit) = solo_digitos(p_cuit) and estado <> 'baja' limit 1;
  end if;

  insert into inscripciones (evento_id, socio_id, asistente_nombre, asistente_email, asistente_telefono,
                             empresa, cuit, es_socio, respuestas, origen)
  values (e.id, v_socio, left(trim(p_nombre), 120), v_email, left(nullif(trim(p_telefono), ''), 40),
          left(nullif(trim(p_empresa), ''), 150), left(nullif(trim(p_cuit), ''), 20), v_socio is not null,
          coalesce(p_respuestas, '{}'::jsonb), 'publico');

  return json_build_object('ok', true, 'titulo', e.titulo, 'fecha_inicio', e.fecha_inicio, 'es_socio', v_socio is not null);
end $$;

grant execute on function public.evento_publico(text) to anon, authenticated;
grant execute on function public.inscribir_publico(text, text, text, text, text, text, jsonb) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. TABLERO (cuotas que cubren varios meses se prorratean por mes)
-- -----------------------------------------------------------------------------

create or replace function public.resumen_dashboard()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'socios_activos', (select count(*) from socios where estado = 'activo'),
    'socios_morosos', (select count(*) from socios_resumen where estado = 'activo' and cuotas_vencidas > 0),
    'deuda_total', (select coalesce(sum(total), 0) from cuotas_detalle where estado = 'pendiente'),
    'deuda_vencida', (select coalesce(sum(total), 0) from cuotas_detalle where situacion = 'vencida'),
    'cobrado_mes', (select coalesce(sum(monto_pagado), 0) from cuotas
                    where estado = 'pagada' and fecha_pago >= date_trunc('month', current_date)),
    'facturado_mes', (select coalesce(round(sum(monto / meses), 2), 0) from cuotas
                      where tipo = 'cuota_social' and estado <> 'anulada'
                        and date_trunc('month', current_date)::date between periodo and coalesce(periodo_hasta, periodo)),
    'cobrado_mes_cuotas', (select coalesce(round(sum(monto / meses), 2), 0) from cuotas
                      where tipo = 'cuota_social' and estado = 'pagada'
                        and date_trunc('month', current_date)::date between periodo and coalesce(periodo_hasta, periodo)),
    'accesos_pendientes', (select count(*) from socio_usuarios where estado = 'pendiente'),
    'comercia_nuevas', (select count(*) from comercia_solicitudes where estado = 'nueva'),
    'proximos_eventos', (select count(*) from eventos where fecha_inicio >= now()),
    'alquileres_pendientes', (select count(*) from alquiler_cargos where estado = 'pendiente' and vencimiento < current_date),
    'facturas_con_error', (select count(*) from facturas where estado = 'error'),
    'banco_sin_conciliar', (select count(*) from banco_movimientos where estado = 'nuevo')
  )
$$;


-- -----------------------------------------------------------------------------
-- Verificación: todo debería decir "ok"
-- -----------------------------------------------------------------------------
select 'categorías nuevas' as control, case when (select count(*) from public.categorias where nombre in ('BANCOS','AA','A','B','C','S','JE/ME')) = 7 then 'ok' else 'FALTA' end as estado
union all select 'periodicidades', case when (select count(*) from public.periodicidades) = 5 then 'ok' else 'FALTA' end
union all select 'alquileres', case when to_regclass('public.alquiler_cargos') is not null then 'ok' else 'FALTA' end
union all select 'facturación', case when to_regclass('public.facturas') is not null then 'ok' else 'FALTA' end
union all select 'banco', case when to_regclass('public.banco_movimientos') is not null then 'ok' else 'FALTA' end
union all select 'formularios públicos', case when exists (select 1 from pg_proc where proname = 'inscribir_publico') then 'ok' else 'FALTA' end
union all select 'bucket de imágenes', coalesce(nullif(current_setting('cecip.bucket', true), ''), 'sin storage');
