import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, RefreshCw, Save, Trash2, UserPlus } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { pesos } from "../../lib/format";
import { ROLES_INFO, type Configuracion as Config, type Rol, type Staff } from "../../lib/types";
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
      {tab === "cuotas" && <><Categorias /><div className="h-5" /><ValoresAnteriores /><div className="h-5" /><Cobranza /></>}
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

const num = (v: string | undefined) => Number(String(v ?? "").replace(",", ".")) || 0;

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

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesTexto = (iso: string) => { const [a, m] = iso.split("-").map(Number); return `${MESES[m - 1]} ${a}`; };

interface ValorAnterior { categoria_id: string; hasta: string; cuota_mensual: number }

/**
 * Valores de cuota de períodos anteriores (por ejemplo, el valor 2025 que se siguió cobrando en el
 * primer bimestre de 2026). Cada cuota toma el valor vigente en el último mes de su período.
 */
function ValoresAnteriores() {
  const { data: categorias } = useCategorias();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [nuevo, setNuevo] = useState({ categoria_id: "", hasta: "", valor: "" });
  const { data } = useQuery({
    queryKey: ["categorias", "valores_anteriores"],
    queryFn: async () => unwrap(await supabase.from("categoria_valores").select("categoria_id, hasta, cuota_mensual").order("hasta", { ascending: false })) as ValorAnterior[],
  });
  const nombre = (id: string) => categorias?.find((c) => c.id === id)?.nombre || "—";
  const puede = can("tesoreria");

  async function agregar() {
    const valor = num(nuevo.valor);
    if (!nuevo.categoria_id || !nuevo.hasta || !valor) return toast("Elegí categoría, último mes y valor.", "error");
    const { error } = await supabase.from("categoria_valores").upsert({ categoria_id: nuevo.categoria_id, hasta: `${nuevo.hasta}-01`, cuota_mensual: valor });
    if (error) return toast(traducirError(error.message), "error");
    toast("Valor guardado. Usá «Recalcular cuotas pendientes» para aplicarlo a las cuotas adeudadas.");
    setNuevo({ categoria_id: "", hasta: "", valor: "" });
    invalidate("categorias");
  }

  async function borrar(v: ValorAnterior) {
    if (!confirm(`¿Eliminar el valor anterior de ${nombre(v.categoria_id)}?`)) return;
    const { error } = await supabase.from("categoria_valores").delete().eq("categoria_id", v.categoria_id).eq("hasta", v.hasta);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("categorias");
  }

  return (
    <Card title="Valores anteriores de la cuota">
      <p className="border-b border-slate-100 p-4 text-xs text-slate-500">
        Cada cuota toma el valor vigente en el <b>último mes de su período</b>. Ejemplo: si AA valía $5.000 hasta febrero de 2026, la cuota de
        enero, la de febrero y el bimestre enero-febrero salen a $5.000 por mes; el trimestre enero-marzo, el semestre y el año ya toman el valor actual.
        Sin un valor anterior, se usa el valor actual de la categoría.
      </p>
      <Table>
        <thead className="bg-slate-50">
          <tr><th className="th">Categoría</th><th className="th">Para cuotas que terminan hasta</th><th className="th text-right">Valor mensual</th><th className="th" /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(data || []).map((v) => (
            <tr key={v.categoria_id + v.hasta}>
              <td className="td">{nombre(v.categoria_id)}</td>
              <td className="td">{mesTexto(v.hasta)}</td>
              <td className="td text-right tabular-nums">{pesos(Number(v.cuota_mensual))}</td>
              <td className="td text-right">
                {puede && <button onClick={() => borrar(v)} className="text-slate-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </td>
            </tr>
          ))}
          {!data?.length && <tr><td className="td text-sm text-slate-500" colSpan={4}>No hay valores anteriores cargados.</td></tr>}
          {puede && (
            <tr>
              <td className="td">
                <Select value={nuevo.categoria_id} onChange={(e) => setNuevo({ ...nuevo, categoria_id: e.target.value })}>
                  <option value="">Categoría…</option>
                  {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </Select>
              </td>
              <td className="td"><Input type="month" value={nuevo.hasta} onChange={(e) => setNuevo({ ...nuevo, hasta: e.target.value })} /></td>
              <td className="td"><Input placeholder="0" inputMode="decimal" value={nuevo.valor} onChange={(e) => setNuevo({ ...nuevo, valor: e.target.value })} /></td>
              <td className="td text-right"><Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={agregar}>Agregar</Button></td>
            </tr>
          )}
        </tbody>
      </Table>
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
  const [clave, setClave] = useState<Staff | null>(null);

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
      <Card title="Personal con acceso al ERP" actions={<Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInvitar(true)}>Agregar</Button>}>
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">Nombre</th><th className="th">Rol</th><th className="th">Estado</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data?.map((s) => (
              <tr key={s.user_id}>
                <td className="td">{s.nombre}<div className="text-xs text-slate-500">{s.email}</div></td>
                <td className="td">
                  <Select className="w-auto" value={s.rol} onChange={(e) => actualizar(s, { rol: e.target.value as Rol })}>
                    {Object.entries(ROLES_INFO).filter(([k, v]) => v.vigente || k === s.rol).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}
                  </Select>
                  <div className="mt-1 max-w-xs text-xs text-slate-500">{ROLES_INFO[s.rol]?.descripcion}</div>
                </td>
                <td className="td">{s.activo ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                <td className="td text-right">
                  <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setClave(s)}>Contraseña</Button>
                  <Button size="sm" variant="ghost" onClick={() => actualizar(s, { activo: !s.activo })}>{s.activo ? "Desactivar" : "Reactivar"}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="space-y-1 border-t border-slate-100 p-4 text-xs text-slate-500">
          {Object.values(ROLES_INFO).filter((r) => r.vigente).map((r) => (
            <div key={r.nombre}><b>{r.nombre}:</b> {r.descripcion}</div>
          ))}
        </div>
      </Card>
      <InvitarModal open={invitar} onClose={() => setInvitar(false)} />
      <ClaveModal persona={clave} onClose={() => setClave(null)} />
    </>
  );
}

function InvitarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<Rol>("administracion");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function enviar() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ reactivado?: boolean; clave?: boolean }>("staff/invitar", { nombre, email, rol, password });
      toast(
        r.clave ? `Usuario listo: ${email} ya puede entrar al ERP con la contraseña que definiste.`
          : r.reactivado ? "Usuario reactivado."
          : `Invitación enviada a ${email}. Va a recibir un email para definir su contraseña.`
      );
      invalidate("staff");
      setNombre(""); setEmail(""); setPassword("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Agregar al personal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={enviar}>{password ? "Crear usuario" : "Enviar invitación"}</Button></>}>
      <div className="space-y-3">
        <Field label="Nombre y apellido"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Rol">
          <Select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            {Object.entries(ROLES_INFO).filter(([, v]) => v.vigente).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-slate-500">{ROLES_INFO[rol]?.descripcion}</p>
        <Field label="Contraseña" hint="Opcional. Si la completás, el usuario queda listo para entrar con esa contraseña. Si la dejás vacía, se le envía una invitación por email para que la defina.">
          <Input type="text" autoComplete="new-password" placeholder="Mínimo 8 caracteres, con letras y números" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** El administrador define una contraseña nueva para alguien del personal */
function ClaveModal({ persona, onClose }: { persona: Staff | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    setError(null);
    try {
      await api("staff/invitar", { user_id: persona!.user_id, password });
      toast(`Contraseña actualizada para ${persona!.nombre}. Pasásela por un medio privado.`);
      setPassword("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!persona} onClose={() => { setPassword(""); setError(null); onClose(); }} title={`Contraseña de ${persona?.nombre || ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} disabled={!password} onClick={guardar}>Guardar contraseña</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{persona?.email}</p>
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres, con letras y números. La persona puede cambiarla después desde “¿Olvidaste tu contraseña?”.">
          <Input type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

