import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora, nombreSocio } from "../../lib/format";
import type { Comunicado, Envio } from "../../lib/types";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, useToast } from "../../components/ui";
import { useCategorias, useInvalidate } from "../data";
import { EnviarEmailModal } from "../components/EnviarEmail";
import { WhatsappCampanas } from "../components/WhatsappCampanas";
import { useSociosResumen } from "./Socios";

type Tab = "comunicados" | "whatsapp" | "masivo" | "historial";

export default function Comunicacion() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get("tab") as Tab) || "comunicados");
  return (
    <>
      <PageHeader title="Comunicación" subtitle="Comunicados oficiales en el portal, emails y WhatsApp a socios" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "comunicados", label: "Comunicados del portal" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "masivo", label: "Email masivo" },
          { value: "historial", label: "Historial de envíos" },
        ]}
      />
      {tab === "comunicados" && <Comunicados />}
      {tab === "whatsapp" && <WhatsappCampanas segmentoInicial={params.get("segmento") || undefined} />}
      {tab === "masivo" && <EnvioMasivo />}
      {tab === "historial" && <Historial />}
    </>
  );
}

// ---------------------------------------------------------------------------

function Comunicados() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editar, setEditar] = useState<Comunicado | "nuevo" | null>(null);
  const [emailDe, setEmailDe] = useState<Comunicado | null>(null);
  const { data: socios } = useSociosResumen();

  const { data, isLoading } = useQuery({
    queryKey: ["comunicados"],
    queryFn: async () => unwrap(await supabase.from("comunicados").select("*").order("created_at", { ascending: false })) as Comunicado[],
  });

  async function eliminar(c: Comunicado) {
    if (!confirm(`¿Eliminar el comunicado "${c.titulo}"?`)) return;
    const { error } = await supabase.from("comunicados").delete().eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("comunicados");
  }

  const activosConEmail = (socios || []).filter((s) => s.estado === "activo" && s.email).map((s) => s.id);
  const puede = can("atencion");

  return (
    <>
      <Card
        title="Comunicados"
        actions={puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nuevo")}>Nuevo comunicado</Button>}
      >
        {isLoading ? <Loading /> : !data?.length ? (
          <Empty>Todavía no hay comunicados. Los comunicados publicados se ven en el portal de socios.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.titulo}</span>
                    {c.publicado ? <Badge tone="green">Publicado</Badge> : <Badge>Borrador</Badge>}
                    {c.destacado && <Badge tone="amber">Destacado</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{c.cuerpo}</p>
                  <div className="mt-0.5 text-xs text-slate-400">{fechaHora(c.fecha_publicacion || c.created_at)}</div>
                </div>
                {puede && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setEmailDe(c)}>Enviar por email</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditar(c)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => eliminar(c)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ComunicadoForm value={editar} onClose={() => setEditar(null)} />
      <EnviarEmailModal
        open={!!emailDe}
        onClose={() => setEmailDe(null)}
        socioIds={activosConEmail}
        asuntoInicial={emailDe?.titulo || ""}
        cuerpoInicial={emailDe ? `Hola {{nombre}},\n\n${emailDe.cuerpo}` : ""}
        comunicadoId={emailDe?.id}
      />
    </>
  );
}

function ComunicadoForm({ value, onClose }: { value: Comunicado | "nuevo" | null; onClose: () => void }) {
  const { staff } = useAuth();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [publicado, setPublicado] = useState(true);
  const [destacado, setDestacado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nuevo") { setTitulo(""); setCuerpo(""); setPublicado(true); setDestacado(false); }
    else { setTitulo(value.titulo); setCuerpo(value.cuerpo); setPublicado(value.publicado); setDestacado(value.destacado); }
  }, [value]);

  async function guardar() {
    if (!titulo.trim() || !cuerpo.trim()) return setError("Completá título y texto.");
    setSaving(true);
    const prev = value !== "nuevo" ? value : null;
    const payload = {
      titulo: titulo.trim(), cuerpo: cuerpo.trim(), publicado, destacado,
      fecha_publicacion: publicado ? prev?.fecha_publicacion || new Date().toISOString() : null,
    };
    const res = prev
      ? await supabase.from("comunicados").update(payload).eq("id", prev.id)
      : await supabase.from("comunicados").insert({ ...payload, created_by: staff?.user_id });
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast(publicado ? "Comunicado publicado en el portal." : "Borrador guardado.");
    invalidate("comunicados");
    onClose();
  }

  return (
    <Modal
      open={!!value}
      onClose={onClose}
      size="lg"
      title={value === "nuevo" ? "Nuevo comunicado" : "Editar comunicado"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}
    >
      <div className="space-y-3">
        <Field label="Título"><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <Field label="Texto" hint="Los links se muestran clickeables en el portal.">
          <Textarea rows={10} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
        </Field>
        <div className="flex gap-6">
          <Checkbox checked={publicado} onChange={setPublicado} label="Publicado en el portal" />
          <Checkbox checked={destacado} onChange={setDestacado} label="Destacado (aparece primero)" />
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function EnvioMasivo() {
  const { data: socios, isLoading } = useSociosResumen();
  const { data: categorias } = useCategorias();
  const [segmento, setSegmento] = useState("activos");
  const [categoria, setCategoria] = useState("");
  const [abierto, setAbierto] = useState(false);

  const destinatarios = useMemo(() => (socios || []).filter((s) => {
    if (segmento !== "todos" && s.estado !== "activo") return false;
    if (segmento === "con-deuda" && !(s.deuda > 0)) return false;
    if (segmento === "vencidas" && !(s.cuotas_vencidas > 0)) return false;
    if (segmento === "al-dia" && s.deuda > 0) return false;
    if (categoria && s.categoria_id !== categoria) return false;
    return true;
  }), [socios, segmento, categoria]);

  const conEmail = destinatarios.filter((s) => !!s.email);

  if (isLoading) return <Loading />;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Destinatarios" className="h-fit">
        <div className="space-y-3 p-4">
          <Field label="Socios">
            <Select value={segmento} onChange={(e) => setSegmento(e.target.value)}>
              <option value="activos">Todos los activos</option>
              <option value="al-dia">Activos al día</option>
              <option value="con-deuda">Activos con deuda</option>
              <option value="vencidas">Activos con cuotas vencidas</option>
              <option value="todos">Todos (incluye suspendidos y bajas)</option>
            </Select>
          </Field>
          <Field label="Categoría">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <b>{conEmail.length}</b> socios con email
            {destinatarios.length !== conEmail.length && (
              <div className="text-xs text-amber-700">{destinatarios.length - conEmail.length} sin email cargado</div>
            )}
          </div>
          <Button className="w-full" icon={<Send className="h-4 w-4" />} disabled={!conEmail.length} onClick={() => setAbierto(true)}>
            Redactar email
          </Button>
          <p className="text-xs text-slate-500">Para WhatsApp usá la pestaña <b>WhatsApp</b>: arma un mensaje distinto para cada socio y espacia los envíos.</p>
        </div>
      </Card>

      <Card title="Vista previa de destinatarios" className="lg:col-span-2">
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto text-sm">
          {conEmail.map((s) => (
            <li key={s.id} className="flex justify-between px-4 py-2">
              <span>{nombreSocio(s)}</span>
              <span className="text-xs text-slate-500">{s.email}</span>
            </li>
          ))}
          {!conEmail.length && <Empty>No hay destinatarios con email para este filtro.</Empty>}
        </ul>
      </Card>

      <EnviarEmailModal open={abierto} onClose={() => setAbierto(false)} socioIds={conEmail.map((s) => s.id)} cuerpoInicial={"Hola {{nombre}},\n\n"} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Historial() {
  const [canal, setCanal] = useState("");
  const [estado, setEstado] = useState("");
  const { data: socios } = useSociosResumen();
  const { data, isLoading } = useQuery({
    queryKey: ["envios", "historial", canal, estado],
    queryFn: async () => {
      let q = supabase.from("envios").select("*").order("created_at", { ascending: false }).limit(300);
      if (canal) q = q.eq("canal", canal);
      if (estado) q = q.eq("estado", estado);
      return unwrap(await q) as Envio[];
    },
  });
  const nombre = (id: string | null) => {
    const s = socios?.find((x) => x.id === id);
    return s ? nombreSocio(s) : "—";
  };

  return (
    <Card>
      <div className="flex gap-2 border-b border-slate-100 p-3">
        <Select className="w-auto" value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Todos los canales</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </Select>
        <Select className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Enviados y con error</option>
          <option value="enviado">Enviados</option>
          <option value="error">Con error</option>
        </Select>
      </div>
      {isLoading ? <Loading /> : !data?.length ? <Empty>Sin envíos registrados.</Empty> : (
        <Table>
          <thead className="bg-slate-50">
            <tr><th className="th">Fecha</th><th className="th">Socio</th><th className="th">Asunto</th><th className="th">Canal</th><th className="th">Estado</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((e) => (
              <tr key={e.id}>
                <td className="td whitespace-nowrap text-xs">{fechaHora(e.created_at)}</td>
                <td className="td">{nombre(e.socio_id)}<div className="text-xs text-slate-400">{e.destinatario}</div></td>
                <td className="td text-sm">{e.asunto}<div className="text-xs text-slate-400">{e.tipo}</div></td>
                <td className="td text-sm">{e.canal === "email" ? "Email" : "WhatsApp"}</td>
                <td className="td">
                  <Badge tone={e.estado === "enviado" ? "green" : "red"}>{e.estado}</Badge>
                  {e.error && <div className="max-w-xs text-xs text-red-600">{e.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
