-- =============================================================================
-- CeCIP · Actualización 010: ALQUILER TEMPORAL DE SALONES
-- Además de los contratos mensuales, los inmuebles (sobre todo los salones) se pueden
-- reservar por día u horas. Cada reserva es un "contrato temporal" con su cobro
-- (seña + saldo, o pago único): usa el mismo cobro, recibo, factura ARCA y conciliación
-- bancaria que los alquileres mensuales. El sistema no deja superponer reservas.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 005. Se puede volver a ejecutar.
-- =============================================================================

-- Tipo de inmueble y tarifas de referencia para salones
alter table public.inmuebles
  add column if not exists tipo text not null default 'local' check (tipo in ('local', 'oficina', 'salon', 'otro')),
  add column if not exists capacidad int check (capacidad is null or capacidad > 0),
  add column if not exists tarifa_hora numeric(12,2),
  add column if not exists tarifa_dia numeric(12,2),
  add column if not exists tarifa_socio_descuento numeric(5,2) not null default 0 check (tarifa_socio_descuento between 0 and 100);

-- Modalidad del alquiler: mensual (contrato) o temporal (reserva por día / horas)
alter table public.alquiler_contratos
  add column if not exists modalidad text not null default 'mensual' check (modalidad in ('mensual', 'temporal')),
  add column if not exists hora_inicio time,
  add column if not exists hora_fin time,
  add column if not exists motivo text,          -- ej.: cumpleaños, capacitación de una empresa, reunión
  add column if not exists personas int check (personas is null or personas > 0);

alter table public.alquiler_contratos drop constraint if exists alquiler_contratos_estado_check;
alter table public.alquiler_contratos add constraint alquiler_contratos_estado_check check (estado in ('vigente', 'finalizado', 'cancelado'));

-- Un solo contrato MENSUAL vigente por inmueble (las reservas temporales pueden ser muchas)
drop index if exists public.alquiler_contrato_vigente;
create unique index if not exists alquiler_contrato_vigente on public.alquiler_contratos(inmueble_id)
  where estado = 'vigente' and modalidad = 'mensual';

-- Los alquileres del mes se generan solo para los contratos mensuales
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
  where k.estado = 'vigente' and k.modalidad = 'mensual'
    and k.fecha_inicio < (v_periodo + interval '1 month')::date
    and (k.fecha_fin is null or k.fecha_fin >= v_periodo)
    and not exists (
      select 1 from alquiler_cargos c
      where c.contrato_id = k.id and c.periodo = v_periodo and c.tipo = 'alquiler' and c.estado <> 'anulada'
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- No se pueden superponer reservas en el mismo inmueble (ni reservar uno alquilado por mes)
create or replace function public.tg_reserva_disponible() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_choque record;
begin
  if new.modalidad <> 'temporal' or new.estado <> 'vigente' then return new; end if;
  if new.fecha_fin is null then new.fecha_fin := new.fecha_inicio; end if;
  if new.fecha_fin < new.fecha_inicio then raise exception 'La fecha de fin no puede ser anterior a la de inicio.'; end if;
  if new.hora_inicio is not null and new.hora_fin is not null and new.fecha_fin = new.fecha_inicio and new.hora_fin <= new.hora_inicio then
    raise exception 'La hora de fin tiene que ser posterior a la de inicio.';
  end if;

  if exists (select 1 from alquiler_contratos k where k.inmueble_id = new.inmueble_id and k.modalidad = 'mensual' and k.estado = 'vigente'
               and k.fecha_inicio <= new.fecha_fin and (k.fecha_fin is null or k.fecha_fin >= new.fecha_inicio)) then
    raise exception 'Ese inmueble tiene un contrato mensual vigente en esas fechas.';
  end if;

  select k.inquilino_nombre, k.fecha_inicio, k.hora_inicio, k.hora_fin into v_choque
  from alquiler_contratos k
  where k.inmueble_id = new.inmueble_id and k.modalidad = 'temporal' and k.estado = 'vigente' and k.id <> new.id
    and k.fecha_inicio <= new.fecha_fin and coalesce(k.fecha_fin, k.fecha_inicio) >= new.fecha_inicio
    -- Si las dos son de un solo día y tienen horario, se superponen solo si se cruzan los horarios
    and not (k.fecha_inicio = coalesce(k.fecha_fin, k.fecha_inicio) and new.fecha_inicio = new.fecha_fin
             and k.hora_inicio is not null and k.hora_fin is not null and new.hora_inicio is not null and new.hora_fin is not null
             and (k.hora_fin <= new.hora_inicio or new.hora_fin <= k.hora_inicio))
  limit 1;
  if found then
    raise exception 'Ya hay una reserva en ese horario: % (% %).', v_choque.inquilino_nombre, to_char(v_choque.fecha_inicio, 'DD/MM/YYYY'),
      coalesce(to_char(v_choque.hora_inicio, 'HH24:MI') || '-' || to_char(v_choque.hora_fin, 'HH24:MI'), 'todo el día');
  end if;
  return new;
end $$;
revoke execute on function public.tg_reserva_disponible() from public, anon, authenticated;
drop trigger if exists alquiler_reserva_disponible on public.alquiler_contratos;
create trigger alquiler_reserva_disponible before insert or update on public.alquiler_contratos
  for each row execute function public.tg_reserva_disponible();

-- Crea la reserva y sus cobros (seña opcional + saldo, o pago único)
create or replace function public.crear_reserva(
  p_inmueble uuid,
  p_cliente text,
  p_desde date,
  p_hasta date default null,
  p_hora_inicio time default null,
  p_hora_fin time default null,
  p_monto numeric default 0,
  p_sena numeric default 0,
  p_motivo text default null,
  p_personas int default null,
  p_socio uuid default null,
  p_cuit text default null,
  p_condicion_iva text default null,
  p_email text default null,
  p_telefono text default null,
  p_facturar boolean default true,
  p_observaciones text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_inm text;
  v_hasta date := coalesce(p_hasta, p_desde);
  v_cuando text;
  v_sena numeric := coalesce(p_sena, 0);
begin
  if not has_role(array['tesoreria', 'atencion']) then
    raise exception 'No tenés permisos para reservar.';
  end if;
  if length(trim(coalesce(p_cliente, ''))) < 2 then raise exception 'Indicá a quién se le alquila.'; end if;
  if coalesce(p_monto, 0) <= 0 then raise exception 'Indicá el precio del alquiler.'; end if;
  if v_sena < 0 or v_sena >= p_monto then raise exception 'La seña tiene que ser menor que el precio total.'; end if;
  select nombre into v_inm from inmuebles where id = p_inmueble;
  if v_inm is null then raise exception 'Inmueble inexistente.'; end if;

  insert into alquiler_contratos (inmueble_id, modalidad, inquilino_nombre, inquilino_cuit, inquilino_condicion_iva, inquilino_email,
                                  inquilino_telefono, socio_id, fecha_inicio, fecha_fin, hora_inicio, hora_fin, monto_mensual,
                                  dia_vencimiento, ajuste_indice, facturar, motivo, personas, observaciones)
  values (p_inmueble, 'temporal', trim(p_cliente), nullif(trim(p_cuit), ''), p_condicion_iva, nullif(trim(p_email), ''),
          nullif(trim(p_telefono), ''), p_socio, p_desde, v_hasta, p_hora_inicio, p_hora_fin, p_monto,
          least(28, extract(day from p_desde)::int), 'ninguno', coalesce(p_facturar, true), nullif(trim(p_motivo), ''), p_personas,
          nullif(trim(p_observaciones), ''))
  returning id into v_id;

  v_cuando := to_char(p_desde, 'DD/MM/YYYY') || case when v_hasta > p_desde then ' al ' || to_char(v_hasta, 'DD/MM/YYYY') else '' end
    || coalesce(' ' || to_char(p_hora_inicio, 'HH24:MI') || '-' || to_char(p_hora_fin, 'HH24:MI') || ' hs', '');

  if v_sena > 0 then
    insert into alquiler_cargos (contrato_id, tipo, concepto, monto, vencimiento, created_by)
    values (v_id, 'alquiler', 'Seña alquiler ' || v_inm || ' ' || v_cuando, v_sena, least(current_date, p_desde), auth.uid()),
           (v_id, 'alquiler', 'Saldo alquiler ' || v_inm || ' ' || v_cuando, p_monto - v_sena, p_desde, auth.uid());
  else
    insert into alquiler_cargos (contrato_id, tipo, concepto, monto, vencimiento, created_by)
    values (v_id, 'alquiler', 'Alquiler ' || v_inm || ' ' || v_cuando, p_monto, p_desde, auth.uid());
  end if;
  return v_id;
end $$;

-- Cancela la reserva: anula lo que falta cobrar (lo cobrado queda registrado para devolverlo o retenerlo)
create or replace function public.cancelar_reserva(p_contrato uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k alquiler_contratos;
begin
  if not has_role(array['tesoreria', 'atencion']) then
    raise exception 'No tenés permisos.';
  end if;
  select * into k from alquiler_contratos where id = p_contrato for update;
  if not found or k.modalidad <> 'temporal' then raise exception 'Reserva inexistente.'; end if;
  update alquiler_cargos set estado = 'anulada' where contrato_id = k.id and estado = 'pendiente';
  update alquiler_contratos set estado = 'cancelado',
    observaciones = concat_ws(E'\n', nullif(observaciones, ''), 'Cancelada el ' || to_char(current_date, 'DD/MM/YYYY') || coalesce(': ' || nullif(trim(p_motivo), ''), ''))
  where id = k.id;
end $$;

revoke execute on function public.crear_reserva(uuid, text, date, date, time, time, numeric, numeric, text, int, uuid, text, text, text, text, boolean, text) from public, anon;
revoke execute on function public.cancelar_reserva(uuid, text) from public, anon;

-- Atención al socio también puede ver y cargar reservas (cobrarlas sigue siendo de Tesorería)
drop policy if exists contr_write on public.alquiler_contratos;
create policy contr_write on public.alquiler_contratos for all to authenticated
  using (has_role(array['tesoreria']) or (modalidad = 'temporal' and has_role(array['atencion'])))
  with check (has_role(array['tesoreria']) or (modalidad = 'temporal' and has_role(array['atencion'])));
drop policy if exists inm_write on public.inmuebles;
create policy inm_write on public.inmuebles for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));

-- Vista de reservas con el estado de cobro
create or replace view public.reservas_detalle with (security_invoker = true) as
select k.*, i.nombre as inmueble_nombre, i.tipo as inmueble_tipo,
       coalesce(c.total, 0) as total_cargos,
       coalesce(c.cobrado, 0) as cobrado,
       coalesce(c.pendiente, 0) as pendiente
from public.alquiler_contratos k
join public.inmuebles i on i.id = k.inmueble_id
left join lateral (
  select sum(x.monto) filter (where x.estado <> 'anulada') as total,
         sum(coalesce(x.monto_pagado, x.monto)) filter (where x.estado = 'pagada') as cobrado,
         sum(x.monto) filter (where x.estado = 'pendiente') as pendiente
  from public.alquiler_cargos x where x.contrato_id = k.id
) c on true
where k.modalidad = 'temporal';

select 'reservas de salones' as control, case when exists (select 1 from pg_proc where proname = 'crear_reserva') then 'ok' else 'FALTA' end as estado;
