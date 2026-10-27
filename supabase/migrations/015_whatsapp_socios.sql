-- 015: Hasta tres WhatsApp por socio (hay comercios que escriben desde varios números).
-- Cuando llega un WhatsApp, el sistema reconoce al socio por cualquiera de sus números
-- (WhatsApp 1, 2, 3 o teléfono) y la IA le responde con los datos de ese socio.
-- Re-ejecutable.

alter table public.socios add column if not exists whatsapp_2 text;
alter table public.socios add column if not exists whatsapp_3 text;

-- La vista se recrea para que incluya las columnas nuevas (s.* queda fijo al crearla)
drop view if exists public.socios_resumen;
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
grant select on public.socios_resumen to authenticated, service_role;

-- Socio por número de WhatsApp: se comparan los últimos 7 dígitos con sus tres WhatsApp y el
-- teléfono (en el padrón están escritos de muchas formas). Si coincide más de un socio, no se
-- elige ninguno (lo vincula el personal desde la Bandeja).
create or replace function public.socio_por_telefono(p_numero text) returns uuid
language sql stable security definer set search_path = public as $$
  with u as (select right(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 7) as d),
  c as (
    select s.id from socios s, u
    where length(u.d) = 7 and s.estado <> 'baja'
      and u.d in (
        right(regexp_replace(coalesce(s.whatsapp, ''), '\D', '', 'g'), 7),
        right(regexp_replace(coalesce(s.whatsapp_2, ''), '\D', '', 'g'), 7),
        right(regexp_replace(coalesce(s.whatsapp_3, ''), '\D', '', 'g'), 7),
        right(regexp_replace(coalesce(s.telefono, ''), '\D', '', 'g'), 7))
  )
  select case when (select count(*) from c) = 1 then (select id from c) end
$$;
revoke execute on function public.socio_por_telefono(text) from public, anon, authenticated;

-- Las conversaciones que ya existen se vinculan solas con el próximo mensaje; estas se vinculan ya
update public.conversaciones c set socio_id = public.socio_por_telefono(c.telefono), etapa = 'Socio'
where c.socio_id is null and c.staff_user_id is null and c.telefono is not null
  and public.socio_por_telefono(c.telefono) is not null;

select 'whatsapp socios' as control,
  (select count(*) from socios where whatsapp_2 is not null or whatsapp_3 is not null) as socios_con_varios_numeros;
