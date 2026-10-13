import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, UserCheck, X } from "lucide-react";
import { supabase, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { fechaHora, formatCuit, nombreSocio } from "../../lib/format";
import type { SocioUsuario } from "../../lib/types";
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";

type Estado = "pendiente" | "aprobado" | "rechazado";

export default function Accesos() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const [tab, setTab] = useState<Estado>("pendiente");
  const [aprobar, setAprobar] = useState<SocioUsuario | null>(null);
  const [rechazar, setRechazar] = useState<SocioUsuario | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["accesos", tab],
    queryFn: async () =>
      unwrap(await supabase.from("socio_usuarios").select("*").eq("estado", tab).order("created_at", { ascending: tab === "pendiente" })) as SocioUsuario[],
  });

  const socioNombre = (id: string | null) => {
    const s = socios?.find((x) => x.id === id);
    return s ? nombreSocio(s) : null;
  };

  async function resolver(u: SocioUsuario, ok: boolean, socioId?: string, motivo?: string) {
    try {
      const r = await api<{ email_enviado: boolean }>("accesos/resolver", { user_id: u.user_id, aprobar: ok, socio_id: socioId, motivo });
      toast((ok ? "Acceso aprobado." : "Solicitud rechazada.") + (r.email_enviado ? " Se le avisó por email." : " (No se pudo enviar el email de aviso.)"));
      invalidate("accesos", "badges", "dashboard", "socios");
      setAprobar(null);
      setRechazar(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function revocar(u: SocioUsuario) {
    if (!confirm(`¿Quitarle el acceso al portal a ${u.email}?`)) return;
    await resolver(u, false, undefined, "Acceso revocado por la administración.");
  }

  return (
    <>
      <PageHeader title="Accesos al portal de socios" subtitle="Los socios se registran desde la web del CeCIP; acá se valida que sean socios reales." />
      <Tabs<Estado> value={tab} onChange={setTab} tabs={[
        { value: "pendiente", label: "Pendientes" }, { value: "aprobado", label: "Aprobados" }, { value: "rechazado", label: "Rechazados" },
      ]} />
      <Card>
        {isLoading ? <Loading /> : !data?.length ? (
          <Empty icon={<UserCheck className="h-10 w-10" />}>{tab === "pendiente" ? "No hay solicitudes pendientes." : "Sin registros."}</Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Usuario</th><th className="th">Declaró</th><th className="th">Socio del padrón</th><th className="th text-right">Acciones</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((u) => {
                const vinculado = socioNombre(u.socio_id);
                return (
                  <tr key={u.user_id}>
                    <td className="td">
                      <div className="font-medium">{u.nombre || "—"}</div>
                      <div className="text-xs text-slate-500">{u.email}{u.telefono && ` · ${u.telefono}`}</div>
                      <div className="text-xs text-slate-400">{fechaHora(u.created_at)}</div>
                    </td>
                    <td className="td text-sm">
                      {u.razon_social_declarada}
                      {u.cuit_declarado && <div className="text-xs text-slate-500">CUIT {formatCuit(u.cuit_declarado)}</div>}
                    </td>
                    <td className="td text-sm">
                      {vinculado ? (
                        <Link to={`/socios/${u.socio_id}`} className="text-brand-600 hover:underline">{vinculado}</Link>
                      ) : (
                        <Badge tone="amber">CUIT no encontrado</Badge>
                      )}
                      {u.motivo_rechazo && <div className="text-xs text-slate-500">{u.motivo_rechazo}</div>}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {tab !== "aprobado" && <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setAprobar(u)}>Aprobar</Button>}
                        {tab === "pendiente" && <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => setRechazar(u)}>Rechazar</Button>}
                        {tab === "aprobado" && <Button size="sm" variant="secondary" onClick={() => revocar(u)}>Quitar acceso</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <AprobarModal usuario={aprobar} onClose={() => setAprobar(null)} onConfirm={(sid) => resolver(aprobar!, true, sid)} />
      <RechazarModal usuario={rechazar} onClose={() => setRechazar(null)} onConfirm={(m) => resolver(rechazar!, false, undefined, m)} />
    </>
  );
}

function AprobarModal({ usuario, onClose, onConfirm }: { usuario: SocioUsuario | null; onClose: () => void; onConfirm: (socioId: string) => Promise<void> }) {
  const { data: socios } = useSociosMin();
  const [socioId, setSocioId] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  if (!usuario) return null;
  const elegido = socioId || usuario.socio_id || "";
  const t = q.toLowerCase();
  const opciones = (socios || []).filter((s) => s.estado !== "baja" && (!t || nombreSocio(s).toLowerCase().includes(t) || s.razon_social.toLowerCase().includes(t)));

  return (
    <Modal open onClose={onClose} title="Aprobar acceso al portal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="success" disabled={!elegido} loading={saving} onClick={async () => { setSaving(true); await onConfirm(elegido); setSaving(false); }}>Aprobar</Button></>}>
      <div className="space-y-3 text-sm">
        <p><b>{usuario.nombre}</b> ({usuario.email}) declaró ser de <b>{usuario.razon_social_declarada}</b>{usuario.cuit_declarado && <> con CUIT {formatCuit(usuario.cuit_declarado)}</>}.</p>
        <p className="text-slate-600">Confirmá a qué socio del padrón corresponde. Si el socio no tenía CUIT cargado se completa con el declarado.</p>
        <Field label="Buscar socio"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o razón social…" /></Field>
        <Field label="Socio">
          <Select value={elegido} onChange={(e) => setSocioId(e.target.value)} size={8}>
            {opciones.map((s) => <option key={s.id} value={s.id}>{nombreSocio(s)}{s.numero_socio ? ` (N° ${s.numero_socio})` : ""}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function RechazarModal({ usuario, onClose, onConfirm }: { usuario: SocioUsuario | null; onClose: () => void; onConfirm: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("No encontramos tu empresa en el padrón de socios.");
  const [saving, setSaving] = useState(false);
  if (!usuario) return null;
  return (
    <Modal open onClose={onClose} title="Rechazar solicitud"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={saving} onClick={async () => { setSaving(true); await onConfirm(motivo); setSaving(false); }}>Rechazar</Button></>}>
      <Field label="Motivo (se le envía por email)"><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </Modal>
  );
}
