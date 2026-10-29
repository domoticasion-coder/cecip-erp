import { useEffect, useState } from "react";
import { supabase, traducirError } from "../../lib/supabase";
import { cuitValido, formatCuit, hoyISO, pesos } from "../../lib/format";
import { CONDICIONES_IVA, SEGUIMIENTOS, type CodigoPeriodicidad, type CondicionIva, type Seguimiento, type Socio } from "../../lib/types";
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "../../components/ui";
import { useCategorias, useInvalidate, usePeriodicidades } from "../data";

type FormState = Omit<Socio, "id" | "created_at" | "numero_socio"> & { numero_socio: string };

const vacio: FormState = {
  numero_socio: "", razon_social: "", nombre_comercial: "", cuit: "", rubro: "", categoria_id: null, estado: "activo",
  contacto_nombre: "", email: "", whatsapp: "", whatsapp_2: "", whatsapp_3: "", telefono: "", direccion: "", localidad: "Paraná", fecha_alta: hoyISO(), observaciones: "", whatsapp_baja: false,
  periodicidad: "mensual", condicion_iva: null, emails_extra: "", seguimiento: null, facturar_auto: true,
};

/** Alta / edición de socio. socio = null cierra, socio = "nuevo" crea uno nuevo. */
export function SocioForm({ socio, onClose, onSaved }: { socio: Socio | "nuevo" | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { data: categorias } = useCategorias();
  const { data: periodicidades } = usePeriodicidades();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [f, setF] = useState<FormState>(vacio);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!socio) return;
    setError(null);
    if (socio === "nuevo") setF(vacio);
    else setF({ ...vacio, ...socio, numero_socio: socio.numero_socio?.toString() || "" } as FormState);
  }, [socio]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const cat = categorias?.find((c) => c.id === f.categoria_id);
  const per = periodicidades?.find((p) => p.codigo === f.periodicidad);
  const cuotaTexto = cat && per && Number(cat.cuota_mensual) > 0
    ? `Cuota ${per.nombre.toLowerCase()}: ${pesos(Number(cat.cuota_mensual) * per.meses * (1 - Number(per.descuento) / 100))}`
    : undefined;

  async function guardar() {
    if (!f.razon_social.trim()) return setError("La razón social es obligatoria.");
    // (los CUIT importados del Excel se aceptan como están; se valida solo si se cambia)
    const cuitOriginal = socio && socio !== "nuevo" ? socio.cuit : null;
    if (f.cuit && f.cuit !== cuitOriginal && !cuitValido(f.cuit)) return setError("El CUIT no es válido (revisá los 11 dígitos).");
    // las direcciones de email no admiten tildes, ñ ni espacios (Resend rechaza el envío)
    const malos = [f.email, ...String(f.emails_extra || "").split(/[,;]+/)].map((e) => (e || "").trim())
      .filter((e) => e && !/^[!-~]+@[!-~]+\.[!-~]+$/.test(e));
    if (malos.length) return setError(`Email inválido: ${malos.join(", ")}. Revisá que no tenga tildes, ñ ni espacios (por ejemplo "administracion@…", sin tilde).`);
    setSaving(true);
    setError(null);

    const payload = {
      numero_socio: f.numero_socio ? Number(f.numero_socio) : null,
      razon_social: f.razon_social.trim(),
      nombre_comercial: f.nombre_comercial?.trim() || null,
      cuit: f.cuit ? formatCuit(f.cuit) : null,
      rubro: f.rubro?.trim() || null,
      categoria_id: f.categoria_id || null,
      estado: f.estado,
      contacto_nombre: f.contacto_nombre?.trim() || null,
      email: f.email?.trim().toLowerCase() || null,
      whatsapp: f.whatsapp?.trim() || null,
      whatsapp_2: f.whatsapp_2?.trim() || null,
      whatsapp_3: f.whatsapp_3?.trim() || null,
      telefono: f.telefono?.trim() || null,
      direccion: f.direccion?.trim() || null,
      localidad: f.localidad?.trim() || null,
      fecha_alta: f.fecha_alta || hoyISO(),
      observaciones: f.observaciones?.trim() || null,
      whatsapp_baja: !!f.whatsapp_baja,
      periodicidad: f.periodicidad,
      condicion_iva: f.condicion_iva || null,
      emails_extra: f.emails_extra?.trim().toLowerCase() || null,
      seguimiento: f.seguimiento || null,
      facturar_auto: !!f.facturar_auto,
    };

    const res = socio === "nuevo"
      ? await supabase.from("socios").insert(payload).select("id").single()
      : await supabase.from("socios").update(payload).eq("id", (socio as Socio).id).select("id").single();

    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    await invalidate("socios", "socio", "socios-min", "dashboard");
    toast(socio === "nuevo" ? "Socio creado." : "Cambios guardados.");
    onSaved?.(res.data.id);
    onClose();
  }

  return (
    <Modal
      open={!!socio}
      onClose={onClose}
      size="lg"
      title={socio === "nuevo" ? "Nuevo socio" : "Editar socio"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={guardar}>Guardar</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Razón social *" className="sm:col-span-2">
          <Input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} />
        </Field>
        <Field label="Nombre de fantasía">
          <Input value={f.nombre_comercial || ""} onChange={(e) => set("nombre_comercial", e.target.value)} />
        </Field>
        <Field label="CUIT">
          <Input value={f.cuit || ""} placeholder="30-12345678-9" onChange={(e) => set("cuit", e.target.value)} />
        </Field>
        <Field label="N° de socio">
          <Input inputMode="numeric" value={f.numero_socio} onChange={(e) => set("numero_socio", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Fecha de alta">
          <Input type="date" value={f.fecha_alta} onChange={(e) => set("fecha_alta", e.target.value)} />
        </Field>
        <Field label="Categoría (define el valor de la cuota)">
          <Select value={f.categoria_id || ""} onChange={(e) => set("categoria_id", e.target.value || null)}>
            <option value="">— Sin categoría —</option>
            {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Forma de pago (periodicidad de la cuota)" hint={cuotaTexto}>
          <Select value={f.periodicidad} onChange={(e) => set("periodicidad", e.target.value as CodigoPeriodicidad)}>
            {periodicidades?.map((p) => (
              <option key={p.codigo} value={p.codigo}>{p.nombre}{Number(p.descuento) ? ` (${p.descuento}% de descuento)` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Estado">
          <Select value={f.estado} onChange={(e) => set("estado", e.target.value as Socio["estado"])}>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido (no se le generan cuotas)</option>
            <option value="baja">Baja</option>
          </Select>
        </Field>
        <Field label="Seguimiento">
          <Select value={f.seguimiento || ""} onChange={(e) => set("seguimiento", (e.target.value || null) as Seguimiento | null)}>
            <option value="">—</option>
            {Object.entries(SEGUIMIENTOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Condición frente al IVA" hint="Define el tipo de factura (A, B o C).">
          <Select value={f.condicion_iva || ""} onChange={(e) => set("condicion_iva", (e.target.value || null) as CondicionIva | null)}>
            <option value="">— Sin dato —</option>
            {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox checked={!!f.facturar_auto} onChange={(v) => set("facturar_auto", v)} label="Facturarle automáticamente cada cobro" />
        </div>
        <Field label="Rubro">
          <Input value={f.rubro || ""} onChange={(e) => set("rubro", e.target.value)} />
        </Field>
        <Field label="Persona de contacto">
          <Input value={f.contacto_nombre || ""} onChange={(e) => set("contacto_nombre", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email || ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Otros emails" hint="Separados por coma (reciben copia de los avisos).">
          <Input value={f.emails_extra || ""} onChange={(e) => set("emails_extra", e.target.value)} />
        </Field>
        <Field label="WhatsApp principal" hint="Con característica, ej: 343 4551234. A este número salen las difusiones.">
          <Input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} />
        </Field>
        <Field label="WhatsApp 2" hint="Opcional: otro número desde el que escribe el comercio.">
          <Input value={f.whatsapp_2 || ""} onChange={(e) => set("whatsapp_2", e.target.value)} />
        </Field>
        <Field label="WhatsApp 3" hint="Opcional. La IA reconoce al socio desde cualquiera de sus números.">
          <Input value={f.whatsapp_3 || ""} onChange={(e) => set("whatsapp_3", e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox checked={!!f.whatsapp_baja} onChange={(v) => set("whatsapp_baja", v)} label="No enviarle difusiones por WhatsApp (pidió BAJA)" />
        </div>
        <Field label="Teléfono">
          <Input value={f.telefono || ""} onChange={(e) => set("telefono", e.target.value)} />
        </Field>
        <Field label="Localidad">
          <Input value={f.localidad || ""} onChange={(e) => set("localidad", e.target.value)} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={f.direccion || ""} onChange={(e) => set("direccion", e.target.value)} />
        </Field>
        <Field label="Observaciones" className="sm:col-span-2">
          <Textarea rows={2} value={f.observaciones || ""} onChange={(e) => set("observaciones", e.target.value)} />
        </Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}
