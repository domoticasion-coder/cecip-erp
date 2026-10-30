-- 018: Portal de prensa, noticias de la web, Mujeres y Jóvenes Empresarios, convenios y promociones,
--      actividad de los socios en el Portal, sugerencias y carga de CV desde el ERP.
--  - prensa_medios: canales y medios a los que comunica el CeCIP (Comunicación → Portal de prensa).
--  - noticias_web: noticias que publica la web (Comunicación → Noticias de la web).
--  - grupos_publicaciones: eventos, actividades y capacitaciones de Mujeres Empresarias y Jóvenes
--    Empresarios, que se ven en sus pestañas de la web (Comunicación → Mujeres y Jóvenes).
--  - convenios: convenios vigentes y promociones para socios (ERP → Convenios; Portal → Convenios).
--  - portal_actividad: qué hace cada socio en el Portal (ERP → Actividad del portal).
--  - sugerencias: sugerencias de los socios al CeCIP desde el Portal.
--  - bolsa_cvs: el personal puede cargar los CV que ya tenía (botón "Cargar CV").
--  - web_contenido(): suma noticias y publicaciones de Mujeres y Jóvenes.
-- Re-ejecutable.

-- -----------------------------------------------------------------------------
-- 1. Portal de prensa
create table if not exists public.prensa_medios (
  id uuid primary key default gen_random_uuid(),
  medio text not null,
  tipo text,                 -- Diario, Radio, TV, Portal web, Revista, Agencia, Redes, Otro
  contacto text,             -- periodista o responsable
  cargo text,
  email text,
  telefono text,
  whatsapp text,
  web text,
  redes text,
  localidad text,
  temas text,                -- secciones o temas que cubre
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prensa_medios_medio_idx on public.prensa_medios(lower(medio));

-- -----------------------------------------------------------------------------
-- 2. Noticias de la web
create table if not exists public.noticias_web (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  bajada text,
  cuerpo text not null default '',
  categoria text not null default 'Institucional',
  imagen_url text,
  fecha timestamptz not null default now(),
  destacado boolean not null default false,
  publicado boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists noticias_web_fecha_idx on public.noticias_web(publicado, fecha desc);

-- -----------------------------------------------------------------------------
-- 3. Mujeres Empresarias y Jóvenes Empresarios
create table if not exists public.grupos_publicaciones (
  id uuid primary key default gen_random_uuid(),
  grupo text not null check (grupo in ('mujeres', 'jovenes')),
  tipo text not null default 'actividad' check (tipo in ('evento', 'actividad', 'capacitacion', 'novedad')),
  titulo text not null,
  descripcion text,
  fecha timestamptz,
  fecha_fin timestamptz,
  lugar text,
  imagen_url text,
  link text,
  publicado boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists grupos_pub_idx on public.grupos_publicaciones(grupo, publicado, fecha desc);

-- -----------------------------------------------------------------------------
-- 4. Convenios vigentes y promociones para socios
create table if not exists public.convenios (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'convenio' check (tipo in ('convenio', 'promocion')),
  titulo text not null,
  empresa text,              -- con quién es el convenio o quién ofrece la promoción
  rubro text,
  descripcion text,
  beneficio text,            -- ej. "15% de descuento", "2x1 los martes"
  condiciones text,
  como_usarlo text,
  contacto text,
  link text,
  imagen_url text,
  vigencia_desde date,
  vigencia_hasta date,
  activo boolean not null default true,
  destacado boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists convenios_activos_idx on public.convenios(activo, vigencia_hasta);

-- -----------------------------------------------------------------------------
-- 5. Actividad de los socios en el Portal
create table if not exists public.portal_actividad (
  id bigint generated always as identity primary key,
  socio_id uuid references public.socios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  accion text not null,      -- ver, click, descarga, inscripcion, pago, sugerencia, interes…
  seccion text not null,     -- inicio, cuotas, comunicados, eventos, comercia, bolsa, convenios, empresa, copiloto…
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists portal_actividad_socio_idx on public.portal_actividad(socio_id, created_at desc);
create index if not exists portal_actividad_fecha_idx on public.portal_actividad(created_at desc);

-- La registra el Portal; ignora repeticiones idénticas de menos de 20 segundos (recargas, dobles clics)
create or replace function public.registrar_actividad_portal(p_accion text, p_seccion text, p_detalle jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_socio uuid := my_socio_id();
begin
  if v_socio is null or auth.uid() is null then return; end if;
  if exists (select 1 from portal_actividad
             where user_id = auth.uid() and accion = left(p_accion, 40) and seccion = left(p_seccion, 40)
               and detalle = coalesce(p_detalle, '{}'::jsonb) and created_at > now() - interval '20 seconds') then
    return;
  end if;
  insert into portal_actividad (socio_id, user_id, accion, seccion, detalle)
  values (v_socio, auth.uid(), left(p_accion, 40), left(p_seccion, 40), coalesce(p_detalle, '{}'::jsonb));
end $$;
revoke execute on function public.registrar_actividad_portal(text, text, jsonb) from public;
grant execute on function public.registrar_actividad_portal(text, text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Sugerencias de los socios
create table if not exists public.sugerencias (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid references public.socios(id) on delete set null default public.my_socio_id(),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  categoria text not null default 'General',
  mensaje text not null check (length(trim(mensaje)) between 3 and 4000),
  estado text not null default 'nueva' check (estado in ('nueva', 'en_revision', 'respondida', 'archivada')),
  respuesta text,
  respondido_por uuid references auth.users(id) on delete set null,
  respondido_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sugerencias_estado_idx on public.sugerencias(estado, created_at desc);

-- -----------------------------------------------------------------------------
-- 7. Permisos
alter table public.prensa_medios enable row level security;
alter table public.noticias_web enable row level security;
alter table public.grupos_publicaciones enable row level security;
alter table public.convenios enable row level security;
alter table public.portal_actividad enable row level security;
alter table public.sugerencias enable row level security;

drop policy if exists prensa_select on public.prensa_medios;
create policy prensa_select on public.prensa_medios for select to authenticated using (is_staff());
drop policy if exists prensa_write on public.prensa_medios;
create policy prensa_write on public.prensa_medios for all to authenticated
  using (has_role(array['prensa'])) with check (has_role(array['prensa']));

drop policy if exists noticias_select on public.noticias_web;
create policy noticias_select on public.noticias_web for select to authenticated using (is_staff());
drop policy if exists noticias_write on public.noticias_web;
create policy noticias_write on public.noticias_web for all to authenticated
  using (has_role(array['prensa'])) with check (has_role(array['prensa']));

drop policy if exists grupos_select on public.grupos_publicaciones;
create policy grupos_select on public.grupos_publicaciones for select to authenticated
  using (is_staff() or (publicado and my_socio_id() is not null));
drop policy if exists grupos_write on public.grupos_publicaciones;
create policy grupos_write on public.grupos_publicaciones for all to authenticated
  using (has_role(array['prensa'])) with check (has_role(array['prensa']));

-- Los socios ven los convenios activos y vigentes
drop policy if exists convenios_select on public.convenios;
create policy convenios_select on public.convenios for select to authenticated
  using (is_staff() or (my_socio_id() is not null and activo
         and (vigencia_desde is null or vigencia_desde <= current_date)
         and (vigencia_hasta is null or vigencia_hasta >= current_date)));
drop policy if exists convenios_write on public.convenios;
create policy convenios_write on public.convenios for all to authenticated
  using (has_role(array['prensa', 'atencion'])) with check (has_role(array['prensa', 'atencion']));

-- La actividad se registra solo con registrar_actividad_portal(); la ve el personal
drop policy if exists actividad_select on public.portal_actividad;
create policy actividad_select on public.portal_actividad for select to authenticated using (is_staff());

drop policy if exists sugerencias_select on public.sugerencias;
create policy sugerencias_select on public.sugerencias for select to authenticated
  using (is_staff() or (socio_id is not null and socio_id = my_socio_id()));
drop policy if exists sugerencias_insert on public.sugerencias;
create policy sugerencias_insert on public.sugerencias for insert to authenticated
  with check (my_socio_id() is not null and socio_id = my_socio_id() and user_id = auth.uid() and estado = 'nueva' and respuesta is null);
drop policy if exists sugerencias_update on public.sugerencias;
create policy sugerencias_update on public.sugerencias for update to authenticated
  using (has_role(array['atencion', 'prensa'])) with check (has_role(array['atencion', 'prensa']));

-- -----------------------------------------------------------------------------
-- 8. Bolsa de empleo: el personal carga los CV que ya tenía
alter table public.bolsa_cvs alter column email drop not null;
drop policy if exists bolsa_insert on public.bolsa_cvs;
create policy bolsa_insert on public.bolsa_cvs for insert to authenticated
  with check (has_role(array['atencion', 'prensa']));

do $$
begin
  if to_regclass('storage.objects') is not null then
    begin
      execute 'drop policy if exists bolsa_cvs_carga on storage.objects';
      execute $q$
        create policy bolsa_cvs_carga on storage.objects for insert to authenticated
        with check (bucket_id = 'bolsa-cvs' and name like 'carga/%' and public.has_role(array['atencion', 'prensa'])) $q$;
    exception when insufficient_privilege then
      raise notice 'No se pudo crear el permiso de carga en "bolsa-cvs": agregalo en Storage (insert en carga/ para el personal).';
    end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Contenido para la web: suma noticias y publicaciones de Mujeres y Jóvenes
create or replace function public.web_contenido() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'eventos', coalesce((select jsonb_agg(x order by x.fecha_inicio) from (
      select e.id, e.titulo, e.tipo, e.descripcion, e.fecha_inicio, e.fecha_fin, e.lugar, e.modalidad, e.link,
             e.costo, e.precio_no_socio, e.imagen_url, e.cantidad_clases, e.dias_semana, e.hora_inicio, e.hora_fin,
             d.nombre as docente,
             case when e.formulario_publico and e.inscripcion_abierta and e.slug is not null then e.slug end as slug_inscripcion,
             e.inscripcion_abierta
      from eventos e left join docentes d on d.id = e.docente_id
      where e.publicado and e.publicar_web and not e.cancelado
        and coalesce(e.fecha_fin, e.fecha_inicio) >= now() - interval '1 day'
      order by e.fecha_inicio limit 40) x), '[]'::jsonb),
    'novedades', coalesce((select jsonb_agg(x order by x.fecha desc) from (
      select c.id, c.titulo, c.cuerpo, c.imagen_url, coalesce(c.fecha_publicacion, c.created_at) as fecha, c.destacado
      from comunicados c
      where c.publicado and c.publicar_web
      order by coalesce(c.fecha_publicacion, c.created_at) desc limit 12) x), '[]'::jsonb),
    'noticias', coalesce((select jsonb_agg(x order by x.fecha desc) from (
      select n.id, n.titulo, n.bajada, n.cuerpo, n.categoria, n.imagen_url, n.fecha, n.destacado
      from noticias_web n
      where n.publicado and n.fecha <= now() + interval '1 hour'
      order by n.fecha desc limit 30) x), '[]'::jsonb),
    'grupos', coalesce((select jsonb_agg(x order by x.orden) from (
      select g.id, g.grupo, g.tipo, g.titulo, g.descripcion, g.fecha, g.fecha_fin, g.lugar, g.imagen_url, g.link,
             -- primero lo que viene (más cercano), después lo pasado (más reciente)
             row_number() over (order by (coalesce(g.fecha_fin, g.fecha, g.created_at) < now()),
               case when coalesce(g.fecha_fin, g.fecha, g.created_at) >= now() then g.fecha end asc,
               coalesce(g.fecha, g.created_at) desc) as orden
      from grupos_publicaciones g
      where g.publicado
      order by orden limit 80) x), '[]'::jsonb)
  )
$$;
revoke execute on function public.web_contenido() from public;
grant execute on function public.web_contenido() to anon, authenticated, service_role;

select 'prensa, noticias, convenios y actividad' as control,
  to_regclass('public.prensa_medios') is not null as prensa,
  to_regclass('public.noticias_web') is not null as noticias,
  to_regclass('public.convenios') is not null as convenios,
  to_regclass('public.portal_actividad') is not null as actividad,
  to_regclass('public.sugerencias') is not null as sugerencias;
