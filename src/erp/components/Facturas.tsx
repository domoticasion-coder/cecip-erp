import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, FileText, Receipt, RotateCw, Send } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, fechaHora, formatCuit, pesos } from "../../lib/format";
import { ESTADOS_FACTURA, type CuotaDetalle, type Factura, type SocioResumen } from "../../lib/types";
import { Badge, Button, Card, Checkbox, Empty, Loading, Table, useToast } from "../../components/ui";
import { enviarFacturasEnCola, useConfig, useInvalidate } from "../data";

export const numeroFactura = (f: Pick<Factura, "tipo" | "punto_venta" | "numero">) =>
  `${f.tipo} ${String(f.punto_venta || 0).padStart(5, "0")}-${f.numero ? String(f.numero).padStart(8, "0") : "········"}`;

/** Envía las facturas a n8n y avisa el resultado */
export function useEnviarFacturas() {
  const toast = useToast();
  const invalidate = useInvalidate();
  return async (ids?: string[]) => {
    const r = await enviarFacturasEnCola(ids);
    await invalidate("facturas");
    if (!r) return toast("No se pudo contactar al servidor de facturación. Quedan en cola y se reintentan solas una vez por día.", "error");
    if (r.sinConfigurar) return toast("La conexión con n8n / ARCA todavía no está configurada (ver Facturación > Conexión). Las facturas quedan en cola.", "error");
    if (!r.enviadas && !r.errores) return toast("No hay facturas en cola para enviar.");
    toast(
      `${r.enviadas} enviada(s) a ARCA` + (r.emitidas ? ` · ${r.emitidas} con CAE` : "") + (r.errores ? ` · ${r.errores} con error` : ""),
      r.errores ? "error" : "ok"
    );
  };
}

export function FacturasTabla({ facturas, showReceptor = true }: { facturas: Factura[]; showReceptor?: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const enviar = useEnviarFacturas();
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function anular(f: Factura) {
    if (!confirm(`¿Anular la factura de "${f.concepto}"? (No se envió a ARCA, así que no hace falta nota de crédito.)`)) return;
    const { error } = await supabase.from("facturas").update({ estado: "anulada" }).eq("id", f.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("facturas");
  }

  if (!facturas.length) return <Empty icon={<Receipt className="h-8 w-8" />}>No hay facturas.</Empty>;
  return (
    <Table>
      <thead className="bg-slate-50">
        <tr>
          <th className="th">Fecha</th>
          <th className="th">Comprobante</th>
          {showReceptor && <th className="th">Receptor</th>}
          <th className="th">Concepto</th>
          <th className="th text-right">Total</th>
          <th className="th">Estado</th>
          <th className="th"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {facturas.map((f) => (
          <tr key={f.id}>
            <td className="td whitespace-nowrap text-sm">{fecha(f.fecha)}</td>
            <td className="td whitespace-nowrap font-mono text-xs">
              {numeroFactura(f)}
              {f.cae && <div className="font-sans text-[11px] text-slate-500">CAE {f.cae}{f.cae_vencimiento && ` · vto ${fecha(f.cae_vencimiento)}`}</div>}
            </td>
            {showReceptor && (
              <td className="td text-sm">
                {f.receptor_nombre}
                <div className="text-xs text-slate-500">{f.receptor_cuit ? `CUIT ${formatCuit(f.receptor_cuit)}` : "Sin CUIT"} · {f.receptor_condicion_iva}</div>
              </td>
            )}
            <td className="td text-sm">{f.concepto}{f.origen === "alquiler" && <span className="ml-1"><Badge tone="purple">Alquiler</Badge></span>}{f.origen === "inscripcion" && <span className="ml-1"><Badge tone="blue">Capacitación</Badge></span>}</td>
            <td className="td text-right tabular-nums">
              {pesos(f.total)}
              {Number(f.iva) > 0 && <div className="text-[11px] text-slate-500">IVA {pesos(f.iva)}</div>}
            </td>
            <td className="td">
              <Badge tone={ESTADOS_FACTURA[f.estado].tone}>{ESTADOS_FACTURA[f.estado].label}</Badge>
              {f.error && <div className="mt-0.5 max-w-56 text-[11px] text-red-600">{f.error}</div>}
              {f.estado === "enviada" && f.enviada_at && <div className="text-[11px] text-slate-500">{fechaHora(f.enviada_at)}</div>}
            </td>
            <td className="td whitespace-nowrap text-right">
              {f.pdf_url && (
                <a href={f.pdf_url} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                  <FileText className="h-3.5 w-3.5" /> PDF
                </a>
              )}
              {can("tesoreria") && ["en_cola", "error"].includes(f.estado) && (
                <>
                  <Button size="sm" variant="ghost" loading={ocupado === f.id} icon={f.estado === "error" ? <RotateCw className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                    onClick={async () => { setOcupado(f.id); await enviar([f.id]); setOcupado(null); }}>
                    {f.estado === "error" ? "Reintentar" : "Emitir"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-slate-400" title="Anular" onClick={() => anular(f)}><Ban className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Pestaña "Facturación" de cada socio */
export function FacturacionSocio({ socio }: { socio: SocioResumen }) {
  const { can } = useAuth();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const enviar = useEnviarFacturas();
  const [facturando, setFacturando] = useState(false);

  const { data: facturas } = useQuery({
    queryKey: ["facturas", "socio", socio.id],
    queryFn: async () =>
      unwrap(await supabase.from("facturas").select("*").eq("socio_id", socio.id).eq("origen", "cuota").order("created_at", { ascending: false })) as Factura[],
  });

  // Cobros hechos desde el ERP que todavía no tienen factura
  const { data: sinFactura } = useQuery({
    queryKey: ["facturas", "sin-factura", socio.id],
    queryFn: async () => {
      const cuotas = unwrap(
        await supabase.from("cuotas_detalle").select("*").eq("socio_id", socio.id).eq("estado", "pagada").eq("importada", false)
          .order("fecha_pago", { ascending: false }).limit(50)
      ) as CuotaDetalle[];
      const fact = unwrap(await supabase.from("facturas").select("cuota_id").eq("socio_id", socio.id).neq("estado", "anulada")) as { cuota_id: string }[];
      const con = new Set(fact.map((f) => f.cuota_id));
      return cuotas.filter((c) => !con.has(c.id));
    },
  });

  async function cambiarAuto(v: boolean) {
    const { error } = await supabase.from("socios").update({ facturar_auto: v }).eq("id", socio.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("socio", "socios");
  }

  async function facturar(ids: string[]) {
    setFacturando(true);
    const nuevas: string[] = [];
    for (const id of ids) {
      const { data, error } = await supabase.rpc("facturar", { p_cuota: id });
      if (error) { setFacturando(false); return toast(traducirError(error.message), "error"); }
      if (data) nuevas.push(data as string);
    }
    await invalidate("facturas");
    await enviar(nuevas);
    setFacturando(false);
  }

  const sinCuit = !socio.cuit;
  return (
    <div className="space-y-5">
      <Card title="Facturación electrónica (ARCA)">
        <div className="grid gap-3 p-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">Receptor</div>
            <div className="font-medium">{socio.razon_social}</div>
            <div className="text-xs">{socio.cuit ? `CUIT ${formatCuit(socio.cuit)}` : <span className="text-amber-700">Sin CUIT: se factura a consumidor final</span>}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Condición frente al IVA</div>
            <div>{socio.condicion_iva || <span className="text-amber-700">Sin dato ({sinCuit ? "consumidor final" : "se toma Responsable Inscripto"})</span>}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Emisión automática</div>
            {can("tesoreria", "atencion") ? (
              <Checkbox checked={socio.facturar_auto} onChange={cambiarAuto} label="Facturar cada cobro" />
            ) : (
              <div>{socio.facturar_auto ? "Sí" : "No"}</div>
            )}
            {cfg && !cfg.facturacion_auto && <div className="text-xs text-amber-700">La facturación automática general está desactivada (Facturación &gt; Conexión).</div>}
          </div>
        </div>
      </Card>

      {can("tesoreria") && !!sinFactura?.length && (
        <Card
          title={`Cobros sin factura (${sinFactura.length})`}
          actions={<Button size="sm" loading={facturando} icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => facturar(sinFactura.map((c) => c.id))}>Facturar todos</Button>}
        >
          <ul className="divide-y divide-slate-100">
            {sinFactura.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div>
                  {c.concepto}
                  <div className="text-xs text-slate-500">Cobrada el {fecha(c.fecha_pago)} · {c.metodo_pago}{c.recibo_numero && ` · Recibo N° ${c.recibo_numero}`}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{pesos(c.monto_pagado || c.monto)}</span>
                  <Button size="sm" variant="secondary" disabled={facturando} onClick={() => facturar([c.id])}>Facturar</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Facturas emitidas al socio">
        {facturas ? <FacturasTabla facturas={facturas} showReceptor={false} /> : <Loading />}
      </Card>
    </div>
  );
}
