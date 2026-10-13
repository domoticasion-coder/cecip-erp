import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle, Sparkles } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora, pesos } from "../../lib/format";
import { abrirWhatsapp } from "../../lib/whatsapp";
import type { ComerciaSolicitud } from "../../lib/types";
import { Badge, Button, Card, Empty, Loading, PageHeader, Select, Textarea, useToast } from "../../components/ui";
import { useInvalidate } from "../data";

type Sol = ComerciaSolicitud & { socio_nombre: string | null };

const ESTADOS: Record<ComerciaSolicitud["estado"], { label: string; tone: "amber" | "blue" | "green" | "gray" }> = {
  nueva: { label: "Nueva", tone: "amber" },
  en_curso: { label: "En curso", tone: "blue" },
  cerrada: { label: "Cerrada (concretada)", tone: "green" },
  descartada: { label: "Descartada", tone: "gray" },
};

export default function Comercia() {
  const { can, staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [estado, setEstado] = useState("abiertas");
  const [notas, setNotas] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["comercia", estado],
    queryFn: async () => {
      let q = supabase.from("comercia_solicitudes").select("*").order("created_at", { ascending: false });
      if (estado === "abiertas") q = q.in("estado", ["nueva", "en_curso"]);
      else if (estado) q = q.eq("estado", estado);
      return unwrap(await q) as Sol[];
    },
  });

  async function actualizar(s: Sol, cambios: Partial<ComerciaSolicitud>) {
    const { error } = await supabase.from("comercia_solicitudes").update(cambios).eq("id", s.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Solicitud actualizada.");
    invalidate("comercia", "badges", "dashboard");
  }

  const puede = can("comercia");
  const esComercia = staff?.rol === "comercia";

  return (
    <>
      <PageHeader
        title="ComercIA"
        subtitle="Pedidos de información que los socios envían desde el portal (ofertas ComercIA, IEC Services y cursos). Les llegan por WhatsApp a FactorIA; acá queda el registro para el seguimiento."
        actions={
          <Select className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="abiertas">Nuevas y en curso</option>
            <option value="nueva">Nuevas</option>
            <option value="en_curso">En curso</option>
            <option value="cerrada">Cerradas</option>
            <option value="descartada">Descartadas</option>
            <option value="">Todas</option>
          </Select>
        }
      />
      {isLoading ? <Loading /> : !data?.length ? (
        <Card><Empty icon={<Sparkles className="h-10 w-10" />}>No hay solicitudes para mostrar.</Empty></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((s) => (
            <Card key={s.id}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{s.servicio}</div>
                    {esComercia ? (
                      <span className="text-sm font-medium text-brand-600">{s.socio_nombre || "Socio del CeCIP"}</span>
                    ) : (
                      <Link to={`/socios/${s.socio_id}`} className="text-sm text-brand-600 hover:underline">{s.socio_nombre || "Socio"}</Link>
                    )}
                  </div>
                  <Badge tone={ESTADOS[s.estado].tone}>{ESTADOS[s.estado].label}</Badge>
                </div>
                {s.detalle && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{s.detalle}</p>}
                <div className="mt-2 text-xs text-slate-500">
                  {fechaHora(s.created_at)}
                  {s.presupuesto_estimado ? <> · Cotización estimada {pesos(s.presupuesto_estimado)}</> : null}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Contacto: {[s.contacto_nombre, s.contacto_email, s.contacto_telefono].filter(Boolean).join(" · ")}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {s.contacto_telefono && (
                    <Button size="sm" variant="success" icon={<MessageCircle className="h-3.5 w-3.5" />}
                      onClick={() => abrirWhatsapp(s.contacto_telefono, `Hola ${s.contacto_nombre || ""}! Te escribimos del CeCIP por tu consulta de ComercIA sobre "${s.servicio}".`)}>
                      WhatsApp
                    </Button>
                  )}
                  {s.contacto_email && (
                    <a href={`mailto:${s.contacto_email}?subject=${encodeURIComponent(`ComercIA - ${s.servicio}`)}`}>
                      <Button size="sm" variant="secondary" icon={<Mail className="h-3.5 w-3.5" />}>Email</Button>
                    </a>
                  )}
                  {puede && (
                    <Select className="w-auto py-1 text-xs" value={s.estado} onChange={(e) => actualizar(s, { estado: e.target.value as ComerciaSolicitud["estado"] })}>
                      {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                  )}
                </div>

                {puede && (
                  <div className="mt-3">
                    <Textarea rows={2} placeholder="Notas internas (no las ve el socio)…"
                      value={notas[s.id] ?? s.notas_internas ?? ""} onChange={(e) => setNotas({ ...notas, [s.id]: e.target.value })} />
                    {notas[s.id] !== undefined && notas[s.id] !== (s.notas_internas ?? "") && (
                      <div className="mt-1 text-right">
                        <Button size="sm" onClick={() => actualizar(s, { notas_internas: notas[s.id] || null })}>Guardar nota</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
