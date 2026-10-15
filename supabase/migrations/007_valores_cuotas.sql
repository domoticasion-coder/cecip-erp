-- =============================================================================
-- VALORES DE LAS CUOTAS (los mismos de la demo)
--
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 005 y ANTES de 006 (o volver a ejecutar
-- el 006 después de este, para que se creen las cuotas de BANCOS y S).
--
-- Valor MENSUAL por categoría. AA, A, B, C y JE/ME salen de la planilla 2026.
-- ⚠️ BANCOS y S NO figuran en la planilla: 20.000 y 3.000 son los valores de ejemplo de la
--    demo. Cambialos acá (o después en ERP > Configuración) por los reales.
-- =============================================================================

update public.categorias c set cuota_mensual = v.mensual, orden = v.orden
from (values
  ('BANCOS', 20000, 1),   -- ⚠️ valor de ejemplo
  ('AA',     10000, 2),
  ('A',       8000, 3),
  ('B',       6000, 4),
  ('C',       5000, 5),
  ('S',       3000, 6),   -- ⚠️ valor de ejemplo
  ('JE/ME',   4000, 7)
) as v(nombre, mensual, orden)
where c.nombre = v.nombre;

-- Descuento por forma de pago (% sobre el valor mensual), como en la planilla
update public.periodicidades p set descuento = v.descuento
from (values ('mensual', 0), ('bimestral', 0), ('trimestral', 3), ('semestral', 6), ('anual', 12)) as v(codigo, descuento)
where p.codigo = v.codigo;

-- Resultado: valor de la cuota de cada categoría según la forma de pago
select c.nombre as categoria, c.cuota_mensual as mensual,
       public.importe_cuota(c.cuota_mensual, 2, (select descuento from public.periodicidades where codigo = 'bimestral')) as bimestral,
       public.importe_cuota(c.cuota_mensual, 3, (select descuento from public.periodicidades where codigo = 'trimestral')) as trimestral,
       public.importe_cuota(c.cuota_mensual, 6, (select descuento from public.periodicidades where codigo = 'semestral')) as semestral,
       public.importe_cuota(c.cuota_mensual, 12, (select descuento from public.periodicidades where codigo = 'anual')) as anual
from public.categorias c
order by c.orden;
