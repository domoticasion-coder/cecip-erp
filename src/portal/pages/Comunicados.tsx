import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { fechaHora } from "../../lib/format";
import type { Comunicado } from "../../lib/types";
import { Badge, Card, Empty, Loading } from "../../components/ui";

/** Texto con saltos de línea y links clickeables (sin HTML) */
export function TextoConLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
      {partes.map((p, i) =>
        /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline break-all">{p}</a> : p
      )}
    </p>
  );
}

export default function Comunicados() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal-comunicados", "todos"],
    queryFn: async () =>
      unwrap(await supabase.from("comunicados").select("*").eq("publicado", true)
        .order("destacado", { ascending: false }).order("fecha_publicacion", { ascending: false })) as Comunicado[],
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Comunicados oficiales</h1>
      {isLoading ? <Loading /> : !data?.length ? (
        <Card><Empty icon={<Megaphone className="h-10 w-10" />}>No hay comunicados publicados.</Empty></Card>
      ) : data.map((c) => (
        <Card key={c.id}>
          <div className="p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{c.titulo}</h2>
              {c.destacado && <Badge tone="amber">Importante</Badge>}
            </div>
            <div className="mb-3 text-xs text-slate-400">{fechaHora(c.fecha_publicacion)}</div>
            {c.imagen_url && (
              <a href={c.imagen_url} target="_blank" rel="noopener noreferrer">
                <img src={c.imagen_url} alt="" className="mb-3 max-h-[28rem] w-full rounded-lg object-contain bg-slate-50" />
              </a>
            )}
            <TextoConLinks texto={c.cuerpo} />
          </div>
        </Card>
      ))}
    </div>
  );
}
