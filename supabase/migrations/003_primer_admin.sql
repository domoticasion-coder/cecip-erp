-- =============================================================================
-- Crear el PRIMER administrador del ERP (ejecutar una sola vez).
--
-- 1) En Supabase > Authentication > Users > "Add user" > "Create new user":
--    cargá el email y una contraseña, y marcá "Auto Confirm User".
-- 2) Reemplazá el email y el nombre de abajo y ejecutá este script en el SQL Editor.
--
-- El resto del personal se invita desde el ERP: Configuración > Personal > Invitar.
-- =============================================================================

insert into public.staff (user_id, nombre, email, rol)
select id, 'NOMBRE Y APELLIDO', email, 'admin'
from auth.users
where email = 'tu-email@centrocomercialparana.com.ar'
on conflict (user_id) do update set rol = 'admin', activo = true;
