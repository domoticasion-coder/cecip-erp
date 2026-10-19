-- =============================================================================
-- CeCIP · Actualización 009: COPILOTO CeCIP EN EL ERP
-- El personal chatea con la IA (Gemini) sobre la gestión: socios, deudas, cobranza,
-- tesorería, facturación, alquileres, eventos, capacitaciones, docentes y ComercIA.
-- La IA recibe solo lo que el rol de quien pregunta puede ver.
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 008. Se puede volver a ejecutar.
-- =============================================================================

-- Las conversaciones del ERP se guardan aparte de las del portal
alter table public.copiloto_chats add column if not exists ambito text not null default 'portal'
  check (ambito in ('portal', 'erp'));
create index if not exists copiloto_chats_ambito_idx on public.copiloto_chats(user_id, ambito, updated_at desc);

-- Datos que recibe el Copiloto del ERP. p_rol = rol de quien pregunta (lo pasa el servidor,
-- después de validar la sesión); p_busqueda = la pregunta, para traer el detalle de los
-- socios que se mencionen. Solo la puede ejecutar el servidor (service role).
create or replace function public.datos_copiloto_erp(p_rol text, p_busqueda text default '')
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_interno boolean := p_rol in ('admin', 'tesoreria', 'atencion');
  v_finanzas boolean := p_rol in ('admin', 'tesoreria');
  v_mes date := date_trunc('month', current_date)::date;
  v_tokens text[];
  v_num int;
  r json;
begin
  if p_rol not in ('admin', 'tesoreria', 'atencion', 'comercia') then
    raise exception 'Rol inválido.';
  end if;

  -- Palabras de la pregunta para buscar socios (de 4 letras o más) y números de socio
  select coalesce(array_agg(distinct w), '{}') into v_tokens
  from regexp_split_to_table(lower(coalesce(p_busqueda, '')), '[^a-záéíóúñü0-9]+') as w
  where length(w) >= 4 and w not in ('cuanto', 'cuánto', 'debe', 'deuda', 'socio', 'socios', 'cuota', 'cuotas', 'tiene', 'esta',
    'está', 'como', 'cómo', 'para', 'sobre', 'quien', 'quién', 'cuales', 'cuáles', 'datos', 'pago', 'pagos', 'pagó', 'empresa',
    'comercio', 'informacion', 'información', 'decime', 'dame', 'mostrame', 'listado', 'lista', 'todos', 'todas', 'mes', 'meses',
    'capacitacion', 'capacitación', 'curso', 'cursos', 'evento', 'eventos', 'factura', 'facturas', 'alquiler', 'alquileres', 'docente',
    'docentes', 'banco', 'hacer', 'puedo', 'quiero', 'necesito', 'cuando', 'cuándo', 'donde', 'dónde', 'tengo', 'hay', 'cual', 'cuál');
  v_num := nullif(substring(coalesce(p_busqueda, '') from '(?:n°|nº|numero|número|socio)\s*(\d{1,5})'), '')::int;

  select json_build_object(
    'rol', p_rol,
    'conocimiento', (select coalesce(json_agg(json_build_object('titulo', titulo, 'contenido', contenido) order by orden), '[]') from conocimiento_cecip where activo),
    'cfg', (select row_to_json(c) from (select nombre_institucion, cuit, direccion, telefono, email, banco, titular, cbu, alias, interes_mensual,
            dia_vencimiento, recordatorios_auto, facturacion_auto, factura_condicion_emisor, factura_punto_venta, comercia_url_adhesion from configuracion where id = 1) c),
    -- ComercIA (todos los roles)
    'ofertas', (select coalesce(json_agg(o order by o.orden), '[]') from comercia_ofertas o where o.activa),
    'servicios', (select coalesce(json_agg(s order by s.orden), '[]') from iec_servicios s where s.activo),
    'cursos_iec', (select coalesce(json_agg(c order by c.orden), '[]') from iec_cursos c where c.activo),
    'promociones', (select coalesce(json_agg(p order by p.orden), '[]') from comercia_promociones p where p.activa and (p.vigente_hasta is null or p.vigente_hasta >= current_date)),
    'convenio', (select coalesce(json_agg(b order by b.orden), '[]') from comercia_convenio b where b.activo),
    'novedades', (select coalesce(json_agg(json_build_object('titulo', titulo, 'cuerpo', cuerpo) order by orden), '[]') from comercia_novedades where publicada),
    'solicitudes_comercia', (select coalesce(json_agg(x), '[]') from (
        select socio_nombre, servicio, estado, presupuesto_estimado, contacto_nombre, created_at::date as fecha
        from comercia_solicitudes order by created_at desc limit 25) x),

    -- Datos internos del CeCIP (no los recibe el equipo externo de ComercIA)
    'resumen', case when v_interno then resumen_dashboard() end,
    'categorias', case when v_interno then (select coalesce(json_agg(x order by x.orden), '[]') from (
        select c.nombre, c.cuota_mensual, c.orden, count(s.id) filter (where s.estado = 'activo') as socios_activos
        from categorias c left join socios s on s.categoria_id = c.id group by c.id) x) end,
    'periodicidades', case when v_interno then (select coalesce(json_agg(p order by p.orden), '[]') from periodicidades p) end,
    'socios_por_estado', case when v_interno then (select json_object_agg(estado, n) from (select estado, count(*) n from socios group by estado) x) end,
    'socios_por_pago', case when v_interno then (select json_object_agg(periodicidad, n) from (select periodicidad, count(*) n from socios where estado = 'activo' group by periodicidad) x) end,
    'seguimiento', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select seguimiento, count(*) as n, string_agg(coalesce(nombre_comercial, razon_social), ', ' order by razon_social) as socios
        from socios where seguimiento is not null and estado <> 'baja' group by seguimiento) x) end,
    'morosos', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select coalesce(nombre_comercial, razon_social) as socio, numero_socio, deuda, cuotas_vencidas, max_dias_atraso,
               coalesce(whatsapp, telefono) as telefono, email
        from socios_resumen where estado = 'activo' and cuotas_vencidas > 0 order by deuda desc limit 30) x) end,
    'socios_mencionados', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select s.numero_socio, s.razon_social, s.nombre_comercial, s.cuit, s.condicion_iva, s.rubro, s.estado, s.seguimiento,
               s.categoria_nombre, s.periodicidad_nombre, s.cuota_periodo, s.deuda, s.cuotas_vencidas, s.contacto_nombre, s.email,
               coalesce(s.whatsapp, s.telefono) as telefono, s.direccion, s.fecha_alta, s.observaciones,
               (select coalesce(json_agg(json_build_object('concepto', c.concepto, 'vence', c.vencimiento, 'total', c.total, 'situacion', c.situacion) order by c.vencimiento), '[]')
                from cuotas_detalle c where c.socio_id = s.id and c.estado = 'pendiente') as pendientes,
               (select json_build_object('concepto', c.concepto, 'fecha', c.fecha_pago, 'monto', c.monto_pagado, 'metodo', c.metodo_pago)
                from cuotas c where c.socio_id = s.id and c.estado = 'pagada' order by c.fecha_pago desc nulls last limit 1) as ultimo_pago
        from socios_resumen s
        where (v_num is not null and s.numero_socio = v_num)
           or exists (select 1 from unnest(v_tokens) t
                      where lower(s.razon_social) like '%' || t || '%' or lower(coalesce(s.nombre_comercial, '')) like '%' || t || '%'
                         or solo_digitos(s.cuit) = solo_digitos(t) and length(solo_digitos(t)) = 11)
        order by s.estado, s.razon_social limit 6) x) end,
    'cuotas_mes', case when v_interno then (select json_build_object(
        'emitidas', count(*), 'pagadas', count(*) filter (where estado = 'pagada'),
        'importe', coalesce(sum(monto), 0), 'cobrado', coalesce(sum(monto_pagado) filter (where estado = 'pagada'), 0))
        from cuotas where estado <> 'anulada' and v_mes between coalesce(periodo, date_trunc('month', vencimiento)::date)
                                                            and coalesce(periodo_hasta, periodo, date_trunc('month', vencimiento)::date)) end,
    'eventos', case when v_interno then (select coalesce(json_agg(x order by x.fecha_inicio), '[]') from (
        select e.titulo, e.tipo, e.fecha_inicio, e.fecha_fin, e.lugar, e.modalidad, e.costo, e.precio_no_socio, e.cupo, e.publicado,
               e.inscripcion_abierta, e.formulario_publico, e.cancelado, e.dias_semana, e.hora_inicio, e.hora_fin, e.cantidad_clases,
               d.nombre as docente, (select count(*) from inscripciones i where i.evento_id = e.id) as inscriptos,
               r.recaudado, r.a_cobrar,
               case when v_finanzas then r.honorario_previsto end as honorario_previsto,
               case when v_finanzas then r.pagado_docente end as pagado_docente
        from eventos e left join docentes d on d.id = e.docente_id left join capacitaciones_resumen r on r.id = e.id
        where coalesce(e.fecha_fin, e.fecha_inicio) >= now() - interval '30 days' order by e.fecha_inicio limit 20) x) end,
    'docentes', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select d.nombre, d.especialidad, d.email, d.telefono, d.activo,
               case when v_finanzas then (select coalesce(sum(p.monto), 0) from docente_pagos p where p.docente_id = d.id) end as total_pagado
        from docentes d order by d.nombre) x) end,
    'pagos_docentes', case when v_finanzas then (select coalesce(json_agg(x), '[]') from (
        select p.fecha, d.nombre as docente, p.concepto, p.monto, p.metodo_pago
        from docente_pagos p join docentes d on d.id = p.docente_id order by p.fecha desc limit 15) x) end,
    'alquileres', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select i.nombre as inmueble, i.direccion, k.inquilino_nombre, k.monto_mensual, k.dia_vencimiento, k.fecha_fin, k.ajuste_indice,
               k.proximo_ajuste, coalesce(k.inquilino_telefono, k.inquilino_email) as contacto,
               (select coalesce(sum(c.monto), 0) from alquiler_cargos c where c.contrato_id = k.id and c.estado = 'pendiente') as adeudado,
               (select count(*) from alquiler_cargos c where c.contrato_id = k.id and c.estado = 'pendiente' and c.vencimiento < current_date) as vencidos
        from inmuebles i left join alquiler_contratos k on k.inmueble_id = i.id and k.estado = 'vigente'
          and coalesce(to_jsonb(k) ->> 'modalidad', 'mensual') = 'mensual'
        order by i.orden) x) end,
    -- Reservas temporales de salones (to_jsonb: funciona aunque todavía no se haya ejecutado la 010)
    'reservas', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select i.nombre as inmueble, k.inquilino_nombre as cliente, k.fecha_inicio as desde, k.fecha_fin as hasta,
               to_jsonb(k) ->> 'hora_inicio' as hora_inicio, to_jsonb(k) ->> 'hora_fin' as hora_fin, to_jsonb(k) ->> 'motivo' as motivo,
               to_jsonb(k) ->> 'personas' as personas, k.monto_mensual as precio, coalesce(k.inquilino_telefono, k.inquilino_email) as contacto,
               (select coalesce(sum(c.monto), 0) from alquiler_cargos c where c.contrato_id = k.id and c.estado = 'pendiente') as pendiente
        from alquiler_contratos k join inmuebles i on i.id = k.inmueble_id
        where to_jsonb(k) ->> 'modalidad' = 'temporal' and k.estado = 'vigente'
          and coalesce(k.fecha_fin, k.fecha_inicio) >= current_date - 7
        order by k.fecha_inicio limit 30) x) end,
    'facturas', case when v_interno then (select json_build_object(
        'por_estado', (select json_object_agg(estado, n) from (select estado, count(*) n from facturas group by estado) x),
        'emitidas_mes', (select coalesce(sum(total), 0) from facturas where estado = 'emitida' and fecha >= v_mes),
        'con_error', (select coalesce(json_agg(json_build_object('receptor', receptor_nombre, 'concepto', concepto, 'error', error)), '[]')
                      from (select * from facturas where estado = 'error' order by created_at desc limit 5) f))) end,
    'tesoreria', case when v_finanzas then (select json_build_object(
        'saldos', (select coalesce(json_agg(json_build_object('cuenta', nombre, 'saldo', saldo)), '[]') from saldos_cuentas where activa),
        'mes', (select coalesce(json_agg(x), '[]') from (
            select tipo, categoria, sum(monto) as total from movimientos where fecha >= v_mes group by tipo, categoria order by tipo, total desc) x),
        'banco_sin_conciliar', (select json_build_object('cantidad', count(*), 'creditos', coalesce(sum(monto) filter (where monto > 0), 0),
                                                         'debitos', coalesce(sum(monto) filter (where monto < 0), 0))
                                from banco_movimientos where estado = 'nuevo'))) end,
    'comunicados', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select titulo, publicado, coalesce(fecha_publicacion, created_at)::date as fecha, left(cuerpo, 300) as cuerpo
        from comunicados order by created_at desc limit 6) x) end,
    'accesos_pendientes', case when v_interno then (select coalesce(json_agg(x), '[]') from (
        select nombre, email, razon_social_declarada, cuit_declarado, created_at::date as fecha from socio_usuarios where estado = 'pendiente' limit 10) x) end,
    'personal', case when v_interno then (select coalesce(json_agg(json_build_object('nombre', nombre, 'rol', rol)), '[]') from staff where activo) end
  ) into r;
  return r;
end $$;

revoke execute on function public.datos_copiloto_erp(text, text) from public, anon, authenticated;
grant execute on function public.datos_copiloto_erp(text, text) to service_role;

select 'copiloto ERP' as control, case when exists (select 1 from pg_proc where proname = 'datos_copiloto_erp') then 'ok' else 'FALTA' end as estado;
