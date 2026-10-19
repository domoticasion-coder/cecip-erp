-- 011: Cola de emails con cupo diario.
-- Los envíos masivos (comunicados, difusión ComercIA y recordatorios de cuota) se guardan acá.
-- Cada vez que se procesa la cola (al enviar y una vez por día con el cron) salen los que entran
-- en el cupo diario del plan de Resend (EMAIL_LIMITE_DIARIO); los demás esperan al día siguiente.
-- Re-ejecutable.

create table if not exists public.email_cola (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null,
  socio_id uuid references public.socios(id) on delete set null,
  comunicado_id uuid references public.comunicados(id) on delete set null,
  tipo text not null default 'manual' check (tipo in ('comunicado', 'recordatorio', 'manual', 'comercia')),
  destinatario text not null,
  cc text[] not null default '{}',
  asunto text not null,
  texto text,
  html text not null,
  -- Recordatorios: cuotas a las que se les marca "ultimo_recordatorio" cuando el email sale
  cuota_ids uuid[] not null default '{}',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error', 'cancelado')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  procesado_at timestamptz
);

create index if not exists email_cola_pendientes_idx on public.email_cola(estado, created_at);
create index if not exists email_cola_lote_idx on public.email_cola(lote_id);

-- Cuántas copias (CC) llevó cada envío: Resend las cuenta en el cupo diario
alter table public.envios add column if not exists copias int not null default 0;

alter table public.email_cola enable row level security;

-- Solo lectura para el personal que envía emails; las escrituras las hace el servidor
drop policy if exists email_cola_select on public.email_cola;
create policy email_cola_select on public.email_cola for select to authenticated
  using (has_role(array['atencion', 'tesoreria']));

-- Resumen por lote para la pantalla de Comunicación
create or replace view public.email_cola_lotes with (security_invoker = true) as
select
  lote_id,
  min(tipo) as tipo,
  min(asunto) as asunto,
  min(created_at) as creado,
  count(*) as total,
  count(*) filter (where estado = 'enviado') as enviados,
  count(*) filter (where estado in ('pendiente', 'enviando')) as pendientes,
  count(*) filter (where estado = 'error') as errores,
  count(*) filter (where estado = 'cancelado') as cancelados,
  max(procesado_at) as ultimo_envio
from public.email_cola
group by lote_id;

grant select on public.email_cola_lotes to authenticated;
