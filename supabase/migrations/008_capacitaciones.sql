-- =============================================================================
-- CeCIP · Actualización 008: CAPACITACIONES
--   - Docentes (alta, baja, datos para pagarles)
--   - Capacitaciones con días, horario, cantidad de clases, precios y honorario del docente
--   - Pagos a docentes con historial (egreso en tesorería)
--   - Inscripciones con datos de facturación (CUIT, razón social, condición IVA), cobro,
--     recibo y factura automática en ARCA (vía n8n, igual que cuotas y alquileres)
--
-- Las capacitaciones son eventos de tipo "capacitacion": se publican en el portal y pueden
-- tener formulario público de inscripción, como cualquier evento.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 005. Se puede volver a ejecutar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. DOCENTES
-- -----------------------------------------------------------------------------

create table if not exists public.docentes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cuit text,
  condicion_iva text check (condicion_iva in ('RI', 'Monotributo', 'Exento', 'Consumidor final')),
  email text,
  telefono text,
  especialidad text,
  cbu text,
  alias text,
  honorario_sugerido numeric(12,2),        -- referencia (por clase u hora) para cargar cursos
  activo boolean not null default true,
  observaciones text,
  created_at timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- 2. DATOS DE CURSADA EN LOS EVENTOS DE TIPO CAPACITACIÓN
-- -----------------------------------------------------------------------------

alter table public.eventos
  add column if not exists docente_id uuid references public.docentes(id) on delete set null,
  add column if not exists dias_semana int[] not null default '{}',   -- 1 = lunes ... 7 = domingo
  add column if not exists hora_inicio time,
  add column if not exists hora_fin time,
  add column if not exists cantidad_clases int check (cantidad_clases is null or cantidad_clases > 0),
  add column if not exists precio_no_socio numeric(12,2),             -- vacío = mismo precio que socios
  -- Cómo se le paga al docente
  add column if not exists honorario_tipo text not null default 'por_clase'
    check (honorario_tipo in ('por_clase', 'por_hora', 'total', 'por_alumno', 'porcentaje')),
  add column if not exists honorario_monto numeric(12,2) not null default 0,
  add column if not exists facturar boolean not null default true,    -- facturar las inscripciones
  add column if not exists cancelado boolean not null default false;


-- -----------------------------------------------------------------------------
-- 3. INSCRIPCIONES: FACTURACIÓN Y COBRO
-- -----------------------------------------------------------------------------

alter table public.inscripciones
  add column if not exists razon_social text,          -- a nombre de quién se factura
  add column if not exists condicion_iva text check (condicion_iva in ('RI', 'Monotributo', 'Exento', 'Consumidor final')),
  add column if not exists monto numeric(12,2) not null default 0,
  -- pendiente · pagada · en_cuenta (cargada en la cuenta corriente del socio) · bonificada · sin_cargo
  add column if not exists estado_pago text not null default 'pendiente'
    check (estado_pago in ('pendiente', 'pagada', 'en_cuenta', 'bonificada', 'sin_cargo')),
  add column if not exists fecha_pago date,
  add column if not exists metodo_pago text,
  add column if not exists monto_pagado numeric(12,2),
  add column if not exists referencia_pago text,
  add column if not exists cuenta_id uuid references public.cuentas(id) on delete set null,
  add column if not exists recibo_numero bigint unique,
  add column if not exists cuota_id uuid references public.cuotas(id) on delete set null;

alter table public.movimientos add column if not exists inscripcion_id uuid references public.inscripciones(id) on delete set null;

-- Al inscribirse: precio de socio o de no socio y datos de facturación del socio
create or replace function public.tg_inscripcion_datos() returns trigger
language plpgsql security definer set search_path = public as $$
declare e eventos; s socios;
begin
  select * into e from eventos where id = new.evento_id;
  if new.socio_id is not null then
    select * into s from socios where id = new.socio_id;
    new.cuit := coalesce(nullif(new.cuit, ''), s.cuit);
    new.razon_social := coalesce(nullif(new.razon_social, ''), s.razon_social);
    new.condicion_iva := coalesce(new.condicion_iva, s.condicion_iva);
    new.empresa := coalesce(nullif(new.empresa, ''), s.nombre_comercial, s.razon_social);
    new.es_socio := true;
  end if;
  if tg_op = 'INSERT' and coalesce(new.monto, 0) = 0 then
    new.monto := case when new.socio_id is not null then coalesce(e.costo, 0)
                      else coalesce(e.precio_no_socio, e.costo, 0) end;
  end if;
  if tg_op = 'INSERT' and coalesce(new.monto, 0) = 0 and new.estado_pago = 'pendiente' then
    new.estado_pago := 'sin_cargo';
  end if;
  return new;
end $$;
revoke execute on function public.tg_inscripcion_datos() from public, anon, authenticated;
drop trigger if exists inscripciones_datos on public.inscripciones;
create trigger inscripciones_datos before insert on public.inscripciones
  for each row execute function public.tg_inscripcion_datos();

-- Las inscripciones de socios ya cargadas toman los datos de facturación del socio
update public.inscripciones i set
  cuit = coalesce(nullif(i.cuit, ''), s.cuit),
  razon_social = coalesce(nullif(i.razon_social, ''), s.razon_social),
  condicion_iva = coalesce(i.condicion_iva, s.condicion_iva),
  empresa = coalesce(nullif(i.empresa, ''), s.nombre_comercial, s.razon_social)
from public.socios s
where s.id = i.socio_id and (i.cuit is null or i.razon_social is null or i.condicion_iva is null);

-- Las inscripciones ya cargadas toman el precio de la actividad
update public.inscripciones i set monto = case when i.socio_id is not null then e.costo else coalesce(e.precio_no_socio, e.costo) end,
  estado_pago = case when coalesce(case when i.socio_id is not null then e.costo else coalesce(e.precio_no_socio, e.costo) end, 0) = 0 then 'sin_cargo' else i.estado_pago end
from public.eventos e
where e.id = i.evento_id and i.monto = 0 and i.estado_pago = 'pendiente';


-- -----------------------------------------------------------------------------
-- 4. PAGOS A DOCENTES
-- -----------------------------------------------------------------------------

create table if not exists public.docente_pagos (
  id uuid primary key default gen_random_uuid(),
  docente_id uuid not null references public.docentes(id) on delete restrict,
  evento_id uuid references public.eventos(id) on delete set null,
  fecha date not null default current_date,
  concepto text not null,
  clases int check (clases is null or clases > 0),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text,
  cuenta_id uuid references public.cuentas(id) on delete set null,
  comprobante text,            -- factura o recibo que entregó el docente
  movimiento_id uuid references public.movimientos(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists docente_pagos_docente_idx on public.docente_pagos(docente_id, fecha desc);
create index if not exists docente_pagos_evento_idx on public.docente_pagos(evento_id);

-- Registra el pago al docente y el egreso en tesorería
create or replace function public.registrar_pago_docente(
  p_docente uuid,
  p_evento uuid,
  p_monto numeric,
  p_concepto text,
  p_clases int default null,
  p_fecha date default current_date,
  p_metodo text default 'Transferencia',
  p_cuenta uuid default null,
  p_comprobante text default null
) returns public.docente_pagos
language plpgsql security definer set search_path = public as $$
declare
  pg docente_pagos;
  v_mov uuid;
  v_doc text;
  v_cuenta uuid := coalesce(p_cuenta, (select cuenta_default_id from configuracion where id = 1));
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para registrar pagos a docentes.';
  end if;
  if coalesce(p_monto, 0) <= 0 then raise exception 'Ingresá un monto válido.'; end if;
  select nombre into v_doc from docentes where id = p_docente;
  if v_doc is null then raise exception 'Docente inexistente.'; end if;

  insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, comprobante, created_by)
  values (coalesce(p_fecha, current_date), 'egreso', 'Honorarios docentes', v_cuenta,
          left(coalesce(nullif(trim(p_concepto), ''), 'Honorarios') || ' - ' || v_doc, 300), p_monto, p_comprobante, auth.uid())
  returning id into v_mov;

  insert into docente_pagos (docente_id, evento_id, fecha, concepto, clases, monto, metodo_pago, cuenta_id, comprobante, movimiento_id, created_by)
  values (p_docente, p_evento, coalesce(p_fecha, current_date), coalesce(nullif(trim(p_concepto), ''), 'Honorarios'), p_clases,
          p_monto, p_metodo, v_cuenta, nullif(trim(p_comprobante), ''), v_mov, auth.uid())
  returning * into pg;
  return pg;
end $$;

create or replace function public.anular_pago_docente(p_pago uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_mov uuid;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos.';
  end if;
  select movimiento_id into v_mov from docente_pagos where id = p_pago;
  if not found then raise exception 'Pago inexistente.'; end if;
  delete from docente_pagos where id = p_pago;
  delete from movimientos where id = v_mov;
end $$;

revoke execute on function public.registrar_pago_docente(uuid, uuid, numeric, text, int, date, text, uuid, text) from public, anon;
revoke execute on function public.anular_pago_docente(uuid) from public, anon;


-- -----------------------------------------------------------------------------
-- 5. COBRO DE INSCRIPCIONES
-- -----------------------------------------------------------------------------

create or replace function public.registrar_pago_inscripcion(
  p_inscripcion uuid,
  p_metodo text,
  p_cuenta uuid default null,
  p_fecha date default current_date,
  p_monto numeric default null,
  p_referencia text default null
) returns public.inscripciones
language plpgsql security definer set search_path = public as $$
declare
  i inscripciones;
  v_titulo text;
  v_cuenta uuid;
begin
  if not (is_service() or has_role(array['tesoreria', 'atencion'])) then
    raise exception 'No tenés permisos para cobrar inscripciones.';
  end if;
  select * into i from inscripciones where id = p_inscripcion for update;
  if not found then raise exception 'Inscripción inexistente.'; end if;
  if i.estado_pago = 'pagada' then return i; end if;
  if i.estado_pago = 'en_cuenta' then raise exception 'Esta inscripción está cargada en la cuenta del socio: se cobra desde sus cuotas.'; end if;
  if coalesce(p_monto, i.monto) <= 0 then raise exception 'La inscripción no tiene importe a cobrar.'; end if;

  v_cuenta := coalesce(p_cuenta,
    case when p_metodo = 'Mercado Pago' then (select cuenta_mp_id from configuracion where id = 1)
         else (select cuenta_default_id from configuracion where id = 1) end);
  update inscripciones set estado_pago = 'pagada', fecha_pago = coalesce(p_fecha, current_date), metodo_pago = p_metodo,
    monto_pagado = coalesce(p_monto, i.monto), referencia_pago = p_referencia, cuenta_id = v_cuenta,
    recibo_numero = nextval('recibo_seq')
  where id = i.id returning * into i;

  select titulo into v_titulo from eventos where id = i.evento_id;
  insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, inscripcion_id, comprobante, created_by)
  values (i.fecha_pago, 'ingreso', 'Eventos y capacitaciones', v_cuenta,
          left('Inscripción: ' || v_titulo || ' - ' || coalesce(i.razon_social, i.empresa, i.asistente_nombre), 300),
          i.monto_pagado, i.id, 'Recibo N° ' || i.recibo_numero, auth.uid());
  return i;
end $$;

create or replace function public.anular_pago_inscripcion(p_inscripcion uuid)
returns public.inscripciones language plpgsql security definer set search_path = public as $$
declare i inscripciones;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para anular cobros.';
  end if;
  select * into i from inscripciones where id = p_inscripcion for update;
  if not found or i.estado_pago <> 'pagada' or i.cuota_id is not null then raise exception 'La inscripción no tiene un cobro propio para anular.'; end if;
  delete from movimientos where inscripcion_id = i.id;
  update inscripciones set estado_pago = 'pendiente', fecha_pago = null, metodo_pago = null, monto_pagado = null,
    referencia_pago = null, cuenta_id = null, recibo_numero = null
  where id = i.id returning * into i;
  return i;
end $$;

-- Pasa el costo de la inscripción a la cuenta corriente del socio (lo paga con sus cuotas o Mercado Pago)
create or replace function public.cargar_inscripcion_a_cuenta(p_inscripcion uuid)
returns public.inscripciones language plpgsql security definer set search_path = public as $$
declare i inscripciones; e eventos; v_cuota uuid;
begin
  if not has_role(array['tesoreria', 'atencion']) then
    raise exception 'No tenés permisos.';
  end if;
  select * into i from inscripciones where id = p_inscripcion for update;
  if not found then raise exception 'Inscripción inexistente.'; end if;
  if i.socio_id is null then raise exception 'Solo se puede cargar a la cuenta de un socio.'; end if;
  if i.estado_pago <> 'pendiente' then raise exception 'La inscripción ya está cobrada o cargada.'; end if;
  if coalesce(i.monto, 0) <= 0 then raise exception 'La inscripción no tiene importe.'; end if;
  select * into e from eventos where id = i.evento_id;
  insert into cuotas (socio_id, tipo, concepto, monto, vencimiento, created_by)
  values (i.socio_id, 'otro', left('Inscripción: ' || e.titulo || ' (' || i.asistente_nombre || ')', 200), i.monto,
          greatest(e.fecha_inicio::date, current_date), auth.uid())
  returning id into v_cuota;
  update inscripciones set estado_pago = 'en_cuenta', cuota_id = v_cuota where id = i.id returning * into i;
  return i;
end $$;

-- Cuando se paga (o se revierte) la cuota de una inscripción cargada en cuenta
create or replace function public.tg_cuota_inscripcion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pagada' and old.estado is distinct from 'pagada' then
    update inscripciones set estado_pago = 'pagada', fecha_pago = new.fecha_pago, metodo_pago = new.metodo_pago,
      monto_pagado = new.monto_pagado, recibo_numero = null
    where cuota_id = new.id;
  elsif old.estado = 'pagada' and new.estado <> 'pagada' then
    update inscripciones set estado_pago = 'en_cuenta', fecha_pago = null, metodo_pago = null, monto_pagado = null
    where cuota_id = new.id;
  elsif new.estado = 'anulada' then
    update inscripciones set estado_pago = 'pendiente', cuota_id = null where cuota_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_cuota_inscripcion() from public, anon, authenticated;
drop trigger if exists cuotas_inscripcion on public.cuotas;
create trigger cuotas_inscripcion after update of estado on public.cuotas
  for each row execute function public.tg_cuota_inscripcion();

revoke execute on function public.registrar_pago_inscripcion(uuid, text, uuid, date, numeric, text) from public, anon;
revoke execute on function public.anular_pago_inscripcion(uuid) from public, anon;
revoke execute on function public.cargar_inscripcion_a_cuenta(uuid) from public, anon;


-- -----------------------------------------------------------------------------
-- 6. FACTURACIÓN DE INSCRIPCIONES (ARCA vía n8n, igual que cuotas y alquileres)
-- -----------------------------------------------------------------------------

alter table public.facturas add column if not exists inscripcion_id uuid references public.inscripciones(id) on delete set null;
alter table public.facturas drop constraint if exists facturas_origen_check;
alter table public.facturas add constraint facturas_origen_check check (origen in ('cuota', 'alquiler', 'manual', 'inscripcion'));
create unique index if not exists facturas_inscripcion_unica on public.facturas(inscripcion_id)
  where inscripcion_id is not null and estado <> 'anulada';

create or replace function public.encolar_factura_inscripcion(p_inscripcion uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i inscripciones;
  v_id uuid;
  v_titulo text;
  v_iva text;
  v_tipo text;
  v_al numeric;
  v_total numeric;
begin
  select id into v_id from facturas where inscripcion_id = p_inscripcion and estado <> 'anulada';
  if v_id is not null then return v_id; end if;
  select * into i from inscripciones where id = p_inscripcion;
  if not found or i.estado_pago <> 'pagada' or i.cuota_id is not null then return null; end if; -- las cargadas en cuenta se facturan con la cuota
  v_total := coalesce(i.monto_pagado, i.monto);
  if v_total <= 0 then return null; end if;
  select titulo into v_titulo from eventos where id = i.evento_id;
  v_iva := coalesce(i.condicion_iva, case when length(solo_digitos(i.cuit)) = 11 then 'RI' else 'Consumidor final' end);
  v_tipo := tipo_factura(v_iva);
  v_al := case when v_tipo = 'C' then 0 else (select factura_iva_alicuota from configuracion where id = 1) end;
  insert into facturas (origen, inscripcion_id, socio_id, receptor_nombre, receptor_cuit, receptor_condicion_iva, receptor_email,
                        tipo, punto_venta, fecha, concepto, neto, iva_alicuota, iva, total, created_by)
  values ('inscripcion', i.id, i.socio_id, coalesce(nullif(i.razon_social, ''), nullif(i.empresa, ''), i.asistente_nombre),
          nullif(i.cuit, ''), v_iva, i.asistente_email, v_tipo, (select factura_punto_venta from configuracion where id = 1),
          coalesce(i.fecha_pago, current_date), left('Inscripción: ' || v_titulo, 200),
          round(v_total / (1 + v_al / 100), 2), v_al, v_total - round(v_total / (1 + v_al / 100), 2), v_total, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.encolar_factura_inscripcion(uuid) from public, anon, authenticated;

create or replace function public.facturar_inscripcion(p_inscripcion uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role(array['tesoreria', 'atencion']) then
    raise exception 'No tenés permisos para facturar.';
  end if;
  v := encolar_factura_inscripcion(p_inscripcion);
  if v is null then raise exception 'La inscripción tiene que estar cobrada (las cargadas en la cuenta del socio se facturan con la cuota).'; end if;
  return v;
end $$;
revoke execute on function public.facturar_inscripcion(uuid) from public, anon;

create or replace function public.tg_facturar_inscripcion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado_pago = 'pagada' and old.estado_pago is distinct from 'pagada' and new.cuota_id is null
     and coalesce((select facturacion_auto from configuracion where id = 1), false)
     and coalesce((select facturar from eventos where id = new.evento_id), true) then
    perform encolar_factura_inscripcion(new.id);
  end if;
  return new;
end $$;
revoke execute on function public.tg_facturar_inscripcion() from public, anon, authenticated;
drop trigger if exists inscripciones_facturar on public.inscripciones;
create trigger inscripciones_facturar after update of estado_pago on public.inscripciones
  for each row execute function public.tg_facturar_inscripcion();


-- -----------------------------------------------------------------------------
-- 7. RESUMEN DE CADA CAPACITACIÓN (inscriptos, recaudado y honorarios)
-- -----------------------------------------------------------------------------

create or replace view public.capacitaciones_resumen with (security_invoker = true) as
select
  e.id,
  d.nombre as docente_nombre,
  coalesce(x.inscriptos, 0) as inscriptos,
  coalesce(x.pagos, 0) as inscriptos_pagos,
  coalesce(x.recaudado, 0) as recaudado,
  coalesce(x.a_cobrar, 0) as a_cobrar,
  coalesce(p.pagado, 0) as pagado_docente,
  round(case e.honorario_tipo
    when 'por_clase' then e.honorario_monto * coalesce(e.cantidad_clases, 1)
    when 'por_hora' then e.honorario_monto * coalesce(e.cantidad_clases, 1)
                       * coalesce(extract(epoch from (e.hora_fin - e.hora_inicio)) / 3600, 1)
    when 'total' then e.honorario_monto
    when 'por_alumno' then e.honorario_monto * coalesce(x.pagos, 0)
    when 'porcentaje' then coalesce(x.recaudado, 0) * e.honorario_monto / 100
  end, 2) as honorario_previsto
from public.eventos e
left join public.docentes d on d.id = e.docente_id
left join lateral (
  select count(*) as inscriptos,
         count(*) filter (where i.estado_pago = 'pagada') as pagos,
         sum(coalesce(i.monto_pagado, i.monto)) filter (where i.estado_pago = 'pagada') as recaudado,
         sum(i.monto) filter (where i.estado_pago in ('pendiente', 'en_cuenta')) as a_cobrar
  from public.inscripciones i where i.evento_id = e.id
) x on true
left join lateral (select sum(dp.monto) as pagado from public.docente_pagos dp where dp.evento_id = e.id) p on true
where e.tipo = 'capacitacion';


-- -----------------------------------------------------------------------------
-- 8. FORMULARIO PÚBLICO: datos de facturación
-- -----------------------------------------------------------------------------

create or replace function public.evento_publico(p_slug text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'titulo', e.titulo, 'descripcion', e.descripcion, 'tipo', e.tipo,
    'fecha_inicio', e.fecha_inicio, 'fecha_fin', e.fecha_fin, 'lugar', e.lugar, 'modalidad', e.modalidad,
    'costo', e.costo, 'precio_no_socio', coalesce(e.precio_no_socio, e.costo), 'cupo', e.cupo, 'imagen_url', e.imagen_url,
    'preguntas', e.preguntas, 'dias_semana', e.dias_semana, 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin,
    'cantidad_clases', e.cantidad_clases, 'docente', (select nombre from docentes where id = e.docente_id),
    -- Con costo se piden los datos para la factura
    'pide_facturacion', coalesce(e.precio_no_socio, e.costo, 0) > 0 or e.costo > 0,
    'cupo_disponible', case when e.cupo is null then null
                            else greatest(e.cupo - (select count(*) from inscripciones i where i.evento_id = e.id), 0) end,
    'abierta', e.inscripcion_abierta and not e.cancelado and e.fecha_inicio > now()
               and (e.cupo is null or (select count(*) from inscripciones i where i.evento_id = e.id) < e.cupo)
  )
  from eventos e
  where e.slug = p_slug and e.formulario_publico
$$;

drop function if exists public.inscribir_publico(text, text, text, text, text, text, jsonb);
create or replace function public.inscribir_publico(
  p_slug text,
  p_nombre text,
  p_email text,
  p_telefono text default null,
  p_empresa text default null,
  p_cuit text default null,
  p_respuestas jsonb default '{}',
  p_razon_social text default null,
  p_condicion_iva text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  e eventos;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_socio uuid;
  v_preg jsonb;
  v_ins inscripciones;
begin
  select * into e from eventos where slug = p_slug and formulario_publico;
  if not found then raise exception 'El formulario no existe o ya no está disponible.'; end if;
  if not e.inscripcion_abierta or e.cancelado or e.fecha_inicio <= now() then
    raise exception 'La inscripción para esta actividad está cerrada.';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Completá tu nombre y apellido.'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Ingresá un email válido.'; end if;
  if length(coalesce(p_respuestas, '{}')::text) > 8000 then raise exception 'Las respuestas son demasiado largas.'; end if;
  if coalesce(p_cuit, '') <> '' and length(solo_digitos(p_cuit)) <> 11 then
    raise exception 'El CUIT/CUIL tiene que tener 11 números.';
  end if;
  if coalesce(e.precio_no_socio, e.costo, 0) > 0 and length(solo_digitos(p_cuit)) <> 11 then
    raise exception 'Ingresá el CUIT o CUIL para la factura.';
  end if;
  if p_condicion_iva is not null and p_condicion_iva not in ('RI', 'Monotributo', 'Exento', 'Consumidor final') then
    raise exception 'Condición frente al IVA inválida.';
  end if;

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
                             empresa, cuit, razon_social, condicion_iva, es_socio, respuestas, origen)
  values (e.id, v_socio, left(trim(p_nombre), 120), v_email, left(nullif(trim(p_telefono), ''), 40),
          left(nullif(trim(p_empresa), ''), 150), left(nullif(trim(p_cuit), ''), 20), left(nullif(trim(p_razon_social), ''), 150),
          p_condicion_iva, v_socio is not null, coalesce(p_respuestas, '{}'::jsonb), 'publico')
  returning * into v_ins;

  return json_build_object('ok', true, 'titulo', e.titulo, 'fecha_inicio', e.fecha_inicio,
                           'es_socio', v_socio is not null, 'monto', v_ins.monto);
end $$;

grant execute on function public.evento_publico(text) to anon, authenticated;
grant execute on function public.inscribir_publico(text, text, text, text, text, text, jsonb, text, text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. PERMISOS
-- -----------------------------------------------------------------------------

alter table public.docentes enable row level security;
alter table public.docente_pagos enable row level security;

drop policy if exists docentes_select on public.docentes;
create policy docentes_select on public.docentes for select to authenticated using (is_staff());
drop policy if exists docentes_write on public.docentes;
create policy docentes_write on public.docentes for all to authenticated
  using (has_role(array['atencion', 'tesoreria'])) with check (has_role(array['atencion', 'tesoreria']));

-- Los pagos a docentes los ve y registra Tesorería (el registro se hace con registrar_pago_docente)
drop policy if exists docente_pagos_select on public.docente_pagos;
create policy docente_pagos_select on public.docente_pagos for select to authenticated using (has_role(array['tesoreria']));
drop policy if exists docente_pagos_write on public.docente_pagos;
create policy docente_pagos_write on public.docente_pagos for update to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));


-- Verificación: todo debería decir "ok"
select 'docentes' as control, case when to_regclass('public.docentes') is not null then 'ok' else 'FALTA' end as estado
union all select 'pagos a docentes', case when to_regclass('public.docente_pagos') is not null then 'ok' else 'FALTA' end
union all select 'resumen de capacitaciones', case when to_regclass('public.capacitaciones_resumen') is not null then 'ok' else 'FALTA' end
union all select 'facturación de inscripciones', case when exists (select 1 from pg_proc where proname = 'facturar_inscripcion') then 'ok' else 'FALTA' end;
