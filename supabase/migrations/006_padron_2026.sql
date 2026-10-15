-- =============================================================================
-- PADRÓN 2026 · importado del Excel "2026 Registro de Asociados" (hoja "Listado Socio 2026")
--
-- Ejecutar en Supabase > SQL Editor DESPUÉS de 005_cobros_alquileres_facturacion.sql.
--
-- Qué hace:
--  - Actualiza los socios del padrón (por N° de socio) con los datos del Excel: razón social,
--    rubro, emails, domicilio, CUIT, condición IVA, forma de pago (periodicidad) y categoría.
--    Si la razón social cambió, el nombre anterior queda como "nombre comercial".
--  - Agrega los socios del Excel que no estaban en el padrón.
--  - Filas en ROJO del Excel = "dados de baja" -> estado Baja.
--    Amarillo = posible baja, rosa = deuda reciente, verde = deuda condonada,
--    celeste = cobranza por el CeCIP -> quedan como marca de seguimiento.
--  - Crea las cuotas sociales 2026 según los meses: P = pagada, F = adeuda (pendiente).
--    Los meses en blanco no generan cuota (se generan desde el ERP con "Generar cuotas").
--    Las cuotas pagadas del Excel NO generan movimientos en Tesorería (ya estaban contabilizadas).
--  - La columna "DEL 2025" (si tiene importe) se carga como saldo adeudado 2025.
--  - Las columnas Adelanto, Del 2026, Deuda y Aclaración quedan en las observaciones del socio.
--
-- IMPORTANTE: los importes salen de los valores de cada categoría (ERP > Configuración).
-- BANCOS y S están en $0: a esos socios no se les crean cuotas hasta que les cargues el valor.
-- Se puede volver a ejecutar (por ejemplo después de cargar esos valores): rehace las cuotas
-- importadas sin tocar las que ya se cobraron desde el ERP.
-- =============================================================================

drop table if exists pg_temp.imp_socios;
create temp table imp_socios (
  fila int, numero int, numero_padron int, razon text, rubro text, email text, emails_extra text,
  domicilio text, cuit text, iva text, periodicidad text, categoria text, estado text,
  seguimiento text, meses text, deuda_2025 numeric, notas text, socio_id uuid
);

insert into imp_socios (fila, numero, numero_padron, razon, rubro, email, emails_extra, domicilio, cuit, iva,
                        periodicidad, categoria, estado, seguimiento, meses, deuda_2025, notas) values
(3, 2001, 2001, 'CAMARA DE ESTACION DE COMBUSTIBLE', null, 'cecaer@cecaer.com.ar', null, 'GUALEGUAYCHU 544', '30-70965424-8', 'Exento', 'anual', 'AA', 'activo', null, 'FFFFFFFFFFFF', null, null),
(4, 22, 22, 'CALZADOS BETER', 'ZAPATERIA', 'info@calzadosbeter.com.ar', null, 'SAN MARTIN 1124', '30-53038351-9', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(5, 29, null, 'NUEVO BANCO DE E. RIOS S.A.', 'BANCARIO Y/O FINANCIERA', null, null, 'MONTE CASEROS 128', '33-70799551-9', 'RI', 'mensual', 'BANCOS', 'activo', null, 'PPPPPPPFF---', 8100, null),
(6, 80, 80, 'CERINI Y PACHER S.A.', 'DISTRIBUCION MATORISTA COMESTIBLE', 'andres_cerini@hotmail.com', null, 'SEGUI 810', '30-53439765-4', 'RI', 'bimestral', 'C', 'activo', null, 'FFFFFFFF----', 4000, null),
(7, 100, 100, 'DEL MESTRE IND. Y COM. S.R.L.', 'TEXTIL Y CORTINADOS', 'ventas@casadelmestre.com.ar', 'daniel.delmestre@casadelmestre.com.ar', '25 DE JUNIO 20/22', '30-50349779-0', 'RI', 'bimestral', 'B', 'activo', null, 'PPFFFFFF----', null, null),
(8, 163, 163, 'HAIMOVICH HNOS. Y CIA. SRL', null, 'gerencia@haimovich.com.ar', 'florencia.tinta@haimovich.com.ar, mauro.bertozzi@haimovich.com.ar', 'GUALEGUAYCHU 540', '30-52760800-3', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(9, 206, 206, 'OPTICA MORELLI S.R.L.', 'ÓPTICAS', 'opticamorelli@gmail.com', null, '25 DE JUNIO 28', '30-71297610-8', 'RI', 'bimestral', 'B', 'activo', null, 'PPFFFFFF----', null, null),
(10, 385, null, 'VALENTINUZ HNOS. S.A.', 'RESPUESTO AUTOMOTOR', 'administracion@valentinuzhnos.com', null, 'ALMAFUERTE 749 (ESQU.R.GODOY)', '30-54027424-6', 'RI', 'bimestral', 'B', 'baja', null, 'FFFFFF------', null, 'Adelanto 2025: 3600 · Aclaración: A FAVOR 2025 $3600'),
(11, 398, 398, 'CLINICA MODELO', 'SANATORIO', null, null, 'SAN MARTIN 1238', '30-54585993-5', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPPPP----', null, null),
(12, 417, null, 'PERSEO S.R.L.', 'SASTRERIA', 'benintende1942@gmail.com', null, 'SAN MARTIN 718', '30-70800408-8', 'RI', 'trimestral', 'B', 'activo', null, 'PPPPPPPPP---', null, null),
(13, 472, 472, 'SAN CRISTOBAL CAJ.MUT(SMSG)', 'SEGUROS', 'albatenque@hotmail.com', null, 'BELGRANO Y GUALEGUAYCHU 305', '34-50004533-9', 'RI', 'anual', 'A', 'activo', null, 'FFFFFFFFFFFF', null, null),
(14, 556, 556, 'EL EMPORIO DE LA LANA', 'TEXTILES LANAS', 'aliciavolpe@gigared.com', null, 'DEAN J. ALVAREZ 274', '27-03924353-4', 'RI', 'semestral', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(15, 688, 688, 'CHEZ LE SAC', 'INDUMENTARIA', 'oficinachezlesac@hotmail.com', null, 'SAN MARTIN 1097', '20-05945086-8', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPFFFF----', null, 'Adelanto 2025: 4000'),
(16, 717, 717, 'JOSE FOLMER E HIJOS S.A.', 'MAQUINARIA AGRICOLA', 'info@folmer.com.ar', null, null, '30-53934154-1', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPFFFF----', null, null),
(17, 722, 722, 'ARCO IRIS', 'MATERIALES ELECTRICOS', 'arcoirisparana@gmail.com', 'elarcoirisparana@gmail.com, arcoirissucursal@yahoo.com.ar', 'O´HIGGINS 795', '30-52072426-1', 'RI', 'semestral', 'B', 'activo', null, 'FFFFFFFFFFFF', null, null),
(18, 748, 748, 'EL RUTERO S. R. L.', null, 'elruteroypf@gmail.com', null, 'AV. DE LAS AMERICAS 3106', '30-53844370-7', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(19, 788, null, 'TRANSPORTE MARIANO MORENO', null, 'sbovier@ersaurbano.com', null, '3 DE FEBRERO 830', '33-54637496-9', 'RI', 'trimestral', 'A', 'baja', null, 'PP----------', 12416, 'Deuda: $ 2620 La cuota del 3 Trimestre estaba abonada en nov,23 ajustar en este año · Aclaración: PIDE BAJA'),
(20, 810, null, 'SABATE MARIA A.VERA DE', null, 'mspolietileno.ventas@yahoo.com', 'mspolietileno@yahoo.com', 'NOGOYA 465', '30-69050516-5', 'RI', 'anual', 'B', 'activo', null, 'FFFFFFFFFFFF', 22704, null),
(21, 839, 472, 'SAN CRISTOBAL CAJA MUTUAL', null, 'proveedores@sancristobalcaja.com.ar', null, 'GUALEGUAYCHU 305', '30-52162835-5', 'Exento', 'bimestral', 'A', 'activo', null, 'PPPPPPFF----', null, null),
(22, 891, 891, 'MODAS URBANAS S.A.', null, 'mysandytarj@gmail.com', 'administracion@mysandy.com.ar', 'URQUIZA 1062', '30-71879960-7', 'RI', 'bimestral', 'A', 'activo', null, 'FFPPFFFF----', null, null),
(23, 958, 958, 'PEDERZOLLI DANIEL ALBERTO UNIPERSONAL', null, 'casapeder@hotmail.com', null, 'ALMAFUERTE 1411/15', '20-14949917-3', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, 'Adelanto 2025: 0'),
(24, 986, 986, 'SELPLAST SA', null, 'administracion@selplast.com.ar', 'selplast@selplast.com.ar', 'ESPAÑA 187', '30-69050738-9', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(25, 1003, 1003, 'VENTURI HNOS. S.A.C.I.F.', null, 'admparana@venturi.com.ar', 'info@venturi.com.ar', 'ALMAFUERTE 577', '30-50420005-8', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, 'Del 2026: 3600 · Deuda: DEBE EL 5TO BIMESTRE'),
(26, 1104, 1104, 'LIBRERIA DEL ATENEO DE PARANA', null, 'libreriaateneoparana@gmail.com', null, 'BUENOS AIRES 32', '30-70806994-5', 'Exento', 'bimestral', 'C', 'activo', 'deuda_reciente', 'FFFFFFFF----', null, null),
(27, 1127, 1127, 'LA PERUANA S.R.L.', null, 'laperuanasrl@arnet.com.ar', null, 'RAMIREZ 2134', '30-69051717-1', 'RI', 'anual', 'A', 'activo', null, 'FFFFFFFFFFFF', 28512, null),
(28, 1195, 1195, 'LA BIANCA SRL', null, 'labianca@gamma.com.ar', 'lorena.fariaslb@gmail.com', 'DERQUI 564 ó ESPAÑA 401', '30-50591453-4', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(29, 1264, 1264, 'BENVENUTTO Y ZANNI S.R.L.', 'INMOBILIARIA', 'administracion@benvenutoyzanni.com.ar', null, 'URUGUAY 218', '30-55254698-5', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(30, 1343, 1343, 'BRONDI MAQUINARIAS S.R.L.', 'MAQUINARIA AGRICOLA', 'ventas@brondimaquinarias.com.ar', null, 'ALMAFUERTE 998', '30-54147843-0', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(31, 1353, 1353, 'BANCO DE LA NACIóN ARGENTINA', 'BANCARIO Y/O FINANCIERA', null, null, 'SAN MARTIN 1000', '30-50001091-2', 'RI', 'mensual', 'BANCOS', 'activo', null, 'PPPPPPPPF---', null, null),
(32, 1533, 1533, 'INST.AUTARQ.PROV.SEG.E.R.', null, 'spresidencia@institutoseguro.com.ar', 'compras@institutoseguro.com.ar', 'SAN MARTIN 918/56', '30-50005550-9', 'RI', 'bimestral', 'AA', 'activo', null, 'FFPPPPFF----', null, 'Del 2026: 10000'),
(33, 1726, 1726, 'Q'' BIEN (DAUNARAS ABEL VICTOR)', null, 'atrimer@yahoo.com.ar', null, 'SAN MARTIN 1083', '20-05954666-0', 'RI', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', 16632, null),
(34, 1767, 1767, 'LOMA NEGRA C.I.A.S.A.', null, 'jorge.rodriguez@lomanegra.com.ar', null, 'AV.AMERICAS 5296 Km 5', '30-50053085-1', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(35, 1913, 1913, 'MODERNA PARANA S.A.', null, 'gla836@gmail.com', 'obrassociales@modernaparana.com.ar', 'SAN MARTIN Y ALEM', '30-71000483-4', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(36, 1917, 1917, 'PAPELERIA EL CUYANO', null, 'pagos.elcuyano@hotmail.com', null, 'PELLEGRINI 387', '30-67118492-7', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(37, 1919, 1919, 'JOHNSON ACERO S.A.', null, 'info@johnsonacero.com', 'proveedores@johnsonacero.com', 'ALMAFUERTE 3658', '30-50199107-0', 'RI', 'anual', 'AA', 'activo', null, 'PPPPPPPPPPPP', null, null),
(38, 1927, 1980, 'LONGVIE S.A.', null, 'lmena@longvie.com.ar', 'gmuller@longvie.com.ar', 'CALLE 910 PQUE IND.', '30-50083378-1', 'RI', 'trimestral', 'AA', 'activo', null, 'PPPPPPPPP---', null, null),
(39, 1931, 1931, 'CERAMICOS PELLEGRINI SRL.', null, 'administracion@ceramicospellegrini.com.ar', null, 'ECHAGUE 735', '30-61519550-9', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(40, 1957, 1957, 'RIO URUGUAY COOP.SEG.LTDA', null, 'agenciaparque@segurosmarco.com.ar', null, 'GUALEGUAYCHU 599', '30-50006171-1', 'RI', 'bimestral', 'A', 'activo', 'posible_baja', 'FFFFFF------', 6000, null),
(41, 1960, 1960, 'EST.DE SERVICIO 25 DE JUNIO SA', null, '25dejunio@arnet.com.ar', null, '25 DE JUNIO 201', '30-56249677-3', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(42, 1975, 1975, 'ITA S.A.', null, 'acerositasa@acerositasa.com', null, 'A. SALELLAS 1391-PQE.IND', '30-61965810-4', 'RI', 'trimestral', 'A', 'activo', 'posible_baja', 'FFFFFF------', 8840, null),
(43, 1981, 1981, 'RIOMAT S.A. UNIMACO', null, 'gherlein@familiabercomat.com', 'egallinger@familiabercomat.com', 'ENRIQUE CARBO 540', '30-70899230-1', 'RI', 'trimestral', 'B', 'activo', null, 'PPPPPPPPP---', null, null),
(44, 2013, 2013, 'LIVE ROCK (EGE SA)', null, 'liverockparana@gmail.com', null, 'SAN MARTIN 1001', '30-70985860-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPPP----', null, null),
(45, 2019, 2019, 'CONSULTORIA COLL ARECO', null, 'patentes@collareco.com', null, 'ALSINA 971', '30-71066308-0', null, 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, 'Condición en el Excel: long'),
(46, 2045, 2045, 'EMPORIO DE LA MADERA SRL.', null, 'emporiosrl@arnetbiz.com.ar', null, null, '30-57830595-1', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(47, 2048, null, 'GRECA SA', null, 'danielgreca@yahoo.com.ar', null, 'PEDROBALCAR 52', '30-71716564-7', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, 'Adelanto 2025: 0'),
(48, 2071, 2071, 'MEDICAL S.R.L.', null, 'administracion@medicalsrl.com.ar', 'gerencia@medicalsrl.com.ar', 'BELGRANO 459', '30-70705232-1', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, 'Deuda: CANJE · N° en el Excel: Leyes Sociales - SUSS 06/2028'),
(49, 2075, 2075, 'ABERTURAS VALENTINUZ SA', 'METALURGICAS', 'agariboglio@valentinuz.com.ar', null, 'A. SALELLAS Y R. SAENZ', '30-68109455-1', 'RI', 'bimestral', 'A', 'activo', 'posible_baja', 'FFFF--------', 18000, null),
(50, 2087, 2087, 'PIEDRAS BLANCAS SA', null, 'yesopiedrasblancas@gmail.com', null, '3 DE FEBRERO 640', '33-70895695-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPFFFF----', null, null),
(51, 2088, 2088, 'GRAVAFILT SA', null, 'lsantiago@gravafilt.com.ar', 'info@gravafilt.com.ar', 'CAMINO DE STGO. ESQ.', '30-50674662-7', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FF----------', 25800, null),
(52, 2091, 2091, 'S Y S COMPUTACION', null, 'hector.machado@syscomputacion.com.ar', 'ventas@syscomputacion.com.ar', 'ITALIA 536', '30-70712810-7', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPPP----', null, null),
(53, 2092, 2092, 'ARMANDOLA JOSE MARIA INMO', 'INMOBILIARIA', 'armandolajm@jmarmandola.com.ar', 'inmoniliaria_armandola@jmarmandola.com.ar', 'ANDRES PAZOS 700', '20-10824744-5', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(54, 2097, null, 'CYNTHIA Y LUIS CORREA OPTICAS S.R.L.', 'ÓPTICAS', 'correacyloptica@gmail.com', 'opticacylcorrea@gmail.com', 'CERVANTES 72', '30-68105330-8', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(55, 2110, 2110, 'BOLSA DE COMERCIO DE E.R.', 'BANCARIO Y/O FINANCIERA', 'laguilar@bcer.com.ar', 'secretaria@bcer.com.ar', 'CERVANTES 190', '30-65376078-3', 'RI', 'trimestral', 'AA', 'activo', null, 'PPPPPPPPP---', null, null),
(56, 2154, 2154, 'ÑANDUBAY S.R.L.', null, 'informes@transportesnandubay.com', 'facturacion@transportesnandubay.com', 'BLAS PARERA 1083', '30-62735126-3', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPFFFF----', null, null),
(57, 2156, 2156, 'GABRIEL FOUINE S.R.L.', null, null, null, 'SAN MARTIN 1.005', '30-58992944-2', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(58, 2157, 2157, 'LADISLAO POPELKA Y CIA.SA', null, 'patopopelka@gmail.com', 'sandramolinopopelka@gmail.com', 'RUTA 11 KM 4 1/2', '33-51377461-9', 'RI', 'trimestral', 'A', 'activo', null, 'PPPPPPPPP---', null, null),
(59, 2194, 2194, 'J Y H DISTRIBUCIONES SRL', null, 'guijai@hotmail.com', null, 'ALMAFUERTE 3794', '30-63865132-3', 'RI', 'bimestral', 'A', 'activo', 'posible_baja', 'FFFFFF------', 18000, null),
(60, 2200, 2200, 'ENTRE RIOS COLCHONES / JOZAMI MARIANA', '27-18417018-9', 'betojozami@hotmail.com', 'marianajozami@gmail.com', 'PERU 64', '27-18417018-9', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', 11831, 'Adelanto 2025: 11831 · Deuda: Deuda del 2023 (facturado) y 2024 (no facturado)'),
(61, 2235, 2235, 'TODO FRENO DE SUCESION DE BUCHHAMMER HUGO Y BOURNISSEN RAMON SOCIEDAD SIMPLE', null, 'todofrenoparana@hotmail.com', null, 'CHURRUARIN 27', '30-59909044-0', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(62, 2241, 2580, 'MATEOS EDUARDO S.R.L.', null, 'martinmateos@gigared.com', 'ulises.edumat@gmail.com', 'GUALEGUAYCHÚ E ILLIA', '30-54824858-9', 'RI', 'bimestral', 'B', 'baja', null, 'PPPPPPPP----', null, null),
(63, 2260, 2260, 'ETCHEVEHERE RURAL S.R.L.', null, 'info@etchevehere-rural.com.ar', 'silvana@etchevehere-rural.com.ar', 'URQUIZA Y SAN JUAN', '30-51994251-4', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(64, 2307, 2307, 'MACUA ALBERTO J. S.A.', null, 'proveedores.macua@grupomacua.com.ar', 'claudio.temporelli@grupomacua.com.ar, gaston.niz@macua.com.ar', 'ECHAGUE Y P. PALMA', '30-60541628-0', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(65, 2312, 2312, 'OSCARB. GONZALEZ S.R.L.', null, 'obgsrl@hotmail.com', null, 'GUALEGUAYCHU 444', '33-62808563-9', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPFFFFFF', null, null),
(66, 2316, 2316, 'NEXO SA', null, 'gerencia@nexo-aberturas.com.ar', 'recepcion@nexo-aberturas.com.ar', 'V. TORRAS 4754', '30-65195783-0', 'RI', 'anual', 'B', 'activo', null, 'FFFFFFFFFFFF', 22704, null),
(67, 2364, 2364, 'SANATORIO LA ENTRERRIANA SA', null, 'contacto@slaentrerriana.com.ar', null, 'BUENOS AIRES 550', '30-54584907-7', 'RI', 'bimestral', 'AA', 'activo', null, 'PPPPFF------', null, null),
(68, 2370, 2370, 'DEPOR JEANS S.A.', null, 'pagos@deporjean.com', 'sm770pna@deporjean.com, sm1020pna@deporjean.com', 'SAN MARTIN 770', '33-61399899-9', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 10000, null),
(69, 2408, 2408, 'VICOER LTDA', null, 'vicoer@fibercorp.com.ar', 'vicoerltda@yahoo.com.ar', 'SEBASTIÁN VAZQUEZ 301', '30-62036045-3', 'RI', 'trimestral', 'B', 'activo', null, 'PPPPPPPPP---', null, null),
(70, 2413, 2413, 'PILAY S.A.', null, 'gspizer@pilay.com.ar', 'pilayparana@pilay.com.ar, gspizer@pilay.com.ar, belenbutta@gmail.com', 'ALAMEDA DE LA FED. 290 - L5', '30-57381925-6', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(71, 2417, 2417, 'CALABRESE ALFREDO C.EST.CONTAB', null, 'info@estudiocalabrese.com.ar', null, 'GOBERNADOR SOLA 687', '20-13631418-2', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(72, 2423, 2423, 'APASER ASOC.PROD.AS.SEG.E.R.', 'SEGUROS', 'contacto@apaser.com.ar', null, 'RAMIREZ 1841 P. ALTA', '30-69045510-9', 'Exento', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, 'Adelanto 2025: 0'),
(73, 2442, 2442, 'DISTRIBUIDORA GUADALUPE SA', null, 'guadalupe.parana@gmail.com', null, 'AV.DE LAS AMERICAS 3935/7', '30-61867017-8', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPPFF----', null, null),
(74, 2453, 2453, 'LAMPERTTI Y CIA. S.R.L.', null, 'contable@sesevi.com.ar', null, 'ALEM 436', '30-63641172-4', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPPFF----', null, null),
(75, 2471, 2100, 'SOS LA ALBORADA DEL SUD S. A.', null, 'administracion@sosemergencias.com.ar', null, 'CURA ALVAREZ 574', null, null, 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, 'Deuda: CANJE'),
(76, 2477, 2477, 'MOLINOS SAN JOSE S.A.', null, 'info@molinossanjose.com', 'molinossanjose@molinossanjose.com.ar', 'SALELLAS S/N§', '30-65853218-5', 'RI', 'trimestral', 'B', 'activo', null, 'PPPPPPPPP---', null, null),
(77, 2480, 2480, 'MERCADO CONCENTRADOR EL CHARRUA S A', null, 'elcharruasa@arnetbiz.com.ar', null, 'ALMAFUERTE 3634', '30-67123207-7', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(78, 2494, 2494, 'CARAMAGNA INMOBILIARIA', null, 'Vickycaramagna73@gmail.com', null, 'URQUIZA 201', '20-18549341-6', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(79, 2521, 2521, 'FELLER S.R.L.', null, 'feller@grupomotta.com', 'flavia.hepp@grupomotta.com', 'ESTACIÓN GENERAL RACEDO', '30-59737214-7', 'RI', 'anual', 'A', 'activo', null, 'FFFFFFFFFFFF', 28512, null),
(80, 2544, 2544, 'BANCO BICA S.A.', 'BANCARIO Y/O FINANCIERA', null, null, '25 DE MAYO 182', '30-71233123-9', 'RI', 'mensual', 'BANCOS', 'activo', null, 'PPPPPPPPP---', null, null),
(81, 2563, 2563, 'ANGEL HUMBERTO BELLONI S.R.L..', null, 'monicabelloni720@hotmail.com', null, 'BARTOLOME ZAPATA 1040', '30-64620565-0', 'RI', 'anual', 'B', 'activo', null, 'FFFFFFFFFFFF', 5000, null),
(82, 2566, 2566, 'ESCO S.A. DE CAPITAL. Y AHORRO', null, 'susana@esco.com.ar', 'soniah@esco.com', 'GUALEGUAYCHU 763', '30-62992974-2', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPPFF----', null, null),
(83, 2603, 2603, 'TRANSPORTE GOTTIG S.R.L.', null, 'pamela.lell@gottig.com.ar', null, 'RUTA 12 KM. 404', '30-63184965-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(84, 2607, 2607, 'BASA WORLD TRAVEL', 'AGENCIA DE VIAJE', 'lorenabasa@basaworldtravel.com.ar', 'carolinabasa@basaworldtravel.com.ar', 'PELLIGRINI 80', '33-71042244-9', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(85, 2611, 2611, 'A TODO COLOR S.R.L.', 'PINTURERIA', 'atc9@atodocolor.com.ar', null, 'ALMAFUERTE 175', '30-70838507-3', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 10000, null),
(86, 2632, 2632, 'AUTOSERVICIO EL CUNUMI', 'SUPERMERCADO Y AUTOSERVICIOS', 'promero_arg@yahoo.com.ar', null, 'GDOR.MANUEL CRESPO 1.223', '30-68112097-8', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(87, 2657, 2657, 'CORRALON RONDEAU', null, 'cristian.grecca@corralonrondeau.com.ar', null, 'RONDEAU 899', '30-71434122-3', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPPP----', null, null),
(88, 2660, 2660, 'CAIRO MARIO HECTOR EDGARDO', null, 'mhecairo@gmail.com', null, 'ILLIA 223', '20-12772360-6', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(89, 2664, 2664, 'GIGARED S.A.', null, 'efernandez@gigared.com.ar', null, 'GUALEGUAYCHU 800', '30-66304517-9', 'RI', 'bimestral', 'C', 'activo', null, 'FFFFFFFF----', null, null),
(90, 2679, 2679, 'SE SE VI SERV.SOCIALES S.R.L.', null, 'contable@sesevi.com.ar', null, 'ALEM 436', '30-63641196-1', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(91, 2682, 2682, 'PROVINCIAS UNIDAS S.R.L.', null, 'punidas@hotmail.com', null, 'PROVINCIAS UNIDAS 683', '30-69050622-6', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPPFF----', null, null),
(92, 2687, 2687, 'CHAPINO REPUESTOS', null, 'chapinorepuestos@yahoo.es', 'chapinorepuestos@hotmail.com', 'AV.LAS AMERICAS KIM. 4', '30-71775284-4', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPFFFFFF', null, null),
(93, 2688, 2688, 'IMPERTODO IMPERMEABILIZACIONES', null, 'impertodopinturerias@gmail.com', null, 'Av. Américas 2825', '27-21564022-7', 'RI', 'trimestral', 'C', 'activo', null, 'PPPFFFFFF---', null, null),
(94, 2690, 2690, 'ARENERA FARJAT', 'MATERIALES CONSTRUCCIÓN', 'arenerafarjat@hotmail.com', null, 'AV. ESTRADA Y CALLE M', '20-26941024-9', 'Monotributo', 'bimestral', 'B', 'activo', null, 'PPFFFFFF----', null, null),
(95, 2696, 2696, 'WIN SRL', null, 'winsrl.rrhh@gmail.com', null, 'Av. Almafuerte 4230', '30-70893477-8', 'RI', 'bimestral', 'C', 'activo', null, 'FFFFFFFF----', 4000, null),
(96, 2700, 2700, 'ROTH SRL (HUEVO CAMPO)', null, 'info@rothsrl.com.ar', 'cesar@rothsrl.com.ar', 'DEAN J. ALVAREZ 202', '30-55518161-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(97, 2703, 2703, 'EL SUPER DE LA CONSTRUCCIÓN SRL.', null, 'ventas.supercon@gmail.com', 'elsuperdelaconstruccion@gmail.com, superconadm@gmail.com', 'ZANNI 2.315', '30-69990056-3', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', null, null),
(98, 2706, 2706, 'COOP FARMACEUTICA DEL LITORAL LTD', null, 'jherrera@drogueriadellitoral.com.ar', 'informacion@drogueriadellitoral.com.ar', 'ESPAÑA 138/ 150', '30-54151921-8', 'RI', 'semestral', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(99, 2710, 2710, 'NAIMAN SA', null, 'saraines@naimanfoods.com.ar', null, 'ALMAFUERTE 2159', '33-70895549-9', 'RI', 'trimestral', 'C', 'activo', null, 'PPPPPPPPPP--', null, 'En los meses figura: FAVOR2910'),
(100, 2711, 2711, 'FINAN-YA', null, null, null, 'ESPAÑA', '30-71208172-0', 'Exento', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(101, 2713, 2713, 'ALPINA S. A.', 'CARPINTERIA', 'marcelo@escalerasalpina.com.ar', null, 'ROQUE SANZ 4825 PQUE.IND.', '30-67122730-8', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(102, 2718, 2718, 'EL EMPALME S.R.L.', null, 'elempalmesrl@gmail.com', null, 'RUTA 12 KM. 4', '33-61533844-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(103, 2723, 2723, 'VECTOR', null, 'vectorhomo@fibertel.com.ar', null, 'BUENOS AIRES 147', '20-07705356-6', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(104, 2725, 2725, 'CECOTTI RAUL', 'AGUA ENVASADA, SODA, DISPENSER', 'contacto.aguacotti@gmail.com', 'contacto.aguacotti@gmail.com', 'AV. ZANNI 1449', '20-13668716-7', 'RI', 'mensual', 'C', 'activo', null, 'PPPPPPPPF---', null, null),
(105, 2726, 2726, 'SOCIEDAD COMERCIAL ELECTRICA SA', null, 'miguelmonzon@scedigital.com.ar', 'edgar@scedigital.com.ar, cesar@scedigital.com.ar', 'GUALEGUAYCHU 657', '33-65689604-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(106, 2734, 2734, 'TRAPOTECA SAS', null, 'claudiazaha@yahoo.com.ar', null, 'ESPAÑA 89', '33-71628376-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(107, 2738, 2738, 'LA ESPIGA DE ORO SRL', null, 'centropanaderos@hotmail.com', 'laespigadeorosrl_adm@hotmail.com', 'CORDOBA Y LAPRIDA', '30-71145475-2', 'RI', 'bimestral', 'B', 'activo', null, 'FFPPPPFF----', null, null),
(108, 2743, 2743, 'INSTITUTO SUPERIOR NEW START', null, 'instituto@newstart.edu.ar', null, 'URQUIZA 1.063', '30-64921576-2', 'Exento', 'mensual', 'C', 'activo', null, 'PPPPPPFPF---', null, 'Del 2026: 1150'),
(109, 2746, 2901, 'HIELO EL POLO SRL', null, 'sonletkren@yahoo.com.ar', null, 'R. CARRILLO 74', '30-71119673-7', 'RI', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(110, 2750, 2750, 'AGUA NUESTRA SA', 'AGUA ENVASADA, SODA, DISPENSER', 'pedidos@aguanuestra.com.ar', null, 'VALENTIN TORRA 5633', '30-70786951-4', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(111, 2755, 2755, 'ASOCIACION MUTUAL DEL CENT', 'SALUD', 'administracion@amupro.com.ar', 'debhora.maidana@amupro.com.ar', 'ENRIQUE CARBO 267', '30-70786955-7', 'Exento', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(112, 2756, null, 'KREVISKY AUTOMOTOR S.R.L.', null, 'mkrevisky@hotmail.com', 'agustinkrevisky@hotmail.com', 'ALMAFUERTE 1400', '30-71848325-1', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', '------------', null, null),
(113, 2757, 2757, 'ESCOBAR SANTA FE S.A.C.I.F.I', null, 'ptorres@escobarstafe.com.ar', null, 'ALMAFUERTE 1140', '30-51884963-4', 'RI', 'anual', 'B', 'activo', null, 'FFFFFFFFFFFF', null, null),
(114, 2760, 2760, 'C.M.S. S.A.', 'FERRETERIA INDUSTRIAL', 'info@ferrenet.net', 'admin@ferrenet.net', 'DEAN J. ALVAREZ 262', '30-70822530-0', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(115, 2761, null, 'LAFEDAR S.A.', null, 'laura.cersofio@lafedar.com', 'recepcion@lafedar.com, lafedar@lafedar.com', 'VALENTIN TORRA 4880', '30-68107138-1', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPFFFF----', null, null),
(116, 2763, 2763, 'FRIO LITORAL', null, 'friolitoralparana@hotmail.com', 'ventas@friolitoral.com', 'AYACUCHO 606', '23-17932520-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(117, 2770, 2770, 'FIAT RITMO (DEHARBE HUGO)', 'RESPUESTO AUTOMOTOR', 'fiatritmoparana@yahoo.com.ar', null, 'RAMIREZ 2571', '20-14604045-5', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', '------------', null, null),
(118, 2775, 2775, 'OPTICA CRILLON', 'ÓPTICAS', 'crillon@live.com.ar', 'crillon@hotmail.com', 'GUALEGUAYCHU 481', '27-12883584-4', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(119, 2780, 2780, 'LA UNION S.A.', null, 'launionsa@yahoo.com.ar', null, 'PARQ.INDUSTRIAL ARANGUREN S/Nº', '30-53231224-4', 'RI', 'bimestral', 'A', 'activo', 'posible_baja', 'FFFFFF------', null, null),
(120, 2793, 2793, 'CASA FONTANA SRL', null, 'fabricafontana@hotmail.com', null, 'NEWBERY 2349', '30-71755599-2', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, 'Adelanto 2025: 28200 · Aclaración: PAGÓ 1 SEMESTRE 2027'),
(121, 2795, null, 'AUTOMOTORES MEGA S.A.', 'CONCECIONARIA AUTOMOTOR', 'antonela@automotoresmega.com.ar', 'autmega@hotmail.com, carolina@automotoresmega.com.ar', 'ALMAFUERTE 145', '30-57487517-6', 'RI', 'semestral', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(122, 2808, 2808, 'COTILLON MAKUKO´S', 'COTILLÓN', 'miguel@cotillonmakukos.com.ar', 'ventas@cotillonmakukos.com.ar', 'ZANNI 1402', '30-71756385-5', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPFFFFFF', null, null),
(123, 2810, 2810, 'LORJES III', null, 'mpatriciamerlo@hotmail.com', 'lorenagassmann@hotmail.com', '25 DE MAYO 220', '30-71551664-7', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(124, 2814, 2814, 'ZIRPOLI MARIA E. SALERNO DE', null, null, null, '25 DE JUNIO 249', '27-05716254-1', 'RI', 'bimestral', 'S', 'activo', null, 'PPFFFFFF----', null, null),
(125, 2815, 2815, 'IMPRESIT SRL', null, 'impresit@hotmail.com', null, 'FELICIANO 287', '30-63652527-4', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(126, 2816, 2816, 'ELESE S.R.L.', null, 'administración@v-elese.com.ar', 'gerencia@v-elese.com.ar', 'ALMAFUERTE 4194', '30-71046915-2', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(127, 2818, 2818, 'FARMACIA VILLEGAS', null, 'contacto@farmaciasvillegas.com.ar', null, 'DONBOSCO 1.505', '30-71087303-4', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 10000, null),
(128, 2821, 2821, 'EVENTOS PARANA S.R.L. (EYP SRL)', null, 'gerencia@eyp.com.ar', null, 'JUAN B. JUSTO 407', '30-70722027-5', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPFFFF----', null, null),
(129, 2824, 2824, 'LA AGRICOLA REGIONAL COOP.LTDA.', null, 'mgimenez@lar.coop', 'juans@laagricolaregional.com.ar, larsalta@lasegunda.com.ar', 'MORENO 1.404 (Pná.GCHU 880)', '33-50404708-9', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(130, 2827, 2827, 'INDUSTRIA METALURGICA DEYVEL S.R.L.', null, 'ventas@deyvel.com.ar', null, 'ARTIGAS 745', '30-70923842-2', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(131, 2829, 2829, 'AGUA DE MESA FRESK', 'AGUA ENVASADA, SODA, DISPENSER', 'aguademesafresk@hotmail.com', null, 'JOSEFINABRESSOUUT 2335', '20-13690811-2', 'RI', 'bimestral', 'B', 'baja', null, 'PPPPPP------', null, 'Aclaración: LO TIENE EL COBRADOR A LOS $2300'),
(132, 2830, null, 'SU COLOR PINTURERIAS', null, 'sucolor@hotmail.com', null, 'SAN JUAN Y COLON', '27-12772503-4', 'RI', 'semestral', 'B', 'baja', null, 'FF----------', null, null),
(133, 2831, 2831, 'ILUMINAR S.H.', null, 'marichal-rafael@hotmail.com', null, '25 DE MAYO E ILLIA', '30-70881224-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPFFFFFF----', null, null),
(134, 2834, 2834, 'VALMOTORS', null, 'lucas.rimolo@grupomacua.com.ar', 'rocio.ferlini@grupomacua.com.ar', 'ALMAFUERTE 807', '30-70941478-6', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(135, 2843, 2843, 'MASTER PLAST SRL', null, 'master.plast@hotmail.com', 'parana@etman.com.ar', 'SALELLAS 1708', '30-71422818-4', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(136, 2847, 2847, 'CENTRO DE LA CONSTRUCCIÓN EN SECO SAS', null, 'administracion@construseco.com.ar', null, 'MACIÁ 161', '30-71669032-2', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 5000, null),
(137, 2848, 2848, 'JOYERÍA EL RUBÍ S.A.', null, 'tallerelrubi@hotmail.com', null, 'SAN MARTÍN Y URQUIZA', '30-70776787-8', 'RI', 'semestral', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(138, 2849, 2849, 'MATAFUEGOS SAN JORGE', null, 'matafuegos-sanjorge@hotmail.com', null, 'PERÓN 390', '20-31017315-1', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(139, 2862, 2862, 'ORTOPEDIA CENTRO (BENZATTI ALCIDES OMAR Y MARTIN MARCELO MARIO SH)', null, 'ortopediacentropna@hotmail.com', null, 'CERVANTES 76', '30-70014288-0', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(140, 2866, 2866, 'ZEN SA', null, 'estacion.zensa@gmail.com', null, 'ENRIQUE CARBO Y ALSINA', '30-70927219-1', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(141, 2867, 2867, 'HERRAJES YORI Y CIA. SRL', null, 'administracion@herrajesyori.com.ar', null, 'ENRIQUE CARBO 906', '30-67121614-4', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFFFF----', 5000, null),
(142, 2873, 2873, 'COUDENHOVE E HIJOS', null, 'gabrielcoudenhove@hotmail.com', 'rubencoudenhove@hotmail.com', 'DON BOSCO 117', '20-24264579-1', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(143, 2888, 2888, 'ARENERA TOMA NUEVA SRL', 'MATERIALES CONSTRUCCIÓN', 'lamaquinavial@gmail.com', 'multigravas@yahoo.com.ar', 'RONDEAU S/Nº AL FINAL', '30-71015676-6', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 5000, null),
(144, 2895, 2895, 'PARANA SANITARIOS SRL', null, 'paranasanitarios@yahoo.com.ar', null, 'E. CARBO 499', '30-60082781-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(145, 2896, 2896, 'DREWANZ EDUARDO HUGO', null, 'bambuparana@hotmail.com', null, '25 DE JUNIO 12', '20-12337750-9', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(146, 2898, 2898, 'CORRER S. A.', null, 'Pagos@corrersa.com', null, 'VILLAGUAY 1025', '30-70703924-4', 'RI', 'bimestral', 'A', 'activo', null, 'PPPPPP------', null, null),
(147, 2900, 2900, 'DISTRIBUIDORA GARAY', null, 'central@garaydistribuciones.com', 'comercial@garaydistribuciones.com', 'GARAY YBUENOS AIRES 481', '20-12756016-2', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPPP----', null, 'Del 2026: 5000'),
(148, 2915, 2915, 'MARAVILLOSO MUNDO', null, 'maravillosomundoparana@gmail.com', null, 'SAN MARTIN 1034', '30-71814835-5', null, 'semestral', 'C', 'activo', null, 'PPPPPPFFFFFF', null, 'Condición en el Excel: AUTONOMO'),
(149, 2916, 2916, 'ENVASER', null, 'claudioenvaser@hotmail.com', null, 'ALMAFUERTE 1321', '20-25032542-9', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(150, 2919, 2919, 'MUNDO ELÉCTRONICO', null, 'pinveninato@gmail.com', null, 'ALEM 915', '20-11807293-7', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(151, 2922, 2922, 'AGROLAC PARANA', 'IMPLEMENTOS TAMBO E IND LACTEA', 'contacto@agrolacparana.com.ar', 'luisina@agrolacparana.com.ar', 'ALMAFUERTE 3283', '20-05097704-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(152, 2929, 2929, 'TAUROC SRL (Pascual)', null, 'taurocparana@live.com.ar', 'contacto@tauroc.com.ar', 'ROQUE SAENZ 4971', '30-71828470-4', 'RI', 'semestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 11280, null),
(153, 2932, 2932, 'FARMACIA RIVADAVIA SRL', null, 'frivadavia38@gmail.com', null, 'ALAMEDA DE LA FED. 399', '30-71662218-1', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 10000, null),
(154, 2933, 2933, 'VIDRIERIA MARIA REINA', null, 'vidrieriamariareina@yahoo.com.ar', null, 'ALMAFUERTE 2201', '20-23786814-6', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 12000, null),
(155, 2941, 2941, 'CALZADOS BARBARO', 'ZAPATERIA', 'calzadosbarbaro@live.com.ar', 'mariasoledadtabares@yahoo.com.ar', 'P. UNIDAS 607', '30-70788225-1', 'RI', 'bimestral', 'C', 'activo', null, 'FFPPFFFF----', 8000, null),
(156, 2951, 2951, 'CALZADOS DINASTIA', 'ZAPATERIA', 'dinastiaalem@gmail.com', null, 'Venezuela 154', '30-63752289-9', 'RI', 'bimestral', 'C', 'activo', null, 'PPFFFFFF----', null, null),
(157, 2953, 2953, 'PARANA REPRESENTACIONES SRL', null, 'cobranzasparana@etman.com.ar', null, 'RAMIREZ 4753', '30-71405492-5', 'RI', 'semestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 14100, null),
(158, 2962, 2962, 'CONFORT S. A.', null, 'alejandromartinez@confortingenieria.com', 'lauralucero@confortingenieria.com', 'BUENOS AIRES 676', '30-71090812-1', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(159, 2964, 2600, 'BANCO ICBC', 'BANCARIO Y/O FINANCIERA', 'marisa.balbi@icbc.com.ar', null, 'PELLEGRINI 42', '30-70944784-6', 'RI', 'mensual', 'BANCOS', 'activo', null, 'PPPPPPPPF---', null, null),
(160, 2967, 2967, 'DILFER S.A. (CONSUMAX)', null, null, null, 'URQUIZA 1031', '30-68727040-8', 'RI', 'bimestral', 'AA', 'activo', 'posible_baja', 'FFFF--------', 20000, null),
(161, 2969, 2969, 'EL MAGO SOCIEDAD ANONIMA', null, 'tiendaelmago@hotmail.com', 'roxanabejar@hotmail.com', 'SAN MARTIN 1177', '30-69050370-7', 'RI', 'semestral', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(162, 2994, 2994, 'HOJMAN NEG. INMOBILIARIOS SRL', null, 'saul@hojman.net', null, 'CERVANTES 150', '30-70015991-0', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(163, 2998, 2998, 'LIBRERÍA Y JUEGUETERIA PICHI', null, 'libreriajugueteriapichi@gmail.com', null, 'SAN MARTIN 638', '30-71572782-6', 'RI', 'semestral', 'B', 'activo', null, 'FFFFFFFFFFFF', null, null),
(164, 3002, 3002, 'ASCENSORES DEL RIO S.R.L.', 'SERVICIO ASCENSOR', 'ascensores_delrio@hotmail.com', null, 'LA PAZ 533', '33-70017409-9', 'RI', 'trimestral', 'B', 'activo', 'deuda_condonada', 'PPPPPPFFF---', null, 'Aclaración: Compensacion de deuda'),
(165, 3020, 3020, 'ORTIZ LIA CELESTE', null, 'alilesce@gmail.com', null, 'C. ZEBALLOS 1183', '27-32405770-1', null, 'anual', 'JE/ME', 'activo', null, 'FFFFFFFFFFFF', null, 'Condición en el Excel: AUTONOMO · Adelanto 2025: 250 · Aclaración: Adelanto enero y se imputa 250 a febrero 2025'),
(166, 3031, 2500, 'CASA LUIS CHEMES S.R.L.', null, 'silvinasaliva@chemesweb.com.ar', null, 'CORRIENTES 210', '30-67437782-3', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(167, 3034, 3034, 'NARELLA', null, null, null, 'ALVAREZ CONDARCO 2005', '20-25032523-2', 'Monotributo', 'semestral', 'C', 'activo', 'posible_baja', '------------', null, null),
(168, 3061, 3061, 'THE MUSIC STORE', null, 'juanma_g86@hotmail.com', null, 'GUALEGUAYCHU 262', '20-32669202-7', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(169, 3062, 3062, 'AGUA MARINA', 'PRODUCTO LIMPIEZA', 'aguamadmi@gmail.com', null, 'JM.ZUVIRIA ESQ. RIO NEGRO', '27-34680018-1', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPFFFFFF', null, null),
(170, 3069, 3069, 'SAUCEDO SILVINA RAQUEL', null, 'silvi.saucedo@hotmail.com', null, 'CONDE DE GENA 2048', '27-21839207-0', 'Monotributo', 'anual', 'JE/ME', 'activo', null, 'PPPPPPPPPPPP', null, 'Aclaración: A favor año 2025 $3050 (ENERO,FEBRERO Y MARZO PROP)'),
(171, 3074, 3074, 'DELLA SCHIAVA S.A.', null, 'ventas@dellaschiava.com.ar', 'dellaschiavasaparana@gmail.com', 'ALMAFUERTE 2792', '30-70862687-9', 'RI', 'semestral', 'A', 'activo', 'deuda_condonada', 'PPPPPPFFFFFF', null, 'Del 2026: 100'),
(172, 3076, null, 'OFFICE CENTER', null, 'parana@ocenter.com.ar', null, 'GUALEGUAYCHU 559', '23-11723240-9', null, 'semestral', 'C', 'baja', null, 'FFFFFF------', null, 'Condición en el Excel: AUTONOMO'),
(173, 3087, 3087, 'CONTACTOS PUBLICITARIOS', null, 'jjorgear@yahoo.com.ar', 'publicidadcmg@hotmail.com', 'NEWBERY 19', '20-20553654-0', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(174, 3091, 3091, 'CI PAR INGENIERÍA SRL', null, 'facundomujica@ciparingenieria.com.ar', 'ventas@ciparingenieria.com.ar, leticiamujica@ciparingenieria.com.ar', 'SAN MARTÍN 1217', '30-71460307-4', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(175, 3093, 3093, 'HERRLEIN DISTRIBUIDORA S.R.L.', null, 'mariofalico@hotmail.com', 'dario.suarez4240@gmail.com, herrleinelisa@gmail.com', 'ROSARIO VERA PEÑALOZA', '30-71227808-7', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(176, 3094, 3094, 'WEEKEND TRAVEL EVYT', null, 'sbel@weekendtravel.com.ar', null, 'HIPOLITO IRIGOYEN 85 - L2', '20-33011575-1', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 8000, null),
(177, 3096, 3096, 'JOYERIA Y RELOJERIA LEVIN', null, 'nancisit@live.com', null, 'PERU 130', '20-21422996-0', 'RI', 'bimestral', 'C', 'activo', null, 'FFFFFFFF----', null, null),
(178, 3097, 3097, 'EL OSO (CARPINTRIA) LOPEZ DIEGO', null, 'cieloso2000@hotmail.com', null, 'RAMIREZ 3930', '20-28796602-5', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 12000, null),
(179, 3115, 3115, 'HERRERÍA LODOLO', 'HERRERÍA', 'herrerialodolo@gmail.com', null, 'VILLA SAN BENITO 1175', '23-12313729-9', 'RI', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', 16632, 'Deuda: AJUSTE 2024 CUOTA $750 no reflejada aca como deuda'),
(180, 3125, 3125, 'MYKONOS BOUTIQUE', null, 'mariarro85@hotmail.com', 'luis_tapari@hotmail.com', 'SAN MARTIN 709', '27-16010154-2', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, 'Del 2026: 2000 · Adelanto 2025: falta facturar 3°bim'),
(181, 3128, 3128, 'PET LAND VETERINARIA', null, 'petlandcontable@gmail.com', 'petlandcarbo@gmail.com', 'ENRIQUE CARBO 299', '30-71534473-0', 'RI', 'semestral', 'B', 'activo', null, 'FFFFFF------', null, null),
(182, 3129, 3129, 'ENRIQUE ESTEBAN', null, 'esteban_augusto_enrique@hotmail.com', null, 'JOSE VERA 1140', '20-27620743-2', 'Monotributo', 'mensual', 'JE/ME', 'activo', null, 'PPPPPPPPPP--', null, null),
(183, 3138, 3138, 'CÍA ENTRERRIANA DE RODAMIENTO SA', null, 'info@rodacom.com.ar', null, 'Almafuerte 201', '30-71015165-9', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, null),
(184, 3142, 3142, 'BLACK BALEY DEPORTES', 'INDUMENTARIA DEPORTIVA', 'ventas@blackbaley.com', null, 'Uruguay 156', '20-22761446-4', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPFFFFFF', null, null),
(185, 3150, 3150, 'EL COMBOYANO FUMIGACIONES', null, 'riosrubene@hotmail.com', null, 'Pte. Peron 461', '20-11379641-4', null, 'mensual', 'C', 'activo', 'cobrador', '------------', 6550, 'Condición en el Excel: AUTONOMO · Del 2026: TODO · Deuda: Desde dic 2020 a Nov2022 · Aclaración: CANJE por servicios de fumigación FALTA FACTURA DE ELLOS'),
(186, 3151, 3151, 'VOXA S.A', null, 'gustavo.lopezcolombo@voxa.com.ar', null, 'Ecuador 90 local 2', '30-71214942-2', 'RI', 'anual', 'B', 'activo', null, 'FFFFFFFFFFFF', null, null),
(187, 3153, 3153, 'JOYERIA AURUM / JADE JOYERIA Y RELOJERIA', null, 'aurum.joyeria@gmail.com', null, 'San Martin 1090', '30-71807267-7', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(188, 3154, 3154, 'MONACO REGALOS', null, 'pamevs@hotmail.com', null, 'San Martin 1048', '27-11949297-7', 'RI', 'semestral', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(189, 3155, 3155, 'SCARPE ROMINA (riso roman antonio)', null, 'scarperomina@hotmail.com', null, 'San Martin 1039', '20-18138299-7', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(190, 3158, 3158, 'CAROLA INDUMENTARIA FEMENIDA (BAYER DAIANA ANAHI)', null, 'daaia.b@hotmail.com', null, 'Montes Caseros 189', '27-38514276-0', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 8000, null),
(191, 3160, null, 'OPTICA MIL ESTILOS', 'ÓPTICAS', 'optica_mil_estilos@hotmail.com', null, 'San Martin 880', '20-16531477-9', 'RI', 'bimestral', 'C', 'baja', null, '------------', null, 'Del 2026: 0 · Aclaración: solicita baja por mail 27/01'),
(192, 3161, 3161, 'ESPACIO B.A.', null, 'localesespacioba@gmail.com', null, 'San Martin 886', '27-32296662-3', 'Monotributo', 'bimestral', 'C', 'baja', null, 'FFFFFF------', null, null),
(193, 3165, 3165, 'SUELITA''S', null, null, null, 'San Martin 1047', '20-31521520-0', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', null, null),
(194, 3167, 3167, 'OPTICA SCHELLHAS', 'ÓPTICAS', 'schellhasparana@gmail.com', null, 'Urquiza 1043', '20-30430266-7', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 12000, null),
(195, 3172, 3172, 'PLATNOS ACCESORIOS', null, 'nadiabolognio@gmail.com', null, 'San Martin 680', '27-34453832-3', 'RI', 'bimestral', 'C', 'activo', null, 'FFFFFFFF----', null, null),
(196, 3173, 3173, 'PRUNE', null, 'pruneparana@hotmail.com.ar', null, 'Cervantes 24/26', '30-70852490-1', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(197, 3179, 3179, 'SHAYA / MINICLEO / ZOWE', null, null, null, 'San Martin 1023', '20-27445087-9', 'Monotributo', 'bimestral', 'C', 'activo', null, 'PPPPFFFF----', null, 'Del 2026: 6000'),
(198, 3182, 3182, 'GARABATOS', null, 'clotapna@hotmail.com', null, '25 DE JUNIO 51 Local 22', '27-20189775-6', 'Monotributo', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 8000, null),
(199, 3188, 3188, 'DRUGSTORE PLAZA', null, 'drugstoreplaza@hotmail.com', null, 'España 27', '20-29121003-2', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPPP----', null, null),
(200, 3190, 3190, 'VAI DECO', null, 'paohabib@hotmail.com', null, 'Buenos Aires 129', '27-31017337-7', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(201, 3191, 3191, 'MUEBLERIA PELLEGRINI', null, 'mpcorreo@gmail.com', null, 'Pellegrini 154', '20-20288707-5', 'Monotributo', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(202, 3192, 3192, 'TEQUILA / 47 STREET', null, 'gabita.68@hotmail.com', null, 'Cervantes 35', '27-20421215-0', 'RI', 'bimestral', 'C', 'activo', 'posible_baja', 'FFFF--------', 8000, null),
(203, 3197, 3197, 'FENIX DISTRIBUCIONES SRL', null, 'fenixdistribuciones1@gmail.com', null, 'Av. America 5327', '30-71564427-0', 'RI', 'bimestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 15000, null),
(204, 3200, 3200, 'LEON INMOBILIARIA', null, 'rleonmartillero@hotmail.com', null, 'Maipu 428', '20-05936149-0', 'Monotributo', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', 16632, null),
(205, 3202, 3202, 'ORCU', null, 'comercial@orcucreditos.com.ar', null, 'Perú 101', '20-05950596-4', 'RI', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(206, 3204, 3204, 'EL PALACIO DEL BOTÓN', null, 'elpalaciodelbotonsrl@gmail.com', null, 'Montes Casero 197', '27-05772757-3', 'Monotributo', 'bimestral', 'C', 'activo', null, 'PPPPPPFF----', null, null),
(207, 3210, 3210, 'ANDREANI LOGISTICA SA', 'LOGISTICA ENVIO', 'jandino@andreani.com', null, 'Almirante Brown 1182', '30-69801114-5', 'RI', 'anual', 'AA', 'activo', null, 'FFFFFFFFFFFF', null, 'Aclaración: QUEDA A FAVOR ENERO FEBRERO MARZO ABRIL 2026'),
(208, 3220, null, 'PAÑALERA NARELLA', null, 'tiendanarella738@gmail.com', null, 'Sarobe 797', '27-40990605-8', 'RI', 'semestral', 'C', 'activo', 'posible_baja', '------------', 11280, null),
(209, 3221, 3221, 'ECO DISEÑO PARANÁ', null, 'ecodiseniopna@gmail.com', null, 'Río Negro 842', '20-30558291-4', 'Monotributo', 'semestral', 'JE/ME', 'activo', null, 'PPPPPPPPPPPP', null, null),
(210, 3222, null, 'CITY SHOES', null, 'liliana91192@gmail.com', null, 'San Martín 693', '30-71559596-2', 'RI', 'semestral', 'C', 'activo', null, 'PPPPPPPPPPPP', null, null),
(211, 3223, 3223, 'ALSUR', 'Bazar', 'alsur-casajardin@hotmail.com', 'miriam-ef@hotmail.com', 'Av. Américas 4694', '23-17997430-4', 'Monotributo', 'semestral', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(212, 3224, 3224, 'YASÚ SRL (CERVECERÍA YASÚ)', 'Cerveceria', 'mirko@pacoricona.com.ar', null, 'Pte. Peron 158', '30-71587927-8', 'RI', 'anual', 'JE/ME', 'activo', null, 'PPPPPPPPPPPP', null, null),
(213, 3225, 3225, 'CHARLY COTILLÓN', 'COTILLÓN', 'lucianazapata1@hotmail.com', null, 'Gualeguaychú 8', '30-71719997-5', 'RI', 'trimestral', 'C', 'activo', 'posible_baja', 'FFFFFF------', 9170, null),
(214, 3226, 3226, 'ARAI / SENTIR LO NUESTRO', 'Yerbateria', 'araiparana@gmail.com', 'davidbresler90@gmail.com', 'Alameda Federación 698', '20-21997825-2', 'Monotributo', 'mensual', 'C', 'activo', null, 'PPPPPPFPF---', null, null),
(215, 3227, 3227, 'CAMARA DE LA PROPIEDAD HORIZONTAL', 'INMOBILIARIA', 'cpihectorcejas@gmail.com', 'caprhopa@gmail.com', 'Rosario Tala 417', '30-71820232-5', 'Exento', 'semestral', 'AA', 'activo', null, 'PPPPPPPPPPPP', null, 'Adelanto 2025: 200 · Aclaración: $200 a favor de enero 2025'),
(217, 3228, 3228, 'MATERIALES EL CONSTRUCTOR', 'MATERIALES CONSTRUCCIÓN', 'silvanochirnicinero@gmail.com', 'elconstructor1070@gmail.com', 'Av. Ramirez 1070', '30-71733842-8', null, 'mensual', 'C', 'activo', 'posible_baja', '------------', 4830, 'Sin forma de pago en el Excel (se tomó mensual) · Del 2026: TODO · Deuda: No paga desde que e dio de alta Abril 2023'),
(218, 3229, 3229, 'RCPTEAM - RATAIL INSUMOS GRÁFICOS', null, 'garciandiagustavo@gmail.com', null, 'Nogoya 50 5C', '20-14718380-2', 'Monotributo', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', null, null),
(219, 3231, 3231, 'NATION', 'Automotores', 'ricardo.esper@nation.com.ar', 'marketing@nation.com.ar', 'Almafuerte 641', '30-71252574-2', 'RI', 'anual', 'AA', 'activo', null, 'FFFFFFFFFFFF', null, null),
(220, 3232, null, 'ALELI Nutrición Cosmética', 'Cosmética', 'liliana91192@gmail.com', null, 'Victoria 34', '27-36102848-7', 'Monotributo', 'trimestral', 'C', 'baja', null, '------------', null, null),
(221, 3233, 3233, 'UOMO LIBRE', 'Indumentaria', 'uomo.libre@live.com', 'daiana_brizuela@hotmail.com', 'San Martin 1055', '20-35441179-3', 'RI', 'trimestral', 'B', 'activo', null, 'PPPPPPFFF---', null, null),
(222, 3234, 3234, 'HB Productores de Seguros', 'SEGUROS', 'silviabechir@hbproductoresdeseguros.com', null, 'Av. Ramirez 5393', '27-21696793-9', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(223, 3237, 3237, 'DISTRIMAX (ROSALIA VERONICA ROUSS)', null, 'ventas@distrimax.com.ar', null, null, '27-25861418-1', 'RI', 'bimestral', 'B', 'activo', null, 'PPFFFFFF----', null, null),
(224, 3238, 3238, 'VICTORIA SCHNEIDER ESTETISISTA', null, 'mvictoriaschneider@gmail.com', 'schneidervictoria97@gmail.com', 'Borges 8', '27-34057867-3', 'Monotributo', 'semestral', 'C', 'activo', 'posible_baja', 'FFFFFFFFFFFF', 11280, 'Aclaración: Acta N°2325'),
(225, 3239, 3239, 'ESTACIÓN DE SERVICIOS LAURENCENA SRL', 'ESTACIÓN', 'administracion@grupodipalma.org', null, 'Av. Laurencena 98', '30-57466871-5', 'RI', 'anual', 'A', 'activo', null, 'PPPPPPPPPPPP', null, null),
(226, 3240, 3240, 'INTI SPORT', 'INDUMENTARIA', 'solnatividadpatat@gmail.com', null, 'San Martin 174 Col. Avellaneda', '27-41154279-9', 'Monotributo', 'mensual', 'JE/ME', 'activo', 'posible_baja', '------------', null, 'Sin forma de pago en el Excel (se tomó mensual) · Del 2026: 6850'),
(227, 3241, 3241, 'DANIELA ALBORNOZ MARKETING Y COMUNICACIÓN', 'MK Y COMUNICACIÓN', 'dsach.mkt@gmail.com', null, 'La rioja 260 8C', '27-36269083-3', 'Monotributo', 'mensual', 'JE/ME', 'activo', null, 'PPPPPPPPF---', null, null),
(228, 3242, 3242, 'COLECCIÓN DE AROMAS', 'FRAGANCIAS', 'bycolecciondearomas@gmail.com', 'candeacosta.marketing@gmail.com', 'Libertad 169', '27-43350173-5', 'Monotributo', 'semestral', 'JE/ME', 'activo', null, 'FFFFFFFFFFFF', null, null),
(229, 3243, 3243, 'FLR CONTROL DE PLAGAS', null, 'Fumigacioneslarioja@hotmail.com', null, 'Pablo Lorentz 2954', '30-71108867-5', 'RI', 'anual', 'C', 'activo', null, 'FFFFFFFFFFFF', 1150, null),
(230, 3244, 3244, 'DISTRIBUCIONES PARANA', null, 'jorgebustamante_@hotmail.com.ar', null, 'Aldea Santa Maria 2177', '20-11047600-1', 'Monotributo', 'semestral', 'C', 'activo', null, 'PPPPPPFFFFFF', null, null),
(231, 3245, 3245, 'VIANDA SANA PARANA - Yeregui Mariela Cecilia', null, 'ceciliayereguicatering@gmail.com', null, 'Bv Racedo 227 Bis', '27-23539782-5', 'RI', 'anual', 'B', 'activo', null, 'PPPPPPPPPPPP', null, null),
(232, 3246, 3246, 'BUFFY''S (MARCHESANO SOFIA LAURA', 'HELADERIA', 'buffysparana@gmail.com', null, 'CORRIENTES 687 (SHOPPING)', '27-41043782-7', null, 'semestral', 'B', 'activo', 'posible_baja', 'FFFFFF------', 14100, 'Condición en el Excel: AUTONOMO'),
(233, 3247, 3247, 'NIMSI GARCIA', 'VERDULERIA', 'nimsigarcia2@hotmail.com', null, 'ESPAÑA 45', '20-13252908-7', 'Monotributo', 'semestral', 'C', 'baja', null, 'PP----------', null, 'Aclaración: Acta N°2325'),
(234, 3248, 3248, 'PERESUTTI FIORELLA', 'BIJOUTERIE/DIETETICA', 'fiorellaperesutti@gmail.com', null, 'FELICIANO 422', '27-33838497-7', 'Monotributo', 'semestral', 'B', 'activo', null, 'FFFFFFFFFFFF', null, 'Aclaración: Acta N°2325'),
(235, 3249, 3249, 'ANVOI SA', 'SERVICIOS DE LIMPIEZA', 'cespina@anvoidistribuciones.com.ar', 'follocco@anvoidistribuciones.com.ar', 'TRENO 518 (RAFAELA STA FE)', '30-70969918-7', 'RI', 'bimestral', 'B', 'activo', null, 'PPPPPPFF----', null, 'Aclaración: Acta N°2329?'),
(236, 3250, 3250, 'AMERICAN ENGLISH ( GOMEZ JUAN PABLO)', 'ENSEÑANZA DE ADULTOS', 'american.english.inst.online@gmail.com', null, 'Belgrano 179', '20-21912488-1', 'Exento', 'semestral', 'B', 'activo', null, 'PPPPPPPP----', null, 'Aclaración: Acta N°2331DE A FAVOR ENERO Y FEBRERO'),
(237, 3251, 3251, 'CAFFARO MARIA JIMENA', 'MARKETING', 'caffarojimena@gmail.com', null, null, '27-34453755-6', 'Monotributo', 'mensual', 'JE/ME', 'activo', null, '------------', null, 'Sin forma de pago en el Excel (se tomó mensual) · Aclaración: Acta N°2331'),
(238, 3252, 3252, 'EMBOTELLADORA ENTRE RÍOS (LEANDRO DEHARBE)', 'EMBOTELLADORA', 'cimes.embotelladora@gmail.com', null, 'FRANCIA 1786', '30-71882236-6', 'RI', 'anual', 'C', 'activo', null, 'PPPPPPPPPPPP', null, 'Aclaración: Acta N°2331 A FAVOR HASTA AGOSTO 2026'),
(239, 3253, 3253, 'SISTEMA CONFIAR SRL - CANAL 6 CRESPO - EL OBSERVADOR- INMOBILIARIA CRESPO . ESTUDIO CONTABLE', 'CANAL 6 CRESPO - EL OBSERVADOR- INMOBILIARIA CRESPO . ESTUDIO CONTABLE', 'secretariaoficinafh@gmail.com', null, 'BELGRANO 459', '30-64408839-8', 'RI', 'anual', 'B', 'activo', null, '-PPPPPPPPPPP', null, 'Aclaración: A FAVOR HASTA ENERO 2027'),
(240, 3254, 2855, 'RAWSON IMÁGENES SRL', null, 'valerialopez@rawsonimagenes.com.ar', null, 'ENRIQUE CARBO 531', '30-71055234-3', 'RI', 'bimestral', 'B', 'activo', null, '----PPFF----', null, null),
(241, 3255, 3255, 'GIUS LEGAL - GIULIANA MILANESIO', 'ASESORAMIENTO LEGAL', 'giuslegal@gmail.com', null, 'CORDOBA 389', '27-39031626-2', 'Monotributo', 'mensual', 'JE/ME', 'activo', null, '-----PPFF---', null, null),
(242, 3256, 3256, 'MUNDO MUEBLES', 'MUEBLERIA', 'mundomueblesparana@gmail.com', null, 'AVDA CHURRUARIN 1244', '27-27607278-7', 'RI', 'bimestral', 'C', 'activo', null, '-----FFF----', null, null),
(243, 3257, 3257, 'LAPORTA GABRIEL EDUARDO', 'VTA DE AUTOS', 'gabre22@hotmail.com', null, 'ALMAFUERTE 5114', '20-28676316-3', 'Monotributo', 'bimestral', 'C', 'activo', null, '-------F----', null, null),
(244, 3258, null, 'IDS CONSULTORA', 'COACHING / CONSULTORIA CAPACITACION', 'ingenierosdelser@gmail.com', null, 'BRIGADIER LOPEZ 1851', '20-30558069-5', 'Monotributo', 'anual', 'B', 'activo', null, '---------F--', null, null);

do $$
declare
  v_anio constant int := 2026;
  v_dia int := coalesce((select dia_vencimiento from configuracion where id = 1), 10);
  x record;
  v_id uuid;
  v_cat uuid;
  v_mensual numeric;
  v_pm int;
  v_desc numeric;
  v_ini int;
  v_bloque text;
  v_estado text;
  v_desde int;
  v_hasta int;
  k int;
  c text;
  v_runs text[];
  v_run_ini int[];
  v_run_fin int[];
  v_monto numeric;
  v_venc date;
  v_meses_txt text;
  v_nombres text[] := array['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
begin
  for x in select * from imp_socios order by fila loop
    -- 1) Socio: se busca por N° de socio del padrón
    v_id := null;
    if x.numero_padron is not null then
      select id into v_id from socios where numero_socio = x.numero_padron;
    end if;
    if v_id is null and x.numero is not null then
      select id into v_id from socios where numero_socio = x.numero;
    end if;
    if v_id is null and x.cuit is not null then
      select id into v_id from socios where solo_digitos(cuit) = solo_digitos(x.cuit);
    end if;

    select id into v_cat from categorias where nombre = x.categoria;

    if v_id is null then
      insert into socios (numero_socio, razon_social, rubro, email, emails_extra, direccion, cuit, condicion_iva,
                          periodicidad, categoria_id, estado, seguimiento, observaciones)
      values (case when not exists (select 1 from socios where numero_socio = x.numero) then x.numero end,
              x.razon, nullif(x.rubro, ''), x.email, nullif(x.emails_extra, ''), nullif(x.domicilio, ''),
              case when not exists (select 1 from socios where solo_digitos(cuit) = solo_digitos(x.cuit)) then x.cuit end,
              x.iva, x.periodicidad, v_cat, x.estado, x.seguimiento, nullif(x.notas, ''))
      returning id into v_id;
    else
      update socios s set
        numero_socio = case when x.numero is not null and x.numero <> coalesce(s.numero_socio, -1)
                             and not exists (select 1 from socios o where o.numero_socio = x.numero)
                            then x.numero else s.numero_socio end,
        nombre_comercial = coalesce(s.nombre_comercial,
          case when upper(regexp_replace(s.razon_social, '[^[:alnum:]]', '', 'g')) <> upper(regexp_replace(x.razon, '[^[:alnum:]]', '', 'g'))
               then s.razon_social end),
        razon_social = x.razon,
        rubro = coalesce(nullif(x.rubro, ''), s.rubro),
        email = coalesce(x.email, s.email),
        emails_extra = coalesce(nullif(x.emails_extra, ''), s.emails_extra),
        direccion = coalesce(nullif(x.domicilio, ''), s.direccion),
        cuit = case when x.cuit is not null and not exists (
                      select 1 from socios o where o.id <> s.id and solo_digitos(o.cuit) = solo_digitos(x.cuit))
                    then x.cuit else s.cuit end,
        condicion_iva = coalesce(x.iva, s.condicion_iva),
        periodicidad = x.periodicidad,
        categoria_id = coalesce(v_cat, s.categoria_id),
        estado = x.estado,
        seguimiento = x.seguimiento,
        observaciones = case
          when nullif(x.notas, '') is null then s.observaciones
          when coalesce(s.observaciones, '') like '%' || x.notas || '%' then s.observaciones
          else concat_ws(E'\n', nullif(s.observaciones, ''), 'Excel 2026: ' || x.notas) end
      where s.id = v_id;
    end if;
    update imp_socios set socio_id = v_id where fila = x.fila;

    -- Constancia en el historial con el estado de cada mes
    delete from socio_notas where socio_id = v_id and texto like 'Importado del Excel 2026%';
    v_meses_txt := '';
    for k in 1..12 loop
      v_meses_txt := v_meses_txt || v_nombres[k] || ' ' || case substr(x.meses, k, 1) when 'P' then 'P' when 'F' then 'F' else '·' end
                     || case when k < 12 then ', ' else '' end;
    end loop;
    insert into socio_notas (socio_id, tipo, texto, autor_nombre)
    values (v_id, 'sistema', 'Importado del Excel 2026 (P pagó · F adeuda · en blanco sin dato): ' || v_meses_txt, 'Importación');

    -- 2) Cuotas 2026: se rehacen las importadas que no se cobraron desde el ERP
    delete from cuotas c0 where c0.socio_id = v_id and c0.importada and c0.recibo_numero is null
      and not exists (select 1 from facturas f where f.cuota_id = c0.id);
    continue when x.estado = 'baja';

    select cat.cuota_mensual, p.meses, p.descuento into v_mensual, v_pm, v_desc
    from socios s join categorias cat on cat.id = s.categoria_id join periodicidades p on p.codigo = s.periodicidad
    where s.id = v_id;
    continue when coalesce(v_mensual, 0) <= 0;

    v_ini := 1;
    while v_ini <= 12 loop
      v_bloque := substr(x.meses, v_ini, v_pm);
      v_runs := '{}'; v_run_ini := '{}'; v_run_fin := '{}';
      if v_bloque !~ '[PF]' then
        null; -- sin datos: no se genera
      elsif v_bloque !~ 'F' then
        v_runs := array['pagada']; v_run_ini := array[v_ini]; v_run_fin := array[v_ini + v_pm - 1];
      elsif v_bloque !~ 'P' then
        v_runs := array['pendiente']; v_run_ini := array[v_ini]; v_run_fin := array[v_ini + v_pm - 1];
      else
        -- Período con meses pagos y adeudados: una cuota por tramo (los meses en blanco se suman al tramo anterior)
        v_estado := null; -- último estado visto: 'P' o 'F'
        for k in 0..v_pm - 1 loop
          c := substr(v_bloque, k + 1, 1);
          if c = '-' then c := coalesce(v_estado, substr(replace(v_bloque, '-', ''), 1, 1)); end if;
          if v_estado is null or v_estado <> c then
            v_estado := c;
            v_runs := v_runs || (case c when 'P' then 'pagada' else 'pendiente' end);
            v_run_ini := v_run_ini || (v_ini + k); v_run_fin := v_run_fin || (v_ini + k);
          else
            v_run_fin[array_length(v_run_fin, 1)] := v_ini + k;
          end if;
        end loop;
      end if;

      for k in 1..coalesce(array_length(v_runs, 1), 0) loop
        v_desde := v_run_ini[k];
        v_hasta := least(v_run_fin[k], 12);
        -- No se pisa una cuota que ya exista para esos meses (por ejemplo, generada o cobrada desde el ERP)
        continue when exists (
          select 1 from cuotas c1
          where c1.socio_id = v_id and c1.tipo = 'cuota_social' and c1.estado <> 'anulada'
            and c1.periodo <= make_date(v_anio, v_hasta, 1)
            and coalesce(c1.periodo_hasta, c1.periodo) >= make_date(v_anio, v_desde, 1));
        v_monto := importe_cuota(v_mensual, v_hasta - v_desde + 1, v_desc);
        v_venc := make_date(v_anio, v_desde, v_dia);
        insert into cuotas (socio_id, tipo, periodo, periodo_hasta, meses, concepto, monto, vencimiento, estado,
                            fecha_pago, metodo_pago, monto_pagado, interes_cobrado, importada)
        values (v_id, 'cuota_social', make_date(v_anio, v_desde, 1), make_date(v_anio, v_hasta, 1), v_hasta - v_desde + 1,
                'Cuota social ' || etiqueta_periodo(make_date(v_anio, v_desde, 1), v_hasta - v_desde + 1),
                v_monto, v_venc, v_runs[k],
                case when v_runs[k] = 'pagada' then v_venc end,
                case when v_runs[k] = 'pagada' then 'Registro anterior (Excel)' end,
                case when v_runs[k] = 'pagada' then v_monto end,
                case when v_runs[k] = 'pagada' then 0 end,
                true)
        on conflict do nothing;
      end loop;
      v_ini := v_ini + v_pm;
    end loop;

    -- 3) Saldo adeudado del año anterior
    if x.deuda_2025 is not null and not exists (
      select 1 from cuotas c2 where c2.socio_id = v_id and c2.concepto = 'Saldo adeudado ' || (v_anio - 1) and c2.estado <> 'anulada') then
      insert into cuotas (socio_id, tipo, concepto, monto, vencimiento, importada)
      values (v_id, 'otro', 'Saldo adeudado ' || (v_anio - 1), x.deuda_2025, make_date(v_anio - 1, 12, 31), true);
    end if;
  end loop;
end $$;

-- Resumen de la importación
select
  (select count(*) from imp_socios) as filas_excel,
  (select count(*) from imp_socios where estado = 'baja') as dados_de_baja,
  (select count(*) from imp_socios where seguimiento = 'posible_baja') as posible_baja,
  (select count(*) from cuotas c join imp_socios i on i.socio_id = c.socio_id where c.importada and c.estado = 'pagada') as cuotas_pagadas,
  (select count(*) from cuotas c join imp_socios i on i.socio_id = c.socio_id where c.importada and c.estado = 'pendiente') as cuotas_adeudadas,
  (select count(*) from imp_socios i join socios s on s.id = i.socio_id left join categorias cat on cat.id = s.categoria_id
    where i.estado = 'activo' and coalesce(cat.cuota_mensual, 0) = 0) as socios_sin_valor_de_cuota;

-- Socios del padrón anterior que NO están en el Excel (revisar: ¿siguen siendo socios?)
select s.numero_socio, s.razon_social, s.estado
from socios s
where not exists (select 1 from imp_socios i where i.socio_id = s.id)
order by s.razon_social;
