-- 014: Canales de comunicación (WhatsApp por Evolution API y email entrante por IMAP).
-- Re-ejecutable.
--
-- Una "conversación" es un contacto (socio o no) con todos sus mensajes de WhatsApp y email.
-- Los mensajes entrantes los atiende la IA según quién escribe (personal, socio o no socio)
-- y el personal responde desde la Bandeja del ERP (texto, PDF, imágenes).
-- Todas las escrituras pasan por la API (service role); el navegador solo lee y, quien
-- corresponde, cambia etapa/asignación de una conversación o resuelve comprobantes.

-- -----------------------------------------------------------------------------
-- 1. Ajustes de los canales (una sola fila)
create table if not exists public.canales_ajustes (
  id int primary key default 1 check (id = 1),
  ia_activa boolean not null default true,
  -- Lo que la IA puede contar del CeCIP a quien no es socio (beneficios, cómo asociarse, etc.)
  perfil_institucional text not null default '',
  -- A quién avisar por área: { "tesoreria": [user_id…], "prensa": […], "administracion": […], "secretaria": […], "presidencia": […], "comercia": […] }
  avisos jsonb not null default '{}',
  pausa_manual_horas int not null default 12 check (pausa_manual_horas between 1 and 168),
  seguimiento_dias int not null default 3 check (seguimiento_dias between 1 and 30),
  max_seguimientos int not null default 2 check (max_seguimientos between 0 and 5),
  campanas_desde time not null default '09:00',
  campanas_hasta time not null default '19:30',
  campanas_tope_diario int not null default 150 check (campanas_tope_diario between 1 and 2000),
  updated_at timestamptz not null default now()
);
insert into public.canales_ajustes (id, perfil_institucional) values (1,
'El Centro Comercial e Industrial de Paraná (CeCIP) es la institución que nuclea y representa a comercios, industrias, empresas de servicios y profesionales de Paraná, Entre Ríos.
Beneficios de asociarse: representación institucional ante el municipio y la provincia; capacitaciones y charlas (muchas sin cargo o con descuento para socios); difusión de su comercio; convenios y beneficios; programa ComercIA Inteligente (implementación de IA, ventas y marketing digital) junto al Instituto IEC; uso de salones para eventos con tarifa preferencial; asesoramiento.
Para asociarse se completa una ficha con los datos de la empresa (razón social, CUIT, rubro, contacto) y se elige la forma de pago de la cuota (mensual, bimestral, trimestral, semestral o anual, con descuento en los pagos más largos).')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Conversaciones (una por contacto) y pipeline de contactos
create table if not exists public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text,
  telefono text,
  email text,
  socio_id uuid references public.socios(id) on delete set null,
  etapa text not null default 'Nuevo' check (etapa in ('Nuevo', 'Consultando', 'Interesado', 'Alta en trámite', 'Socio', 'Derivado', 'Perdido')),
  interes text check (interes in ('Asociarse', 'Alquiler de salón', 'Capacitación', 'Evento', 'ComercIA', 'Pagos y cuotas', 'Reclamo', 'Otro')),
  area text check (area in ('tesoreria', 'prensa', 'administracion', 'secretaria', 'presidencia', 'comercia')),
  resumen text,
  empresa text,
  asignado_a uuid references auth.users(id) on delete set null,
  ia_pausada_hasta timestamptz,
  no_leidos int not null default 0,
  ultimo_mensaje text,
  ultimo_canal text check (ultimo_canal in ('whatsapp', 'email')),
  ultimo_mensaje_at timestamptz not null default now(),
  ultimo_entrante_at timestamptz,
  acepta_novedades boolean not null default false,
  baja_at timestamptz,
  seguimiento_at timestamptz,
  seguimientos_enviados int not null default 0,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  created_at timestamptz not null default now()
);
-- Conversaciones de alguien del personal con el Copiloto por WhatsApp (no se muestran como contactos)
alter table public.conversaciones add column if not exists staff_user_id uuid references public.staff(user_id) on delete set null;
create unique index if not exists conversaciones_telefono_idx on public.conversaciones(telefono) where telefono is not null;
create unique index if not exists conversaciones_email_idx on public.conversaciones(lower(email)) where email is not null and telefono is null;
create index if not exists conversaciones_orden_idx on public.conversaciones(estado, ultimo_mensaje_at desc);
create index if not exists conversaciones_socio_idx on public.conversaciones(socio_id);

create table if not exists public.mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,
  canal text not null check (canal in ('whatsapp', 'email')),
  direccion text not null check (direccion in ('entrante', 'saliente')),
  -- contacto: lo escribió el contacto · ia: respuesta automática · personal: alguien del CeCIP · sistema: aviso automático
  autor text not null check (autor in ('contacto', 'ia', 'personal', 'sistema')),
  staff_id uuid references auth.users(id) on delete set null,
  cuerpo text not null default '',
  asunto text,
  adjunto_path text,
  adjunto_nombre text,
  adjunto_mime text,
  media_tipo text check (media_tipo in ('imagen', 'documento', 'audio', 'video')),
  externo_id text,      -- id del mensaje en Evolution o Message-ID del email
  hilo_ref text,        -- email: Message-ID al que responde (para mantener el hilo)
  estado text not null default 'ok' check (estado in ('ok', 'error')),
  error text,
  analisis jsonb,       -- clasificación de la IA (emails y adjuntos)
  created_at timestamptz not null default now()
);
create unique index if not exists mensajes_externo_idx on public.mensajes(canal, externo_id) where externo_id is not null;
create index if not exists mensajes_conv_idx on public.mensajes(conversacion_id, created_at);
create index if not exists mensajes_limite_idx on public.mensajes(conversacion_id, direccion, created_at);

-- -----------------------------------------------------------------------------
-- 3. WhatsApp del personal (para consultar el Copiloto y recibir avisos)
create table if not exists public.staff_whatsapp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff(user_id) on delete cascade,
  telefono text not null unique,
  recibe_avisos boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff add column if not exists whatsapp_codigo text;
alter table public.staff add column if not exists whatsapp_codigo_vence timestamptz;
create unique index if not exists staff_whatsapp_codigo_idx on public.staff(whatsapp_codigo) where whatsapp_codigo is not null;

-- -----------------------------------------------------------------------------
-- 4. Comprobantes de pago recibidos por WhatsApp o email (para conciliar en Tesorería)
create table if not exists public.comprobantes_recibidos (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  mensaje_id uuid references public.mensajes(id) on delete set null,
  socio_id uuid references public.socios(id) on delete set null,
  canal text not null check (canal in ('whatsapp', 'email')),
  monto numeric(12, 2),
  fecha date,
  emisor text,
  referencia text,
  archivo_path text,
  archivo_nombre text,
  archivo_mime text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'conciliado', 'descartado')),
  cuota_id uuid references public.cuotas(id) on delete set null,
  notas text,
  analisis jsonb,
  resuelto_por uuid references auth.users(id) on delete set null,
  resuelto_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists comprobantes_recibidos_estado_idx on public.comprobantes_recibidos(estado, created_at desc);

-- -----------------------------------------------------------------------------
-- 5. Casilla de email (IMAP). La contraseña se guarda cifrada por la API; nadie la lee desde el navegador.
create table if not exists public.email_cuenta (
  id int primary key default 1 check (id = 1),
  host text not null,
  puerto int not null default 993,
  usuario text not null,
  password_enc text not null,
  carpeta text not null default 'INBOX',
  ultimo_uid bigint not null default 0,
  uid_validity bigint,
  conectada_por uuid references auth.users(id) on delete set null,
  conectada_at timestamptz not null default now(),
  ultima_sync_at timestamptz,
  ultimo_resultado text,
  ultimo_error text,
  lock_hasta timestamptz
);

-- -----------------------------------------------------------------------------
-- 6. Campañas de WhatsApp con envío automático (salen desde el número del CeCIP, de a poco)
alter table public.wa_campanas add column if not exists modo text not null default 'manual';
alter table public.wa_campanas drop constraint if exists wa_campanas_modo_check;
alter table public.wa_campanas add constraint wa_campanas_modo_check check (modo in ('manual', 'automatico'));
alter table public.wa_mensajes add column if not exists error text;
alter table public.wa_mensajes drop constraint if exists wa_mensajes_estado_check;
alter table public.wa_mensajes add constraint wa_mensajes_estado_check check (estado in ('pendiente', 'enviado', 'omitido', 'error'));

-- -----------------------------------------------------------------------------
-- 7. Permisos (lectura para el personal interno; escrituras puntuales según el área)
alter table public.canales_ajustes enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes enable row level security;
alter table public.staff_whatsapp enable row level security;
alter table public.comprobantes_recibidos enable row level security;
alter table public.email_cuenta enable row level security;

drop policy if exists canaj_select on public.canales_ajustes;
create policy canaj_select on public.canales_ajustes for select to authenticated using (is_staff());
drop policy if exists canaj_update on public.canales_ajustes;
create policy canaj_update on public.canales_ajustes for update to authenticated using (has_role(array[]::text[])) with check (has_role(array[]::text[]));

drop policy if exists conv_select on public.conversaciones;
create policy conv_select on public.conversaciones for select to authenticated using (is_staff());
drop policy if exists conv_update on public.conversaciones;
create policy conv_update on public.conversaciones for update to authenticated
  using (has_role(array['atencion', 'tesoreria', 'prensa'])) with check (has_role(array['atencion', 'tesoreria', 'prensa']));

drop policy if exists msj_select on public.mensajes;
create policy msj_select on public.mensajes for select to authenticated using (is_staff());

drop policy if exists stwa_select on public.staff_whatsapp;
create policy stwa_select on public.staff_whatsapp for select to authenticated using (user_id = auth.uid() or has_role(array[]::text[]));

drop policy if exists comprec_select on public.comprobantes_recibidos;
create policy comprec_select on public.comprobantes_recibidos for select to authenticated using (is_staff());
drop policy if exists comprec_update on public.comprobantes_recibidos;
create policy comprec_update on public.comprobantes_recibidos for update to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));
-- email_cuenta: sin políticas (solo la API)

-- Socio por número de WhatsApp: en el padrón los teléfonos están escritos de muchas formas
-- ("343 15 412-3456", "+54 9 343 4123456"…), así que se comparan los últimos 7 dígitos.
-- Si coincide más de un socio, no se elige ninguno (lo vincula el personal desde la Bandeja).
create or replace function public.socio_por_telefono(p_numero text) returns uuid
language sql stable security definer set search_path = public as $$
  with u as (select right(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 7) as d),
  c as (
    select s.id from socios s, u
    where length(u.d) = 7 and s.estado <> 'baja'
      and (right(regexp_replace(coalesce(s.whatsapp, ''), '\D', '', 'g'), 7) = u.d
        or right(regexp_replace(coalesce(s.telefono, ''), '\D', '', 'g'), 7) = u.d)
  )
  select case when (select count(*) from c) = 1 then (select id from c) end
$$;
revoke execute on function public.socio_por_telefono(text) from public, anon, authenticated;

-- Socio por email (principal o adicionales)
create or replace function public.socio_por_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  with c as (
    select s.id from socios s
    where s.estado <> 'baja' and p_email is not null and (
      lower(trim(s.email)) = lower(trim(p_email))
      or lower(trim(p_email)) = any (select lower(trim(x)) from regexp_split_to_table(coalesce(s.emails_extra, ''), '[\s,;]+') x where x <> ''))
  )
  select case when (select count(*) from c) = 1 then (select id from c) end
$$;
revoke execute on function public.socio_por_email(text) from public, anon, authenticated;

-- Marca una conversación como leída (quien la abre en la Bandeja)
create or replace function public.conversacion_leida(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update conversaciones set no_leidos = 0 where id = p_id and is_staff();
$$;
revoke execute on function public.conversacion_leida(uuid) from public, anon;

select 'canales' as control,
  (select count(*) from canales_ajustes) as ajustes,
  to_regclass('public.conversaciones') is not null as conversaciones,
  to_regclass('public.mensajes') is not null as mensajes;
