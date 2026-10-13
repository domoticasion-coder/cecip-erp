import { useEffect, useState } from "react";
import { supabase, traducirError } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { hoyISO, nombreSocio } from "../../lib/format";
import { Button, ErrorBox, Field, Input, Modal, Select, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";
import { INVALIDAR_COBRO } from "./Cobro";

/** Carga manual de un cargo (cuota atrasada, inscripción a curso, alquiler de salón, etc.) */
export function NuevaCuotaModal({ open, onClose, socioId }: { open: boolean; onClose: () => void; socioId?: string }) {
  const { staff } = useAuth();
  const { data: socios } = useSociosMin();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [socio, setSocio] = useState(socioId || "");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [venc, setVenc] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSocio(socioId || "");
      setConcepto("");
      setMonto("");
      setVenc(hoyISO());
      setError(null);
    }
  }, [open, socioId]);

  async function guardar() {
    const m = Number(monto.replace(",", "."));
    if (!socio) return setError("Elegí el socio.");
    if (!concepto.trim()) return setError("Indicá el concepto.");
    if (!m || m <= 0) return setError("Ingresá un monto válido.");
    setSaving(true);
    const { error } = await supabase.from("cuotas").insert({
      socio_id: socio, tipo: "otro", concepto: concepto.trim(), monto: m, vencimiento: venc, created_by: staff?.user_id,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast("Cargo creado.");
    invalidate(...INVALIDAR_COBRO);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo cargo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={saving} onClick={guardar}>Crear cargo</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!socioId && (
          <Field label="Socio">
            <Select value={socio} onChange={(e) => setSocio(e.target.value)}>
              <option value="">— Elegir —</option>
              {socios?.filter((s) => s.estado !== "baja").map((s) => (
                <option key={s.id} value={s.id}>{nombreSocio(s)}{s.numero_socio ? ` (N° ${s.numero_socio})` : ""}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Concepto" hint="Ej.: Cuota social Marzo 2025 (atrasada), Curso de liquidación de sueldos, Alquiler de salón.">
          <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto">
            <Input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
          </Field>
          <Field label="Vencimiento">
            <Input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
          </Field>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
