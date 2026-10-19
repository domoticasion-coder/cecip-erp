# Flujos de n8n del ERP CeCIP

Instancia: `https://n8n.smarteco.com.ar` (n8n 1.111). Los flujos se exportan en `n8n/cecip/` (versión de referencia; la que corre es la de n8n).

## Mapa de procesos

| Proceso | Workflow (entrada) | Sub-procesos |
|---|---|---|
| **Facturación masiva (ARCA)** | `CeCIP · Facturas: Recibir lote (webhook)` · `POST /webhook/cecip-facturas` | `Facturas: Emitir y notificar` → `ARCA: Emitir comprobante` → `ARCA: Obtener token WSAA` → `ERP: Enviar resultado` |
| **Movimientos Santander (a pedido)** | `CeCIP · Banco: Sincronizar (webhook)` · `POST /webhook/cecip-banco` | `Santander: Obtener movimientos` → `ERP: Enviar resultado` |
| **Movimientos Santander (diario)** | `CeCIP · Banco: Sincronización diaria` (lun-vie 7:30) | `Santander: Obtener movimientos` → `ERP: Enviar resultado` |
| **Envío masivo de emails** | `CeCIP · Envíos: Recibir email masivo (webhook)` · `POST /webhook/cecip-envios` | `Email: Enviar lote por Resend` → `ERP: Enviar resultado` |
| **Alertas** | `CeCIP · Alertas de errores` (workflow de errores de los 4 de arriba) | — |
| **Configuración** | `CeCIP · Config` (sub-workflow) | Usado por todos |

### Cómo funciona la facturación masiva
1. El ERP junta las facturas en cola (cada cobro con facturación automática genera una) y las manda **en un solo pedido**.
2. n8n responde `202` enseguida, así el ERP no espera a ARCA (Vercel corta a los 60 s).
3. n8n emite **de a una y en orden** (para no pisar la numeración de ARCA): pide el último número, solicita el CAE y avisa cada resultado al ERP (`/api/integraciones/facturas-callback`).
4. Si algo falla, el ERP marca esa factura "con error" para reintentar; las que quedan en cola se reenvían solas una vez por día.

### Envío masivo
El ERP (Comunicados por email y Difusión ComercIA) entrega la lista completa a n8n, que envía de a 100 por Resend con una pausa entre lotes y le devuelve al ERP el resultado de cada email para el historial. Sin `N8N_ENVIOS_WEBHOOK_URL` el ERP sigue enviando directo, como antes.

## Seguridad
- Todo lo que entra y sale entre el ERP y n8n lleva el header `x-cecip-secret`. En n8n es la credencial **"CeCIP ERP · Clave compartida"**; en Vercel, la variable `N8N_SECRET` (el mismo valor). Un pedido sin la clave recibe `403`.
- Nada secreto va en los nodos: claves en Credenciales; certificado de ARCA en archivos del servidor.

## Puesta en marcha

1. **Vercel → Environment Variables** (Production) y redeploy:
   - `N8N_SECRET` = el valor de la credencial "CeCIP ERP · Clave compartida"
   - `N8N_FACTURAS_WEBHOOK_URL` = `https://n8n.smarteco.com.ar/webhook/cecip-facturas`
   - `N8N_BANCO_WEBHOOK_URL` = `https://n8n.smarteco.com.ar/webhook/cecip-banco`
   - `N8N_ENVIOS_WEBHOOK_URL` = `https://n8n.smarteco.com.ar/webhook/cecip-envios` (opcional)
2. **n8n → activar** los workflows de entrada: Facturas (webhook), Banco (webhook), Envíos (webhook) y, cuando haya API de Santander, Banco diario.
3. **CeCIP · Config**: completar `email_alertas`. Arranca con `ambiente_arca = simulacion` (CAE de prueba) y `modo_banco = simulacion`.
4. **Credenciales a crear en n8n** (y elegir en el nodo indicado):
   - `Resend API` (Header Auth: `Authorization` = `Bearer re_…`) → nodo *Resend: enviar lote*.
   - SMTP (p. ej. Resend: `smtp.resend.com`, 465, usuario `resend`) → nodo *Enviar alerta por email*.
   - OAuth2 de Santander (cuando esté el convenio) → nodo *Santander: movimientos*.

### Pasar a ARCA real
1. Generar en ARCA el certificado del CUIT del CeCIP, asociarlo a **wsfe** y habilitar un **punto de venta para Web Services** (cargarlo en ERP → Facturación → Conexión).
2. Copiar `cecip.crt` y `cecip.key` al servidor en la carpeta montada como `/files/arca` del contenedor de n8n (ej.: volumen `./arca:/files/arca`).
3. En el contenedor de n8n agregar la variable `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (la firma del pedido de acceso usa el módulo `crypto` de Node) y reiniciar.
4. En `CeCIP · Config` poner `ambiente_arca = homologacion`, probar, y después `produccion`.

El token de ARCA (dura 12 h) se guarda en `/files/arca/ta-<ambiente>.json` y se reutiliza: ARCA rechaza pedir uno nuevo mientras el anterior esté vigente.

### Santander
Requiere el convenio de API con el banco. Con los datos del convenio: crear la credencial OAuth2, completar `santander_api_url` y `santander_cuenta` en Config, revisar en el nodo *Santander: movimientos* la ruta y los parámetros de fecha según la documentación que entregue el banco, y poner `modo_banco = produccion`. El nodo *Normalizar movimientos* ya acepta los formatos habituales (Open Banking / Berlin Group).
