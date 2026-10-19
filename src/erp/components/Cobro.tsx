import { useEffect, useState } from "react";
import { Copy, Mail, MessageCircle, Link2 } from "lucide-react";
import { supabase, traducirError } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hoyISO, nombreSocio, pesos, fecha } from "../../lib/format";
import { abrirWhatsapp, normalizarWhatsapp } from "../../lib/whatsapp";
import { METODOS_PAGO, type CuotaDetalle } from "../../lib/types";
import { Button, ErrorBox, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { enviarFacturasEnCola, useConfig, useCuentas, useInvalidate } from "../data";

export const INVALIDAR_COBRO = ["cuotas", "socios", "socio", "dashboard", "movimientos", "morosos", "notas", "facturas"];

/** Modal para registrar el cobro manual de una cuota (efectivo, transferencia, etc.) */
export function PagoModal({ cuota, onClose }: { cuota: CuotaDetalle | null; onClose: () => void }) {
  const { data: cuentas } = useCuentas();
  const { data: cfg } = useConfig();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [metodo, setMetodo] = useState("Efectivo");
  const [cuenta, setCuenta] = useState("");
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [monto, setMonto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cuota) {
      setMetodo("Efectivo");
      setFechaPago(hoyISO());
      setMonto(String(cuota.total));
      setReferencia("");
      setError(null);
    }
  }, [cuota]);

  useEffect(() => {
    if (!cfg) return;
    setCuenta((metodo === "Mercado Pago" ? cfg.cuenta_mp_id : cfg.cuenta_default_id) || "");
  }, [metodo, cfg]);

  async function guardar() {
    if (!cuota) return;
    const m = Number(monto.replace(",", "."));
    if (!m || m <= 0) return setError("Ingresá un monto válido.");
    setSaving(true);
    setError(null);
    const { data, error } = await supabase.rpc("registrar_pago", {
      p_cuota_id: cuota.id,
      p_metodo: metodo,
      p_cuenta_id: cuenta || null,
      p_fecha: fechaPago,
      p_referencia: referencia || null,
      p_monto: m,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    // Con la facturación automática activa el cobro deja la factura en cola: se envía a n8n / ARCA
    if (cfg?.facturacion_auto) enviarFacturasEnCola().then(() => invalidate("facturas"));
    await invalidate(...INVALIDAR_COBRO);
    toast(`Pago registrado. Recibo N° ${data.recibo_numero}.${cfg?.facturacion_auto ? " La factura se está emitiendo." : ""}`);
    onClose();
  }

  return (
    <Modal
      open={!!cuota}
      onClose={onClose}
      title="Registrar pago"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="success" loading={saving} onClick={guardar}>Confirmar pago</Button>
        </>
      }
    >
      {cuota && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-semibold">{nombreSocio(cuota)}</div>
            <div className="text-slate-600">{cuota.concepto} · vence {fecha(cuota.vencimiento)}</div>
            <div className="mt-1">
              Importe {pesos(cuota.monto)}
              {cuota.interes > 0 && <> + intereses {pesos(cuota.interes)} ({cuota.dias_atraso} días)</>}
              {" = "}<b>{pesos(cuota.total)}</b>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Forma de pago">
              <Select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {METODOS_PAGO.map((m) => <option key={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Ingresa en">
              <Select value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
                <option value="">— Sin cuenta —</option>
                {cuentas?.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Fecha de pago">
              <Input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
            </Field>
            <Field label="Monto cobrado" hint="Podés ajustarlo si se condonan intereses.">
              <Input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
            </Field>
          </div>
          <Field label="Referencia (opcional)" hint="N° de transferencia, cheque, etc.">
            <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}

export interface LinkTarget {
  socio: { id: string; razon_social: string; nombre_comercial: string | null; whatsapp: string | null; email: string | null };
  cuotaIds?: string[];
}

/** Genera el link de pago de Mercado Pago y permite copiarlo o enviarlo por WhatsApp/email */
export function LinkPagoModal({ target, onClose }: { target: LinkTarget | null; onClose: () => void }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [link, setLink] = useState<{ url: string; total: number; cuotas: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!target) return;
    setLink(null);
    setError(null);
    setLoading(true);
    api("pagos/link", { socio_id: target.socio.id, cuota_ids: target.cuotaIds })
      .then(setLink)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [target]);

  if (!target) return null;
  const nombre = nombreSocio(target.socio);
  const wa = normalizarWhatsapp(target.socio.whatsapp);

  const mensaje = link
    ? `Hola ${nombre}! Te escribimos del Centro Comercial e Industrial de Paraná. ` +
      `Tenés ${link.cuotas === 1 ? "1 cuota pendiente" : `${link.cuotas} cuotas pendientes`} por un total de ${pesos(link.total)}. ` +
      `Podés abonar online con Mercado Pago desde este link: ${link.url}\n\nSi ya realizaste el pago, desestimá este mensaje. ¡Gracias!`
    : "";

  async function registrar(canal: "whatsapp" | "email", texto: string) {
    await Promise.all([
      supabase.from("envios").insert({
        socio_id: target!.socio.id, canal, tipo: "recordatorio", asunto: "Link de pago",
        destinatario: canal === "whatsapp" ? wa : target!.socio.email, created_by: staff?.user_id,
      }),
      supabase.from("socio_notas").insert({
        socio_id: target!.socio.id, tipo: canal, texto, autor_nombre: staff?.nombre, created_by: staff?.user_id,
      }),
    ]);
    invalidate("notas", "envios");
  }

  async function porWhatsapp() {
    if (!abrirWhatsapp(target!.socio.whatsapp, mensaje)) return toast("El socio no tiene un WhatsApp válido cargado.", "error");
    await registrar("whatsapp", `Se envió link de pago por WhatsApp (${pesos(link!.total)}).`);
  }

  async function porEmail() {
    setSending(true);
    try {
      const r = await api<{ enviados: number; pendientes: number; errores: { error: string }[] }>("cobranzas/recordatorio", {
        socio_ids: [target!.socio.id], cuota_ids: target!.cuotaIds,
      });
      if (r.enviados) {
        toast("Email enviado con el link de pago.");
        await supabase.from("socio_notas").insert({
          socio_id: target!.socio.id, tipo: "email", texto: `Se envió recordatorio de pago por email (${pesos(link!.total)}).`,
          autor_nombre: staff?.nombre, created_by: staff?.user_id,
        });
        invalidate("notas", "envios", "cuotas");
      } else if (r.pendientes) {
        toast("Hoy ya se usó el cupo diario de emails: el recordatorio quedó en cola y sale mañana.");
        invalidate("envios");
      } else toast(r.errores[0]?.error || "No se pudo enviar.", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Link de pago · ${nombre}`}>
      {loading && <p className="text-sm text-slate-500">Generando link en Mercado Pago…</p>}
      <ErrorBox error={error} />
      {link && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            {link.cuotas === 1 ? "1 cuota" : `${link.cuotas} cuotas`} · Total <b>{pesos(link.total)}</b>
            <div className="mt-1 text-xs text-slate-500">El link vence en 5 días. Al pagarse, la cuota se marca como pagada sola.</div>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={link.url} onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => navigator.clipboard.writeText(link.url).then(() => toast("Link copiado."))}
            >
              Copiar
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="success" icon={<MessageCircle className="h-4 w-4" />} onClick={porWhatsapp} disabled={!wa}>
              Enviar por WhatsApp
            </Button>
            <Button icon={<Mail className="h-4 w-4" />} onClick={porEmail} loading={sending} disabled={!target.socio.email}>
              Enviar por email
            </Button>
          </div>
          {!wa && <p className="text-xs text-amber-700">El socio no tiene WhatsApp válido cargado.</p>}
          {!target.socio.email && <p className="text-xs text-amber-700">El socio no tiene email cargado.</p>}
        </div>
      )}
    </Modal>
  );
}

export function LinkIcon() {
  return <Link2 className="h-4 w-4" />;
}
