import { useState } from "react";
import { supabase, traducirError } from "../../lib/supabase";
import { fecha, formatCuit } from "../../lib/format";
import type { Socio } from "../../lib/types";
import { Button, Card, ErrorBox, Field, Input, Loading, useToast } from "../../components/ui";
import { useConfigPortal } from "../data";

export default function MiEmpresa({ socio }: { socio?: Socio }) {
  const { data: cfg } = useConfigPortal();
  if (!socio) return <Loading />;
  const datos: [string, string | null | undefined][] = [
    ["Razón social", socio.razon_social],
    ["Nombre de fantasía", socio.nombre_comercial],
    ["CUIT", formatCuit(socio.cuit)],
    ["N° de socio", socio.numero_socio?.toString()],
    ["Rubro", socio.rubro],
    ["Socio desde", fecha(socio.fecha_alta)],
    ["Email", socio.email],
    ["WhatsApp", socio.whatsapp],
    ["Teléfono", socio.telefono],
    ["Dirección", [socio.direccion, socio.localidad].filter(Boolean).join(", ")],
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Mi empresa</h1>
      <Card title="Datos registrados en el CeCIP">
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
          {datos.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v || "—"}</dd></div>
          ))}
        </dl>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          ¿Algún dato está desactualizado? Escribinos a {cfg?.email || "la administración del CeCIP"}{cfg?.telefono && ` o llamanos al ${cfg.telefono}`} y lo corregimos.
        </p>
      </Card>
      <CambiarClave />
    </div>
  );
}

function CambiarClave() {
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (p1.length < 8) return setError("Mínimo 8 caracteres.");
    if (p1 !== p2) return setError("Las contraseñas no coinciden.");
    setSaving(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    setP1(""); setP2("");
    toast("Contraseña actualizada.");
  }

  return (
    <Card title="Cambiar contraseña">
      <div className="grid max-w-xl gap-3 p-4 sm:grid-cols-2">
        <Field label="Nueva contraseña"><Input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></Field>
        <Field label="Repetir"><Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
        <div><Button loading={saving} onClick={guardar}>Guardar</Button></div>
      </div>
    </Card>
  );
}
