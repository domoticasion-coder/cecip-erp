import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, CalendarClock, ExternalLink, Handshake, Phone } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { fecha } from "../../lib/format";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal } from "../../components/ui";
import type { Convenio } from "../../erp/pages/Convenios";
import { registrarActividad } from "../actividad";

/** Convenios vigentes y promociones para socios (los carga el CeCIP desde el ERP) */
export default function Convenios() {
  const [tipo, setTipo] = useState<"" | "convenio" | "promocion">("");
  const [ver, setVer] = useState<Convenio | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["convenios-portal"],
    queryFn: async () => unwrap(await supabase.from("convenios").select("*").order("destacado", { ascending: false }).order("created_at", { ascending: false })) as Convenio[],
  });
  const lista = (data || []).filter((c) => !tipo || c.tipo === tipo);

  function abrir(c: Convenio) {
    setVer(c);
    registrarActividad("click", "convenios", { id: c.id, titulo: c.titulo });
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Convenios y promociones</h1>
        <p className="text-sm text-slate-500">Beneficios vigentes para las empresas socias del CeCIP.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {([["", "Todos"], ["convenio", "Convenios"], ["promocion", "Promociones"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTipo(v)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${tipo === v ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {l} {data && `· ${(data || []).filter((c) => !v || c.tipo === v).length}`}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {isLoading ? <Loading /> : !lista.length ? (
        <Card><Empty icon={<Handshake className="h-8 w-8" />}>No hay {tipo === "promocion" ? "promociones" : tipo === "convenio" ? "convenios" : "convenios ni promociones"} vigentes en este momento.</Empty></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((c) => (
            <button key={c.id} type="button" onClick={() => abrir(c)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              {c.imagen_url ? <img src={c.imagen_url} alt="" className="h-36 w-full object-cover" /> : (
                <div className={`grid h-24 place-items-center ${c.tipo === "convenio" ? "bg-gradient-to-br from-sky-500 to-brand-700" : "bg-gradient-to-br from-fuchsia-500 to-purple-700"} text-white`}>
                  {c.tipo === "convenio" ? <Handshake className="h-9 w-9" /> : <BadgePercent className="h-9 w-9" />}
                </div>
              )}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={c.tipo === "convenio" ? "blue" : "purple"}>{c.tipo === "convenio" ? "Convenio" : "Promoción"}</Badge>
                  {c.destacado && <Badge tone="amber">Destacado</Badge>}
                </div>
                <div className="mt-2 font-semibold text-slate-900">{c.titulo}</div>
                {c.empresa && <div className="text-xs text-slate-500">{c.empresa}</div>}
                {c.beneficio && <div className="mt-2 text-lg font-bold text-emerald-700">{c.beneficio}</div>}
                <div className="mt-auto flex items-center justify-between pt-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{c.vigencia_hasta ? `Hasta el ${fecha(c.vigencia_hasta)}` : "Vigente"}</span>
                  <span className="font-semibold text-brand-700 group-hover:underline">Ver detalle →</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!ver} onClose={() => setVer(null)} size="lg" title={ver?.titulo || ""}
        footer={ver && <>
          {ver.link && <a href={ver.link} target="_blank" rel="noopener noreferrer" onClick={() => registrarActividad("click", "convenios", { id: ver.id, titulo: `${ver.titulo} (link)` })}>
            <Button icon={<ExternalLink className="h-4 w-4" />}>Ir al sitio</Button></a>}
          <Button variant="secondary" onClick={() => setVer(null)}>Cerrar</Button>
        </>}>
        {ver && (
          <div className="space-y-3 text-sm">
            {ver.imagen_url && <img src={ver.imagen_url} alt="" className="max-h-56 w-full rounded-lg object-cover" />}
            <div className="flex flex-wrap gap-2">
              <Badge tone={ver.tipo === "convenio" ? "blue" : "purple"}>{ver.tipo === "convenio" ? "Convenio" : "Promoción"}</Badge>
              {ver.empresa && <Badge>{ver.empresa}</Badge>}{ver.rubro && <Badge>{ver.rubro}</Badge>}
            </div>
            {ver.beneficio && <div className="rounded-lg bg-emerald-50 p-3 text-lg font-bold text-emerald-800">{ver.beneficio}</div>}
            {ver.descripcion && <p className="whitespace-pre-wrap text-slate-700">{ver.descripcion}</p>}
            {ver.como_usarlo && <div><div className="text-xs font-semibold uppercase text-slate-500">Cómo usarlo</div><p className="whitespace-pre-wrap">{ver.como_usarlo}</p></div>}
            {ver.condiciones && <div><div className="text-xs font-semibold uppercase text-slate-500">Condiciones</div><p className="whitespace-pre-wrap text-slate-600">{ver.condiciones}</p></div>}
            {ver.contacto && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" />{ver.contacto}</div>}
            <div className="text-xs text-slate-500">
              {ver.vigencia_desde && `Desde el ${fecha(ver.vigencia_desde)} · `}{ver.vigencia_hasta ? `Vigente hasta el ${fecha(ver.vigencia_hasta)}` : "Sin fecha de vencimiento"}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
