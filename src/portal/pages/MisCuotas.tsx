import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, CreditCard, FileText, Landmark, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { fecha, pesos } from "../../lib/format";
import { Button, Card, Empty, ErrorBox, Loading, SituacionBadge, Table } from "../../components/ui";
import { useConfigPortal, useMisCuotas, usePagar } from "../data";

export default function MisCuotas({ socioId }: { socioId: string }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: cuotas, isLoading } = useMisCuotas(socioId);
  const { data: cfg } = useConfigPortal();
  const { pagar, pagando, error } = usePagar();
  const [retorno, setRetorno] = useState<"ok" | "pendiente" | "error" | null>(null);

  // Vuelta desde Mercado Pago: verificar el pago al instante
  useEffect(() => {
    const estado = params.get("pago") as "ok" | "pendiente" | "error" | null;
    if (!estado) return;
    setRetorno(estado);
    const paymentId = params.get("payment_id") || params.get("collection_id");
    const refrescar = () => qc.invalidateQueries({ queryKey: ["mis-cuotas"] });
    if (paymentId && /^\d+$/.test(paymentId)) {
      api("pagos/verificar", { payment_id: paymentId }).catch(() => {}).finally(refrescar);
    } else refrescar();
    setParams({}, { replace: true });
  }, [params, qc, setParams]);

  if (isLoading) return <Loading />;
  const pendientes = (cuotas || []).filter((c) => c.estado === "pendiente").sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  const pagadas = (cuotas || []).filter((c) => c.estado === "pagada");
  const deuda = pendientes.reduce((a, c) => a + Number(c.total), 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Mis cuotas</h1>

      {retorno === "ok" && <Aviso tone="green" icon={<CheckCircle2 className="h-5 w-5" />}>¡Pago recibido! En unos instantes vas a ver la cuota como pagada y su recibo.</Aviso>}
      {retorno === "pendiente" && <Aviso tone="amber" icon={<Clock className="h-5 w-5" />}>Tu pago está pendiente de acreditación. Se va a reflejar automáticamente cuando Mercado Pago lo confirme.</Aviso>}
      {retorno === "error" && <Aviso tone="red" icon={<XCircle className="h-5 w-5" />}>El pago no se completó. Podés intentarlo de nuevo.</Aviso>}

      <Card title="Pendientes de pago" actions={pendientes.length > 1 && (
        <Button size="sm" icon={<CreditCard className="h-3.5 w-3.5" />} loading={pagando === "todo"} onClick={() => pagar(undefined, "todo")}>
          Pagar todo ({pesos(deuda)})
        </Button>
      )}>
        {error && <div className="p-3"><ErrorBox error={error} /></div>}
        {!pendientes.length ? (
          <Empty icon={<CheckCircle2 className="h-10 w-10 text-emerald-300" />}>No tenés cuotas pendientes.</Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Concepto</th><th className="th">Vencimiento</th><th className="th">Estado</th><th className="th text-right">Importe</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendientes.map((c) => (
                <tr key={c.id}>
                  <td className="td">{c.concepto}</td>
                  <td className="td">{fecha(c.vencimiento)}</td>
                  <td className="td"><SituacionBadge s={c.situacion} /></td>
                  <td className="td text-right tabular-nums">
                    <div className="font-medium">{pesos(c.total)}</div>
                    {c.interes > 0 && <div className="text-xs text-slate-500">incluye {pesos(c.interes)} de interés por mora</div>}
                  </td>
                  <td className="td text-right">
                    <Button size="sm" icon={<CreditCard className="h-3.5 w-3.5" />} loading={pagando === c.id} disabled={!!pagando} onClick={() => pagar([c.id], c.id)}>Pagar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {pendientes.length > 0 && cfg && (cfg.cbu || cfg.alias) && (
        <Card title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4" /> También podés pagar por transferencia</span>}>
          <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
            {cfg.banco && <div><span className="text-slate-500">Banco:</span> {cfg.banco}</div>}
            {cfg.titular && <div><span className="text-slate-500">Titular:</span> {cfg.titular}</div>}
            {cfg.cbu && <div><span className="text-slate-500">CBU:</span> <span className="font-mono">{cfg.cbu}</span></div>}
            {cfg.alias && <div><span className="text-slate-500">Alias:</span> <span className="font-mono">{cfg.alias}</span></div>}
            <p className="text-xs text-slate-500 sm:col-span-2">
              Enviá el comprobante a {cfg.email || "la administración"} indicando el nombre de tu empresa. El pago se acredita cuando la administración lo registra.
            </p>
          </div>
        </Card>
      )}

      <Card title="Pagos realizados">
        {!pagadas.length ? <Empty>Todavía no hay pagos registrados.</Empty> : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Concepto</th><th className="th">Fecha de pago</th><th className="th">Forma</th><th className="th text-right">Importe</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagadas.map((c) => (
                <tr key={c.id}>
                  <td className="td">{c.concepto}</td>
                  <td className="td">{fecha(c.fecha_pago)}</td>
                  <td className="td text-sm">{c.metodo_pago}</td>
                  <td className="td text-right tabular-nums">{pesos(c.total)}</td>
                  <td className="td text-right">
                    <Link to={`/recibo/${c.id}`}><Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />}>Recibo</Button></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Aviso({ tone, icon, children }: { tone: "green" | "amber" | "red"; icon: React.ReactNode; children: React.ReactNode }) {
  const t = { green: "border-emerald-200 bg-emerald-50 text-emerald-800", amber: "border-amber-200 bg-amber-50 text-amber-800", red: "border-red-200 bg-red-50 text-red-800" };
  return <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${t[tone]}`}>{icon}{children}</div>;
}
