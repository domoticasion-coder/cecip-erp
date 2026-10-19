-- 012: Roles del personal (Administración, Prensa y capacitación, Presidente, Prosecretario,
-- Comisión directiva). Ver shared/roles.ts: los permisos de acá tienen que coincidir.
-- Re-ejecutable.

-- 1) Roles válidos
alter table public.staff drop constraint if exists staff_rol_check;
alter table public.staff add constraint staff_rol_check check (rol in (
  'admin', 'administracion', 'prensa', 'presidente', 'prosecretario', 'comision',
  'tesoreria', 'atencion', 'comercia'
));

-- 2) Qué grupos de permisos (de modificación) tiene cada rol.
--    Presidente y Comisión directiva no tienen ninguno: consultan sin modificar.
create or replace function public.permisos_rol(p_rol text) returns text[]
language sql immutable set search_path = public as $$
  select case p_rol
    when 'admin'          then array['tesoreria', 'atencion', 'prensa', 'comercia']
    when 'administracion' then array['tesoreria', 'atencion', 'prensa']
    when 'prensa'         then array['prensa']
    when 'prosecretario'  then array['atencion', 'prensa']
    when 'tesoreria'      then array['tesoreria']
    when 'atencion'       then array['atencion', 'prensa']
    when 'comercia'       then array['comercia']
    else array[]::text[]
  end
$$;

-- has_role(['tesoreria']) ahora significa "tiene el permiso tesoreria" (por su rol)
create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff
    where user_id = auth.uid() and activo
      and (rol = 'admin' or rol = any(roles) or permisos_rol(rol) && roles)
  )
$$;

-- Personal interno que puede modificar datos (excluye a los roles de solo consulta y a ComercIA)
create or replace function public.puede_editar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff
    where user_id = auth.uid() and activo and rol not in ('presidente', 'comision', 'comercia')
  )
$$;

-- 3) Escrituras que antes alcanzaba con "ser personal": ahora piden poder editar
drop policy if exists notas_insert on public.socio_notas;
create policy notas_insert on public.socio_notas for insert to authenticated with check (puede_editar());

drop policy if exists envios_insert on public.envios;
create policy envios_insert on public.envios for insert to authenticated
  with check (puede_editar() or (has_role(array['comercia']) and tipo = 'comercia'));

drop policy if exists ins_insert on public.inscripciones;
create policy ins_insert on public.inscripciones for insert to authenticated
  with check (
    puede_editar() or (
      socio_id = my_socio_id() and exists (
        select 1 from eventos e where e.id = evento_id and e.publicado and e.inscripcion_abierta and e.fecha_inicio > now()
      )
    )
  );
drop policy if exists ins_update on public.inscripciones;
create policy ins_update on public.inscripciones for update to authenticated
  using (puede_editar()) with check (puede_editar());
drop policy if exists ins_delete on public.inscripciones;
create policy ins_delete on public.inscripciones for delete to authenticated
  using (puede_editar() or socio_id = my_socio_id());

-- 4) Prensa y capacitación: comunicados, eventos, docentes, WhatsApp, contenido y cola de emails
drop policy if exists com_write on public.comunicados;
create policy com_write on public.comunicados for all to authenticated
  using (has_role(array['atencion', 'prensa'])) with check (has_role(array['atencion', 'prensa']));

drop policy if exists ev_write on public.eventos;
create policy ev_write on public.eventos for all to authenticated
  using (has_role(array['atencion', 'prensa'])) with check (has_role(array['atencion', 'prensa']));

drop policy if exists docentes_write on public.docentes;
create policy docentes_write on public.docentes for all to authenticated
  using (has_role(array['atencion', 'tesoreria', 'prensa'])) with check (has_role(array['atencion', 'tesoreria', 'prensa']));

drop policy if exists conoc_write on public.conocimiento_cecip;
create policy conoc_write on public.conocimiento_cecip for all to authenticated
  using (has_role(array['atencion', 'prensa'])) with check (has_role(array['atencion', 'prensa']));

drop policy if exists wa_camp_write on public.wa_campanas;
create policy wa_camp_write on public.wa_campanas for all to authenticated
  using ((has_role(array['atencion', 'tesoreria', 'prensa']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'))
  with check ((has_role(array['atencion', 'tesoreria', 'prensa']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'));

drop policy if exists wa_msg_write on public.wa_mensajes;
create policy wa_msg_write on public.wa_mensajes for all to authenticated
  using ((has_role(array['atencion', 'tesoreria', 'prensa']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'))
  with check ((has_role(array['atencion', 'tesoreria', 'prensa']) and origen = 'cecip') or (has_role(array['comercia']) and origen = 'comercia'));

drop policy if exists email_cola_select on public.email_cola;
create policy email_cola_select on public.email_cola for select to authenticated
  using (has_role(array['atencion', 'tesoreria', 'prensa']));

-- 5) Imágenes: suben y borran quienes pueden editar (y ComercIA)
do $$
begin
  if to_regclass('storage.objects') is not null then
    begin
      execute 'drop policy if exists imagenes_subida on storage.objects';
      execute 'drop policy if exists imagenes_borrado on storage.objects';
      execute $q$
        create policy imagenes_subida on storage.objects for insert to authenticated
        with check (bucket_id = 'imagenes' and (public.puede_editar() or public.has_role(array['comercia']))) $q$;
      execute $q$
        create policy imagenes_borrado on storage.objects for delete to authenticated
        using (bucket_id = 'imagenes' and (public.puede_editar() or public.has_role(array['comercia']))) $q$;
    exception when insufficient_privilege then
      raise notice 'No se pudieron actualizar los permisos del bucket "imagenes" (quedan los anteriores).';
    end;
  end if;
end $$;
