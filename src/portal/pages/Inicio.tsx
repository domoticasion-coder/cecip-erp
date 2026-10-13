import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, CreditCard, Gift, Megaphone, Sparkles } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, fechaHora, hoyISO, pesos } from "../../lib/format";
import type { Comunicado, Evento } from "../../lib/types";
import { Badge, Button, Card, Empty, ErrorBox } from "../../components/ui";
import { useMisCuotas, usePagar } from "../data";

export default function Inicio({ socioId }: { socioId: string }) {
  const { socioUsuario } = useAuth();
  const { data: cuotas } = useMisCuotas(socioId);
  const { pagar, pagando, error } = usePagar();

  const { data: comunicados } = useQuery({
    queryKey: ["portal-comunicados", "ultimos"],
    queryFn: async () =>
      unwrap(await supabase.from("comunicados").select("*").eq("publicado", true)
        .order("destacado", { ascending: false }).order("fecha_publicacion", { ascending: false }).limit(3)) as Comunicado[],
  });

  const { data: eventos } = useQuery({
    queryKey: ["portal-eventos", "proximos"],
    queryFn: async () =>
      unwrap(await supabase.from("eventos").select("*").eq("publicado", true).gte("fecha_inicio", new Date().toISOString()).order("fecha_inicio").limit(3)) as Evento[],
  });

  const { data: promo } = useQuery({
    queryKey: ["portal-promo-destacada"],
    queryFn: async () => {
      const { data } = await supabase.from("comercia_promociones").select("titulo, descuento").eq("activa", true)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoyISO()}`).order("destacada", { ascending: false }).order("orden").limit(1);
      return data?.[0] || null;
    },
  });

  const pendientes = (cuotas || []).filter((c) => c.estado === "pendiente");
  const deuda = pendientes.reduce((a, c) => a + Number(c.total), 0);
  const vencidas = pendientes.filter((c) => c.situacion === "vencida").length;
  const proxima = [...pendientes].sort((a, b) => a.vencimiento.localeCompare(b.vencimiento))[0];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">¡Hola{socioUsuario?.nombre ? `, ${socioUsuario.nombre.split(" ")[0]}` : ""}!</h1>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          {deuda > 0 ? (
            <div>
              <div className="text-sm text-slate-500">Saldo pendiente</div>
              <div className={`text-3xl font-bold tabular-nums ${vencidas ? "text-red-700" : "text-slate-900"}`}>{pesos(deuda)}</div>
              <div className="mt-1 text-sm text-slate-600">
                {pendientes.length} cuota{pendientes.length > 1 && "s"} pendiente{pendientes.length > 1 && "s"}
                {vencidas > 0 && <> · <span className="text-red-600">{vencidas} vencida{vencidas > 1 && "s"}</span></>}
                {proxima && !vencidas && <> · próximo vencimiento {fecha(proxima.vencimiento)}</>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <div>
                <div className="text-lg font-semibold">Estás al día</div>
                <div className="text-sm text-slate-500">No tenés cuotas pendientes. ¡Gracias!</div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Link to="/cuotas"><Button variant="secondary">Ver mis cuotas</Button></Link>
            {deuda > 0 && (
              <Button icon={<CreditCard className="h-4 w-4" />} loading={pagando === "todo"} onClick={() => pagar(undefined, "todo")}>
                Pagar con Mercado Pago
              </Button>
            )}
          </div>
        </div>
        {error && <div className="px-5 pb-4"><ErrorBox error={error} /></div>}
      </Card>

      <Link to="/copiloto" className="group flex items-center gap-4 rounded-2xl bg-gradient-to-r from-brand-700 to-brand-900 p-5 text-white shadow-md transition hover:shadow-lg">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><Sparkles className="h-6 w-6" /></div>
        <div className="flex-1">
          <div className="text-lg font-bold">Preguntale al Copiloto CeCIP</div>
          <div className="text-sm text-brand-100">Chateá con nuestra IA sobre tu cuenta, beneficios, eventos, ComercIA y todo el CeCIP.</div>
        </div>
        <ArrowRight className="h-6 w-6 shrink-0 transition group-hover:translate-x-1" />
      </Link>

      {promo && (
        <Link to="/comercia" className="group relative block overflow-hidden rounded-2xl bg-gradient-to-r from-[#1d4ed8] via-[#7c3aed] to-[#db2777] p-5 text-white shadow-md transition hover:shadow-lg">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#ffffff]/10 blur-xl" />
          <div className="relative flex flex-wrap items-center gap-4">
            {promo.descuento && <div className={promo.descuento.length > 10 ? "text-2xl font-black leading-none sm:text-3xl" : "text-3xl font-black leading-none sm:text-4xl"}>{promo.descuento}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#fbcfe8]"><Gift className="h-3.5 w-3.5" /> ComercIA · promo para socios</div>
              <div className="text-lg font-bold">{promo.titulo}</div>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-bold">Conocé el convenio <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" /></span>
          </div>
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Comunicados</span>}
          actions={<Link to="/comunicados" className="text-xs text-brand-600 hover:underline">Ver todos</Link>}>
          {!comunicados?.length ? <Empty>No hay comunicados.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {comunicados.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">{c.titulo}{c.destacado && <Badge tone="amber">Importante</Badge>}</div>
                  <p className="line-clamp-2 text-sm text-slate-600">{c.cuerpo}</p>
                  <div className="text-xs text-slate-400">{fechaHora(c.fecha_publicacion)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Próximos eventos y capacitaciones</span>}
          actions={<Link to="/eventos" className="text-xs text-brand-600 hover:underline">Ver todos</Link>}>
          {!eventos?.length ? <Empty>No hay eventos próximos.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {eventos.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="font-medium">{e.titulo}</div>
                  <div className="text-sm text-slate-500">{fechaHora(e.fecha_inicio)} · {e.lugar || e.modalidad}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
