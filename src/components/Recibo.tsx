import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Printer, ArrowLeft } from "lucide-react";
import { supabase, unwrap } from "../lib/supabase";
import { fecha, formatCuit, pesos } from "../lib/format";
import type { Configuracion, CuotaDetalle, Socio } from "../lib/types";
import { Button, Empty, Loading } from "./ui";

export default function Recibo() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["recibo", id],
    queryFn: async () => {
      const cuota = unwrap(await supabase.from("cuotas_detalle").select("*").eq("id", id!).single()) as CuotaDetalle;
      const [socio, cfg] = await Promise.all([
        supabase.from("socios").select("*").eq("id", cuota.socio_id).single().then(unwrap) as Promise<Socio>,
        supabase.from("configuracion").select("*").eq("id", 1).single().then(unwrap) as Promise<Configuracion>,
      ]);
      return { cuota, socio, cfg };
    },
  });

  if (isLoading) return <Loading />;
  if (!data || data.cuota.estado !== "pagada") return <Empty>El recibo no está disponible.</Empty>;
  const { cuota, socio, cfg } = data;

  return (
    <div className="min-h-full bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-2xl justify-between px-4">
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>Volver</Button>
        <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Imprimir / Guardar PDF</Button>
      </div>

      <div className="mx-auto max-w-2xl bg-white p-10 shadow print:shadow-none">
        <div className="flex items-start justify-between border-b-2 border-brand-700 pb-5">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="h-14" />
            <div className="text-xs text-slate-600">
              <div className="text-sm font-bold text-slate-900">{cfg.nombre_institucion}</div>
              {cfg.cuit && <div>CUIT {formatCuit(cfg.cuit)}</div>}
              {cfg.direccion && <div>{cfg.direccion}</div>}
              {(cfg.telefono || cfg.email) && <div>{[cfg.telefono, cfg.email].filter(Boolean).join(" · ")}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-brand-700">RECIBO</div>
            <div className="font-mono text-sm">N° {String(cuota.recibo_numero).padStart(8, "0")}</div>
            <div className="text-sm text-slate-600">Fecha: {fecha(cuota.fecha_pago)}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-500">Recibimos de</div>
            <div className="font-semibold">{socio.razon_social}</div>
            {socio.nombre_comercial && <div>{socio.nombre_comercial}</div>}
            {socio.cuit && <div>CUIT {formatCuit(socio.cuit)}</div>}
            {socio.direccion && <div className="text-slate-600">{socio.direccion}</div>}
          </div>
          <div className="text-right">
            {socio.numero_socio && (
              <>
                <div className="text-xs uppercase text-slate-500">Socio N°</div>
                <div className="font-semibold">{socio.numero_socio}</div>
              </>
            )}
          </div>
        </div>

        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
              <th className="py-2">Concepto</th>
              <th className="py-2 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2">{cuota.concepto}</td>
              <td className="py-2 text-right tabular-nums">{pesos(cuota.monto)}</td>
            </tr>
            {Number(cuota.interes_cobrado) > 0 && (
              <tr className="border-b border-slate-100">
                <td className="py-2">Intereses por pago fuera de término</td>
                <td className="py-2 text-right tabular-nums">{pesos(cuota.interes_cobrado)}</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 text-right font-semibold">TOTAL</td>
              <td className="pt-3 text-right text-lg font-bold tabular-nums">{pesos(cuota.monto_pagado)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-6 text-sm text-slate-600">
          Forma de pago: <b>{cuota.metodo_pago}</b>
          {cuota.referencia_pago && <> · Ref.: {cuota.referencia_pago}</>}
        </div>

        <p className="mt-12 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">
          Comprobante de pago emitido por el sistema de gestión de {cfg.nombre_institucion}. No válido como factura.
        </p>
      </div>
    </div>
  );
}
