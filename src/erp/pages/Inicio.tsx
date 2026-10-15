import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Sparkles, UserCheck, Users, Wallet } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, fechaHora, nombreSocio, pesos, MESES } from "../../lib/format";
import type { CuotaDetalle, Evento } from "../../lib/types";
import { Card, Empty, Loading, PageHeader, Stat, Table } from "../../components/ui";
import { useCategorias } from "../data";

interface Resumen {
  socios_activos: number;
  socios_morosos: number;
  deuda_total: number;
  deuda_vencida: number;
  cobrado_mes: number;
  facturado_mes: number;
  cobrado_mes_cuotas: number;
  accesos_pendientes: number;
  comercia_nuevas: number;
  proximos_eventos: number;
  alquileres_pendientes: number;
  facturas_con_error: number;
  banco_sin_conciliar: number;
}

export default function Inicio() {
  const { staff, can } = useAuth();
  const { data: categorias } = useCategorias();

  const { data: r, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => unwrap(await supabase.rpc("resumen_dashboard")) as Resumen,
  });

  const { data: pagos } = useQuery({
    queryKey: ["cuotas", "ultimos-pagos"],
    queryFn: async () =>
      unwrap(await supabase.from("cuotas_detalle").select("*").eq("estado", "pagada").gt("recibo_numero", 0).order("recibo_numero", { ascending: false }).limit(8)) as CuotaDetalle[],
  });

  const { data: eventos } = useQuery({
    queryKey: ["eventos", "proximos"],
    queryFn: async () =>
      unwrap(await supabase.from("eventos").select("*").gte("fecha_inicio", new Date().toISOString()).order("fecha_inicio").limit(5)) as Evento[],
  });

  const { data: sinCategoria } = useQuery({
    queryKey: ["socios", "sin-categoria"],
    queryFn: async () => (await supabase.from("socios").select("id", { count: "exact", head: true }).eq("estado", "activo").is("categoria_id", null)).count || 0,
  });

  if (isLoading || !r) return <Loading />;

  const mes = MESES[new Date().getMonth()];
  const cobranzaPct = r.facturado_mes > 0 ? Math.round((r.cobrado_mes_cuotas / r.facturado_mes) * 100) : null;
  const sinMontos = categorias && categorias.every((c) => Number(c.cuota_mensual) === 0);
  const categoriasSinValor = (categorias || []).filter((c) => Number(c.cuota_mensual) === 0).map((c) => c.nombre);

  return (
    <>
      <PageHeader title={`Hola, ${staff!.nombre.split(" ")[0]}`} subtitle="Resumen de la gestión del Centro Comercial" />

      {(sinMontos || !!sinCategoria || categoriasSinValor.length > 0 || r.facturas_con_error > 0 || r.alquileres_pendientes > 0 || r.banco_sin_conciliar > 0) && can("tesoreria") && (
        <div className="mb-4 space-y-2">
          {!sinMontos && categoriasSinValor.length > 0 && (
            <Aviso to="/configuracion">
              Las categorías {categoriasSinValor.join(", ")} no tienen valor de cuota: a sus socios no se les generan cuotas. Cargalo en Configuración.
            </Aviso>
          )}
          {r.facturas_con_error > 0 && (
            <Aviso to="/facturacion">{r.facturas_con_error} factura(s) rechazadas por ARCA: revisalas y reintentá.</Aviso>
          )}
          {r.alquileres_pendientes > 0 && (
            <Aviso to="/alquileres">{r.alquileres_pendientes} alquiler(es) vencidos sin cobrar.</Aviso>
          )}
          {r.banco_sin_conciliar > 0 && (
            <Aviso to="/tesoreria">{r.banco_sin_conciliar} movimiento(s) del Banco Santander sin conciliar.</Aviso>
          )}
          {sinMontos && (
            <Aviso to="/configuracion">Todavía no cargaste el valor de la cuota de cada categoría. Configuralo antes de generar cuotas.</Aviso>
          )}
          {!!sinCategoria && (
            <Aviso to="/socios?filtro=sin-categoria">
              Hay {sinCategoria} socios activos sin categoría: no se les va a generar cuota social hasta que se les asigne una.
            </Aviso>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={`Cobrado en ${mes}`} value={pesos(r.cobrado_mes)} tone="good" icon={<Wallet className="h-4 w-4" />}
          hint={cobranzaPct !== null ? `${cobranzaPct}% de las cuotas del mes` : "Sin cuotas generadas este mes"} />
        <Stat label="Deuda vencida" value={pesos(r.deuda_vencida)} tone={r.deuda_vencida > 0 ? "bad" : "default"}
          icon={<AlertTriangle className="h-4 w-4" />} hint={`Deuda total ${pesos(r.deuda_total)}`} />
        <Stat label="Socios activos" value={r.socios_activos} icon={<Users className="h-4 w-4" />} />
        <Stat label="Socios con cuotas vencidas" value={r.socios_morosos} tone={r.socios_morosos > 0 ? "warn" : "default"}
          hint={<Link to="/cobranzas" className="text-brand-600 hover:underline">Ver morosos →</Link>} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniLink to="/accesos" icon={<UserCheck className="h-4 w-4" />} label="Solicitudes de acceso al portal" value={r.accesos_pendientes} />
        <MiniLink to="/comercia" icon={<Sparkles className="h-4 w-4" />} label="Consultas ComercIA nuevas" value={r.comercia_nuevas} />
        <MiniLink to="/eventos" icon={<CalendarDays className="h-4 w-4" />} label="Próximos eventos" value={r.proximos_eventos} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card title="Últimos pagos" className="lg:col-span-3" actions={<Link to="/cuotas?estado=pagada" className="text-xs text-brand-600 hover:underline">Ver todos</Link>}>
          {!pagos?.length ? (
            <Empty>Todavía no hay pagos registrados.</Empty>
          ) : (
            <Table>
              <tbody className="divide-y divide-slate-100">
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <Link to={`/socios/${p.socio_id}`} className="font-medium hover:underline">{nombreSocio(p)}</Link>
                      <div className="text-xs text-slate-500">{p.concepto}</div>
                    </td>
                    <td className="td text-xs text-slate-500">{fecha(p.fecha_pago)} · {p.metodo_pago}</td>
                    <td className="td text-right font-medium tabular-nums">{pesos(p.monto_pagado)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Próximos eventos" className="lg:col-span-2">
          {!eventos?.length ? (
            <Empty>No hay eventos programados.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {eventos.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="text-sm font-medium">{e.titulo}</div>
                  <div className="text-xs text-slate-500">{fechaHora(e.fecha_inicio)} · {e.lugar || e.modalidad}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Aviso({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {children}
    </Link>
  );
}

function MiniLink({ to, icon, label, value }: { to: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm hover:border-brand-200">
      <span className="flex items-center gap-2 text-slate-600">{icon}{label}</span>
      <span className={value > 0 ? "rounded-full bg-amber-100 px-2 font-bold text-amber-800" : "font-semibold text-slate-400"}>{value}</span>
    </Link>
  );
}
