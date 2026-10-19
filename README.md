# CeCIP Paraná · ERP administrativo + Portal de socios

Un solo proyecto que sirve dos aplicaciones según el subdominio:

| Subdominio | Para quién | Qué hace |
|---|---|---|
| **erp.centrocomercialparana.com.ar** | Personal administrativo | Socios, cuotas, cobranzas, tesorería, comunicación, eventos, ComercIA, accesos, configuración |
| **portalsocios.centrocomercialparana.com.ar** | Socios | Estado de cuenta y pago online, recibos, comunicados oficiales, eventos y capacitaciones, ComercIA |

**Tecnología:** React + Vite (frontend), Supabase (base de datos PostgreSQL, login y permisos), funciones serverless en Vercel (`/api`), Mercado Pago Checkout Pro (cobros) y Resend (emails).

---

## Qué resuelve

**Cuotas y cobranza**
- Categorías **BANCOS, AA, A, B, C, S y JE/ME** con el valor mensual de la cuota, editable desde Configuración.
- Cada socio tiene su **forma de pago**: mensual, bimestral, trimestral, semestral o anual, con el descuento de cada una (anual 12%, semestral 6%, trimestral 3%, como en la planilla de Tesorería; se editan en Configuración). Los bimestres, trimestres y semestres son del año calendario.
- "Generar cuotas del mes": a cada socio activo le genera el período de su forma de pago que incluye ese mes (al anual, el año; al bimestral, el bimestre), con vista previa y sin duplicar nunca un período. Se puede usar todos los meses.
- "Recalcular cuotas pendientes": después de un aumento, actualiza el importe de las cuotas impagas.
- Padrón 2026 importado del Excel "Registro de Asociados": categoría, forma de pago, CUIT, condición IVA, emails, y los meses pagos (P) y adeudados (F) como cuotas pagadas o pendientes. Los colores de la planilla quedan como marcas de seguimiento (posible baja, baja, deuda reciente, deuda condonada, cobra el cobrador).
- Interés por mora configurable (% mensual, proporcional por día de atraso). Se calcula automáticamente.
- Cobro manual (efectivo, transferencia, cheque, etc.). Cada cobro numera el recibo, registra el ingreso en tesorería y queda anotado en el historial del socio.
- **Links de pago de Mercado Pago**, por una cuota o por toda la deuda. Al pagarse, la cuota se marca pagada sola (webhook) y se genera el recibo.
- Envío del link por **WhatsApp** (se abre el chat con el mensaje listo) o por **email**.
- **Recordatorios automáticos** por email (opcional): unos días antes del vencimiento y, a quienes deben cuotas vencidas, como máximo una vez por semana.
- Lista de morosos con filtros por atraso y envío masivo de recordatorios.
- Recibos imprimibles o para guardar como PDF. Se puede revertir un pago cargado por error.
- Cargos sueltos (cuotas atrasadas, cursos, alquiler de salón, etc.).

**Tesorería:** saldos por cuenta (caja, bancos, Mercado Pago), ingresos y egresos por categoría, conciliación y exportación a Excel.

**Banco Santander:** los movimientos de la cuenta llegan solos desde un flujo de **n8n** conectado a la API de Santander (requiere el convenio de API con el banco), o se importan desde el extracto en CSV. Tesorería los concilia con un clic: un crédito se imputa a la cuota del socio (lo reconoce por CUIT) o a un alquiler, y genera el recibo y la factura; los débitos se registran como gasto.

**Facturación electrónica (ARCA vía n8n):** cada cobro de cuota o alquiler puede facturarse automáticamente. El ERP arma la factura (A, B o C según la condición frente al IVA del CeCIP y del socio) y la envía a un webhook de **n8n**, que la emite en ARCA (WSFE) y devuelve CAE, número y PDF. Cada socio tiene su pestaña **Facturación** con sus comprobantes y los cobros sin facturar; el socio ve sus facturas en el portal. Si ARCA rechaza una, queda marcada para reintentar.

**Alquileres:** los tres inmuebles del CeCIP con su contrato (inquilino, monto, vencimiento, depósito y ajuste por ICL, IPC, Casa Propia o porcentaje con aviso de la fecha de ajuste), generación mensual de los alquileres, cobro con recibo e ingreso en tesorería, recordatorio por WhatsApp con los datos para transferir, cargos extra (expensas, servicios) y facturación.

**Comunicación**
- Comunicados oficiales publicados en el portal, con **imagen o flyer**.
- Imágenes en los emails, en las novedades y emails de ComercIA y en las campañas de WhatsApp (se copia la imagen para pegarla en el chat o se envía su link). Se guardan en Supabase Storage.
- Emails masivos por segmento (todos, morosos, al día, por categoría) con variables `{{nombre}}` y `{{deuda}}`.
- Difusión por WhatsApp uno por uno.
- Historial de todo lo enviado.

**Difusión por WhatsApp (Comunicación → WhatsApp):** campañas a todos los socios, a morosos, a los que están al día o por categoría. Funciona sin la API paga de Meta: el sistema abre cada chat con el mensaje escrito y el administrativo toca *Enviar*. Para que WhatsApp no lo tome como spam:
- Cada socio recibe un **texto distinto**: variantes escritas por la IA (Gemini), alternativas `{a|b}`, y saludos, despedidas y avisos de BAJA que van cambiando.
- Se completan los datos de cada uno: `{{nombre}}`, `{{empresa}}`, `{{deuda}}` y `{{link_pago}}` (su link de Mercado Pago).
- Hay una **espera al azar** entre envíos y un **tope diario**, configurables. La campaña sigue otro día donde quedó.
- Quien responde BAJA se marca con un botón y queda excluido de las próximas campañas.

**Socios**
- Padrón con búsqueda y filtros, ficha con cuenta corriente e historial de contacto (llamadas, reuniones, acuerdos).
- Importación desde Excel/CSV, exportación y asignación masiva de categoría.

**Eventos y capacitaciones:** publicación en el portal, inscripción de socios con control de cupo, asistencia, exportación y cobro de la inscripción a los socios. Además, cada evento puede tener un **formulario de inscripción público** para no socios: un link (`portalsocios.../inscripcion/...`) para compartir por WhatsApp, email o redes, con imagen, preguntas propias (texto, opciones, sí/no), control de cupo y protección anti-spam. Si quien se anota ingresa el CUIT de una empresa socia, se lo reconoce.

**Capacitaciones:** sección propia para los cursos del CeCIP. Cada curso tiene docente, días de cursada, horario, cantidad de clases (con el cronograma de fechas calculado), cupo, precio para socios y para no socios, y cómo se le paga al docente (por clase, por hora, monto total, por alumno o % de lo recaudado). Las inscripciones (desde el portal, el formulario público o el ERP) guardan CUIT, razón social y condición IVA; se cobran con recibo e ingreso en tesorería, o se cargan en la cuenta corriente del socio, y se **facturan automáticamente en ARCA** como el resto de los cobros. Pestaña **Docentes** para darlos de alta, editarlos, desactivarlos o eliminarlos, y **Pagos a docentes** con el historial de lo pagado a cada uno (egreso "Honorarios docentes" en tesorería), lo previsto y lo que resta pagar por curso.

**ComercIA (convenio CeCIP + FactorIA + IEC Services):** en el portal, el socio ve la sección ComercIA con el formato de la app ComercIA Paraná. Arranca con **El convenio**, una página de presentación llamativa con las **promociones** para socios, qué implica el convenio, quiénes participan, cómo sumarse y preguntas frecuentes. Sigue con las pestañas **Ofertas para tu comercio**, **IEC Services** (servicios técnicos) y **Cursos IEC**. Con "Pedir información" se abre WhatsApp de FactorIA con el mensaje listo, y el pedido queda registrado en el ERP (sección ComercIA) para el seguimiento. Todo el contenido (promociones, convenio, ofertas, servicios, cursos, WhatsApp de FactorIA y link de adhesión) se edita desde *ERP → Contenido del portal*.

**Copiloto CeCIP (IA con Gemini):** chat a pantalla completa estilo ChatGPT (portal → *Copiloto IA*), con historial de conversaciones guardado por usuario. Responde sobre el CeCIP (institución, autoridades, beneficios, sede), la cuenta del socio (deuda, vencimientos, cómo pagar), los comunicados, los eventos y ComercIA. Lo que sabe sobre el CeCIP se edita por secciones en *ERP → Contenido del portal → Información para el Copiloto* (Administración y Atención al socio).

**Copiloto CeCIP en el ERP (IA con Gemini):** chat estilo ChatGPT para el personal (menú *Copiloto CeCIP*), con historial propio. Responde con los datos actuales del sistema según el rol de quien pregunta: resumen de gestión, socios y su deuda (buscando por nombre, CUIT o N°), morosos, cuotas, tesorería, banco, facturación, alquileres, eventos, capacitaciones y docentes, ComercIA y cómo hacer cada tarea en el ERP; también redacta emails, mensajes y comunicados. El equipo externo de ComercIA solo recibe información de ComercIA. Usa la misma `GEMINI_API_KEY`.

**Accesos:** el socio se registra con el CUIT de su empresa y el personal aprueba o rechaza la solicitud con un clic. Si el CUIT coincide con el padrón, la solicitud se vincula sola. Al socio le llega un email con el resultado.

**Roles del personal**

| Rol | Puede |
|---|---|
| Administrador | Todo, incluida la configuración y el personal |
| Tesorería | Cuotas, cobros, tesorería, banco, facturación, alquileres y recordatorios |
| Atención al socio | Socios, comunicación, eventos, accesos e información del Copiloto |
| ComercIA (IEC / FactorIA) | Usuario **externo**: solicitudes de ComercIA, todo el contenido de ComercIA y **Difusión ComercIA** (novedades en el portal, email y campañas de WhatsApp propias). No ve socios, cuotas, tesorería ni la comunicación del CeCIP: para email el servidor arma la lista y para WhatsApp recibe solo nombre y teléfono de cada destinatario. |

Los permisos se controlan **en la base de datos**: aunque alguien conozca la API, no puede leer ni modificar lo que no le corresponde. Un socio solo ve los datos de su propia empresa.

---

## Puesta en marcha

### 1. Supabase (base de datos)

1. Creá un proyecto en <https://supabase.com>. Conviene elegir la región São Paulo.
2. En **SQL Editor** ejecutá, en orden:
   1. `supabase/migrations/001_esquema.sql`: tablas, permisos y lógica de cobro.
   2. `supabase/migrations/002_padron_inicial.sql`: los 227 socios del padrón original (con teléfonos y WhatsApp).
   3. `supabase/migrations/005_cobros_alquileres_facturacion.sql`: periodicidades, categorías BANCOS/AA/A/B/C/S/JE-ME, alquileres, facturación, banco, imágenes y formularios públicos.
   4. `supabase/migrations/006_padron_2026.sql`: el Excel "2026 Registro de Asociados". Actualiza los socios por N° de socio, agrega los nuevos y crea las cuotas 2026 pagadas y adeudadas. Al final muestra un resumen y la lista de socios del padrón viejo que no figuran en el Excel, para revisarlos. **BANCOS y S no tienen precio en la planilla**: cargalos en Configuración y volvé a ejecutar el 006 (se puede repetir sin duplicar).
   5. `supabase/migrations/007_valores_cuotas.sql`: valores de cuota por categoría (antes del 006).
   6. `supabase/migrations/008_capacitaciones.sql`: capacitaciones, docentes, pagos a docentes y facturación de inscripciones.
   7. `supabase/migrations/009_copiloto_erp.sql`: Copiloto CeCIP del ERP (datos de gestión según el rol).
   - `004_usuarios_prueba.sql` es opcional (usuarios de prueba). Si ya ejecutaste 001 a 004, solo te falta correr 005 y 006.
3. Creá tu usuario administrador:
   1. En **Authentication → Users → Add user**, cargá tu email y contraseña y marcá "Auto Confirm User".
   2. Editá y ejecutá `supabase/migrations/003_primer_admin.sql`.
4. En **Authentication → URL Configuration**:
   - **Site URL:** `https://portalsocios.centrocomercialparana.com.ar`
   - **Redirect URLs:** agregá `https://portalsocios.centrocomercialparana.com.ar/**`, `https://erp.centrocomercialparana.com.ar/**` y `http://localhost:5173/**`.
5. **Emails de Supabase** (confirmación de cuenta, invitaciones y recuperación de contraseña): el servidor de correo que trae Supabase por defecto solo manda unos pocos emails por hora. Configurá **Authentication → Emails → SMTP Settings** con Resend:
   - host `smtp.resend.com`, puerto `465`, usuario `resend` y como contraseña tu API key de Resend.
   - En la misma sección podés traducir las plantillas al español.
6. **Storage:** la migración 005 crea el bucket público `imagenes` y sus permisos. Si en el resultado aparece el aviso de que no pudo crear los permisos, creá en **Storage → Policies** (bucket `imagenes`) una política de INSERT y otra de DELETE para `authenticated` con la condición `public.is_staff() or public.has_role(array['comercia'])`.
7. En **Project Settings → API** copiá `Project URL`, `anon public key` y `service_role key`. La `service_role key` nunca debe publicarse.

### 2. Resend (emails)

1. Creá una cuenta en <https://resend.com>.
2. En **Domains**, agregá `centrocomercialparana.com.ar` y cargá en el DNS los registros que te indique (SPF/DKIM). Sin este paso los emails van a spam.
3. Creá una **API key**.

### 3. Mercado Pago

1. Ingresá a <https://www.mercadopago.com.ar/developers> con la cuenta de Mercado Pago del CeCIP.
2. En **Tus integraciones → Crear aplicación**, elegí "Pagos online / Checkout Pro".
3. Copiá el **Access Token de producción**. Para probar, primero usá el de prueba.
4. No hace falta configurar webhooks en el panel: cada link de pago ya le indica a Mercado Pago a dónde avisar (`/api/pagos/webhook`).

### 4. Vercel (hosting)

1. Subí esta carpeta a un repositorio de GitHub e importalo en <https://vercel.com> con **Add New → Project**. Vercel detecta que es Vite.
2. En **Settings → Environment Variables**, cargá todas las variables de `.env.example`:

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL`, `SUPABASE_URL` | Project URL de Supabase |
   | `VITE_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `VITE_ERP_URL`, `ERP_URL` | `https://erp.centrocomercialparana.com.ar` |
   | `VITE_PORTAL_URL`, `PORTAL_URL` | `https://portalsocios.centrocomercialparana.com.ar` |
   | `MP_ACCESS_TOKEN` | Access Token de Mercado Pago |
   | `RESEND_API_KEY` | API key de Resend |
   | `EMAIL_FROM` | `CeCIP Paraná <administracion@centrocomercialparana.com.ar>` |
   | `EMAIL_REPLY_TO` | casilla donde querés recibir las respuestas |
   | `CRON_SECRET` | una cadena larga al azar |
   | `GEMINI_API_KEY` | clave de Google AI Studio para el Copiloto (puede ser la misma de ComercIA) |
   | `GEMINI_MODEL` | opcional: modelo de Gemini a usar primero |
   | `VITE_FACTORIA_WHATSAPP` | opcional: WhatsApp de FactorIA por defecto (también se configura en *ERP → Contenido → Ajustes de ComercIA*) |

3. En **Settings → Domains**, agregá los dos dominios: `erp.centrocomercialparana.com.ar` y `portalsocios.centrocomercialparana.com.ar`.
4. En el proveedor DNS del dominio, creá dos registros **CNAME** que apunten a `cname.vercel-dns.com`, uno para `erp` y otro para `portalsocios`.
5. Hacé **Redeploy** para que tome las variables.

> El plan gratuito de Vercel (Hobby) es para uso no comercial. Para una institución corresponde el plan **Pro**.
> Los recordatorios automáticos se ejecutan todos los días a las 9:00 (hora argentina).

### 5. Conectar la web del CeCIP

En la web actual, el botón **"Login Socios"** muestra "Próximamente". Cambialo por un link al portal:

```html
<a href="https://portalsocios.centrocomercialparana.com.ar">Login Socios</a>
<!-- Para abrir directamente el formulario de registro: -->
<a href="https://portalsocios.centrocomercialparana.com.ar/?registro=1">Registrarme como socio</a>
```

En el proyecto original de la web, los botones están en `src/App.tsx`, buscando `socioslogin` (escritorio) y `mobilelogin` (celular).

### 6. Primeros pasos dentro del ERP

1. **Configuración → Cuotas y cobranza:** revisá el valor mensual de cada categoría (falta BANCOS y S), los descuentos por forma de pago, el día de vencimiento y el interés por mora. Ojo: el interés se aplica también a las deudas importadas del Excel; si no corresponde, dejalo en 0.
2. **Configuración → Institución:** cargá CUIT, dirección y los datos bancarios para transferencias (CBU y alias).
3. **Socios:** filtrá "Sin categoría", seleccioná a todos y usá **Asignar categoría**. Completá los CUIT, o importá un Excel con `cuit` y `numero_socio`.
4. **Configuración → Personal:** invitá a tesorería y atención al socio.
5. **Cuotas → Generar cuotas del mes.**
6. **Alquileres → Inmuebles y contratos:** cargá nombre, dirección y el contrato vigente de cada inmueble.
7. **Facturación → Conexión ARCA / n8n:** condición del CeCIP frente al IVA, punto de venta y, cuando el flujo de n8n esté listo, activá la facturación automática.

### 7. n8n: facturación en ARCA y movimientos de Santander

Las variables `N8N_FACTURAS_WEBHOOK_URL`, `N8N_BANCO_WEBHOOK_URL` y `N8N_SECRET` se cargan en Vercel. Todas las llamadas entre el ERP y n8n llevan el header `x-cecip-secret` con el valor de `N8N_SECRET` (en n8n, verificalo en el nodo Webhook).

**Facturas:** el ERP hace `POST` a `N8N_FACTURAS_WEBHOOK_URL` con `{ evento: "emitir_factura", emisor, factura, receptor, callback_url }` (el detalle completo está en *Facturación → Conexión ARCA / n8n*). El flujo autentica en WSAA con el certificado del CeCIP, pide el último número (`FECompUltimoAutorizado`) y emite (`FECAESolicitar`). Responde `{ cae, cae_vencimiento, numero, pdf_url }` (o `{ error }`), en la misma respuesta o después con un `POST` a `/api/integraciones/facturas-callback` incluyendo `factura_id`. Las facturas en cola se reintentan una vez por día.

**Santander:** con el convenio de API del banco, un flujo de n8n consulta los movimientos y hace `POST /api/integraciones/banco-movimientos` con `{ banco: "Santander", movimientos: [{ id, fecha, descripcion, monto, saldo, referencia, contraparte_nombre, contraparte_cuit }] }` (monto positivo = crédito). El botón *Sincronizar con Santander* llama a `N8N_BANCO_WEBHOOK_URL` con `{ desde, hasta, callback_url }`; el flujo puede responder con `movimientos` o enviarlos después. Repetir un movimiento no lo duplica.

---

## Modo demo (ver el sistema sin crear cuentas)

```bash
npm install
```

```bash
npm run demo
```

Abrí <http://localhost:5173/erp> para el ERP y <http://localhost:5173/portal> para el portal de socios.

- Carga una base de datos de ejemplo **en tu navegador**, con el mismo esquema y permisos que la real: el padrón, cuotas de los últimos meses, pagos, gastos, comunicados, eventos y solicitudes.
- No se envían emails. Los links de Mercado Pago abren un checkout simulado que acredita el pago.
- El Copiloto responde de forma automática con los datos de ejemplo; Gemini solo se usa en la versión real.
- En el recuadro amarillo podés cambiar de rol (Admin, Tesorería, Atención) y usar **Reiniciar demo** para volver a los datos iniciales.
- El modo demo no se incluye en la versión que se publica en Vercel.

## Desarrollo local

Requiere Node 22.

```bash
npm install
```

```bash
cp .env.example .env
```

Completá `.env` con tus claves y después:

```bash
npm run dev
```

- ERP: <http://localhost:5173/erp>
- Portal: <http://localhost:5173/portal>

Las funciones `/api` también corren en local. El webhook de Mercado Pago no puede llegar a `localhost`, pero al volver del pago el portal verifica el pago igual.

## Estructura

```
api/                     Funciones serverless (Vercel)
  pagos/link.ts          Crea links de Mercado Pago
  pagos/webhook.ts       Recibe la notificación de pago y acredita la cuota
  pagos/verificar.ts     Verificación al volver de Mercado Pago
  cobranzas/recordatorio.ts  Email de deuda con link de pago
  comunicaciones/enviar.ts   Emails masivos
  accesos/resolver.ts    Aprobar/rechazar socios del portal (+ email)
  staff/invitar.ts       Invitar personal
  copilot.ts             Copiloto CeCIP (Gemini)
  cron/recordatorios.ts  Recordatorios automáticos diarios (y reintento de facturas en cola)
  integraciones/[accion].ts  n8n: facturas ARCA (procesar/callback) y movimientos de Santander
src/erp/                 ERP administrativo
src/portal/              Portal de socios
shared/                  Tipos de ComercIA/IEC y armado del contexto del Copiloto (portal, ERP y api)
supabase/migrations/     Esquema SQL, permisos y datos iniciales
```
