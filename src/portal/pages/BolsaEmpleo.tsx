import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Download, Heart, Search } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { fecha } from "../../lib/format";
import { Badge, Button, Card, Empty, Loading, Select, useToast } from "../../components/ui";
import { useInvalidate } from "../../erp/data";
import { abrirCv, type BolsaCv } from "../../erp/pages/BolsaEmpleo";

/**
 * Bolsa de empleo para los socios: currículums que la gente cargó en la web del CeCIP y que el
 * CeCIP aprobó. El socio puede descargarlos y marcar "Me interesa" (el CeCIP ve quién se interesó).
 */
export default function BolsaEmpleo({ socioId }: { socioId: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["bolsa", "portal"],
    queryFn: async () => unwrap(await supabase.from("bolsa_cvs").select("id, nombre, localidad, area, tipo_profesional, comentarios, archivo_path, archivo_nombre, archivo_tamano, created_at, email, telefono, estado, notas")
      .eq("estado", "aprobado").order("created_at", { ascending: false })) as BolsaCv[],
  });
  const { data: mios } = useQuery({
    queryKey: ["bolsa", "mis-intereses", socioId],
    queryFn: async () => (unwrap(await supabase.from("bolsa_interes").select("cv_id").eq("socio_id", socioId)) as { cv_id: string }[]).map((x) => x.cv_id),
  });

  async function interes(cv: BolsaCv, marcar: boolean) {
    const { error } = marcar
      ? await supabase.from("bolsa_interes").insert({ cv_id: cv.id, socio_id: socioId })
      : await supabase.from("bolsa_interes").delete().eq("cv_id", cv.id).eq("socio_id", socioId);
    if (error) return toast(traducirError(error.message), "error");
    toast(marcar ? "Le avisamos al CeCIP que te interesa este perfil." : "Listo.");
    invalidate("bolsa");
  }

  const areas = [...new Set((data || []).map((c) => c.area).filter(Boolean))] as string[];
  const lista = (data || []).filter((c) => (!area || c.area === area) &&
    (!q.trim() || [c.nombre, c.localidad, c.comentarios, c.tipo_profesional].some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()))));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Bolsa de empleo</h1>
        <p className="mt-1 text-sm text-slate-500">Perfiles que se postularon en la web del CeCIP. Descargá el CV y, si te interesa, avisanos con "Me interesa" o contactalo directamente.</p>
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar por perfil o localidad…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </Select>
        </div>
        {isLoading ? <Loading /> : !lista.length ? <Empty icon={<Briefcase className="h-8 w-8" />}>Todavía no hay perfiles publicados.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {lista.map((c) => {
              const marcado = mios?.includes(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{c.nombre}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.area && <Badge tone="blue">{c.area}</Badge>}
                      {c.tipo_profesional && <Badge>{c.tipo_profesional}</Badge>}
                      {c.localidad && <Badge tone="gray">{c.localidad}</Badge>}
                    </div>
                    {c.comentarios && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{c.comentarios}</p>}
                    <div className="mt-1 text-xs text-slate-400">Postulado el {fecha(c.created_at.slice(0, 10))}{c.email ? ` · ${c.email}` : ""}{c.telefono ? ` · ${c.telefono}` : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    {c.archivo_path && <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => abrirCv(c.archivo_path, c.archivo_nombre)}>CV</Button>}
                    <Button size="sm" variant={marcado ? "success" : "secondary"} icon={<Heart className="h-4 w-4" />} onClick={() => interes(c, !marcado)}>
                      {marcado ? "Te interesa" : "Me interesa"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
