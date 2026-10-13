-- =============================================================================
-- CeCIP Paraná · ERP administrativo + Portal de socios
-- Ejecutar completo en Supabase > SQL Editor (una sola vez, en un proyecto nuevo)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CONFIGURACIÓN
-- -----------------------------------------------------------------------------

create table public.cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo text not null default 'banco' check (tipo in ('banco', 'caja', 'billetera')),
  activa boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  cuota_mensual numeric(12,2) not null default 0 check (cuota_mensual >= 0),
  descripcion text,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.configuracion (
  id int primary key default 1 check (id = 1),
  nombre_institucion text not null default 'Centro Comercial e Industrial de Paraná',
  cuit text,
  direccion text,
  telefono text,
  email text,
  -- Datos para pago por transferencia (se muestran a los socios)
  banco text,
  titular text,
  cbu text,
  alias text,
  -- Cobranza
  interes_mensual numeric(6,2) not null default 0 check (interes_mensual >= 0), -- % mensual, proporcional por día
  dia_vencimiento int not null default 10 check (dia_vencimiento between 1 and 28),
  recordatorios_auto boolean not null default false,
  dias_aviso int not null default 3 check (dias_aviso between 0 and 30),
  cuenta_mp_id uuid references public.cuentas(id) on delete set null,
  cuenta_default_id uuid references public.cuentas(id) on delete set null,
  -- ComercIA: WhatsApp de FactorIA que recibe los pedidos y link del formulario de adhesión
  factoria_whatsapp text,
  comercia_url_adhesion text default 'https://iec-ia.com.ar/formulariofactoria.html',
  -- Difusión por WhatsApp: tope de mensajes por día y espera al azar entre envíos (segundos)
  wa_limite_diario int not null default 40 check (wa_limite_diario between 1 and 500),
  wa_espera_min int not null default 60 check (wa_espera_min >= 0),
  wa_espera_max int not null default 180 check (wa_espera_max >= 0),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. PERSONAL (usuarios del ERP)
-- -----------------------------------------------------------------------------

create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text not null,
  -- comercia: equipo de ComercIA / IEC / FactorIA (externo): solo administra ComercIA, no ve datos internos
  rol text not null check (rol in ('admin', 'tesoreria', 'atencion', 'comercia')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. SOCIOS
-- -----------------------------------------------------------------------------

create table public.socios (
  id uuid primary key default gen_random_uuid(),
  numero_socio int unique,
  razon_social text not null,
  nombre_comercial text,
  cuit text unique,
  rubro text,
  categoria_id uuid references public.categorias(id) on delete set null,
  estado text not null default 'activo' check (estado in ('activo', 'suspendido', 'baja')),
  contacto_nombre text,
  email text,
  whatsapp text,
  telefono text,
  direccion text,
  localidad text default 'Paraná',
  fecha_alta date not null default current_date,
  observaciones text,
  whatsapp_baja boolean not null default false, -- pidió no recibir difusiones por WhatsApp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index socios_estado_idx on public.socios(estado);

create table public.socio_notas (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('nota', 'llamada', 'reunion', 'email', 'whatsapp', 'pago', 'sistema')),
  texto text not null,
  autor_nombre text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index socio_notas_socio_idx on public.socio_notas(socio_id, created_at desc);

-- Usuarios del portal de socios (se registran solos y el personal los aprueba)
create table public.socio_usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  socio_id uuid references public.socios(id) on delete set null,
  nombre text,
  email text not null,
  telefono text,
  cuit_declarado text,
  razon_social_declarada text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo_rechazo text,
  aprobado_por uuid references auth.users(id) on delete set null,
  aprobado_at timestamptz,
  created_at timestamptz not null default now()
);
create index socio_usuarios_socio_idx on public.socio_usuarios(socio_id);

-- -----------------------------------------------------------------------------
-- 4. CUOTAS, PAGOS Y TESORERÍA
-- -----------------------------------------------------------------------------

create sequence public.recibo_seq start 1;

create table public.cuotas (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete restrict,
  tipo text not null default 'cuota_social' check (tipo in ('cuota_social', 'otro')),
  periodo date, -- primer día del mes facturado (solo cuota social)
  concepto text not null,
  monto numeric(12,2) not null check (monto > 0),
  vencimiento date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  fecha_pago date,
  metodo_pago text,
  monto_pagado numeric(12,2),
  interes_cobrado numeric(12,2),
  referencia_pago text,
  recibo_numero bigint unique,
  cuenta_id uuid references public.cuentas(id) on delete set null,
  ultimo_recordatorio timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index cuotas_socio_idx on public.cuotas(socio_id);
create index cuotas_estado_venc_idx on public.cuotas(estado, vencimiento);
create unique index cuotas_social_unica on public.cuotas(socio_id, periodo)
  where tipo = 'cuota_social' and estado <> 'anulada';

create table public.movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  categoria text not null,
  cuenta_id uuid references public.cuentas(id) on delete set null,
  detalle text not null,
  monto numeric(12,2) not null check (monto > 0),
  comprobante text,
  cuota_id uuid references public.cuotas(id) on delete set null,
  conciliado boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index movimientos_fecha_idx on public.movimientos(fecha desc);

-- Links de pago de Mercado Pago (pueden cubrir una o varias cuotas)
create table public.links_pago (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete cascade,
  items jsonb not null, -- [{ "cuota_id": "...", "monto": 1234.00, "concepto": "..." }]
  total numeric(12,2) not null,
  mp_preference_id text,
  url text,
  estado text not null default 'activo' check (estado in ('activo', 'pagado', 'expirado')),
  expira_at timestamptz not null,
  mp_payment_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index links_pago_socio_idx on public.links_pago(socio_id, estado);

-- -----------------------------------------------------------------------------
-- 5. COMUNICACIÓN
-- -----------------------------------------------------------------------------

create table public.comunicados (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  cuerpo text not null,
  publicado boolean not null default false,
  destacado boolean not null default false,
  fecha_publicacion timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.envios (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references public.socios(id) on delete set null,
  comunicado_id uuid references public.comunicados(id) on delete set null,
  canal text not null check (canal in ('email', 'whatsapp')),
  tipo text not null default 'manual' check (tipo in ('comunicado', 'recordatorio', 'manual', 'acceso', 'comercia')),
  asunto text,
  destinatario text,
  estado text not null default 'enviado' check (estado in ('enviado', 'error')),
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index envios_created_idx on public.envios(created_at desc);

-- -----------------------------------------------------------------------------
-- 6. EVENTOS Y CAPACITACIONES
-- -----------------------------------------------------------------------------

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  tipo text not null default 'evento' check (tipo in ('evento', 'capacitacion')),
  fecha_inicio timestamptz not null,
  fecha_fin timestamptz,
  lugar text,
  modalidad text not null default 'presencial' check (modalidad in ('presencial', 'virtual', 'mixta')),
  link text,
  cupo int check (cupo is null or cupo > 0),
  costo numeric(12,2) not null default 0,
  publicado boolean not null default false,
  inscripcion_abierta boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inscripciones (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  socio_id uuid references public.socios(id) on delete cascade,
  asistente_nombre text not null,
  asistente_email text,
  asistente_telefono text,
  asistio boolean not null default false,
  created_at timestamptz not null default now(),
  unique (evento_id, socio_id, asistente_email)
);

-- -----------------------------------------------------------------------------
-- 7. COMERCIA (solicitudes de servicios digitales)
-- -----------------------------------------------------------------------------

create table public.comercia_solicitudes (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null references public.socios(id) on delete cascade,
  socio_nombre text, -- se completa solo: así el equipo de ComercIA ve quién consultó sin acceder al padrón
  servicio text not null,
  detalle text,
  presupuesto_estimado numeric(12,2),
  contacto_nombre text,
  contacto_email text,
  contacto_telefono text,
  estado text not null default 'nueva' check (estado in ('nueva', 'en_curso', 'cerrada', 'descartada')),
  notas_internas text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7b. CONTENIDO EDITABLE DESDE EL ERP (ComercIA, IEC y conocimiento del Copiloto)
-- -----------------------------------------------------------------------------

create table public.comercia_ofertas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  etiqueta text,
  problema text,
  solucion text not null,
  incluye text[] not null default '{}',
  icono text not null default 'Store',
  destacada boolean not null default false,
  activa boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.iec_servicios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  subtitulo text,
  descripcion text,
  icono text not null default 'Wrench',
  subtipos text[] not null default '{}',
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.iec_cursos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  subtitulo text,
  duracion text,
  frecuencia text,
  modalidad text,
  lugar text,
  requisitos text,
  salida_laboral text,
  temario text[] not null default '{}',
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- Promociones del convenio ComercIA para los comercios socios
create table public.comercia_promociones (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descuento text,            -- lo que se muestra en grande, ej.: "25% OFF", "SIN COSTO", "2x1"
  descripcion text,
  condiciones text,
  vigente_hasta date,        -- vacío = sin vencimiento; vencida no se muestra
  destacada boolean not null default false,
  activa boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- Qué implica el convenio: participantes, ejes del programa, beneficios, pasos y preguntas frecuentes
create table public.comercia_convenio (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('parte', 'eje', 'beneficio', 'paso', 'pregunta')),
  titulo text not null,
  texto text,
  icono text not null default 'Sparkles',
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- Novedades de ComercIA que se publican en el portal (las redacta el equipo de ComercIA)
create table public.comercia_novedades (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  cuerpo text not null,
  publicada boolean not null default true,
  orden int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Información institucional que usa el Copiloto, organizada por secciones
create table public.conocimiento_cecip (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  contenido text not null,
  activo boolean not null default true,
  orden int not null default 0,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7c. CAMPAÑAS DE WHATSAPP (mensaje personalizado por socio, envío espaciado)
-- -----------------------------------------------------------------------------

create table public.wa_campanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  mensaje_base text not null,
  variantes text[] not null default '{}',
  estado text not null default 'activa' check (estado in ('activa', 'pausada', 'finalizada')),
  total int not null default 0,
  -- cecip: campañas del personal del CeCIP · comercia: campañas del equipo de ComercIA (salen de otro número)
  origen text not null default 'cecip' check (origen in ('cecip', 'comercia')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.wa_mensajes (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.wa_campanas(id) on delete cascade,
  socio_id uuid references public.socios(id) on delete set null,
  nombre text not null,
  telefono text not null,
  mensaje text not null,
  usa_link_pago boolean not null default false,
  orden int not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'omitido')),
  enviado_at timestamptz,
  enviado_por uuid references auth.users(id) on delete set null,
  origen text not null default 'cecip' check (origen in ('cecip', 'comercia'))
);
create index wa_mensajes_campana_idx on public.wa_mensajes(campana_id, estado, orden);
create index wa_mensajes_enviado_idx on public.wa_mensajes(enviado_at) where estado = 'enviado';

-- -----------------------------------------------------------------------------
-- 8. COPILOTO IA (conversaciones de cada usuario del portal)
-- -----------------------------------------------------------------------------

create table public.copiloto_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default 'Nueva conversación',
  mensajes jsonb not null default '[]', -- [{ "rol": "usuario" | "copiloto", "texto": "..." }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index copiloto_chats_user_idx on public.copiloto_chats(user_id, updated_at desc);

-- =============================================================================
-- FUNCIONES DE PERMISOS
-- =============================================================================

create or replace function public.is_service() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  -- Personal interno del CeCIP (el rol comercia es externo y no accede a socios, cuotas ni tesorería)
  select exists (select 1 from staff where user_id = auth.uid() and activo and rol <> 'comercia')
$$;

-- El rol 'admin' siempre tiene permiso
create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff
    where user_id = auth.uid() and activo and (rol = 'admin' or rol = any(roles))
  )
$$;

create or replace function public.my_socio_id() returns uuid
language sql stable security definer set search_path = public as $$
  select su.socio_id from socio_usuarios su
  join socios s on s.id = su.socio_id
  where su.user_id = auth.uid() and su.estado = 'aprobado' and s.estado <> 'baja'
$$;

create or replace function public.solo_digitos(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

create or replace function public.tg_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger socios_updated before update on public.socios
  for each row execute function public.tg_updated_at();
create trigger config_updated before update on public.configuracion
  for each row execute function public.tg_updated_at();

-- Registro de socios: al crearse un usuario con metadata tipo=socio se crea la solicitud
-- de acceso pendiente. Si el CUIT coincide con un socio del padrón se vincula automáticamente
-- (igual requiere aprobación del personal). El personal NUNCA se crea desde acá.
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_socio uuid;
  v_cuit text := solo_digitos(new.raw_user_meta_data ->> 'cuit');
begin
  if coalesce(new.raw_user_meta_data ->> 'tipo', '') <> 'socio' then
    return new;
  end if;

  if length(v_cuit) = 11 then
    select id into v_socio from socios where solo_digitos(cuit) = v_cuit limit 1;
  end if;

  insert into socio_usuarios (user_id, socio_id, nombre, email, telefono, cuit_declarado, razon_social_declarada)
  values (
    new.id, v_socio,
    new.raw_user_meta_data ->> 'nombre',
    new.email,
    new.raw_user_meta_data ->> 'telefono',
    new.raw_user_meta_data ->> 'cuit',
    new.raw_user_meta_data ->> 'razon_social'
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();

-- Control de cupo de eventos
create or replace function public.tg_control_cupo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cupo int; v_count int;
begin
  select cupo into v_cupo from eventos where id = new.evento_id;
  if v_cupo is not null then
    select count(*) into v_count from inscripciones where evento_id = new.evento_id;
    if v_count >= v_cupo then
      raise exception 'El evento no tiene más cupo disponible.';
    end if;
  end if;
  return new;
end $$;

create trigger inscripciones_cupo before insert on public.inscripciones
  for each row execute function public.tg_control_cupo();

-- Guarda el nombre del comercio en cada solicitud de ComercIA
create or replace function public.tg_solicitud_socio_nombre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(nombre_comercial, razon_social) into new.socio_nombre from socios where id = new.socio_id;
  return new;
end $$;

create trigger comercia_solicitud_nombre before insert on public.comercia_solicitudes
  for each row execute function public.tg_solicitud_socio_nombre();

-- Ajustes de ComercIA (WhatsApp de FactorIA y formulario de adhesión): los cambia el equipo de ComercIA
-- sin tener acceso al resto de la configuración del CeCIP
create or replace function public.actualizar_ajustes_comercia(p_whatsapp text, p_url_adhesion text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['comercia']) then
    raise exception 'No tenés permisos para cambiar los ajustes de ComercIA.';
  end if;
  update configuracion set factoria_whatsapp = nullif(trim(p_whatsapp), ''),
    comercia_url_adhesion = nullif(trim(p_url_adhesion), '')
  where id = 1;
end $$;
revoke execute on function public.actualizar_ajustes_comercia(text, text) from public, anon;

-- Destinatarios de una campaña de WhatsApp de ComercIA: solo nombre y teléfono de socios activos
-- que no pidieron BAJA (el equipo de ComercIA no accede al resto del padrón)
create or replace function public.destinatarios_comercia(p_rubro text default null, p_categoria uuid default null)
returns table (socio_id uuid, nombre text, contacto_nombre text, telefono text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(array['comercia']) then
    raise exception 'No tenés permisos.';
  end if;
  return query
    select s.id, coalesce(s.nombre_comercial, s.razon_social), s.contacto_nombre, coalesce(nullif(s.whatsapp, ''), s.telefono)
    from socios s
    where s.estado = 'activo' and not s.whatsapp_baja
      and coalesce(nullif(s.whatsapp, ''), s.telefono) is not null
      and (p_rubro is null or s.rubro ilike '%' || p_rubro || '%')
      and (p_categoria is null or s.categoria_id = p_categoria)
    order by 2;
end $$;
revoke execute on function public.destinatarios_comercia(text, uuid) from public, anon;

-- Marca a un socio como BAJA de difusiones por WhatsApp (lo usan el CeCIP y ComercIA)
create or replace function public.marcar_baja_whatsapp(p_socio uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_role(array['atencion', 'tesoreria', 'comercia']) then
    raise exception 'No tenés permisos.';
  end if;
  update socios set whatsapp_baja = true where id = p_socio;
end $$;
revoke execute on function public.marcar_baja_whatsapp(uuid) from public, anon;

-- =============================================================================
-- VISTAS (respetan los permisos de quien consulta)
-- =============================================================================

create or replace function public.interes_a_fecha(p_monto numeric, p_venc date, p_fecha date)
returns numeric language sql stable set search_path = public as $$
  select case
    when p_fecha > p_venc then
      round(p_monto * coalesce((select interes_mensual from configuracion where id = 1), 0) / 100
            * (p_fecha - p_venc) / 30.0, 2)
    else 0 end
$$;

create or replace view public.cuotas_detalle with (security_invoker = true) as
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

create or replace view public.socios_resumen with (security_invoker = true) as
select
  s.*,
  cat.nombre as categoria_nombre,
  cat.cuota_mensual,
  coalesce(d.deuda, 0) as deuda,
  coalesce(d.pendientes, 0) as cuotas_pendientes,
  coalesce(d.vencidas, 0) as cuotas_vencidas,
  coalesce(d.max_atraso, 0) as max_dias_atraso
from public.socios s
left join public.categorias cat on cat.id = s.categoria_id
left join lateral (
  select sum(cd.total) as deuda,
         count(*) as pendientes,
         count(*) filter (where cd.situacion = 'vencida') as vencidas,
         max(cd.dias_atraso) as max_atraso
  from public.cuotas_detalle cd
  where cd.socio_id = s.id and cd.estado = 'pendiente'
) d on true;

create or replace view public.saldos_cuentas with (security_invoker = true) as
select c.id, c.nombre, c.tipo, c.activa, c.orden,
       coalesce(sum(case when m.tipo = 'ingreso' then m.monto else -m.monto end), 0) as saldo,
       coalesce(sum(m.monto) filter (where not m.conciliado), 0) as sin_conciliar
from public.cuentas c
left join public.movimientos m on m.cuenta_id = c.id
group by c.id;

-- =============================================================================
-- OPERACIONES DE NEGOCIO
-- =============================================================================

create or replace function public.nombre_mes(p date) returns text language sql immutable as $$
  select (array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                'Septiembre','Octubre','Noviembre','Diciembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

-- Genera la cuota social del período para todos los socios activos con categoría
create or replace function public.generar_cuotas(p_periodo date, p_vencimiento date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_periodo date := date_trunc('month', p_periodo)::date;
  v_count int;
begin
  if not has_role(array['tesoreria']) then
    raise exception 'No tenés permisos para generar cuotas.';
  end if;

  insert into cuotas (socio_id, tipo, periodo, concepto, monto, vencimiento, created_by)
  select s.id, 'cuota_social', v_periodo, 'Cuota social ' || nombre_mes(v_periodo),
         cat.cuota_mensual, p_vencimiento, auth.uid()
  from socios s
  join categorias cat on cat.id = s.categoria_id
  where s.estado = 'activo'
    and cat.cuota_mensual > 0
    and not exists (
      select 1 from cuotas c
      where c.socio_id = s.id and c.periodo = v_periodo
        and c.tipo = 'cuota_social' and c.estado <> 'anulada'
    );

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Registra el cobro de una cuota: marca pagada, numera recibo, crea el ingreso en tesorería
-- y deja constancia en el historial del socio. Es idempotente (si ya está pagada no hace nada).
create or replace function public.registrar_pago(
  p_cuota_id uuid,
  p_metodo text,
  p_cuenta_id uuid default null,
  p_fecha date default current_date,
  p_referencia text default null,
  p_monto numeric default null
) returns public.cuotas
language plpgsql security definer set search_path = public as $$
declare
  c cuotas;
  cfg configuracion;
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

  if p_monto is not null then
    v_total := p_monto;
    v_interes := greatest(p_monto - c.monto, 0);
  else
    v_interes := interes_a_fecha(c.monto, c.vencimiento, coalesce(p_fecha, current_date));
    v_total := c.monto + v_interes;
  end if;

  v_cuenta := coalesce(p_cuenta_id,
    case when p_metodo = 'Mercado Pago' then cfg.cuenta_mp_id else cfg.cuenta_default_id end);

  update cuotas set
    estado = 'pagada',
    fecha_pago = coalesce(p_fecha, current_date),
    metodo_pago = p_metodo,
    monto_pagado = v_total,
    interes_cobrado = v_interes,
    referencia_pago = p_referencia,
    cuenta_id = v_cuenta,
    recibo_numero = nextval('recibo_seq')
  where id = c.id
  returning * into c;

  select coalesce(nombre_comercial, razon_social) into v_socio from socios where id = c.socio_id;
  select nombre into v_autor from staff where user_id = auth.uid();

  insert into movimientos (fecha, tipo, categoria, cuenta_id, detalle, monto, cuota_id, comprobante, created_by)
  values (c.fecha_pago, 'ingreso', 'Cuotas sociales', v_cuenta,
          c.concepto || ' - ' || v_socio, v_total, c.id,
          'Recibo N° ' || c.recibo_numero, auth.uid());

  insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_by)
  values (c.socio_id, 'pago',
          format('Pago de "%s" por $%s (%s). Recibo N° %s.', c.concepto, v_total, p_metodo, c.recibo_numero),
          coalesce(v_autor, 'Sistema'), auth.uid());

  return c;
end $$;

-- Revierte un pago cargado por error
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
    interes_cobrado = null, referencia_pago = null, cuenta_id = null, recibo_numero = null
  where id = c.id returning * into c;
  return c;
end $$;

-- Aprueba o rechaza una solicitud de acceso al portal
create or replace function public.resolver_acceso(p_user_id uuid, p_aprobar boolean, p_socio_id uuid default null, p_motivo text default null)
returns public.socio_usuarios language plpgsql security definer set search_path = public as $$
declare su socio_usuarios;
begin
  if not has_role(array['atencion', 'tesoreria']) then
    raise exception 'No tenés permisos para gestionar accesos.';
  end if;

  select * into su from socio_usuarios where user_id = p_user_id for update;
  if not found then raise exception 'Solicitud inexistente.'; end if;

  if p_aprobar then
    if coalesce(p_socio_id, su.socio_id) is null then
      raise exception 'Elegí a qué socio del padrón corresponde este usuario.';
    end if;
    update socio_usuarios set estado = 'aprobado', socio_id = coalesce(p_socio_id, su.socio_id),
      motivo_rechazo = null, aprobado_por = auth.uid(), aprobado_at = now()
    where user_id = p_user_id returning * into su;

    -- Si el socio no tenía CUIT cargado, se completa con el declarado
    update socios set cuit = su.cuit_declarado
    where id = su.socio_id and cuit is null and su.cuit_declarado is not null
      and not exists (select 1 from socios x where solo_digitos(x.cuit) = solo_digitos(su.cuit_declarado));

    insert into socio_notas (socio_id, tipo, texto, autor_nombre, created_by)
    values (su.socio_id, 'sistema', format('Acceso al portal aprobado para %s.', su.email),
            (select nombre from staff where user_id = auth.uid()), auth.uid());
  else
    update socio_usuarios set estado = 'rechazado', motivo_rechazo = p_motivo
    where user_id = p_user_id returning * into su;
  end if;
  return su;
end $$;

-- Cantidad de inscriptos por evento publicado (para mostrar cupos en el portal sin exponer datos)
create or replace function public.inscriptos_por_evento()
returns table (evento_id uuid, inscriptos bigint)
language sql stable security definer set search_path = public as $$
  select i.evento_id, count(*) from inscripciones i
  join eventos e on e.id = i.evento_id
  where e.publicado and (is_staff() or my_socio_id() is not null)
  group by i.evento_id
$$;
revoke execute on function public.inscriptos_por_evento() from public, anon;

-- Resumen para el tablero del ERP
create or replace function public.resumen_dashboard()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'socios_activos', (select count(*) from socios where estado = 'activo'),
    'socios_morosos', (select count(*) from socios_resumen where estado = 'activo' and cuotas_vencidas > 0),
    'deuda_total', (select coalesce(sum(total), 0) from cuotas_detalle where estado = 'pendiente'),
    'deuda_vencida', (select coalesce(sum(total), 0) from cuotas_detalle where situacion = 'vencida'),
    'cobrado_mes', (select coalesce(sum(monto_pagado), 0) from cuotas
                    where estado = 'pagada' and fecha_pago >= date_trunc('month', current_date)),
    'facturado_mes', (select coalesce(sum(monto), 0) from cuotas
                      where tipo = 'cuota_social' and estado <> 'anulada'
                        and periodo = date_trunc('month', current_date)::date),
    'cobrado_mes_cuotas', (select coalesce(sum(monto), 0) from cuotas
                      where tipo = 'cuota_social' and estado = 'pagada'
                        and periodo = date_trunc('month', current_date)::date),
    'accesos_pendientes', (select count(*) from socio_usuarios where estado = 'pendiente'),
    'comercia_nuevas', (select count(*) from comercia_solicitudes where estado = 'nueva'),
    'proximos_eventos', (select count(*) from eventos where fecha_inicio >= now())
  )
$$;

-- Permisos de ejecución
revoke execute on function public.generar_cuotas(date, date) from public, anon;
revoke execute on function public.registrar_pago(uuid, text, uuid, date, text, numeric) from public, anon;
revoke execute on function public.anular_pago(uuid) from public, anon;
revoke execute on function public.resolver_acceso(uuid, boolean, uuid, text) from public, anon;
revoke execute on function public.resumen_dashboard() from public, anon;
revoke execute on function public.tg_nuevo_usuario() from public, anon, authenticated;

-- =============================================================================
-- SEGURIDAD A NIVEL DE FILA (RLS)
-- Roles del personal: admin (todo), tesoreria (cobranzas y caja), atencion (socios y comunicación)
-- =============================================================================

alter table public.cuentas enable row level security;
alter table public.categorias enable row level security;
alter table public.configuracion enable row level security;
alter table public.staff enable row level security;
alter table public.socios enable row level security;
alter table public.socio_notas enable row level security;
alter table public.socio_usuarios enable row level security;
alter table public.cuotas enable row level security;
alter table public.movimientos enable row level security;
alter table public.links_pago enable row level security;
alter table public.comunicados enable row level security;
alter table public.envios enable row level security;
alter table public.eventos enable row level security;
alter table public.inscripciones enable row level security;
alter table public.comercia_solicitudes enable row level security;
alter table public.copiloto_chats enable row level security;
alter table public.wa_campanas enable row level security;
alter table public.wa_mensajes enable row level security;

-- Campañas de WhatsApp: las del CeCIP las crean Atención y Tesorería; las de ComercIA, el equipo de ComercIA.
-- El personal del CeCIP ve todas; el equipo de ComercIA solo las suyas. El Administrador puede todo.
create policy wa_camp_select on public.wa_campanas for select to authenticated
  using (is_staff() or (has_role(array['comercia']) and origen = 'comercia'));
create policy wa_camp_write on public.wa_campanas for all to authenticated
  using ((has_role(array['atencion', 'tesoreria']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'))
  with check ((has_role(array['atencion', 'tesoreria']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'));
create policy wa_msg_select on public.wa_mensajes for select to authenticated
  using (is_staff() or (has_role(array['comercia']) and origen = 'comercia'));
create policy wa_msg_write on public.wa_mensajes for all to authenticated
  using ((has_role(array['atencion', 'tesoreria']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'))
  with check ((has_role(array['atencion', 'tesoreria']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'));

-- Novedades de ComercIA en el portal
alter table public.comercia_novedades enable row level security;
create policy novedades_select on public.comercia_novedades for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (publicada and my_socio_id() is not null));
create policy novedades_write on public.comercia_novedades for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));

-- Contenido de ComercIA / IEC: lo ven el personal y los socios aprobados (solo lo activo);
-- lo editan Administración y Atención al socio
alter table public.comercia_ofertas enable row level security;
alter table public.iec_servicios enable row level security;
alter table public.iec_cursos enable row level security;
alter table public.conocimiento_cecip enable row level security;

-- El contenido de ComercIA / IEC / FactorIA lo administra el rol "comercia" (y el Administrador).
-- Lo ve todo el personal y los socios aprobados (solo lo activo).
alter table public.comercia_promociones enable row level security;
alter table public.comercia_convenio enable row level security;
create policy ofertas_select on public.comercia_ofertas for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (activa and my_socio_id() is not null));
create policy ofertas_write on public.comercia_ofertas for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
create policy promos_select on public.comercia_promociones for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (activa and (vigente_hasta is null or vigente_hasta >= current_date) and my_socio_id() is not null));
create policy promos_write on public.comercia_promociones for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
create policy convenio_select on public.comercia_convenio for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (activo and my_socio_id() is not null));
create policy convenio_write on public.comercia_convenio for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
create policy iec_serv_select on public.iec_servicios for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (activo and my_socio_id() is not null));
create policy iec_serv_write on public.iec_servicios for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
create policy iec_cursos_select on public.iec_cursos for select to authenticated
  using (is_staff() or has_role(array['comercia']) or (activo and my_socio_id() is not null));
create policy iec_cursos_write on public.iec_cursos for all to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
-- El conocimiento lo lee el Copiloto desde el servidor; en el ERP lo ve el personal
create policy conoc_select on public.conocimiento_cecip for select to authenticated using (is_staff());
create policy conoc_write on public.conocimiento_cecip for all to authenticated
  using (has_role(array['atencion'])) with check (has_role(array['atencion']));

-- Cada usuario ve y maneja solo sus propias conversaciones con el Copiloto
create policy chats_propios on public.copiloto_chats for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Configuración, categorías y cuentas
create policy cfg_select on public.configuracion for select to authenticated
  using (is_staff() or has_role(array['comercia']) or my_socio_id() is not null);
create policy cfg_update on public.configuracion for update to authenticated
  using (has_role(array[]::text[])) with check (has_role(array[]::text[]));

create policy cat_select on public.categorias for select to authenticated
  using (is_staff() or has_role(array['comercia']) or my_socio_id() is not null);
create policy cat_write on public.categorias for all to authenticated
  using (has_role(array[]::text[])) with check (has_role(array[]::text[]));

create policy cuentas_select on public.cuentas for select to authenticated using (is_staff());
create policy cuentas_write on public.cuentas for all to authenticated
  using (has_role(array[]::text[])) with check (has_role(array[]::text[]));

-- Personal
create policy staff_select on public.staff for select to authenticated
  using (is_staff() or user_id = auth.uid());
create policy staff_update on public.staff for update to authenticated
  using (has_role(array[]::text[])) with check (has_role(array[]::text[]));

-- Socios
create policy socios_select on public.socios for select to authenticated
  using (is_staff() or id = my_socio_id());
create policy socios_insert on public.socios for insert to authenticated
  with check (has_role(array['atencion', 'tesoreria']));
create policy socios_update on public.socios for update to authenticated
  using (has_role(array['atencion', 'tesoreria'])) with check (has_role(array['atencion', 'tesoreria']));
create policy socios_delete on public.socios for delete to authenticated
  using (has_role(array[]::text[]));

create policy notas_select on public.socio_notas for select to authenticated using (is_staff());
create policy notas_insert on public.socio_notas for insert to authenticated with check (is_staff());
create policy notas_delete on public.socio_notas for delete to authenticated
  using (has_role(array[]::text[]) or created_by = auth.uid());

create policy su_select on public.socio_usuarios for select to authenticated
  using (is_staff() or user_id = auth.uid());
create policy su_update on public.socio_usuarios for update to authenticated
  using (has_role(array['atencion', 'tesoreria'])) with check (has_role(array['atencion', 'tesoreria']));
create policy su_delete on public.socio_usuarios for delete to authenticated
  using (has_role(array[]::text[]));

-- Cuotas
create policy cuotas_select on public.cuotas for select to authenticated
  using (is_staff() or socio_id = my_socio_id());
create policy cuotas_insert on public.cuotas for insert to authenticated
  with check (has_role(array['tesoreria']));
create policy cuotas_update on public.cuotas for update to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));
create policy cuotas_delete on public.cuotas for delete to authenticated
  using (has_role(array[]::text[]) and estado <> 'pagada');

-- Tesorería
create policy mov_select on public.movimientos for select to authenticated using (has_role(array['tesoreria']));
create policy mov_write on public.movimientos for all to authenticated
  using (has_role(array['tesoreria'])) with check (has_role(array['tesoreria']));

create policy links_select on public.links_pago for select to authenticated
  using (is_staff() or socio_id = my_socio_id());

-- Comunicación
create policy com_select on public.comunicados for select to authenticated
  using (is_staff() or (publicado and my_socio_id() is not null));
create policy com_write on public.comunicados for all to authenticated
  using (has_role(array['atencion'])) with check (has_role(array['atencion']));

create policy envios_select on public.envios for select to authenticated using (is_staff());
create policy envios_insert on public.envios for insert to authenticated
  with check (is_staff() or (has_role(array['comercia']) and tipo = 'comercia'));

-- Eventos
create policy ev_select on public.eventos for select to authenticated
  using (is_staff() or (publicado and my_socio_id() is not null));
create policy ev_write on public.eventos for all to authenticated
  using (has_role(array['atencion'])) with check (has_role(array['atencion']));

create policy ins_select on public.inscripciones for select to authenticated
  using (is_staff() or socio_id = my_socio_id());
create policy ins_insert on public.inscripciones for insert to authenticated
  with check (
    is_staff() or (
      socio_id = my_socio_id() and exists (
        select 1 from eventos e where e.id = evento_id and e.publicado and e.inscripcion_abierta and e.fecha_inicio > now()
      )
    )
  );
create policy ins_update on public.inscripciones for update to authenticated
  using (is_staff()) with check (is_staff());
create policy ins_delete on public.inscripciones for delete to authenticated
  using (is_staff() or socio_id = my_socio_id());

-- ComercIA
create policy cia_select on public.comercia_solicitudes for select to authenticated
  using (is_staff() or has_role(array['comercia']) or socio_id = my_socio_id());
create policy cia_insert on public.comercia_solicitudes for insert to authenticated
  with check (is_staff() or (socio_id = my_socio_id() and estado = 'nueva' and notas_internas is null));
create policy cia_update on public.comercia_solicitudes for update to authenticated
  using (has_role(array['comercia'])) with check (has_role(array['comercia']));
create policy cia_delete on public.comercia_solicitudes for delete to authenticated
  using (has_role(array[]::text[]));

-- =============================================================================
-- DATOS INICIALES
-- =============================================================================

insert into public.cuentas (nombre, tipo, orden) values
  ('Caja', 'caja', 1),
  ('Banco Entre Ríos', 'banco', 2),
  ('Banco Nación', 'banco', 3),
  ('Mercado Pago', 'billetera', 4);

insert into public.categorias (nombre, cuota_mensual, orden) values
  ('Pequeño Comercio', 0, 1),
  ('Servicios', 0, 2),
  ('Mediana Empresa', 0, 3),
  ('Gran Industria', 0, 4);

insert into public.configuracion (id, cuenta_mp_id, cuenta_default_id)
select 1,
  (select id from public.cuentas where nombre = 'Mercado Pago'),
  (select id from public.cuentas where nombre = 'Caja');

-- Contenido inicial de ComercIA / IEC (tomado de la app ComercIA Paraná). Se edita desde ERP > Contenido.
insert into public.comercia_ofertas (titulo, etiqueta, problema, solucion, incluye, icono, destacada, orden) values
  ('Sucursal Virtual 24/7', 'Sucursal Virtual', 'A las 21 hs o los fines de semana el local cierra y se pierden ventas y consultas.', 'Tu comercio siempre abierto: catálogo digital, turnos y recepción de pedidos directo a tu WhatsApp, incluso con la persiana baja.', array['Perfil del comercio en ComercIA con mapa y horarios', 'Catálogo de productos y servicios', 'Pedidos y consultas directo a WhatsApp', 'Turnos online']::text[], 'Store', true, 1),
  ('Digitalización con FactorIA', 'Listo en ~30 días', 'Hacer una web desde cero suele costar caro, tardar meses y quedar desactualizada.', 'FactorIA estandarizó el proceso: tu comercio online y operativo en aproximadamente 30 días, con respaldo del CeCIP.', array['Web o tienda online del comercio', 'Puesta en marcha guiada', 'Capacitación para tu equipo', 'Respaldo del convenio CeCIP']::text[], 'Zap', true, 2),
  ('Búsqueda inteligente y stock', 'Respuesta con IA', 'El vecino da vueltas por la ciudad o pregunta en grupos sin saber quién tiene stock hoy.', 'El asistente de IA de ComercIA le indica en segundos qué comercio local tiene lo que busca, con dirección y WhatsApp directo.', array['Aparición en las respuestas del asistente IA', 'Conexión opcional de stock', 'Más consultas de vecinos de Paraná']::text[], 'Search', false, 3),
  ('Promociones destacadas en ComercIA', 'Más visibilidad', 'Las promociones del local se pierden entre publicaciones de redes y nadie se entera.', 'Publicá tus descuentos en el carrusel de promociones de ComercIA y en el asistente IA, con la etiqueta de comercio adherido.', array['Carrusel de promociones de la app', 'Promos exclusivas ComercIA', 'Difusión en campañas del CeCIP']::text[], 'BadgePercent', false, 4),
  ('Respaldo técnico en el local', 'Técnicos matriculados', 'Conseguir un electricista matriculado o un instalador confiable y rápido es un dolor de cabeza.', 'IEC Services pone técnicos matriculados para electricidad, seguridad, gas, construcción en seco y mantenimiento del local.', array['Técnicos verificados', 'Guardia para urgencias', 'Mantenimiento programado del comercio']::text[], 'Wrench', false, 5);

insert into public.iec_servicios (nombre, subtitulo, descripcion, icono, subtipos, orden) values
  ('Electricidad', 'Instalaciones, mantenimiento y reparaciones de urgencia', 'Técnicos matriculados para tableros eléctricos, cableado, térmicas, luminarias LED y cortocircuitos.', 'Zap', array['Instalación', 'Mantenimiento', 'Reparación']::text[], 1),
  ('Cámaras y alarmas', 'Seguridad electrónica hogareña y comercial', 'Sistemas CCTV, cámaras IP WiFi, alarmas comunitarias, sensores de movimiento y monitoreo por app móvil.', 'Shield', array['Instalación', 'Mantenimiento', 'Reparación']::text[], 2),
  ('Gasista', 'Gasistas matriculados oficiales', 'Calefones, termotanques, cocinas, cañerías, trámites de habilitación y detección de pérdidas.', 'Flame', array['Instalación', 'Mantenimiento', 'Reparación']::text[], 3),
  ('Marketing y Comunicación Digital', 'Redes sociales, publicidad digital, branding y diseño web', 'Especialistas en crecimiento de marcas, campañas publicitarias, presencia digital y captación de clientes en Paraná.', 'Megaphone', array['Gestión de redes sociales y contenido', 'Campañas en Meta / Google Ads', 'Identidad y branding comercial', 'Desarrollo web y tiendas online']::text[], 4),
  ('Capacitación', 'Cursos técnicos y formación laboral en Paraná', 'Programas de capacitación técnica y formación laboral avalados por IEC Paraná.', 'GraduationCap', array['Cursos de oficios con salida laboral', 'Talleres prácticos intensivos', 'Capacitación para empresas y comercios', 'Marketing y habilidades digitales']::text[], 5),
  ('Construcción en seco', 'Tabiquería, cielorrasos y aislamiento', 'Estructuras de Durlock, tabiques divisorios acústicos, cielorrasos suspendidos y molduras decorativas.', 'Hammer', array['Instalación', 'Mantenimiento', 'Reparación']::text[], 6),
  ('Reparación de celulares', 'Servicio técnico especializado multimarca', 'Reparación express con repuestos de calidad garantizada para iPhone, Samsung, Motorola, Xiaomi y más.', 'Smartphone', array['Cambio de módulo / pantalla', 'Cambio de batería y pin de carga', 'Diagnóstico de placa y software']::text[], 7),
  ('Cartelería de vidrieras', 'Publicidad gráfica y presencia visual para locales', 'Montaje profesional de vinilos esmerilados, cartelería frontal, promociones estacionales y branding para vidrieras.', 'Store', array['Vinilos microperforados', 'Rotulación y ploteo de vidrieras', 'Retiro y mantenimiento de cartelería']::text[], 8);

insert into public.iec_cursos (nombre, subtitulo, duracion, frecuencia, modalidad, lugar, requisitos, salida_laboral, temario, orden) values
  ('Electricidad Domiciliaria e Industrial', 'Formación práctica con instrumental profesional y normas AEA', '4 meses', '2 clases semanales (3 hs c/u)', 'Presencial con práctica en taller', 'Sede IEC Paraná - 25 de Mayo 380', 'Mayor de 18 años, sin conocimientos previos', 'Instalaciones domiciliarias, tableros, iluminación y mantenimiento.', array['Circuitos eléctricos y cálculos', 'Tableros y protecciones diferenciales/térmicas', 'Luminotecnia y cableado normalizado', 'Reglamentaciones vigentes en Entre Ríos']::text[], 1),
  ('Instalación de Cámaras de Seguridad y CCTV', 'Seguridad electrónica, alarmas y monitoreo por app', '2 meses', '1 clase semanal intensiva (4 hs)', 'Presencial teórico-práctico', 'Sede IEC Paraná - 25 de Mayo 380', 'Manejo básico de herramientas y smartphone/PC', 'Instalador independiente de cámaras IP, DVR/NVR y alarmas.', array['Cámaras IP, WiFi y analógicas HD', 'Configuración de DVR y routers para acceso móvil', 'Sensores de movimiento y cercos perimetrales', 'Presupuestación e instalación en obra']::text[], 2),
  ('Reparación de Celulares y Microelectrónica', 'Diagnóstico, cambio de módulos, baterías y microsoldadura', '3 meses', '2 clases semanales (2,5 hs c/u)', 'Presencial en laboratorio técnico', 'Sede IEC Paraná - 25 de Mayo 380', 'Motricidad fina, sin experiencia previa', 'Taller propio o servicio técnico para locales comerciales.', array['Desarme y cambio de pantallas/módulos', 'Pines de carga, periféricos y baterías', 'Estación de soldado y multímetro', 'Diagnóstico de fallas comunes y software']::text[], 3),
  ('Marketing Digital y Redes para Comercios', 'Ventas en Instagram, TikTok, Meta Ads y WhatsApp Business', '2 meses', '1 clase semanal (3 hs) + tutoría online', 'Presencial en aula multimedia', 'Sede IEC Paraná - 25 de Mayo 380', 'Uso básico de computadora o smartphone', 'Gestión de redes para negocios propios o community manager freelance.', array['Contenido con Canva y CapCut', 'Campañas en Facebook e Instagram Ads', 'Ventas automatizadas por WhatsApp Business', 'Google Mi Negocio y ComercIA Paraná']::text[], 4),
  ('Construcción en Seco y Sistemas Durlock', 'Tabiquería, cielorrasos suspendidos, aislaciones y juntas', '2 meses', 'Sábados (5 hs)', 'Taller práctico intensivo', 'Sede IEC Paraná - 25 de Mayo 380', 'Mayor de 18 años', 'Oficio de rápida colocación en obras particulares y comerciales.', array['Perfilería y anclajes', 'Colocación y corte de placas de yeso', 'Juntas, masillado y lijado', 'Aislamiento termoacústico y cielorrasos']::text[], 5),
  ('Capacitación a Medida para Empresas y Comercios', 'Programas in-company o en sede para personal operativo y comercial', 'A coordinar', 'Jornadas modulares', 'In-company o sede IEC', 'A definir con la empresa en Paraná', 'Personal designado por la firma', 'Mejora de competencias técnicas del equipo.', array['Seguridad laboral y eléctrica', 'Atención técnica al cliente', 'Eficiencia energética en locales', 'Módulos a medida']::text[], 6);

-- Información institucional que usa el Copiloto (REVISAR: viene de la web generada originalmente)
insert into public.conocimiento_cecip (titulo, contenido, orden) values
  ('Institución', '- Centro Comercial e Industrial de Paraná (CeCIP). Fundado el 18 de octubre de 1898 como "Sociedad de Comerciantes" (más de 125 años de trayectoria).
- Asociación civil gremial empresaria sin fines de lucro.
- Misión: representar a comerciantes, industriales y prestadores de servicios de Paraná y el departamento, defender la legalidad comercial, combatir el comercio clandestino, fomentar la competencia equitativa y promover el empleo genuino.
- Sede: 25 de Mayo 28, 1º piso, Paraná, Entre Ríos (centro histórico, cerca de Peatonal San Martín y Plaza 1º de Mayo).
- Horario de atención: lunes a viernes de 9 a 17 hs.
- Teléfono: (0343) 431-2785 · WhatsApp: 343 457-5070 · Email: info@centrocomercialparana.com.ar · Web: centrocomercialparana.com.ar
- Hitos: 1905 impulso del descanso dominical mercantil; 1920 sede propia en 25 de Mayo 28; 1970 rol protagónico en la fundación del Parque Industrial de Paraná; 1985 primer Centro Comercial a Cielo Abierto y peatonalización de calle San Martín. Hoy representa a más de 230 empresas y comercios.', 1),
  ('Autoridades (comisión directiva)', '- Presidente: Mauricio Benitende (Perseo SRL). Vicepresidente: Víctor E. Béjar (Tienda El Mago).
- Secretario: Gabriel N. Icasatti (BlackBaley). Prosecretario: Marcelo Quiroga (EGE S.A.).
- Tesorero: Edgardo R. Greca (Greca S.A.). Protesorero: Ricardo Fernández (CMS S.A.).
- Vocales titulares: Esteban A. Danessi (Eco Diseño Paraná), Raúl Habid (Trapoteca SAS).
- Vocales suplentes: Mirko Pacoricona (Yasu S.R.L.), Pedro Guzmán Berón (Win S.R.L.), Silvia Bechir (HB Productos de Seguridad), Danilo Brizuela (Uomo Libre).
- Revisores de cuentas: David Bresler (Sentir lo Nuestro), Esteban A. Enrique (Diseñarte Creaciones).', 2),
  ('Comisiones de trabajo', '- Comercio Minorista (centros comerciales a cielo abierto): corredores peatonales, seguridad y promociones.
- Parques Industriales y Logística: tarifas energéticas, gas natural y Parque Industrial Paraná.
- Capacitaciones y Extensión Gremial: formación para empresarios, mandos medios y empleados de comercio.
- Mujeres y Diversidad Empresaria.
- Jóvenes Emprendedores (Jóvenes CeCIP, sub-40): relevo generacional, rondas de negocios.', 3),
  ('Cámaras sectoriales', '- Comercio: campañas (Día del Padre, Día de la Madre, Navidad, "Comprá en tu Ciudad"), peatonalización temporal, mesas de seguridad comercial.
- Industria: gestiones de gas y potencia eléctrica, vinculación con INTI y universidades, misiones comerciales.
- Servicios: digitalización de pymes, turismo, convenios con facultades para pasantías.
- Jóvenes Empresarios: talleres de liderazgo y mentorías.', 4),
  ('Entidades a las que adhiere', '- CAME (Confederación Argentina de la Mediana Empresa): cursos gratuitos en CAME Educativa, créditos subsidiados, estadísticas del comercio minorista.
- CAC (Cámara Argentina de Comercio y Servicios): becas, asesoramiento en comercio exterior, informes de coyuntura.
- FEDER (Federación Económica de Entre Ríos): defensa ante el gobierno provincial, tarifas eléctricas, leyes impositivas (ATER).
- Bolsa de Comercio de Entre Ríos: pagarés pyme y descuento de cheques con aval de SGR.', 5),
  ('Beneficios para socios', '- Informes comerciales (Veraz, Fidelitas, Nosis) a tarifa bonificada.
- Asesoramiento legal, laboral, contable e impositivo gratuito (Tasa de Higiene y Profilaxis, habilitaciones, AFIP/ARCA y ATER).
- Capacitaciones gratuitas o bonificadas con certificado.
- Uso bonificado del Salón de Actos (más de 80 personas) y salas de reunión, sujeto a reserva.
- Bolsa de empleo: acceso a currículums de postulantes sin costo de agencia.
- Convenios y descuentos (telefonía, seguridad, hotelería, medicina laboral, promociones bancarias).
- Portal de Socios: estado de cuenta, pago online de cuotas con Mercado Pago, recibos, comunicados, eventos y capacitaciones, y la sección ComercIA.', 6);

-- Contenido del convenio tomado del documento "ComercIA Inteligente" del Instituto IEC.
-- Se edita desde ERP > Contenido > Promociones / Convenio.

-- Beneficios con condiciones preferenciales para asociados (el documento no fija montos ni porcentajes:
-- cuando se acuerden, cargarlos en "Texto grande", ej. "20% OFF").
insert into public.comercia_promociones (titulo, descuento, descripcion, condiciones, destacada, orden) values
  ('Desarrollo digital e instalaciones smart', 'PREFERENCIAL',
   'Páginas web, tiendas online, e-commerce y sistemas de domótica para tu comercio en condiciones preferenciales por ser socio del CeCIP.',
   'Para comercios asociados al CeCIP, en el marco del convenio con el Instituto IEC.', true, 1),
  ('Sala de streaming del Instituto IEC', 'CON DESCUENTO',
   'Grabá contenido, entrevistas, transmisiones en vivo y piezas publicitarias de tu comercio en la sala de streaming del Instituto.',
   'Alquiler con descuento para comercios adheridos.', false, 2),
  ('Espacios del Instituto para tu comercio', 'ACCESO PREFERENCIAL',
   'Organizá jornadas, workshops, encuentros empresariales, lanzamientos y actividades institucionales en los espacios del Instituto IEC.',
   'Condiciones diferenciales para comercios adheridos.', false, 3),
  ('Simposios tecnológicos mensuales', 'CADA MES',
   'Encuentros con las últimas tendencias en IA, automatización, domótica, e-commerce, marketing digital y productividad. Intercambio y networking con otros comercios.',
   'Para asociados del CeCIP adheridos al programa.', false, 4),
  ('Asesoramiento personalizado', 'SIN COSTO',
   'El Instituto IEC analiza tu comercio y te arma una propuesta adaptada a tu rubro y necesidad.',
   'Pedilo desde "Quiero sumarme" o con el formulario de adhesión.', false, 5);

insert into public.comercia_convenio (tipo, titulo, texto, icono, orden) values
  ('parte', 'CeCIP', 'Firma el convenio marco con el Instituto IEC: todos sus asociados acceden a los beneficios del programa en condiciones preferenciales.', 'Briefcase', 1),
  ('parte', 'Instituto IEC', 'Motor del programa. Institución de formación, innovación y tecnología aplicada (IA, programación, robótica, automatización y transformación digital) con sede en Gualeguaychú 449, Paraná.', 'GraduationCap', 2),
  ('parte', 'FactorIA', 'El área de desarrollo digital: webs, tiendas online, e-commerce y automatización de la atención, ágil, de bajo costo y adaptado a cada rubro.', 'Zap', 3),

  ('eje', 'Formación y capacitación con IA', 'Experto en IA para Pymes (administración, atención al cliente, marketing y ventas), Programación con IA, Robótica Kids y Espacio AprendIA (apoyo escolar con IA y psicopedagogos).', 'GraduationCap', 1),
  ('eje', 'Sistemas smart y domótica', 'Control inteligente de iluminación y climatización, encendido programado y monitoreo remoto: menos consumo de energía y menos costos.', 'Zap', 2),
  ('eje', 'Desarrollo digital (FactorIA)', 'Páginas web, tiendas online, e-commerce con medios de pago y automatización de la atención al cliente.', 'Globe', 3),
  ('eje', 'Simposios tecnológicos mensuales', 'Actualización permanente en IA, automatización, e-commerce y marketing digital, con intercambio entre pares.', 'Users', 4),
  ('eje', 'IEC Tech Experience', 'Acceso preferencial a los espacios del Instituto para jornadas, workshops y lanzamientos, y sala de streaming con descuento.', 'Rocket', 5),
  ('eje', 'Streaming "ComercIA Inteligente"', 'Programa propio sobre tecnología aplicada al comercio. Los comercios adheridos al CeCIP son invitados a participar en charlas, entrevistas y debates.', 'Camera', 6),

  ('beneficio', 'Eficiencia operativa', 'Menos tiempo perdido, menos costos operativos y ahorro energético con soluciones smart en el día a día.', 'Zap', 1),
  ('beneficio', 'Inteligencia aplicada a la gestión', 'IA en la administración, la comunicación, el marketing y la atención al cliente.', 'Sparkles', 2),
  ('beneficio', 'Expansión digital', 'Web, e-commerce y venta digital a bajo costo, con desarrollo ágil y adaptado a tu rubro.', 'Globe', 3),
  ('beneficio', 'Actualización y networking', 'Simposios mensuales con formación continua e intercambio con otros comercios.', 'Users', 4),
  ('beneficio', 'Infraestructura y visibilidad', 'Espacios tecnológicos del Instituto, sala de streaming con descuento y participación en el programa de streaming.', 'Camera', 5),
  ('beneficio', 'Un solo ecosistema', 'Una sola adhesión te conecta con todo el universo de transformación tecnológica del IEC.', 'Rocket', 6),

  ('paso', 'Convenio CeCIP + IEC', 'Como socio del CeCIP ya accedés a los beneficios del programa en condiciones preferenciales.', 'Briefcase', 1),
  ('paso', 'Contanos qué necesitás', 'Tocá "Quiero sumarme": formación, desarrollo digital, instalación smart o uso de espacios.', 'MessageCircle', 2),
  ('paso', 'Asesoramiento personalizado', 'El Instituto IEC te arma una propuesta adaptada a tu comercio.', 'Search', 3),
  ('paso', 'Transformación continua', 'Implementamos y te acompañamos con simposios, formación y streaming.', 'Rocket', 4),

  ('pregunta', '¿Qué es ComercIA Inteligente?', 'Un programa integral del Instituto IEC para modernizar comercios y pymes con inteligencia artificial, automatización, digitalización, formación aplicada y espacios de difusión. No es una capacitación aislada: es una estrategia sostenida que acompaña al comercio en cada etapa.', 'Sparkles', 1),
  ('pregunta', '¿Para qué comercios es?', 'Para comercios y pymes de todos los rubros y tamaños.', 'Sparkles', 2),
  ('pregunta', '¿Qué gano por ser socio del CeCIP?', 'El convenio marco entre el CeCIP y el Instituto IEC te da acceso a los beneficios del programa en condiciones preferenciales.', 'Sparkles', 3),
  ('pregunta', '¿Puedo contratar solo un servicio?', 'Sí. Podés adherir a servicios puntuales como el desarrollo digital, la instalación de sistemas smart o la participación en espacios formativos.', 'Sparkles', 4),
  ('pregunta', '¿Qué modalidades hay?', 'Beneficios exclusivos para asociados, programas grupales de capacitación, servicios individuales para comercios adheridos, condiciones preferenciales para desarrollos digitales e instalaciones smart, y acceso a cronogramas especiales de actividades, formaciones, emisiones y eventos.', 'Sparkles', 5),
  ('pregunta', '¿Dónde queda el Instituto IEC?', 'En Gualeguaychú 449, Paraná, Entre Ríos.', 'Sparkles', 6);

-- Propuestas formativas del Eje 1 (documento ComercIA Inteligente)
insert into public.iec_cursos (nombre, subtitulo, modalidad, lugar, orden) values
  ('Experto en IA para Pymes', 'Uso estratégico de la IA en la gestión diaria: administración, atención al cliente, automatización, marketing y ventas.', 'Formación aplicada', 'Instituto IEC - Gualeguaychú 449, Paraná', 0),
  ('Programación con IA', 'Programar, prototipar y crear automatizaciones con herramientas de inteligencia artificial.', 'Formación aplicada', 'Instituto IEC - Gualeguaychú 449, Paraná', 0),
  ('Robótica Kids', 'Para niños y adolescentes: robótica, pensamiento computacional, creatividad y resolución de problemas.', 'Taller', 'Instituto IEC - Gualeguaychú 449, Paraná', 0),
  ('Espacio AprendIA', 'Apoyo escolar con IA y psicopedagogos: estrategias personalizadas, hábitos de estudio y herramientas tecnológicas.', 'Acompañamiento', 'Instituto IEC - Gualeguaychú 449, Paraná', 0);

-- Lo que sabe el Copiloto sobre el programa
insert into public.conocimiento_cecip (titulo, contenido, orden) values
  ('Programa ComercIA Inteligente (convenio CeCIP + Instituto IEC)',
   '- Programa integral del Instituto IEC (Gualeguaychú 449, Paraná) para la transformación tecnológica de comercios y pymes: inteligencia artificial, automatización, domótica, digitalización, formación aplicada y espacios de difusión.
- Objetivo: optimizar la operatoria diaria, reducir costos y fortalecer la competitividad del comercio.
- Seis ejes: 1) Formación y capacitación con IA (Experto en IA para Pymes, Programación con IA, Robótica Kids, Espacio AprendIA); 2) Sistemas smart y domótica (iluminación, climatización, encendido programado, monitoreo remoto, ahorro energético); 3) Desarrollo digital con FactorIA (webs, tiendas online, e-commerce con medios de pago, automatización de la atención); 4) Simposios tecnológicos mensuales; 5) IEC Tech Experience (acceso preferencial a espacios del Instituto y sala de streaming con descuento); 6) Programa de streaming "ComercIA Inteligente", donde participan los comercios adheridos al CeCIP.
- Se implementa mediante un convenio marco entre el Instituto IEC y el CeCIP, que da a todos los asociados acceso a los beneficios en condiciones preferenciales. También se puede adherir de forma individual a servicios puntuales. El Instituto acompaña con asesoramiento personalizado.
- Modalidades: beneficios exclusivos para asociados, programas grupales de capacitación, servicios individuales, condiciones preferenciales para desarrollos digitales e instalaciones smart, y cronogramas especiales de actividades, formaciones, emisiones y eventos.', 7);

-- Novedad inicial de ComercIA (se edita desde ERP > Difusión > Novedades)
insert into public.comercia_novedades (titulo, cuerpo, orden) values
  ('Llegó ComercIA Inteligente para los socios del CeCIP',
   'Gracias al convenio entre el CeCIP y el Instituto IEC, tu comercio puede acceder en condiciones preferenciales al programa ComercIA Inteligente: formación en IA, sistemas smart y domótica, desarrollo digital con FactorIA, simposios mensuales, espacios tecnológicos y streaming. Tocá "Quiero sumarme" y te asesoramos.', 1);
