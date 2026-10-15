import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Circle, Download, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fecha, hoyISO, MESES, pesos } from "../../lib/format";
import { CATEGORIAS_MOVIMIENTO, type Movimiento } from "../../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Tabs, useToast } from "../../components/ui";
import { useCuentas, useInvalidate } from "../data";
import { BancoSantander } from "../components/Banco";

interface Saldo { id: string; nombre: string; tipo: string; activa: boolean; saldo: number; sin_conciliar: number }

export default function Tesoreria() {
  const [vista, setVista] = useState<"movimientos" | "banco">("movimientos");
  const tabs = (
    <Tabs<"movimientos" | "banco"> value={vista} onChange={setVista} tabs={[
      { value: "movimientos", label: "Movimientos" },
      { value: "banco", label: "Banco Santander" },
    ]} />
  );
  if (vista === "movimientos") return <Movimientos tabs={tabs} />;
  return (
    <>
      <PageHeader title="Tesorería" subtitle="Movimientos de la cuenta bancaria y conciliación" />
      {tabs}
      <BancoSantander />
    </>
  );
}

function Movimientos({ tabs }: { tabs: ReactNode }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: cuentas } = useCuentas();
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [cuenta, setCuenta] = useState("");
  const [tipo, setTipo] = useState("");
  const [nuevo, setNuevo] = useState<"ingreso" | "egreso" | null>(null);

  const { data: saldos } = useQuery({
    queryKey: ["movimientos", "saldos"],
    queryFn: async () => unwrap(await supabase.from("saldos_cuentas").select("*").order("orden")) as Saldo[],
  });

  const { data: movs, isLoading } = useQuery({
    queryKey: ["movimientos", "lista", mes],
    queryFn: async () => {
      const [y, m] = mes.split("-").map(Number);
      const hasta = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return unwrap(
        await supabase.from("movimientos").select("*").gte("fecha", `${mes}-01`).lt("fecha", hasta)
          .order("fecha", { ascending: false }).order("created_at", { ascending: false })
      ) as Movimiento[];
    },
  });

  const lista = useMemo(() => (movs || []).filter((m) => (!cuenta || m.cuenta_id === cuenta) && (!tipo || m.tipo === tipo)), [movs, cuenta, tipo]);
  const nombreCuenta = (id: string | null) => cuentas?.find((c) => c.id === id)?.nombre || "—";

  const resumen = useMemo(() => {
    let ing = 0, egr = 0;
    const porCat = new Map<string, { tipo: string; total: number }>();
    for (const m of lista) {
      if (m.tipo === "ingreso") ing += Number(m.monto); else egr += Number(m.monto);
      const k = `${m.tipo}|${m.categoria}`;
      porCat.set(k, { tipo: m.tipo, total: (porCat.get(k)?.total || 0) + Number(m.monto) });
    }
    return { ing, egr, porCat: [...porCat.entries()].map(([k, v]) => ({ categoria: k.split("|")[1], ...v })).sort((a, b) => b.total - a.total) };
  }, [lista]);

  async function toggleConciliado(m: Movimiento) {
    const { error } = await supabase.from("movimientos").update({ conciliado: !m.conciliado }).eq("id", m.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("movimientos");
  }

  async function eliminar(m: Movimiento) {
    if (m.cuota_id) return toast("Este ingreso corresponde al cobro de una cuota. Para eliminarlo, revertí el pago desde la cuota.", "error");
    if (m.alquiler_cargo_id) return toast("Este ingreso corresponde al cobro de un alquiler. Para eliminarlo, anulá el cobro desde Alquileres.", "error");
    if (!confirm(`¿Eliminar el movimiento "${m.detalle}" por ${pesos(m.monto)}?`)) return;
    const { error } = await supabase.from("movimientos").delete().eq("id", m.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Movimiento eliminado.");
    invalidate("movimientos");
  }

  const [y, mm] = mes.split("-").map(Number);

  return (
    <>
      <PageHeader
        title="Tesorería"
        subtitle="Caja, bancos y movimientos"
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => descargarCSV(`tesoreria-${mes}`, lista.map((m) => ({
              fecha: fecha(m.fecha), tipo: m.tipo, categoria: m.categoria, cuenta: nombreCuenta(m.cuenta_id), detalle: m.detalle,
              comprobante: m.comprobante, ingreso: m.tipo === "ingreso" ? Number(m.monto) : "", egreso: m.tipo === "egreso" ? Number(m.monto) : "",
              conciliado: m.conciliado ? "Sí" : "No",
            })))}>Exportar</Button>
            <Button variant="secondary" icon={<ArrowDownCircle className="h-4 w-4 text-red-600" />} onClick={() => setNuevo("egreso")}>Registrar egreso</Button>
            <Button icon={<ArrowUpCircle className="h-4 w-4" />} onClick={() => setNuevo("ingreso")}>Registrar ingreso</Button>
          </>
        }
      />

      {tabs}

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {(saldos || []).filter((s) => s.activa || Number(s.saldo) !== 0).map((s) => (
          <Stat key={s.id} label={s.nombre} value={pesos(s.saldo)} tone={Number(s.saldo) < 0 ? "bad" : "default"} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <Input type="month" className="w-auto" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
            <Select className="w-auto" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
              <option value="">Todas las cuentas</option>
              {cuentas?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
            <Select className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Ingresos y egresos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </Select>
          </div>
          {isLoading ? <Loading /> : lista.length === 0 ? <Empty>Sin movimientos en {MESES[mm - 1]} {y}.</Empty> : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Fecha</th>
                  <th className="th">Detalle</th>
                  <th className="th hidden md:table-cell">Cuenta</th>
                  <th className="th text-right">Monto</th>
                  <th className="th text-center" title="Conciliado con el banco">Conc.</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((m) => (
                  <tr key={m.id}>
                    <td className="td whitespace-nowrap text-xs">{fecha(m.fecha)}</td>
                    <td className="td">
                      <div>{m.detalle}</div>
                      <div className="text-xs text-slate-500">{m.categoria}{m.comprobante && <> · {m.comprobante}</>}</div>
                    </td>
                    <td className="td hidden text-sm md:table-cell">{nombreCuenta(m.cuenta_id)}</td>
                    <td className={`td text-right font-medium tabular-nums ${m.tipo === "ingreso" ? "text-emerald-700" : "text-red-700"}`}>
                      {m.tipo === "egreso" && "−"}{pesos(m.monto)}
                    </td>
                    <td className="td text-center">
                      <button onClick={() => toggleConciliado(m)} title={m.conciliado ? "Conciliado" : "Marcar como conciliado"}>
                        {m.conciliado ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                      </button>
                    </td>
                    <td className="td text-right">
                      <button onClick={() => eliminar(m)} className="text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={`Resumen ${MESES[mm - 1]} ${y}`}>
          <div className="space-y-2 p-4 text-sm">
            <div className="flex justify-between"><span>Ingresos</span><b className="text-emerald-700">{pesos(resumen.ing)}</b></div>
            <div className="flex justify-between"><span>Egresos</span><b className="text-red-700">{pesos(resumen.egr)}</b></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><span>Resultado</span><b>{pesos(resumen.ing - resumen.egr)}</b></div>
          </div>
          <div className="border-t border-slate-100 p-4">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Por categoría</div>
            <ul className="space-y-1 text-sm">
              {resumen.porCat.map((c) => (
                <li key={c.tipo + c.categoria} className="flex justify-between gap-2">
                  <span className="truncate"><Badge tone={c.tipo === "ingreso" ? "green" : "red"}>{c.tipo === "ingreso" ? "+" : "−"}</Badge> {c.categoria}</span>
                  <span className="tabular-nums">{pesos(c.total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <MovimientoModal tipo={nuevo} onClose={() => setNuevo(null)} userId={staff?.user_id} />
    </>
  );
}

function MovimientoModal({ tipo, onClose, userId }: { tipo: "ingreso" | "egreso" | null; onClose: () => void; userId?: string }) {
  const { data: cuentas } = useCuentas();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [f, setF] = useState({ fecha: hoyISO(), categoria: "", cuenta_id: "", detalle: "", monto: "", comprobante: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tipo) {
      setF({ fecha: hoyISO(), categoria: CATEGORIAS_MOVIMIENTO[tipo][0], cuenta_id: cuentas?.[0]?.id || "", detalle: "", monto: "", comprobante: "" });
      setError(null);
    }
  }, [tipo, cuentas]);

  async function guardar() {
    const monto = Number(f.monto.replace(",", "."));
    if (!f.detalle.trim()) return setError("Completá el detalle.");
    if (!monto || monto <= 0) return setError("Ingresá un monto válido.");
    setSaving(true);
    const { error } = await supabase.from("movimientos").insert({
      tipo, fecha: f.fecha, categoria: f.categoria, cuenta_id: f.cuenta_id || null, detalle: f.detalle.trim(),
      monto, comprobante: f.comprobante.trim() || null, created_by: userId,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast(tipo === "ingreso" ? "Ingreso registrado." : "Egreso registrado.");
    invalidate("movimientos");
    onClose();
  }

  return (
    <Modal
      open={!!tipo}
      onClose={onClose}
      title={tipo === "ingreso" ? "Registrar ingreso" : "Registrar egreso"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}
    >
      {tipo && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha"><Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
          <Field label="Monto"><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
          <Field label="Categoría">
            <Select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>
              {CATEGORIAS_MOVIMIENTO[tipo].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Cuenta">
            <Select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
              {cuentas?.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Detalle" className="sm:col-span-2"><Input value={f.detalle} onChange={(e) => setF({ ...f, detalle: e.target.value })} /></Field>
          <Field label="Comprobante (opcional)" className="sm:col-span-2" hint="N° de factura, transferencia, etc.">
            <Input value={f.comprobante} onChange={(e) => setF({ ...f, comprobante: e.target.value })} />
          </Field>
          <div className="sm:col-span-2"><ErrorBox error={error} /></div>
        </div>
      )}
    </Modal>
  );
}
