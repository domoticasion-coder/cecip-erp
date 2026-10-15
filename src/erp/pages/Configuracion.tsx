import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Save, Trash2, UserPlus } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { pesos } from "../../lib/format";
import { ROLES, type Configuracion as Config, type Rol, type Staff } from "../../lib/types";
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, useToast } from "../../components/ui";
import { useCategorias, useConfig, useCuentas, useInvalidate, usePeriodicidades } from "../data";

type Tab = "cuotas" | "institucion" | "cuentas" | "personal";

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>("cuotas");
  return (
    <>
      <PageHeader title="Configuración" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "cuotas", label: "Cuotas y cobranza" },
        { value: "institucion", label: "Institución y transferencias" },
        { value: "cuentas", label: "Cuentas de tesorería" },
        { value: "personal", label: "Personal" },
      ]} />
      {tab === "cuotas" && <><Categorias /><div className="h-5" /><Cobranza /></>}
      {tab === "institucion" && <Institucion />}
      {tab === "cuentas" && <Cuentas />}
      {tab === "personal" && <Personal />}
    </>
  );
}

function useGuardarConfig() {
  const toast = useToast();
  const invalidate = useInvalidate();
  return async (cambios: Partial<Config>) => {
    const { error } = await supabase.from("configuracion").update(cambios).eq("id", 1);
    if (error) return toast(traducirError(error.message), "error");
    toast("Configuración guardada.");
    invalidate("configuracion");
  };
}

function Categorias() {
  const { data } = useCategorias();
  const { data: periodicidades } = usePeriodicidades();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [edit, setEdit] = useState<Record<string, { nombre: string; cuota_mensual: string }>>({});
  const [desc, setDesc] = useState<Record<string, string>>({});
  const [nuevo, setNuevo] = useState({ nombre: "", cuota_mensual: "" });
  const [recalculando, setRecalculando] = useState(false);

  useEffect(() => {
    if (data) setEdit(Object.fromEntries(data.map((c) => [c.id, { nombre: c.nombre, cuota_mensual: String(c.cuota_mensual) }])));
  }, [data]);
  useEffect(() => {
    if (periodicidades) setDesc(Object.fromEntries(periodicidades.map((p) => [p.codigo, String(p.descuento)])));
  }, [periodicidades]);

  const num = (v: string | undefined) => Number(String(v ?? "").replace(",", ".")) || 0;

  async function guardar() {
    for (const c of data || []) {
      const e = edit[c.id];
      if (!e) continue;
      const monto = num(e.cuota_mensual);
      if (e.nombre !== c.nombre || monto !== Number(c.cuota_mensual)) {
        const { error } = await supabase.from("categorias").update({ nombre: e.nombre.trim(), cuota_mensual: monto }).eq("id", c.id);
        if (error) return toast(traducirError(error.message), "error");
      }
    }
    for (const p of periodicidades || []) {
      const d = num(desc[p.codigo]);
      if (d !== Number(p.descuento)) {
        const { error } = await supabase.from("periodicidades").update({ descuento: d }).eq("codigo", p.codigo);
        if (error) return toast(traducirError(error.message), "error");
      }
    }
    toast("Valores guardados. Se aplican a las próximas cuotas que generes (para las pendientes usá «Recalcular cuotas pendientes»).");
    invalidate("categorias", "periodicidades", "socios");
  }

  async function recalcular() {
    if (!confirm("¿Actualizar el importe de TODAS las cuotas sociales pendientes con los valores actuales? Las cuotas pagadas no se modifican.")) return;
    setRecalculando(true);
    const { data: n, error } = await supabase.rpc("recalcular_cuotas_pendientes", {});
    setRecalculando(false);
    if (error) return toast(traducirError(error.message), "error");
    toast(n ? `Se actualizaron ${n} cuotas pendientes.` : "Las cuotas pendientes ya estaban con los valores actuales.");
    invalidate("cuotas", "socios", "dashboard");
  }

  async function agregar() {
    if (!nuevo.nombre.trim()) return;
    const { error } = await supabase.from("categorias").insert({
      nombre: nuevo.nombre.trim(), cuota_mensual: num(nuevo.cuota_mensual), orden: (data?.length || 0) + 1,
    });
    if (error) return toast(traducirError(error.message), "error");
    setNuevo({ nombre: "", cuota_mensual: "" });
    invalidate("categorias");
  }

  async function borrar(id: string) {
    if (!confirm("¿Eliminar la categoría? Los socios que la tengan quedan sin categoría.")) return;
    const { error } = await supabase.from("categorias").delete().eq("id", id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("categorias", "socios");
  }

  const pers = (periodicidades || []).filter((p) => p.meses > 1);
  return (
    <Card
      title="Categorías y valor de la cuota"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={recalculando} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={recalcular}>Recalcular cuotas pendientes</Button>
          <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={guardar}>Guardar cambios</Button>
        </div>
      }
    >
      <Table>
        <thead className="bg-slate-50">
          <tr>
            <th className="th">Categoría</th>
            <th className="th">Valor mensual ($)</th>
            {pers.map((p) => (
              <th key={p.codigo} className="th text-right">
                {p.nombre}
                <div className="mt-1 flex items-center justify-end gap-1 font-normal normal-case">
                  <span className="text-[11px]">desc.</span>
                  <input
                    className="input w-14 px-1.5 py-0.5 text-right text-xs" inputMode="decimal" title={`Descuento ${p.nombre.toLowerCase()} (%)`}
                    value={desc[p.codigo] ?? ""} onChange={(e) => setDesc({ ...desc, [p.codigo]: e.target.value })}
                  />
                  <span className="text-[11px]">%</span>
                </div>
              </th>
            ))}
            <th className="th"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data?.map((c) => {
            const mensual = num(edit[c.id]?.cuota_mensual);
            return (
              <tr key={c.id}>
                <td className="td w-32"><Input value={edit[c.id]?.nombre || ""} onChange={(e) => setEdit({ ...edit, [c.id]: { ...edit[c.id], nombre: e.target.value } })} /></td>
                <td className="td w-40">
                  <Input inputMode="decimal" value={edit[c.id]?.cuota_mensual || ""} onChange={(e) => setEdit({ ...edit, [c.id]: { ...edit[c.id], cuota_mensual: e.target.value } })} />
                  {mensual === 0 && <span className="text-xs text-amber-700">Sin valor: no se generan cuotas</span>}
                </td>
                {pers.map((p) => (
                  <td key={p.codigo} className="td text-right text-sm tabular-nums">
                    {mensual ? pesos(Math.round(mensual * p.meses * (1 - num(desc[p.codigo]) / 100) * 100) / 100) : "—"}
                  </td>
                ))}
                <td className="td text-right"><button onClick={() => borrar(c.id)} className="text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            );
          })}
          <tr>
            <td className="td"><Input placeholder="Nueva categoría" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></td>
            <td className="td"><Input placeholder="0" inputMode="decimal" value={nuevo.cuota_mensual} onChange={(e) => setNuevo({ ...nuevo, cuota_mensual: e.target.value })} /></td>
            <td className="td text-right" colSpan={pers.length + 1}><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={agregar}>Agregar</Button></td>
          </tr>
        </tbody>
      </Table>
      <p className="border-t border-slate-100 p-4 text-xs text-slate-500">
        Cada socio paga según su <b>forma de pago</b> (mensual, bimestral, trimestral, semestral o anual): el importe es el valor mensual de su categoría
        por la cantidad de meses, menos el descuento de esa forma de pago. Los bimestres, trimestres y semestres son del año calendario
        (ej.: 5° bimestre = septiembre-octubre).
      </p>
    </Card>
  );
}

function Cobranza() {
  const { data: cfg } = useConfig();
  const { data: cuentas } = useCuentas();
  const guardarCfg = useGuardarConfig();
  const [f, setF] = useState<Config | null>(null);
  useEffect(() => { if (cfg) setF(cfg); }, [cfg]);
  if (!f) return <Loading />;

  const ejemplo = 10000 * (Number(f.interes_mensual) / 100) * (15 / 30);

  return (
    <Card title="Cobranza" actions={<Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => guardarCfg({
      interes_mensual: Number(String(f.interes_mensual).replace(",", ".")) || 0, dia_vencimiento: Number(f.dia_vencimiento),
      recordatorios_auto: f.recordatorios_auto, dias_aviso: Number(f.dias_aviso), cuenta_mp_id: f.cuenta_mp_id || null, cuenta_default_id: f.cuenta_default_id || null,
    })}>Guardar</Button>}>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Día de vencimiento de la cuota" hint="Se propone al generar las cuotas de cada mes.">
          <Input type="number" min={1} max={28} value={f.dia_vencimiento} onChange={(e) => setF({ ...f, dia_vencimiento: Number(e.target.value) })} />
        </Field>
        <Field label="Interés por mora (% mensual)" hint={`Proporcional por día de atraso. Ej.: cuota de $10.000 con 15 días de atraso = ${pesos(ejemplo)} de interés. Poné 0 para no cobrar intereses.`}>
          <Input inputMode="decimal" value={String(f.interes_mensual)} onChange={(e) => setF({ ...f, interes_mensual: e.target.value as unknown as number })} />
        </Field>
        <Field label="Cuenta donde ingresan los pagos de Mercado Pago">
          <Select value={f.cuenta_mp_id || ""} onChange={(e) => setF({ ...f, cuenta_mp_id: e.target.value })}>
            <option value="">—</option>
            {cuentas?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Cuenta por defecto para cobros manuales">
          <Select value={f.cuenta_default_id || ""} onChange={(e) => setF({ ...f, cuenta_default_id: e.target.value })}>
            <option value="">—</option>
            {cuentas?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
          <Checkbox checked={f.recordatorios_auto} onChange={(v) => setF({ ...f, recordatorios_auto: v })} label={<b>Enviar recordatorios automáticos por email</b>} />
          <p className="mt-1 text-xs text-slate-500">
            Todos los días se avisa a los socios cuya cuota vence en los próximos días (una vez), y a los que tienen cuotas vencidas (como máximo una vez por semana).
            Cada email incluye el detalle de la deuda y un link de pago de Mercado Pago.
          </p>
          <div className="mt-2 w-48">
            <Field label="Avisar antes del vencimiento (días)">
              <Input type="number" min={0} max={30} value={f.dias_aviso} onChange={(e) => setF({ ...f, dias_aviso: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Institucion() {
  const { data: cfg } = useConfig();
  const guardarCfg = useGuardarConfig();
  const [f, setF] = useState<Config | null>(null);
  useEffect(() => { if (cfg) setF(cfg); }, [cfg]);
  if (!f) return <Loading />;
  const campo = (k: keyof Config, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={(f[k] as string) || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card title="Datos de la institución (aparecen en recibos y emails)" actions={<Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => guardarCfg({
      nombre_institucion: f.nombre_institucion, cuit: f.cuit || null, direccion: f.direccion || null, telefono: f.telefono || null, email: f.email || null,
      banco: f.banco || null, titular: f.titular || null, cbu: f.cbu || null, alias: f.alias || null,
    })}>Guardar</Button>}>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {campo("nombre_institucion", "Nombre")}
        {campo("cuit", "CUIT")}
        {campo("direccion", "Dirección")}
        {campo("telefono", "Teléfono")}
        {campo("email", "Email de contacto")}
        <div className="sm:col-span-2 mt-2 text-sm font-semibold text-slate-700">Datos para pago por transferencia (los ven los socios)</div>
        {campo("banco", "Banco")}
        {campo("titular", "Titular de la cuenta")}
        {campo("cbu", "CBU")}
        {campo("alias", "Alias")}
      </div>
    </Card>
  );
}

function Cuentas() {
  const { data } = useCuentas();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("banco");

  async function agregar() {
    if (!nombre.trim()) return;
    const { error } = await supabase.from("cuentas").insert({ nombre: nombre.trim(), tipo, orden: (data?.length || 0) + 1 });
    if (error) return toast(traducirError(error.message), "error");
    setNombre("");
    invalidate("cuentas", "movimientos");
  }
  async function toggle(id: string, activa: boolean) {
    await supabase.from("cuentas").update({ activa }).eq("id", id);
    invalidate("cuentas", "movimientos");
  }

  return (
    <Card title="Cuentas de caja, bancos y billeteras">
      <Table>
        <tbody className="divide-y divide-slate-100">
          {data?.map((c) => (
            <tr key={c.id}>
              <td className="td">{c.nombre}</td>
              <td className="td text-sm text-slate-500">{c.tipo}</td>
              <td className="td">{c.activa ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</td>
              <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => toggle(c.id, !c.activa)}>{c.activa ? "Desactivar" : "Activar"}</Button></td>
            </tr>
          ))}
          <tr>
            <td className="td"><Input placeholder="Nueva cuenta (ej. Banco Galicia)" value={nombre} onChange={(e) => setNombre(e.target.value)} /></td>
            <td className="td">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="banco">Banco</option><option value="caja">Caja</option><option value="billetera">Billetera virtual</option>
              </Select>
            </td>
            <td className="td" colSpan={2}><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={agregar}>Agregar</Button></td>
          </tr>
        </tbody>
      </Table>
    </Card>
  );
}

function Personal() {
  const { staff: yo } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [invitar, setInvitar] = useState(false);

  const { data } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => unwrap(await supabase.from("staff").select("*").order("nombre")) as Staff[],
  });

  async function actualizar(s: Staff, cambios: Partial<Staff>) {
    if (s.user_id === yo?.user_id && (cambios.activo === false || (cambios.rol && cambios.rol !== "admin"))) {
      return toast("No podés quitarte el rol de administrador ni desactivarte a vos mismo.", "error");
    }
    const { error } = await supabase.from("staff").update(cambios).eq("user_id", s.user_id);
    if (error) return toast(traducirError(error.message), "error");
    toast("Usuario actualizado.");
    invalidate("staff");
  }

  return (
    <>
      <Card title="Personal con acceso al ERP" actions={<Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInvitar(true)}>Invitar</Button>}>
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">Nombre</th><th className="th">Rol</th><th className="th">Estado</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.map((s) => (
              <tr key={s.user_id}>
                <td className="td">{s.nombre}<div className="text-xs text-slate-500">{s.email}</div></td>
                <td className="td">
                  <Select className="w-auto" value={s.rol} onChange={(e) => actualizar(s, { rol: e.target.value as Rol })}>
                    {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </td>
                <td className="td">{s.activo ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                <td className="td text-right">
                  <Button size="sm" variant="ghost" onClick={() => actualizar(s, { activo: !s.activo })}>{s.activo ? "Desactivar" : "Reactivar"}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-slate-100 p-4 text-xs text-slate-500">
          <b>Administrador:</b> todo, incluida la configuración. <b>Tesorería:</b> cuotas, cobros, tesorería y recordatorios.{" "}
          <b>Atención al socio:</b> socios, comunicación, eventos, accesos al portal e información del Copiloto. Todos pueden consultar socios y cuotas.{" "}
          <b>ComercIA (IEC / FactorIA):</b> usuario externo que solo administra ComercIA (solicitudes, promociones, convenio, ofertas, IEC Services, cursos y ajustes); no ve socios, cuotas ni tesorería.
        </div>
      </Card>
      <InvitarModal open={invitar} onClose={() => setInvitar(false)} />
    </>
  );
}

function InvitarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<Rol>("atencion");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function enviar() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ reactivado?: boolean }>("staff/invitar", { nombre, email, rol });
      toast(r.reactivado ? "Usuario reactivado." : `Invitación enviada a ${email}. Va a recibir un email para definir su contraseña.`);
      invalidate("staff");
      setNombre(""); setEmail("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invitar al personal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={enviar}>Enviar invitación</Button></>}>
      <div className="space-y-3">
        <Field label="Nombre y apellido"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Rol">
          <Select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

