import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Save, Send, XCircle } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fecha, hoyISO, pesos } from "../../lib/format";
import { ESTADOS_FACTURA, type Configuracion, type EstadoFactura, type Factura } from "../../lib/types";
import { Button, Card, Checkbox, Field, Input, Loading, PageHeader, Select, Stat, Tabs, useToast } from "../../components/ui";
import { useConfig, useInvalidate } from "../data";
import { FacturasTabla, numeroFactura, useEnviarFacturas } from "../components/Facturas";

type Tab = "comprobantes" | "conexion";

export default function Facturacion() {
  const [tab, setTab] = useState<Tab>("comprobantes");
  return (
    <>
      <PageHeader title="Facturación electrónica" subtitle="Facturas de cuotas y alquileres emitidas en ARCA a través de n8n" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "comprobantes", label: "Comprobantes" },
        { value: "conexion", label: "Conexión ARCA / n8n" },
      ]} />
      {tab === "comprobantes" ? <Comprobantes /> : <Conexion />}
    </>
  );
}

function Comprobantes() {
  const enviar = useEnviarFacturas();
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [estado, setEstado] = useState<EstadoFactura | "">("");
  const [origen, setOrigen] = useState("");
  const [enviando, setEnviando] = useState(false);

  const { data: facturas, isLoading } = useQuery({
    queryKey: ["facturas", "lista", mes],
    queryFn: async () => {
      let q = supabase.from("facturas").select("*").order("created_at", { ascending: false }).range(0, 1999);
      if (mes) {
        const [y, m] = mes.split("-").map(Number);
        const hasta = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
        q = q.gte("fecha", `${mes}-01`).lt("fecha", hasta);
      }
      return unwrap(await q) as Factura[];
    },
  });

  // Las que necesitan atención no dependen del mes
  const { data: pendientes } = useQuery({
    queryKey: ["facturas", "pendientes"],
    queryFn: async () => unwrap(await supabase.from("facturas").select("*").in("estado", ["en_cola", "error", "enviada"]).order("created_at")) as Factura[],
  });

  const lista = useMemo(() => (facturas || []).filter((f) => (!estado || f.estado === estado) && (!origen || f.origen === origen)), [facturas, estado, origen]);
  const emitidas = (facturas || []).filter((f) => f.estado === "emitida");
  const cola = (pendientes || []).filter((f) => f.estado === "en_cola");
  const errores = (pendientes || []).filter((f) => f.estado === "error");
  const esperando = (pendientes || []).filter((f) => f.estado === "enviada");

  function exportar() {
    descargarCSV(`facturas-${mes || "todas"}`, lista.map((f) => ({
      fecha: fecha(f.fecha), comprobante: numeroFactura(f), receptor: f.receptor_nombre, cuit: f.receptor_cuit, condicion_iva: f.receptor_condicion_iva,
      concepto: f.concepto, neto: Number(f.neto), iva: Number(f.iva), total: Number(f.total), estado: ESTADOS_FACTURA[f.estado].label, cae: f.cae,
    })));
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Emitidas en el mes" value={emitidas.length} hint={pesos(emitidas.reduce((a, f) => a + Number(f.total), 0))} tone="good" />
        <Stat label="En cola" value={cola.length} tone={cola.length ? "warn" : "default"} hint="Esperando envío a ARCA" />
        <Stat label="Esperando CAE" value={esperando.length} hint="n8n las recibió" />
        <Stat label="Con error" value={errores.length} tone={errores.length ? "bad" : "default"} hint={errores.length ? "Revisá el detalle y reintentá" : undefined} />
      </div>

      {!!(cola.length || errores.length) && (
        <Card className="mb-5" title="Para enviar o revisar"
          actions={!!cola.length && (
            <Button size="sm" loading={enviando} icon={<Send className="h-3.5 w-3.5" />} onClick={async () => { setEnviando(true); await enviar(); setEnviando(false); }}>
              Enviar las {cola.length} en cola
            </Button>
          )}>
          <FacturasTabla facturas={[...errores, ...cola]} />
        </Card>
      )}

      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            Comprobantes de
            <Input type="month" className="w-auto py-1" value={mes} onChange={(e) => setMes(e.target.value)} />
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Select className="w-auto py-1 text-xs" value={estado} onChange={(e) => setEstado(e.target.value as EstadoFactura | "")}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS_FACTURA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Select className="w-auto py-1 text-xs" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              <option value="">Cuotas y alquileres</option>
              <option value="cuota">Cuotas sociales</option>
              <option value="alquiler">Alquileres</option>
            </Select>
            <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportar}>Exportar</Button>
          </div>
        }
      >
        {isLoading ? <Loading /> : <FacturasTabla facturas={lista} />}
      </Card>
    </>
  );
}

const EJEMPLO_PAYLOAD = `{
  "evento": "emitir_factura",
  "callback_url": "https://erp.centrocomercialparana.com.ar/api/integraciones/facturas-callback",
  "emisor":   { "razon_social": "Centro Comercial e Industrial de Paraná", "cuit": "30XXXXXXXXX", "condicion_iva": "exento", "punto_venta": 3 },
  "factura":  { "id": "uuid", "tipo": "C", "cbte_tipo": 11, "punto_venta": 3, "fecha": "2026-10-15",
                "concepto": "Cuota social 5° bimestre 2026 (sep-oct)", "concepto_arca": 2,
                "servicio_desde": "2026-09-01", "servicio_hasta": "2026-10-31", "vencimiento_pago": "2026-10-15",
                "moneda": "PES", "neto": 12000, "iva_alicuota": 0, "iva": 0, "total": 12000 },
  "receptor": { "nombre": "DEL MESTRE IND. Y COM. S.R.L.", "doc_tipo": 80, "doc_nro": "30503497790",
                "condicion_iva": "RI", "condicion_iva_id": 1, "email": "ventas@..." }
}`;

const EJEMPLO_RESPUESTA = `{ "factura_id": "uuid", "cae": "76123456789012", "cae_vencimiento": "20261025",
  "numero": 1523, "pdf_url": "https://.../factura.pdf" }
// o, si ARCA la rechaza:
{ "factura_id": "uuid", "error": "10016: El CUIT del receptor no es válido" }`;

function Conexion() {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Configuracion | null>(null);
  useEffect(() => { if (cfg) setF(cfg); }, [cfg]);

  const { data: estado } = useQuery({
    queryKey: ["integraciones", "estado"],
    queryFn: () => api<{ facturas: boolean; banco: boolean; secreto: boolean; callback_facturas: string; endpoint_banco: string }>("integraciones/estado"),
  });

  async function guardar() {
    if (!f) return;
    const { error } = await supabase.from("configuracion").update({
      facturacion_auto: f.facturacion_auto, factura_condicion_emisor: f.factura_condicion_emisor,
      factura_punto_venta: f.factura_punto_venta ? Number(f.factura_punto_venta) : null,
      factura_iva_alicuota: Number(String(f.factura_iva_alicuota).replace(",", ".")) || 0,
    }).eq("id", 1);
    if (error) return toast(traducirError(error.message), "error");
    toast("Configuración de facturación guardada.");
    invalidate("configuracion");
  }

  if (!f) return <Loading />;
  const esAdmin = can();
  const Ok = ({ v, si, no }: { v?: boolean; si: string; no: string }) => (
    <div className="flex items-center gap-2 text-sm">
      {v ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
      {v ? si : no}
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Datos de facturación" actions={esAdmin && <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={guardar}>Guardar</Button>}>
        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-slate-200 p-3">
            <Checkbox checked={f.facturacion_auto} onChange={(v) => setF({ ...f, facturacion_auto: v })} label={<b>Facturar automáticamente cada cobro</b>} />
            <p className="mt-1 text-xs text-slate-500">
              Al cobrar una cuota (por caja, transferencia, Mercado Pago o conciliación bancaria) o un alquiler, se genera la factura y se envía a ARCA.
              En cada socio y contrato se puede desactivar. Las cuotas pagadas importadas del Excel no se facturan.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Condición del CeCIP frente al IVA" hint="Exento o Monotributo emiten factura C; Responsable Inscripto, A o B.">
              <Select value={f.factura_condicion_emisor} onChange={(e) => setF({ ...f, factura_condicion_emisor: e.target.value as Configuracion["factura_condicion_emisor"] })}>
                <option value="exento">IVA Exento</option>
                <option value="monotributo">Monotributo</option>
                <option value="ri">Responsable Inscripto</option>
              </Select>
            </Field>
            <Field label="Punto de venta (ARCA)" hint="El punto de venta habilitado para Web Services.">
              <Input type="number" min={1} value={f.factura_punto_venta ?? ""} onChange={(e) => setF({ ...f, factura_punto_venta: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            {f.factura_condicion_emisor === "ri" && (
              <Field label="Alícuota de IVA (%)">
                <Input inputMode="decimal" value={String(f.factura_iva_alicuota)} onChange={(e) => setF({ ...f, factura_iva_alicuota: e.target.value as unknown as number })} />
              </Field>
            )}
          </div>
          {!esAdmin && <p className="text-xs text-slate-500">Solo el Administrador puede cambiar estos datos.</p>}
        </div>
      </Card>

      <Card title="Estado de la conexión">
        <div className="space-y-2 p-4">
          {estado ? (
            <>
              <Ok v={estado.facturas} si="Webhook de facturación de n8n configurado" no="Falta N8N_FACTURAS_WEBHOOK_URL" />
              <Ok v={estado.secreto} si="Clave compartida con n8n configurada" no="Falta N8N_SECRET" />
              <Ok v={estado.banco} si="Webhook de Santander (n8n) configurado" no="Falta N8N_BANCO_WEBHOOK_URL (opcional)" />
              <div className="pt-2 text-xs text-slate-500">
                Estas claves se cargan como variables de entorno en Vercel (no en la base), así nadie puede verlas desde el sistema.
              </div>
              <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs">
                <div className="font-semibold text-slate-700">URL de respuesta para n8n (callback)</div>
                <code className="break-all">{estado.callback_facturas}</code>
              </div>
            </>
          ) : (
            <Loading />
          )}
        </div>
      </Card>

      <Card title="Cómo armar el flujo en n8n" className="lg:col-span-2">
        <div className="space-y-3 p-4 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>En ARCA: generá el <b>certificado digital</b> del CUIT del CeCIP, asocialo al servicio <b>«Facturación electrónica» (wsfe)</b> y habilitá un <b>punto de venta para Web Services</b>.</li>
            <li>En n8n creá un flujo que empiece con un nodo <b>Webhook (POST)</b>. Verificá que el header <code>x-cecip-secret</code> sea igual a tu clave <code>N8N_SECRET</code>.</li>
            <li>Con los datos recibidos, autenticá con <b>WSAA</b> (certificado), pedí el último número con <code>FECompUltimoAutorizado</code> y emití con <code>FECAESolicitar</code> (podés usar un servicio como AfipSDK o tu propio nodo).</li>
            <li>Respondé al webhook con el resultado (o enviálo después por POST a la URL de callback con el mismo header).</li>
            <li>En Vercel cargá <code>N8N_FACTURAS_WEBHOOK_URL</code> (la URL del webhook de n8n) y <code>N8N_SECRET</code>, y volvé a desplegar.</li>
          </ol>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">Lo que el ERP le envía a n8n</div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{EJEMPLO_PAYLOAD}</pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-600">Lo que n8n tiene que responder</div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{EJEMPLO_RESPUESTA}</pre>
              <p className="mt-2 text-xs text-slate-500">
                Si n8n responde sin CAE, la factura queda «Enviada a ARCA» hasta que llegue el callback. Si hay error, queda marcada para revisar y reintentar.
                Las facturas en cola se reintentan solas una vez por día.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
