import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Download, Mail, Plus, Search } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { descargarCSV } from "../../lib/csv";
import { fecha, hoyISO, MESES, nombreSocio, pesos } from "../../lib/format";
import type { CuotaDetalle } from "../../lib/types";
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, useToast } from "../../components/ui";
import { useCategorias, useConfig, useInvalidate, useSociosMin } from "../data";
import { CuotasTabla } from "../components/CuotasTabla";
import { NuevaCuotaModal } from "../components/NuevaCuota";
import { INVALIDAR_COBRO } from "../components/Cobro";

const mesActual = () => hoyISO().slice(0, 7);

export default function Cuotas() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const periodo = params.get("periodo") ?? mesActual(); // "" = todos
  const estado = params.get("estado") || "";
  const [q, setQ] = useState("");
  const [generar, setGenerar] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
    setSel(new Set());
  };

  const { data: cuotas, isLoading } = useQuery({
    queryKey: ["cuotas", "lista", periodo, estado],
    queryFn: async () => {
      let query = supabase.from("cuotas_detalle").select("*").order("vencimiento", { ascending: false }).order("razon_social").range(0, 4999);
      if (periodo) {
        const [y, m] = periodo.split("-").map(Number);
        const desde = `${periodo}-01`;
        const hasta = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
        // Cuotas sociales del período + cargos sueltos que vencen ese mes
        query = query.or(`periodo.eq.${desde},and(periodo.is.null,vencimiento.gte.${desde},vencimiento.lt.${hasta})`);
      }
      if (estado === "vencida") query = query.eq("estado", "pendiente").lt("vencimiento", hoyISO());
      else if (estado) query = query.eq("estado", estado);
      else query = query.neq("estado", "anulada");
      return unwrap(await query) as CuotaDetalle[];
    },
  });

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cuotas || [];
    return (cuotas || []).filter((c) =>
      c.razon_social.toLowerCase().includes(t) || (c.nombre_comercial || "").toLowerCase().includes(t) ||
      c.concepto.toLowerCase().includes(t) || String(c.numero_socio || "") === t
    );
  }, [cuotas, q]);

  const tot = useMemo(() => {
    const r = { emitido: 0, cobrado: 0, pendiente: 0, vencido: 0, nPag: 0, n: 0 };
    for (const c of lista) {
      if (c.estado === "anulada") continue;
      r.n++;
      r.emitido += Number(c.monto);
      if (c.estado === "pagada") { r.cobrado += Number(c.total); r.nPag++; }
      else { r.pendiente += Number(c.total); if (c.situacion === "vencida") r.vencido += Number(c.total); }
    }
    return r;
  }, [lista]);

  const pendientesSel = lista.filter((c) => sel.has(c.id) && c.estado === "pendiente");

  async function recordar() {
    const socios = [...new Set(pendientesSel.map((c) => c.socio_id))];
    if (!confirm(`¿Enviar recordatorio de pago por email a ${socios.length} socio(s)? El email incluye toda su deuda pendiente y un link de Mercado Pago.`)) return;
    setEnviando(true);
    try {
      const r = await api<{ enviados: number; errores: { socio: string; error: string }[] }>("cobranzas/recordatorio", { socio_ids: socios });
      toast(`Recordatorios enviados: ${r.enviados}.` + (r.errores.length ? `\nSin enviar: ${r.errores.map((e) => `${e.socio} (${e.error})`).slice(0, 5).join(", ")}` : ""), r.enviados ? "ok" : "error");
      setSel(new Set());
      invalidate("cuotas", "envios");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setEnviando(false);
    }
  }

  function exportar() {
    descargarCSV(`cuotas-${periodo || "todas"}`, lista.map((c) => ({
      numero_socio: c.numero_socio, socio: nombreSocio(c), concepto: c.concepto, vencimiento: fecha(c.vencimiento),
      estado: c.situacion, monto: Number(c.monto), interes: Number(c.interes), total: Number(c.total),
      fecha_pago: fecha(c.fecha_pago), metodo: c.metodo_pago, recibo: c.recibo_numero,
    })));
  }

  // Opciones de período: últimos 24 meses + próximos 2
  const periodos = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 2);
    for (let i = 0; i < 26; i++) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);

  return (
    <>
      <PageHeader
        title="Cuotas"
        subtitle="Cuotas sociales y otros cargos a socios"
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportar}>Exportar</Button>
            {can("tesoreria") && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo cargo</Button>}
            {can("tesoreria") && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setGenerar(true)}>Generar cuotas del mes</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Emitido" value={pesos(tot.emitido)} hint={`${tot.n} cuotas/cargos`} />
        <Stat label="Cobrado" value={pesos(tot.cobrado)} tone="good" hint={tot.n ? `${tot.nPag} de ${tot.n} (${Math.round((tot.nPag / tot.n) * 100)}%)` : undefined} />
        <Stat label="Pendiente de cobro" value={pesos(tot.pendiente)} tone="warn" />
        <Stat label="Vencido" value={pesos(tot.vencido)} tone={tot.vencido ? "bad" : "default"} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Buscar socio o concepto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={periodo} onChange={(e) => setParam("periodo", e.target.value)}>
            <option value="">Todos los períodos</option>
            {periodos.map((p) => {
              const [y, m] = p.split("-").map(Number);
              return <option key={p} value={p}>{MESES[m - 1]} {y}</option>;
            })}
          </Select>
          <Select className="w-auto" value={estado} onChange={(e) => setParam("estado", e.target.value)}>
            <option value="">Pendientes y pagadas</option>
            <option value="pendiente">Pendientes</option>
            <option value="vencida">Vencidas</option>
            <option value="pagada">Pagadas</option>
            <option value="anulada">Anuladas</option>
          </Select>
        </div>
        {pendientesSel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
            <b>{pendientesSel.length} cuotas seleccionadas</b>
            <Button size="sm" icon={<Mail className="h-3.5 w-3.5" />} loading={enviando} onClick={recordar}>Enviar recordatorio por email</Button>
            <button className="ml-auto text-xs text-slate-500 hover:underline" onClick={() => setSel(new Set())}>Limpiar</button>
          </div>
        )}
        {isLoading ? (
          <Loading />
        ) : (
          <CuotasTabla
            cuotas={lista}
            selectable
            selected={sel}
            onToggle={(id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onToggleAll={() => {
              const pend = lista.filter((c) => c.estado === "pendiente");
              setSel(pend.every((c) => sel.has(c.id)) ? new Set() : new Set(pend.map((c) => c.id)));
            }}
          />
        )}
      </Card>

      <GenerarModal open={generar} onClose={() => setGenerar(false)} onDone={(p) => { setParam("periodo", p); invalidate(...INVALIDAR_COBRO); }} toastFn={toast} />
      <NuevaCuotaModal open={nuevo} onClose={() => setNuevo(false)} />
    </>
  );
}

function GenerarModal({ open, onClose, onDone, toastFn }: { open: boolean; onClose: () => void; onDone: (periodo: string) => void; toastFn: (t: string, tipo?: "ok" | "error") => void }) {
  const { data: cfg } = useConfig();
  const { data: categorias } = useCategorias();
  const { data: socios } = useSociosMin();
  const [periodo, setPeriodo] = useState(mesActual());
  const [venc, setVenc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    setVenc(`${periodo}-${String(cfg.dia_vencimiento).padStart(2, "0")}`);
  }, [periodo, cfg]);

  const { data: yaGeneradas } = useQuery({
    queryKey: ["cuotas", "generadas", periodo],
    enabled: open,
    queryFn: async () => {
      const r = await supabase.from("cuotas").select("socio_id").eq("periodo", `${periodo}-01`).eq("tipo", "cuota_social").neq("estado", "anulada");
      return new Set((r.data || []).map((x) => x.socio_id));
    },
  });

  const preview = useMemo(() => {
    const activos = (socios || []).filter((s) => s.estado === "activo");
    const precio = new Map((categorias || []).map((c) => [c.id, Number(c.cuota_mensual)]));
    let n = 0, total = 0, sinCat = 0, sinPrecio = 0, ya = 0;
    for (const s of activos) {
      if (yaGeneradas?.has(s.id)) { ya++; continue; }
      if (!s.categoria_id) { sinCat++; continue; }
      const p = precio.get(s.categoria_id) || 0;
      if (!p) { sinPrecio++; continue; }
      n++;
      total += p;
    }
    return { n, total, sinCat, sinPrecio, ya };
  }, [socios, categorias, yaGeneradas]);

  async function generar() {
    setSaving(true);
    setError(null);
    const { data, error } = await supabase.rpc("generar_cuotas", { p_periodo: `${periodo}-01`, p_vencimiento: venc });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toastFn(`Se generaron ${data} cuotas.`);
    onDone(periodo);
    onClose();
  }

  const [y, m] = periodo.split("-").map(Number);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generar cuotas sociales"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} disabled={!preview.n || !venc} onClick={generar}>Generar {preview.n} cuotas</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mes">
            <Input type="month" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} />
          </Field>
          <Field label="Vencimiento">
            <Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
          </Field>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p>
            Se va a generar la <b>Cuota social {MESES[m - 1]} {y}</b> para <b>{preview.n}</b> socios activos, por un total de{" "}
            <b>{pesos(preview.total)}</b>. El monto de cada uno sale del valor de su categoría.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
            {preview.ya > 0 && <li>• {preview.ya} socios ya tienen la cuota de este mes (no se duplica).</li>}
            {preview.sinCat > 0 && <li className="text-amber-700">• {preview.sinCat} socios activos no tienen categoría y quedan afuera.</li>}
            {preview.sinPrecio > 0 && <li className="text-amber-700">• {preview.sinPrecio} socios tienen una categoría con cuota en $0 y quedan afuera.</li>}
          </ul>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
