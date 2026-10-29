-- 017: Conexión con la web del CeCIP (www.centrocomercialparana.com.ar) y Bolsa de Empleo.
--  - La web lee del ERP los eventos, capacitaciones y novedades publicados (función web_contenido,
--    solo datos públicos: nada de socios, montos internos ni datos personales).
--  - El formulario "Carga tu CV" de la web guarda los CV en el ERP (bolsa_cvs + archivo en Storage).
--  - El personal los revisa en ERP → Bolsa de empleo; los aprobados los ven los socios en el Portal.
-- Re-ejecutable.

-- -----------------------------------------------------------------------------
-- 1. Qué se publica en la web
alter table public.comunicados add column if not exists publicar_web boolean not null default false;
alter table public.eventos add column if not exists publicar_web boolean not null default true;

-- Contenido público para la web (la llama la web sin sesión)
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
      order by coalesce(c.fecha_publicacion, c.created_at) desc limit 12) x), '[]'::jsonb)
  )
$$;
revoke execute on function public.web_contenido() from public;
grant execute on function public.web_contenido() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Bolsa de Empleo
create table if not exists public.bolsa_cvs (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  telefono text,
  localidad text,
  area text,                 -- Administración, Ventas y Comercial, Industria y Producción, Tecnología y Sistemas…
  tipo_profesional text,     -- Estudiante / Junior, Técnico Especialista, Profesional Senior, Oficios / Operativo
  comentarios text,
  archivo_path text,
  archivo_nombre text,
  archivo_tamano text,
  -- nuevo: recién llegado · aprobado: lo ven los socios en el Portal · contactado · archivado
  estado text not null default 'nuevo' check (estado in ('nuevo', 'aprobado', 'contactado', 'archivado')),
  notas text,
  origen text not null default 'web',
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bolsa_cvs_estado_idx on public.bolsa_cvs(estado, created_at desc);

create table if not exists public.bolsa_interes (
  cv_id uuid not null references public.bolsa_cvs(id) on delete cascade,
  socio_id uuid not null references public.socios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cv_id, socio_id)
);

alter table public.bolsa_cvs enable row level security;
alter table public.bolsa_interes enable row level security;

-- El personal ve todo; los socios, solo los CV aprobados
drop policy if exists bolsa_select on public.bolsa_cvs;
create policy bolsa_select on public.bolsa_cvs for select to authenticated
  using (is_staff() or (estado = 'aprobado' and my_socio_id() is not null));
drop policy if exists bolsa_update on public.bolsa_cvs;
create policy bolsa_update on public.bolsa_cvs for update to authenticated
  using (has_role(array['atencion', 'prensa'])) with check (has_role(array['atencion', 'prensa']));
drop policy if exists bolsa_delete on public.bolsa_cvs;
create policy bolsa_delete on public.bolsa_cvs for delete to authenticated using (has_role(array['atencion']));

drop policy if exists bolsa_int_select on public.bolsa_interes;
create policy bolsa_int_select on public.bolsa_interes for select to authenticated
  using (is_staff() or socio_id = my_socio_id());
drop policy if exists bolsa_int_insert on public.bolsa_interes;
create policy bolsa_int_insert on public.bolsa_interes for insert to authenticated
  with check (socio_id = my_socio_id() and exists (select 1 from bolsa_cvs c where c.id = cv_id and c.estado = 'aprobado'));
drop policy if exists bolsa_int_delete on public.bolsa_interes;
create policy bolsa_int_delete on public.bolsa_interes for delete to authenticated using (socio_id = my_socio_id());

-- Postulación desde la web (sin sesión). El archivo ya tiene que estar subido a "bolsa-cvs/web/…".
create or replace function public.web_postular_cv(
  p_nombre text, p_email text, p_telefono text, p_area text, p_tipo_profesional text,
  p_comentarios text default null, p_localidad text default null,
  p_archivo_path text default null, p_archivo_nombre text default null, p_archivo_tamano text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_email), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Completá nombre, email y teléfono.';
  end if;
  if trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El email no es válido.';
  end if;
  if p_archivo_path is null or p_archivo_path !~ '^web/' then
    raise exception 'Adjuntá tu currículum (PDF o Word).';
  end if;
  -- límites contra envíos automáticos
  if (select count(*) from bolsa_cvs where lower(email) = lower(trim(p_email)) and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Ya recibimos tu currículum hoy. ¡Gracias!';
  end if;
  if (select count(*) from bolsa_cvs where created_at > now() - interval '1 day') >= 300 then
    raise exception 'No pudimos recibir tu currículum en este momento. Probá más tarde.';
  end if;
  insert into bolsa_cvs (nombre, email, telefono, area, tipo_profesional, comentarios, localidad, archivo_path, archivo_nombre, archivo_tamano)
  values (left(trim(p_nombre), 120), left(lower(trim(p_email)), 160), left(trim(p_telefono), 40), left(p_area, 80), left(p_tipo_profesional, 80),
          left(p_comentarios, 2000), left(p_localidad, 80), left(p_archivo_path, 300), left(p_archivo_nombre, 200), left(p_archivo_tamano, 20))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.web_postular_cv(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.web_postular_cv(text, text, text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

-- Archivos de los CV: bucket privado. La web solo puede SUBIR (no listar ni leer) dentro de "web/";
-- los lee el personal y, si el CV está aprobado, los socios.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    begin
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('bolsa-cvs', 'bolsa-cvs', false, 5242880, array[
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
      on conflict (id) do nothing;
      execute 'drop policy if exists bolsa_cvs_subida on storage.objects';
      execute 'drop policy if exists bolsa_cvs_lectura on storage.objects';
      execute 'drop policy if exists bolsa_cvs_borrado on storage.objects';
      execute $q$
        create policy bolsa_cvs_borrado on storage.objects for delete to authenticated
        using (bucket_id = 'bolsa-cvs' and public.has_role(array['atencion'])) $q$;
      execute $q$
        create policy bolsa_cvs_subida on storage.objects for insert to anon, authenticated
        with check (bucket_id = 'bolsa-cvs' and name like 'web/%') $q$;
      execute $q$
        create policy bolsa_cvs_lectura on storage.objects for select to authenticated
        using (bucket_id = 'bolsa-cvs' and (public.is_staff() or (public.my_socio_id() is not null and exists (
          select 1 from public.bolsa_cvs c where c.archivo_path = name and c.estado = 'aprobado')))) $q$;
    exception when insufficient_privilege then
      raise notice 'No se pudo crear el almacenamiento "bolsa-cvs": crealo en Storage (privado, 5 MB, PDF/Word).';
    end;
  end if;
end $$;

select 'web y bolsa' as control,
  to_regclass('public.bolsa_cvs') is not null as bolsa,
  to_regprocedure('public.web_contenido()') is not null as contenido_web;
