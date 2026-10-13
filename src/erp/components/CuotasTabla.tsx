import { useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, FileText, Link2, MoreHorizontal } from "lucide-react";
import { supabase, traducirError } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, nombreSocio, pesos } from "../../lib/format";
import type { CuotaDetalle } from "../../lib/types";
import { Button, Empty, SituacionBadge, Table, useToast } from "../../components/ui";
import { useInvalidate } from "../data";
import { INVALIDAR_COBRO, LinkPagoModal, PagoModal, type LinkTarget } from "./Cobro";

export function CuotasTabla({
  cuotas, showSocio = true, selectable = false, selected, onToggle, onToggleAll,
}: {
  cuotas: CuotaDetalle[];
  showSocio?: boolean;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [cobrar, setCobrar] = useState<CuotaDetalle | null>(null);
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const esTesoreria = can("tesoreria");

  async function anularCuota(c: CuotaDetalle) {
    setMenu(null);
    if (!confirm(`¿Anular "${c.concepto}" de ${nombreSocio(c)}? La cuota deja de figurar como deuda.`)) return;
    const { error } = await supabase.from("cuotas").update({ estado: "anulada" }).eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Cuota anulada.");
    invalidate(...INVALIDAR_COBRO);
  }

  async function reactivar(c: CuotaDetalle) {
    setMenu(null);
    const { error } = await supabase.from("cuotas").update({ estado: "pendiente" }).eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Cuota reactivada.");
    invalidate(...INVALIDAR_COBRO);
  }

  async function anularPago(c: CuotaDetalle) {
    setMenu(null);
    if (!confirm(`¿Revertir el pago del recibo N° ${c.recibo_numero}? Se elimina el ingreso de tesorería y la cuota vuelve a quedar pendiente.`)) return;
    const { error } = await supabase.rpc("anular_pago", { p_cuota_id: c.id });
    if (error) return toast(traducirError(error.message), "error");
    toast("Pago revertido.");
    invalidate(...INVALIDAR_COBRO);
  }

  if (cuotas.length === 0) return <Empty>No hay cuotas para mostrar.</Empty>;

  const allSelected = selectable && cuotas.every((c) => selected?.has(c.id));

  return (
    <>
      <Table>
        <thead className="bg-slate-50">
          <tr>
            {selectable && <th className="th w-8"><input type="checkbox" checked={allSelected} onChange={onToggleAll} /></th>}
            {showSocio && <th className="th">Socio</th>}
            <th className="th">Concepto</th>
            <th className="th">Vencimiento</th>
            <th className="th">Estado</th>
            <th className="th text-right">Importe</th>
            <th className="th text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cuotas.map((c) => (
            <tr key={c.id} className={c.estado === "anulada" ? "opacity-50" : ""}>
              {selectable && (
                <td className="td">
                  {c.estado === "pendiente" && <input type="checkbox" checked={selected?.has(c.id) || false} onChange={() => onToggle?.(c.id)} />}
                </td>
              )}
              {showSocio && (
                <td className="td">
                  <Link to={`/socios/${c.socio_id}`} className="font-medium hover:underline">{nombreSocio(c)}</Link>
                  {c.numero_socio && <div className="text-xs text-slate-500">N° {c.numero_socio}</div>}
                </td>
              )}
              <td className="td">
                {c.concepto}
                {c.ultimo_recordatorio && c.estado === "pendiente" && (
                  <div className="text-xs text-slate-400">Recordado {fecha(c.ultimo_recordatorio.slice(0, 10))}</div>
                )}
              </td>
              <td className="td whitespace-nowrap">
                {fecha(c.vencimiento)}
                {c.dias_atraso > 0 && <div className="text-xs text-red-600">{c.dias_atraso} días de atraso</div>}
              </td>
              <td className="td">
                <SituacionBadge s={c.situacion} />
                {c.estado === "pagada" && (
                  <div className="mt-0.5 text-xs text-slate-500">{fecha(c.fecha_pago)} · {c.metodo_pago}</div>
                )}
              </td>
              <td className="td text-right tabular-nums">
                <div className="font-medium">{pesos(c.total)}</div>
                {c.interes > 0 && <div className="text-xs text-slate-500">incl. {pesos(c.interes)} int.</div>}
              </td>
              <td className="td">
                <div className="relative flex justify-end gap-1">
                  {c.estado === "pendiente" && esTesoreria && (
                    <Button size="sm" variant="success" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setCobrar(c)}>Cobrar</Button>
                  )}
                  {c.estado === "pendiente" && (
                    <Button size="sm" variant="secondary" title="Link de pago" icon={<Link2 className="h-3.5 w-3.5" />}
                      onClick={() => setLink({ socio: { id: c.socio_id, razon_social: c.razon_social, nombre_comercial: c.nombre_comercial, whatsapp: c.socio_whatsapp, email: c.socio_email }, cuotaIds: [c.id] })} />
                  )}
                  {c.estado === "pagada" && (
                    <Link to={`/recibo/${c.id}`}>
                      <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />}>Recibo</Button>
                    </Link>
                  )}
                  {esTesoreria && (
                    <Button size="sm" variant="ghost" onClick={() => setMenu(menu === c.id ? null : c.id)} icon={<MoreHorizontal className="h-4 w-4" />} />
                  )}
                  {menu === c.id && (
                    <div className="absolute right-0 top-8 z-10 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(null)}>
                      {c.estado === "pendiente" && <MenuItem onClick={() => anularCuota(c)}>Anular cuota</MenuItem>}
                      {c.estado === "anulada" && <MenuItem onClick={() => reactivar(c)}>Reactivar cuota</MenuItem>}
                      {c.estado === "pagada" && <MenuItem onClick={() => anularPago(c)} danger>Revertir pago</MenuItem>}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <PagoModal cuota={cobrar} onClose={() => setCobrar(null)} />
      <LinkPagoModal target={link} onClose={() => setLink(null)} />
    </>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 ${danger ? "text-red-600" : ""}`}>
      {children}
    </button>
  );
}
