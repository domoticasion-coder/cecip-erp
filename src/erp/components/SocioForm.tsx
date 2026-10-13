import { useEffect, useState } from "react";
import { supabase, traducirError } from "../../lib/supabase";
import { cuitValido, formatCuit, hoyISO } from "../../lib/format";
import type { Socio } from "../../lib/types";
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "../../components/ui";
import { useCategorias, useInvalidate } from "../data";

type FormState = Omit<Socio, "id" | "created_at" | "numero_socio"> & { numero_socio: string };

const vacio: FormState = {
  numero_socio: "", razon_social: "", nombre_comercial: "", cuit: "", rubro: "", categoria_id: null, estado: "activo",
  contacto_nombre: "", email: "", whatsapp: "", telefono: "", direccion: "", localidad: "Paraná", fecha_alta: hoyISO(), observaciones: "", whatsapp_baja: false,
};

/** Alta / edición de socio. socio = null cierra, socio = "nuevo" crea uno nuevo. */
export function SocioForm({ socio, onClose, onSaved }: { socio: Socio | "nuevo" | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { data: categorias } = useCategorias();
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

  async function guardar() {
    if (!f.razon_social.trim()) return setError("La razón social es obligatoria.");
    if (f.cuit && !cuitValido(f.cuit)) return setError("El CUIT no es válido (revisá los 11 dígitos).");
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
      telefono: f.telefono?.trim() || null,
      direccion: f.direccion?.trim() || null,
      localidad: f.localidad?.trim() || null,
      fecha_alta: f.fecha_alta || hoyISO(),
      observaciones: f.observaciones?.trim() || null,
      whatsapp_baja: !!f.whatsapp_baja,
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
        <Field label="Estado">
          <Select value={f.estado} onChange={(e) => set("estado", e.target.value as Socio["estado"])}>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido (no se le generan cuotas)</option>
            <option value="baja">Baja</option>
          </Select>
        </Field>
        <Field label="Rubro">
          <Input value={f.rubro || ""} onChange={(e) => set("rubro", e.target.value)} />
        </Field>
        <Field label="Persona de contacto">
          <Input value={f.contacto_nombre || ""} onChange={(e) => set("contacto_nombre", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email || ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="WhatsApp" hint="Con característica, ej: 343 4551234">
          <Input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} />
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
