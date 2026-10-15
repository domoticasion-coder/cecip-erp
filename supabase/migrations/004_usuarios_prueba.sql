-- =============================================================================
-- USUARIOS DE PRUEBA (los mismos de la demo) — OPCIONAL
--
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 001_esquema.sql y 002_padron_inicial.sql.
--
-- ⚠️  IMPORTANTE
--  - Cambiá la contraseña de abajo (v_password). Cualquiera que la conozca entra como
--    Administrador al ERP real.
--  - Usalos solo para probar y BORRALOS antes de abrir el sistema al personal y a los socios
--    (al final de este archivo está el bloque para eliminarlos).
--  - Se puede ejecutar más de una vez: si un usuario ya existe, no lo duplica.
-- =============================================================================

do $$
declare
  v_password text := 'CAMBIAR-esta-clave-2026';   -- <<< poné acá tu contraseña de prueba
  v_id uuid;
  r record;
begin
  -- 1) Personal del ERP (un usuario por rol)
  for r in
    select * from (values
      ('admin@cecip.demo',     'Carla Gómez (prueba)',     'admin'),
      ('tesoreria@cecip.demo', 'Esteban Peralta (prueba)', 'tesoreria'),
      ('atencion@cecip.demo',  'Clara Viggiano (prueba)',  'atencion'),
      ('comercia@cecip.demo',  'Equipo ComercIA (prueba)', 'comercia')
    ) as t(email, nombre, rol)
  loop
    select id into v_id from auth.users where email = r.email;
    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', r.email,
        extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', r.nombre), now(), now(),
        '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_id, v_id::text,
              jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true),
              'email', now(), now(), now());
    end if;

    insert into public.staff (user_id, nombre, email, rol)
    values (v_id, r.nombre, r.email, r.rol)
    on conflict (user_id) do update set rol = excluded.rol, activo = true;
  end loop;

  -- 2) Socio de prueba para el portal: queda vinculado a "25 DE JUNIO S.A" (socio N° 1960)
  update public.socios set cuit = '30-71234567-1'
  where numero_socio = 1960 and cuit is null
    and not exists (select 1 from public.socios where cuit = '30-71234567-1');

  select id into v_id from auth.users where email = 'socio@cecip.demo';
  if v_id is null then
    v_id := gen_random_uuid();
    -- La metadata tipo=socio + CUIT hace que el sistema cree la solicitud de acceso y la vincule al socio
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', 'socio@cecip.demo',
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"tipo":"socio","nombre":"Juan Pérez (prueba)","cuit":"30-71234567-1","razon_social":"25 de Junio S.A.","telefono":"343 431-4448"}',
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
            jsonb_build_object('sub', v_id::text, 'email', 'socio@cecip.demo', 'email_verified', true),
            'email', now(), now(), now());
  end if;

  -- Acceso al portal aprobado
  update public.socio_usuarios
  set estado = 'aprobado', aprobado_at = now(),
      socio_id = coalesce(socio_id, (select id from public.socios where numero_socio = 1960))
  where user_id = v_id;

  raise notice 'Usuarios de prueba listos. Recordá borrarlos antes de usar el sistema en serio.';
end $$;

-- Verificación: debería listar 5 usuarios
select u.email, coalesce(s.rol, 'socio (' || su.estado || ')') as tipo
from auth.users u
left join public.staff s on s.user_id = u.id
left join public.socio_usuarios su on su.user_id = u.id
where u.email like '%@cecip.demo'
order by 1;


-- =============================================================================
-- PARA BORRAR LOS USUARIOS DE PRUEBA (descomentá y ejecutá cuando termines de probar)
-- Se borran sus filas de personal, su acceso al portal y sus conversaciones con el Copiloto.
-- =============================================================================
-- delete from auth.users where email like '%@cecip.demo';
