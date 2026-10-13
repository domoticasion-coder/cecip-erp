import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Mail, MessageCircle, Search, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api";
import { descargarCSV } from "../../lib/csv";
import { nombreSocio, pesos } from "../../lib/format";
import { normalizarWhatsapp } from "../../lib/whatsapp";
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Stat, Table, useToast } from "../../components/ui";
import { useConfig, useInvalidate } from "../data";
import { LinkPagoModal, type LinkTarget } from "../components/Cobro";
import { useSociosResumen } from "./Socios";

export default function Cobranzas() {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: cfg } = useConfig();
  const { data: socios, isLoading } = useSociosResumen();
  const [filtro, setFiltro] = useState<"vencidas" | "todas">("vencidas");
  const [minDias, setMinDias] = useState(0);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (socios || [])
      .filter((s) => s.deuda > 0 && s.estado !== "baja")
      .filter((s) => (filtro === "vencidas" ? s.cuotas_vencidas > 0 : true))
      .filter((s) => s.max_dias_atraso >= minDias)
      .filter((s) => !t || s.razon_social.toLowerCase().includes(t) || (s.nombre_comercial || "").toLowerCase().includes(t))
      .sort((a, b) => b.deuda - a.deuda);
  }, [socios, filtro, minDias, q]);

  const total = lista.reduce((a, s) => a + Number(s.deuda), 0);
  const allSel = lista.length > 0 && lista.every((s) => sel.has(s.id));

  async function recordar(ids: string[], key: string) {
    if (ids.length > 1 && !confirm(`¿Enviar recordatorio de pago por email a ${ids.length} socios?`)) return;
    setEnviando(key);
    try {
      const r = await api<{ enviados: number; errores: { socio: string; error: string }[] }>("cobranzas/recordatorio", { socio_ids: ids });
      toast(
        `Recordatorios enviados: ${r.enviados}.` + (r.errores.length ? `\nSin enviar (${r.errores.length}): ${r.errores.slice(0, 5).map((e) => `${e.socio} – ${e.error}`).join("; ")}` : ""),
        r.enviados ? "ok" : "error"
      );
      setSel(new Set());
      invalidate("cuotas", "envios");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Cobranzas y morosos"
        subtitle={
          cfg && (
            <>
              Recordatorios automáticos por email:{" "}
              {cfg.recordatorios_auto ? <Badge tone="green">activados</Badge> : <Badge tone="gray">desactivados</Badge>}{" "}
              <Link to="/configuracion" className="text-brand-600 hover:underline">cambiar</Link>
            </>
          )
        }
        actions={
          <>
          <Button variant="success" icon={<MessageCircle className="h-4 w-4" />} onClick={() => navigate("/comunicacion?tab=whatsapp&segmento=vencidas")}>
            Campaña de WhatsApp a morosos
          </Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />}
            onClick={() => descargarCSV("morosos", lista.map((s) => ({
              numero: s.numero_socio, socio: nombreSocio(s), email: s.email, whatsapp: s.whatsapp,
              deuda: Number(s.deuda), cuotas_pendientes: s.cuotas_pendientes, cuotas_vencidas: s.cuotas_vencidas, dias_atraso: s.max_dias_atraso,
            })))}>
            Exportar
          </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Socios en la lista" value={lista.length} />
        <Stat label="Deuda total de la lista" value={pesos(total)} tone="bad" />
        <Stat label="Sin email cargado" value={lista.filter((s) => !s.email).length} hint="No reciben recordatorios automáticos" />
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Buscar socio…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as "vencidas" | "todas")}>
            <option value="vencidas">Con cuotas vencidas</option>
            <option value="todas">Con cualquier deuda</option>
          </Select>
          <Select className="w-auto" value={minDias} onChange={(e) => setMinDias(Number(e.target.value))}>
            <option value={0}>Cualquier atraso</option>
            <option value={30}>Más de 30 días</option>
            <option value={60}>Más de 60 días</option>
            <option value={90}>Más de 90 días</option>
          </Select>
        </div>

        {sel.size > 0 && (
          <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
            <b>{sel.size} seleccionados</b>
            <Button size="sm" icon={<Mail className="h-3.5 w-3.5" />} loading={enviando === "bulk"} onClick={() => recordar([...sel], "bulk")}>
              Enviar recordatorio con link de pago
            </Button>
          </div>
        )}

        {isLoading ? (
          <Loading />
        ) : lista.length === 0 ? (
          <Empty icon={<CheckCircle2 className="h-10 w-10 text-emerald-300" />}>No hay socios con deuda para estos filtros.</Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="th w-8"><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(lista.map((s) => s.id)))} /></th>
                <th className="th">Socio</th>
                <th className="th">Cuotas</th>
                <th className="th">Atraso</th>
                <th className="th text-right">Deuda</th>
                <th className="th text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((s) => (
                <tr key={s.id}>
                  <td className="td">
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => setSel((x) => { const n = new Set(x); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                  </td>
                  <td className="td">
                    <Link to={`/socios/${s.id}`} className="font-medium hover:underline">{nombreSocio(s)}</Link>
                    <div className="text-xs text-slate-500">{s.email || <span className="text-amber-600">sin email</span>} · {s.whatsapp || "sin WhatsApp"}</div>
                  </td>
                  <td className="td text-sm">
                    {s.cuotas_pendientes} pendiente{s.cuotas_pendientes !== 1 && "s"}
                    {s.cuotas_vencidas > 0 && <div className="text-xs text-red-600">{s.cuotas_vencidas} vencida{s.cuotas_vencidas !== 1 && "s"}</div>}
                  </td>
                  <td className="td">
                    {s.max_dias_atraso > 0 ? (
                      <Badge tone={s.max_dias_atraso > 90 ? "red" : s.max_dias_atraso > 30 ? "amber" : "gray"}>{s.max_dias_atraso} días</Badge>
                    ) : "—"}
                  </td>
                  <td className="td text-right font-semibold tabular-nums text-red-700">{pesos(s.deuda)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="success" icon={<MessageCircle className="h-3.5 w-3.5" />}
                        disabled={!normalizarWhatsapp(s.whatsapp)} onClick={() => setLink({ socio: s })} title="Generar link y enviar por WhatsApp">
                        WhatsApp
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Mail className="h-3.5 w-3.5" />} disabled={!s.email}
                        loading={enviando === s.id} onClick={() => recordar([s.id], s.id)}>
                        Email
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <LinkPagoModal target={link} onClose={() => setLink(null)} />
    </>
  );
}
