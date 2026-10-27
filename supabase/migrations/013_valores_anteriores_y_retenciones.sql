-- 013: Valores anteriores de cuota por categoría, cuotas importadas que no se facturan solas
-- y retenciones al registrar un cobro. Re-ejecutable.
--
-- Contexto: el primer bimestre de 2026 se cobró y facturó con el valor mensual 2025, mientras que
-- los trimestres, semestres y años completos se facturaron con el valor 2026. La regla que
-- reproduce eso: cada cuota toma el valor vigente en el ÚLTIMO mes de su período.

-- -----------------------------------------------------------------------------
-- 1. Valores anteriores por categoría
--    Una fila = "este valor mensual se aplica a las cuotas cuyo período termina hasta este mes".
--    Sin fila que corresponda, se usa el valor actual de la categoría (categorias.cuota_mensual).
create table if not exists public.categoria_valores (
  categoria_id uuid not null references public.categorias(id) on delete cascade,
  hasta date not null check (extract(day from hasta) = 1),
  cuota_mensual numeric(12, 2) not null check (cuota_mensual >= 0),
  created_at timestamptz not null default now(),
  primary key (categoria_id, hasta)
);

alter table public.categoria_valores enable row level security;
drop policy if exists catval_select on public.categoria_valores;
create policy catval_select on public.categoria_valores for select to authenticated using (is_staff());
drop policy if exists catval_write on public.categoria_valores;
create policy catval_write on public.categoria_valores for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));

-- Valor mensual de una categoría para una cuota cuyo período termina en p_mes
create or replace function public.valor_categoria(p_categoria uuid, p_mes date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.cuota_mensual from categoria_valores v
      where v.categoria_id = p_categoria and v.hasta >= date_trunc('month', p_mes)::date
      order by v.hasta limit 1),
    (select c.cuota_mensual from categorias c where c.id = p_categoria))
$$;

-- Valores 2025 informados por el CeCIP: se aplican a las cuotas que terminan en enero o febrero de 2026
insert into public.categoria_valores (categoria_id, hasta, cuota_mensual)
select c.id, date '2026-02-01', v.valor
from (values ('AA', 5000), ('A', 3000), ('B', 2500), ('C', 2000), ('JE/ME', 2000)) as v(nombre, valor)
join public.categorias c on c.nombre = v.nombre
on conflict (categoria_id, hasta) do nothing;

-- Generar cuotas: valor vigente en el último mes del período
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
    select so.id, so.categoria_id, p.meses as pm, p.descuento
    from socios so
    join categorias cat on cat.id = so.categoria_id
    join periodicidades p on p.codigo = so.periodicidad
    where so.estado = 'activo'
    order by so.razon_social
  loop
    v_ini := inicio_periodo(p_periodo, s.pm);
    v_fin := (v_ini + make_interval(months => s.pm - 1))::date;
    continue when coalesce(valor_categoria(s.categoria_id, v_fin), 0) <= 0;
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
    monto := importe_cuota(valor_categoria(s.categoria_id, v_fin), meses_entre(v_desde, v_fin), s.descuento);
    concepto := 'Cuota social ' || etiqueta_periodo(v_desde, meses_entre(v_desde, v_fin));
    return next;
  end loop;
end $$;
revoke execute on function public.cuotas_a_generar(date) from public, anon;

-- Recalcular pendientes: cada cuota con el valor de su período (no toca pagadas ni con link activo)
create or replace function public.recalcular_cuotas_pendientes(p_categoria uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos.';
  end if;
  update cuotas c set monto = x.nuevo
  from (
    select c2.id, importe_cuota(valor_categoria(s.categoria_id, coalesce(c2.periodo_hasta, c2.periodo)), c2.meses, p.descuento) as nuevo
    from cuotas c2
    join socios s on s.id = c2.socio_id
    join periodicidades p on p.codigo = s.periodicidad
    where c2.tipo = 'cuota_social' and c2.estado = 'pendiente' and c2.meses is not null and c2.periodo is not null
      and s.categoria_id is not null
      and (p_categoria is null or s.categoria_id = p_categoria)
  ) x
  where c.id = x.id and x.nuevo > 0 and c.monto <> x.nuevo
    and not exists (
      select 1 from links_pago l
      where l.estado = 'activo' and l.expira_at > now()
        and l.items @> jsonb_build_array(jsonb_build_object('cuota_id', c.id::text))
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.recalcular_cuotas_pendientes(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- 2. Las cuotas importadas del Excel ya se facturaron por fuera del sistema:
--    al cobrarlas NO se genera factura automática (se puede facturar a mano si hiciera falta).
create or replace function public.tg_facturar_cobro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pagada' and old.estado is distinct from 'pagada'
     and coalesce((select facturacion_auto from configuracion where id = 1), false) then
    if tg_table_name = 'cuotas' then
      if not coalesce(new.importada, false)
         and coalesce((select facturar_auto from socios where id = new.socio_id), true) then
        perform encolar_factura(new.id, null);
      end if;
    elsif coalesce((select facturar from alquiler_contratos where id = new.contrato_id), true) then
      perform encolar_factura(null, new.id);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_facturar_cobro() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Retenciones al cobrar (el socio paga por transferencia y retiene impuestos con certificado):
--    la cuota queda saldada por el total, en caja entra lo recibido y la retención queda registrada.
alter table public.cuotas add column if not exists retencion numeric(12, 2) not null default 0;

drop function if exists public.registrar_pago(uuid, text, uuid, date, text, numeric);
create or replace function public.registrar_pago(
  p_cuota_id uuid,
  p_metodo text,
  p_cuenta_id uuid default null,
  p_fecha date default current_date,
  p_referencia text default null,
  p_monto numeric default null,      -- importe recibido (sin las retenciones)
  p_retencion numeric default 0      -- retenciones sufridas (certificados)
) returns public.cuotas
language plpgsql security definer set search_path = public as $$
declare
  c cuotas;
  cfg configuracion;
  v_ret numeric := greatest(coalesce(p_retencion, 0), 0);
  v_interes numeric;
  v_total numeric;
  v_cuenta uuid;
  v_socio text;
  v_autor text;
begin
  if not (is_service() or has_role(array['tesoreria'])) then
    raise exception 'No tenés permisos para registrar pagos.';
  end if;

  select * into c from cuotas where id = p_cuota_id for update;
  if not found then raise exception 'Cuota inexistente.'; end if;
  if c.estado = 'pagada' then return c; end if;
  if c.estado = 'anulada' then raise exception 'La cuota está anulada.'; end if;

  select * into cfg from configuracion where id = 1;

  -- v_total = lo imputado a la cuota (recibido + retenciones)
  if p_monto is not null then
    v_total := p_monto + v_ret;
    v_interes := greatest(v_total - c.monto, 0);
  else
    v_interes := interes_a_fecha(c.monto, c.vencimiento, coalesce(p_fecha, current_date));
    v_total := c.monto + v_interes;
  end if;
  if v_ret > v_total then raise exception 'La retención no puede superar el total de la cuota.'; end if;

  v_cuenta := coalesce(p_cuenta_id,
    case when p_metodo = 'Mercado Pago' then cfg.cuenta_mp_id else cfg.cuenta_default_id end);

  update cuotas set
    estado = 'pagada',
    fecha_pago = coalesce(p_fecha, current_date),
    metodo_pago = p_metodo,
    monto_pagado = v_total,
    interes_cobrado = v_interes,
    retencion = v_ret,
    referencia_pago = p_referencia,
    cuenta_id = v_cuenta,
    recibo_numero = nextval('recibo_seq')
  where id = c.id
  returning * into c;

  select coalesce(nombre_comercial, razon_social) into v_socio from socios where id = c.socio_id;
  select nombre into v_autor from staff where user_id = auth.uid();

  -- En la cuenta entra lo efectivamente recibido
  insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, cuota_id, comprobante, created_by)
  values (c.fecha_pago, 'ingreso', 'Cuotas sociales', v_cuenta,
          c.concepto || ' - ' || v_socio || case when v_ret > 0 then format(' (retenciones $%s)', v_ret) else '' end,
          v_total - v_ret, c.id, 'Recibo N° ' || c.recibo_numero, auth.uid());

  insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_by)
  values (c.socio_id, 'pago',
          format('Pago de "%s" por $%s (%s)%s. Recibo N° %s.', c.concepto, v_total, p_metodo,
                 case when v_ret > 0 then format(', con retenciones por $%s', v_ret) else '' end, c.recibo_numero),
          coalesce(v_autor, 'Sistema'), auth.uid());

  return c;
end $$;
revoke execute on function public.registrar_pago(uuid, text, uuid, date, text, numeric, numeric) from public, anon;
grant execute on function public.registrar_pago(uuid, text, uuid, date, text, numeric, numeric) to authenticated, service_role;

-- Anular un pago también borra la retención registrada
create or replace function public.anular_pago(p_cuota_id uuid)
returns public.cuotas language plpgsql security definer set search_path = public as $$
declare c cuotas; v_autor text;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para anular pagos.';
  end if;

  select * into c from cuotas where id = p_cuota_id for update;
  if not found or c.estado <> 'pagada' then raise exception 'La cuota no está pagada.'; end if;

  delete from movimientos where cuota_id = c.id;

  select nombre into v_autor from staff where user_id = auth.uid();
  insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_by)
  values (c.socio_id, 'pago',
          format('Se anuló el pago de "%s" (recibo N° %s).', c.concepto, c.recibo_numero),
          v_autor, auth.uid());

  update cuotas set estado = 'pendiente', fecha_pago = null, metodo_pago = null, monto_pagado = null,
    interes_cobrado = null, retencion = 0, referencia_pago = null, cuenta_id = null, recibo_numero = null
  where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.anular_pago(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- 4. Corrección de las cuotas existentes con los valores anteriores
--    - Pendientes: pasan al valor de su período (salvo las que tengan un link de pago vigente).
--    - Pagadas importadas del Excel ("Registro anterior"): se corrige el importe que figura cobrado.
--    Las cobradas desde el ERP no se tocan.
with x as (
  select c.id, c.estado,
         importe_cuota(valor_categoria(s.categoria_id, coalesce(c.periodo_hasta, c.periodo)), c.meses, p.descuento) as nuevo
  from cuotas c
  join socios s on s.id = c.socio_id
  join periodicidades p on p.codigo = s.periodicidad
  where c.tipo = 'cuota_social' and c.meses is not null and c.periodo is not null and s.categoria_id is not null
    and exists (select 1 from categoria_valores v where v.categoria_id = s.categoria_id and v.hasta >= coalesce(c.periodo_hasta, c.periodo))
    and (c.estado = 'pendiente' or (c.estado = 'pagada' and c.importada and c.metodo_pago = 'Registro anterior (Excel)'))
    and not exists (
      select 1 from links_pago l
      where l.estado = 'activo' and l.expira_at > now()
        and l.items @> jsonb_build_array(jsonb_build_object('cuota_id', c.id::text)))
)
update cuotas c set
  monto = x.nuevo,
  monto_pagado = case when x.estado = 'pagada' then x.nuevo else c.monto_pagado end
from x
where c.id = x.id and x.nuevo > 0 and c.monto <> x.nuevo;

-- Links de pago que nunca llegaron a tener URL de Mercado Pago (MP sin configurar): se dan por vencidos
update links_pago set estado = 'expirado' where estado = 'activo' and url is null and expira_at <= now();

select 'valores anteriores' as control,
  (select count(*) from categoria_valores) as valores_cargados,
  (select count(*) from cuotas c join socios s on s.id = c.socio_id
     where c.tipo = 'cuota_social' and coalesce(c.periodo_hasta, c.periodo) <= date '2026-02-01' and c.periodo >= date '2026-01-01') as cuotas_ene_feb;
