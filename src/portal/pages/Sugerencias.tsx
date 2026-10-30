import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Send } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora } from "../../lib/format";
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, Select, Textarea, useToast } from "../../components/ui";
import { ESTADOS_SUG, type Sugerencia } from "../../erp/pages/ActividadPortal";
import { registrarActividad } from "../actividad";

export const CATEGORIAS_SUGERENCIA = ["General", "Capacitaciones", "Eventos", "Beneficios y convenios", "Portal de socios", "Gestiones ante el Estado", "Comunicación", "Otro"];

/** El socio le escribe sugerencias al CeCIP y ve las respuestas */
export default function Sugerencias({ socioId }: { socioId: string }) {
  const { session } = useAuth();
  const toast = useToast();
  const [categoria, setCategoria] = useState(CATEGORIAS_SUGERENCIA[0]);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["mis-sugerencias", socioId],
    queryFn: async () => unwrap(await supabase.from("sugerencias").select("*").eq("socio_id", socioId).order("created_at", { ascending: false })) as Sugerencia[],
  });

  async function enviar() {
    if (mensaje.trim().length < 3) return setError("Escribí tu sugerencia.");
    setEnviando(true);
    setError(null);
    const { error } = await supabase.from("sugerencias").insert({ socio_id: socioId, user_id: session?.user.id, categoria, mensaje: mensaje.trim() });
    setEnviando(false);
    if (error) return setError(traducirError(error.message));
    registrarActividad("sugerencia", "sugerencias", { titulo: categoria });
    setMensaje("");
    toast("¡Gracias! Recibimos tu sugerencia y te vamos a responder por acá.");
    refetch();
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Lightbulb className="h-6 w-6 text-amber-500" /> Sugerencias al CeCIP</h1>
        <p className="text-sm text-slate-500">¿Qué te gustaría que haga o mejore el Centro Comercial? Leemos todas las sugerencias y respondemos acá.</p>
      </div>
      <Card className="mb-5">
        <div className="space-y-3 p-4">
          <Field label="Tema">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>{CATEGORIAS_SUGERENCIA.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Tu sugerencia">
            <Textarea rows={5} maxLength={4000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Contanos tu idea, propuesta o algo que podamos mejorar…" />
          </Field>
          <ErrorBox error={error} />
          <Button loading={enviando} icon={<Send className="h-4 w-4" />} onClick={enviar}>Enviar sugerencia</Button>
        </div>
      </Card>
      <Card title="Mis sugerencias">
        {isLoading ? <Loading /> : !data?.length ? <Empty icon={<Lightbulb className="h-8 w-8" />}>Todavía no enviaste sugerencias.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.map((s) => (
              <li key={s.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{s.categoria}</Badge>
                  <Badge tone={ESTADOS_SUG[s.estado].tone}>{s.estado === "nueva" ? "Recibida" : ESTADOS_SUG[s.estado].label}</Badge>
                  <span className="text-xs text-slate-400">{fechaHora(s.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-slate-700">{s.mensaje}</p>
                {s.respuesta && (
                  <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3">
                    <div className="mb-1 text-xs font-semibold text-emerald-800">Respuesta del CeCIP · {fechaHora(s.respondido_at)}</div>
                    <p className="whitespace-pre-wrap text-slate-700">{s.respuesta}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
