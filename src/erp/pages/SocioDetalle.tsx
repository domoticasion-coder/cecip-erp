import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Link2, Mail, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, fechaHora, formatCuit, nombreSocio, pesos } from "../../lib/format";
import { abrirWhatsapp, normalizarWhatsapp } from "../../lib/whatsapp";
import { SEGUIMIENTOS, type CuotaDetalle, type Envio, type SocioNota, type SocioResumen, type SocioUsuario } from "../../lib/types";
import { Badge, Button, Card, Empty, Loading, PageHeader, Select, SituacionBadge, Stat, Tabs, Textarea, useToast } from "../../components/ui";
import { useInvalidate } from "../data";
import { SocioForm } from "../components/SocioForm";
import { CuotasTabla } from "../components/CuotasTabla";
import { NuevaCuotaModal } from "../components/NuevaCuota";
import { LinkPagoModal, type LinkTarget } from "../components/Cobro";
import { EnviarEmailModal } from "../components/EnviarEmail";
import { FacturacionSocio } from "../components/Facturas";

type Tab = "cuenta" | "facturacion" | "historial" | "datos" | "portal" | "envios";

const TIPOS_NOTA: Record<SocioNota["tipo"], string> = {
  nota: "Nota", llamada: "Llamada", reunion: "Reunión", email: "Email", whatsapp: "WhatsApp", pago: "Pago", sistema: "Sistema",
};

export default function SocioDetalle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<Tab>("cuenta");
  const [editar, setEditar] = useState(false);
  const [nuevaCuota, setNuevaCuota] = useState(false);
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [email, setEmail] = useState(false);
  const [verAnuladas, setVerAnuladas] = useState(false);

  const { data: socio, isLoading } = useQuery({
    queryKey: ["socio", id],
    queryFn: async () => unwrap(await supabase.from("socios_resumen").select("*").eq("id", id!).single()) as SocioResumen,
  });

  const { data: cuotas } = useQuery({
    queryKey: ["cuotas", "socio", id],
    queryFn: async () =>
      unwrap(await supabase.from("cuotas_detalle").select("*").eq("socio_id", id!).order("vencimiento", { ascending: false })) as CuotaDetalle[],
  });

  if (isLoading) return <Loading />;
  if (!socio) return <Empty>Socio no encontrado.</Empty>;

  const nombre = nombreSocio(socio);
  const wa = normalizarWhatsapp(socio.whatsapp || socio.telefono);
  const visibles = (cuotas || []).filter((c) => verAnuladas || c.estado !== "anulada");
  const pagadoAnio = (cuotas || [])
    .filter((c) => c.estado === "pagada" && c.fecha_pago?.startsWith(String(new Date().getFullYear())))
    .reduce((a, c) => a + Number(c.monto_pagado || 0), 0);

  async function eliminar() {
    if (!confirm(`¿Eliminar definitivamente a ${nombre}? Solo es posible si no tiene cuotas. Para socios que dejan la institución usá el estado "Baja".`)) return;
    const { error } = await supabase.from("socios").delete().eq("id", socio!.id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Socio eliminado.");
    invalidate("socios", "socios-min");
    navigate("/socios");
  }

  return (
    <>
      <Link to="/socios" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Socios
      </Link>
      <PageHeader
        title={nombre}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {socio.nombre_comercial && <span>{socio.razon_social}</span>}
            {socio.numero_socio && <span>· Socio N° {socio.numero_socio}</span>}
            {socio.cuit && <span>· CUIT {formatCuit(socio.cuit)}</span>}
            <SituacionBadge s={socio.estado} />
            {socio.categoria_nombre ? <Badge tone="blue">{socio.categoria_nombre}</Badge> : <Badge tone="amber">Sin categoría</Badge>}
            {socio.periodicidad_nombre && <Badge tone="purple">Paga {socio.periodicidad_nombre.toLowerCase()}</Badge>}
            {socio.seguimiento && <Badge tone={SEGUIMIENTOS[socio.seguimiento].tone}>{SEGUIMIENTOS[socio.seguimiento].label}</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<MessageCircle className="h-4 w-4" />} disabled={!wa}
              onClick={() => abrirWhatsapp(socio.whatsapp || socio.telefono, `Hola ${nombre}! Te escribimos del Centro Comercial e Industrial de Paraná.`)}>
              WhatsApp
            </Button>
            {can("atencion", "tesoreria", "prensa") && <Button variant="secondary" icon={<Mail className="h-4 w-4" />} disabled={!socio.email} onClick={() => setEmail(true)}>Email</Button>}
            {socio.deuda > 0 && can("tesoreria", "atencion") && (
              <Button variant="success" icon={<Link2 className="h-4 w-4" />} onClick={() => setLink({ socio })}>
                Link de pago total
              </Button>
            )}
            {can("atencion", "tesoreria") && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditar(true)}>Editar</Button>}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Deuda actual" value={pesos(socio.deuda)} tone={socio.cuotas_vencidas > 0 ? "bad" : socio.deuda > 0 ? "warn" : "good"}
          hint={socio.cuotas_pendientes ? `${socio.cuotas_pendientes} cuota(s) pendiente(s)` : "Al día"} />
        <Stat label="Cuotas vencidas" value={socio.cuotas_vencidas} tone={socio.cuotas_vencidas ? "bad" : "default"}
          hint={socio.max_dias_atraso ? `Máx. ${socio.max_dias_atraso} días de atraso` : undefined} />
        <Stat label={`Pagado en ${new Date().getFullYear()}`} value={pesos(pagadoAnio)} />
        <Stat
          label={socio.periodicidad_nombre ? `Cuota ${socio.periodicidad_nombre.toLowerCase()}` : "Cuota"}
          value={socio.cuota_periodo ? pesos(socio.cuota_periodo) : "—"}
          hint={socio.cuota_mensual ? `${pesos(socio.cuota_mensual)} por mes · socio desde ${fecha(socio.fecha_alta)}` : `Socio desde ${fecha(socio.fecha_alta)}`}
        />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "cuenta", label: "Cuenta corriente" },
          { value: "facturacion", label: "Facturación" },
          { value: "historial", label: "Historial de contacto" },
          { value: "datos", label: "Datos" },
          { value: "portal", label: "Acceso al portal" },
          { value: "envios", label: "Emails enviados" },
        ]}
      />

      {tab === "cuenta" && (
        <Card
          title="Cuotas y cargos"
          actions={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} /> Ver anuladas
              </label>
              {can("tesoreria") && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNuevaCuota(true)}>Nuevo cargo</Button>}
            </div>
          }
        >
          {cuotas ? <CuotasTabla cuotas={visibles} showSocio={false} /> : <Loading />}
        </Card>
      )}

      {tab === "facturacion" && <FacturacionSocio socio={socio} />}
      {tab === "historial" && <Historial socioId={socio.id} />}

      {tab === "datos" && (
        <Card>
          <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <Dato k="Razón social" v={socio.razon_social} />
            <Dato k="Nombre de fantasía" v={socio.nombre_comercial} />
            <Dato k="CUIT" v={formatCuit(socio.cuit)} />
            <Dato k="Rubro" v={socio.rubro} />
            <Dato k="Categoría" v={socio.categoria_nombre} />
            <Dato k="Forma de pago" v={socio.periodicidad_nombre} />
            <Dato k="Condición frente al IVA" v={socio.condicion_iva} />
            <Dato k="Contacto" v={socio.contacto_nombre} />
            <Dato k="Email" v={socio.email} />
            <Dato k="Otros emails" v={socio.emails_extra} />
            <Dato k="WhatsApp" v={socio.whatsapp} />
            <Dato k="Teléfono" v={socio.telefono} />
            <Dato k="Dirección" v={[socio.direccion, socio.localidad].filter(Boolean).join(", ")} />
            <Dato k="Fecha de alta" v={fecha(socio.fecha_alta)} />
            <Dato k="Observaciones" v={socio.observaciones} />
          </dl>
          {can() && (
            <div className="border-t border-slate-100 p-3 text-right">
              <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={eliminar}>Eliminar socio</Button>
            </div>
          )}
        </Card>
      )}

      {tab === "portal" && <AccesoPortal socioId={socio.id} />}
      {tab === "envios" && <Envios socioId={socio.id} />}

      <SocioForm socio={editar ? socio : null} onClose={() => setEditar(false)} />
      <NuevaCuotaModal open={nuevaCuota} onClose={() => setNuevaCuota(false)} socioId={socio.id} />
      <LinkPagoModal target={link} onClose={() => setLink(null)} />
      <EnviarEmailModal open={email} onClose={() => setEmail(false)} socioIds={[socio.id]} cuerpoInicial={`Hola {{nombre}},\n\n\n\nSaludos cordiales,\n${staff?.nombre}\nCentro Comercial e Industrial de Paraná`} />
    </>
  );
}

function Dato({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="whitespace-pre-line">{v || "—"}</dd>
    </div>
  );
}

function Historial({ socioId }: { socioId: string }) {
  const { staff, can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<SocioNota["tipo"]>("nota");
  const [saving, setSaving] = useState(false);

  const { data: notas } = useQuery({
    queryKey: ["notas", socioId],
    queryFn: async () =>
      unwrap(await supabase.from("socio_notas").select("*").eq("socio_id", socioId).order("created_at", { ascending: false })) as SocioNota[],
  });

  async function agregar() {
    if (!texto.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("socio_notas").insert({
      socio_id: socioId, tipo, texto: texto.trim(), autor_nombre: staff?.nombre, created_by: staff?.user_id,
    });
    setSaving(false);
    if (error) return toast(traducirError(error.message), "error");
    setTexto("");
    invalidate("notas");
  }

  return (
    <Card>
      {can("tesoreria", "atencion", "prensa") && <div className="border-b border-slate-100 p-4">
        <Textarea rows={2} placeholder="Registrar una llamada, reunión, reclamo, acuerdo de pago…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="mt-2 flex justify-end gap-2">
          <Select className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as SocioNota["tipo"])}>
            {(["nota", "llamada", "reunion", "email", "whatsapp"] as const).map((t) => <option key={t} value={t}>{TIPOS_NOTA[t]}</option>)}
          </Select>
          <Button loading={saving} onClick={agregar}>Agregar</Button>
        </div>
      </div>}
      {!notas?.length ? (
        <Empty>Sin registros todavía.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {notas.map((n) => (
            <li key={n.id} className="px-4 py-3 text-sm">
              <div className="mb-0.5 flex items-center gap-2 text-xs text-slate-500">
                <Badge tone={n.tipo === "pago" ? "green" : n.tipo === "sistema" ? "gray" : "blue"}>{TIPOS_NOTA[n.tipo]}</Badge>
                {fechaHora(n.created_at)} {n.autor_nombre && <>· {n.autor_nombre}</>}
              </div>
              <div className="whitespace-pre-line">{n.texto}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccesoPortal({ socioId }: { socioId: string }) {
  const { data: usuarios } = useQuery({
    queryKey: ["accesos", "socio", socioId],
    queryFn: async () => unwrap(await supabase.from("socio_usuarios").select("*").eq("socio_id", socioId).order("created_at")) as SocioUsuario[],
  });
  return (
    <Card title="Usuarios del portal de socios" actions={<Link to="/accesos" className="text-xs text-brand-600 hover:underline">Gestionar accesos</Link>}>
      {!usuarios?.length ? (
        <Empty>Este socio todavía no tiene usuarios en el portal. Puede registrarse desde la web del CeCIP.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {usuarios.map((u) => (
            <li key={u.user_id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{u.nombre || u.email}</div>
                <div className="text-xs text-slate-500">{u.email} · registrado {fecha(u.created_at.slice(0, 10))}</div>
              </div>
              <Badge tone={u.estado === "aprobado" ? "green" : u.estado === "pendiente" ? "amber" : "red"}>{u.estado}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Envios({ socioId }: { socioId: string }) {
  const { data } = useQuery({
    queryKey: ["envios", "socio", socioId],
    queryFn: async () =>
      unwrap(await supabase.from("envios").select("*").eq("socio_id", socioId).order("created_at", { ascending: false }).limit(100)) as Envio[],
  });
  return (
    <Card>
      {!data?.length ? (
        <Empty>No se le enviaron comunicaciones todavía.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <div>
                <div>{e.asunto}</div>
                <div className="text-xs text-slate-500">{fechaHora(e.created_at)} · {e.canal} · {e.tipo}{e.error && <span className="text-red-600"> · {e.error}</span>}</div>
              </div>
              <Badge tone={e.estado === "enviado" ? "green" : "red"}>{e.estado}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
