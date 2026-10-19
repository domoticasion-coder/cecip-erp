import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { api } from "../../lib/api";
import { Button, ErrorBox, Field, Input, Modal, Textarea, useToast } from "../../components/ui";
import { useInvalidate } from "../data";
import { ImagenInput } from "../../components/ImagenInput";

/** Redactar y enviar un email a uno o varios socios */
export function EnviarEmailModal({
  socioIds, open, onClose, asuntoInicial = "", cuerpoInicial = "", comunicadoId, imagenInicial = null,
}: {
  socioIds: string[]; open: boolean; onClose: () => void; asuntoInicial?: string; cuerpoInicial?: string; comunicadoId?: string;
  imagenInicial?: string | null;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [asunto, setAsunto] = useState(asuntoInicial);
  const [cuerpo, setCuerpo] = useState(cuerpoInicial);
  const [imagen, setImagen] = useState<string | null>(imagenInicial);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setAsunto(asuntoInicial);
      setCuerpo(cuerpoInicial);
      setImagen(imagenInicial);
      setError(null);
    }
  }, [open, asuntoInicial, cuerpoInicial, imagenInicial]);

  async function enviar() {
    if (!asunto.trim() || !cuerpo.trim()) return setError("Completá asunto y mensaje.");
    if (!confirm(`¿Enviar este email a ${socioIds.length} socio(s)?`)) return;
    setSending(true);
    setError(null);
    try {
      const r = await api<{ enviados: number; encolados?: boolean; errores: { socio: string; error: string }[] }>("comunicaciones/enviar", {
        socio_ids: socioIds, asunto, cuerpo, comunicado_id: comunicadoId, imagen_url: imagen,
      });
      toast(
        (r.encolados ? `Se están enviando ${r.enviados} emails (el resultado de cada uno aparece en el historial de envíos).` : `Enviados: ${r.enviados}.`) +
          (r.errores.length ? `\nNo enviados: ${r.errores.length} (ver historial de envíos).` : ""),
        r.errores.length && !r.enviados ? "error" : "ok"
      );
      invalidate("envios");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Enviar email a ${socioIds.length} socio${socioIds.length === 1 ? "" : "s"}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button icon={<Send className="h-4 w-4" />} loading={sending} onClick={enviar}>Enviar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Asunto">
          <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} />
        </Field>
        <Field label="Mensaje" hint={<>Podés usar <code>{"{{nombre}}"}</code> (nombre del socio) y <code>{"{{deuda}}"}</code> (deuda actual). Los links se vuelven clickeables.</>}>
          <Textarea rows={10} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />
        </Field>
        <ImagenInput value={imagen} onChange={setImagen} carpeta="emails" hint="Se muestra debajo del título del email." />
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
