-- 016: Conocimiento institucional sobre feriados y días no laborables (lo usan el Copiloto del
-- ERP, el del Portal y los asistentes de WhatsApp). Se edita desde ERP → Contenido del portal.
-- Re-ejecutable: no duplica si ya existe una sección con el mismo título.

insert into public.conocimiento_cecip (titulo, contenido, activo, orden)
select 'Feriados y días no laborables para el comercio',
$txt$FERIADO NACIONAL
- El comercio puede abrir sus puertas.
- Remuneración: se paga el día normal más un recargo del 100% (pago doble).
- Sujeto al convenio colectivo de cada actividad.

DÍA NO LABORABLE
- El empleador decide si se trabaja o no.
- Remuneración: se paga como un día normal (salario simple), independientemente de si el local abre o permanece cerrado.

FERIADOS PROVINCIALES Y LOCALES
- La norma establece expresamente que su cumplimiento es optativo para el comercio y la industria.
- Por lo tanto, los comercios pueden desarrollar su actividad con normalidad, quedando a criterio de cada establecimiento adherir o no a la jornada.

Para casos puntuales (horas extra, convenios particulares, liquidación de sueldos) conviene consultar al contador o al sindicato de la actividad.$txt$,
true,
coalesce((select max(orden) + 1 from public.conocimiento_cecip), 1)
where not exists (select 1 from public.conocimiento_cecip where titulo = 'Feriados y días no laborables para el comercio');

select 'conocimiento feriados' as control, count(*) as secciones from public.conocimiento_cecip where titulo = 'Feriados y días no laborables para el comercio';
