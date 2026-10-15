import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, CalendarPlus, FileSignature, MessageCircle, Pencil, Plus, Receipt, Undo2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, formatCuit, hoyISO, MESES, pesos } from "../../lib/format";
import { abrirWhatsapp, normalizarWhatsapp } from "../../lib/whatsapp";
import {
  AJUSTES, CONDICIONES_IVA, METODOS_PAGO, type AjusteIndice, type AlquilerCargo, type AlquilerContrato, type CondicionIva, type Inmueble,
} from "../../lib/types";
import {
  Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, SituacionBadge, Stat, Table, Tabs, Textarea, useToast,
} from "../../components/ui";
import { enviarFacturasEnCola, useConfig, useCuentas, useInvalidate, useSociosMin } from "../data";

type Tab = "cobros" | "inmuebles";
const mesActual = () => hoyISO().slice(0, 7);
const sumarMeses = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

function useInmuebles() {
  return useQuery({
    queryKey: ["alquileres", "inmuebles"],
    queryFn: async () => unwrap(await supabase.from("inmuebles").select("*").order("orden")) as Inmueble[],
  });
}

function useContratos() {
  return useQuery({
    queryKey: ["alquileres", "contratos"],
    queryFn: async () => unwrap(await supabase.from("alquiler_contratos").select("*").order("fecha_inicio", { ascending: false })) as AlquilerContrato[],
  });
}

export default function Alquileres() {
  const [tab, setTab] = useState<Tab>("cobros");
  return (
    <>
      <PageHeader title="Alquileres" subtitle="Inmuebles del CeCIP, contratos y cobro mensual de los alquileres" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "cobros", label: "Cobros" },
        { value: "inmuebles", label: "Inmuebles y contratos" },
      ]} />
      {tab === "cobros" ? <Cobros /> : <Inmuebles />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cobros mensuales
// ---------------------------------------------------------------------------

function Cobros() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: cfg } = useConfig();
  const { data: contratos } = useContratos();
  const [mes, setMes] = useState(mesActual());
  const [cobrar, setCobrar] = useState<AlquilerCargo | null>(null);
  const [nuevoCargo, setNuevoCargo] = useState(false);
  const [generando, setGenerando] = useState(false);

  const { data: cargos, isLoading } = useQuery({
    queryKey: ["alquileres", "cargos", mes],
    queryFn: async () => {
      const [y, m] = mes.split("-").map(Number);
      const hasta = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return unwrap(
        await supabase.from("alquiler_cargos_detalle").select("*").gte("vencimiento", `${mes}-01`).lt("vencimiento", hasta)
          .neq("estado", "anulada").order("vencimiento").order("inmueble_nombre")
      ) as AlquilerCargo[];
    },
  });

  // Deuda de meses anteriores
  const { data: atrasados } = useQuery({
    queryKey: ["alquileres", "atrasados", mes],
    queryFn: async () =>
      unwrap(
        await supabase.from("alquiler_cargos_detalle").select("*").eq("estado", "pendiente").lt("vencimiento", `${mes}-01`).order("vencimiento")
      ) as AlquilerCargo[],
  });

  const tot = useMemo(() => {
    const r = { total: 0, cobrado: 0, pendiente: 0, vencido: 0 };
    for (const c of cargos || []) {
      r.total += Number(c.monto);
      if (c.estado === "pagada") r.cobrado += Number(c.monto_pagado || c.monto);
      else { r.pendiente += Number(c.monto); if (c.situacion === "vencida") r.vencido += Number(c.monto); }
    }
    return r;
  }, [cargos]);

  const ajustesPendientes = (contratos || []).filter((k) => k.estado === "vigente" && k.proximo_ajuste && k.proximo_ajuste <= hoyISO());

  async function generar() {
    setGenerando(true);
    const { data, error } = await supabase.rpc("generar_alquileres", { p_periodo: `${mes}-01` });
    setGenerando(false);
    if (error) return toast(traducirError(error.message), "error");
    toast(data ? `Se generaron ${data} alquileres de ${MESES[Number(mes.slice(5)) - 1]}.` : "Los alquileres de este mes ya estaban generados.");
    invalidate("alquileres", "dashboard");
  }

  async function anular(c: AlquilerCargo) {
    if (!confirm(`¿Anular el cobro de "${c.concepto}"? Se borra el ingreso de tesorería.`)) return;
    const { error } = await supabase.rpc("anular_pago_alquiler", { p_cargo_id: c.id });
    if (error) return toast(traducirError(error.message), "error");
    invalidate("alquileres", "movimientos", "dashboard");
  }

  async function facturar(c: AlquilerCargo) {
    const { data, error } = await supabase.rpc("facturar", { p_cargo: c.id });
    if (error) return toast(traducirError(error.message), "error");
    const r = await enviarFacturasEnCola(data ? [data as string] : undefined);
    invalidate("facturas");
    toast(r?.sinConfigurar ? "Factura en cola: falta configurar la conexión con n8n / ARCA." : "Factura enviada a ARCA.");
  }

  function recordar(c: AlquilerCargo) {
    const datosPago = cfg?.cbu || cfg?.alias
      ? `\n\nPodés transferir a ${cfg?.titular || cfg?.nombre_institucion}${cfg?.banco ? ` (${cfg.banco})` : ""}${cfg?.cbu ? ` · CBU ${cfg.cbu}` : ""}${cfg?.alias ? ` · Alias ${cfg.alias}` : ""}.`
      : "";
    const texto = `Hola ${c.inquilino_nombre}! Te recordamos que el ${c.concepto.toLowerCase()} por ${pesos(c.monto)} ` +
      `${c.situacion === "vencida" ? `venció el ${fecha(c.vencimiento)}` : `vence el ${fecha(c.vencimiento)}`}.${datosPago}\n\nSi ya lo abonaste, desestimá este mensaje. ¡Gracias! Centro Comercial e Industrial de Paraná.`;
    if (!abrirWhatsapp(c.inquilino_telefono, texto)) toast("El inquilino no tiene un teléfono válido cargado en el contrato.", "error");
  }

  const fila = (c: AlquilerCargo) => (
    <tr key={c.id}>
      <td className="td">
        <div className="font-medium">{c.inquilino_nombre}</div>
        <div className="text-xs text-slate-500">{c.inmueble_nombre}</div>
      </td>
      <td className="td text-sm">{c.concepto}</td>
      <td className="td whitespace-nowrap text-sm">{fecha(c.vencimiento)}{c.dias_atraso > 0 && <div className="text-xs text-red-600">{c.dias_atraso} días de atraso</div>}</td>
      <td className="td text-right tabular-nums">{pesos(c.estado === "pagada" ? c.monto_pagado || c.monto : c.monto)}</td>
      <td className="td">
        <SituacionBadge s={c.situacion} />
        {c.estado === "pagada" && <div className="text-[11px] text-slate-500">{fecha(c.fecha_pago)} · {c.metodo_pago}{c.recibo_numero && ` · Rec. ${c.recibo_numero}`}</div>}
      </td>
      <td className="td whitespace-nowrap text-right">
        {c.estado === "pendiente" ? (
          <>
            <Button size="sm" variant="ghost" icon={<MessageCircle className="h-3.5 w-3.5" />} disabled={!normalizarWhatsapp(c.inquilino_telefono)} onClick={() => recordar(c)}>Recordar</Button>
            {can("tesoreria") && <Button size="sm" variant="success" onClick={() => setCobrar(c)}>Cobrar</Button>}
          </>
        ) : can("tesoreria") && (
          <>
            <Button size="sm" variant="ghost" icon={<Receipt className="h-3.5 w-3.5" />} onClick={() => facturar(c)}>Facturar</Button>
            <Button size="sm" variant="ghost" className="text-slate-400" title="Anular cobro" onClick={() => anular(c)}><Undo2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
      </td>
    </tr>
  );

  return (
    <>
      {ajustesPendientes.length > 0 && (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Ajuste de alquiler pendiente:</b>{" "}
            {ajustesPendientes.map((k) => `${k.inquilino_nombre} (${AJUSTES[k.ajuste_indice]}, desde ${fecha(k.proximo_ajuste)})`).join(" · ")}.
            Actualizá el monto en «Inmuebles y contratos» antes de generar el mes.
          </div>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Alquileres del mes" value={pesos(tot.total)} hint={`${cargos?.length || 0} cargos`} />
        <Stat label="Cobrado" value={pesos(tot.cobrado)} tone="good" />
        <Stat label="Pendiente" value={pesos(tot.pendiente)} tone="warn" />
        <Stat label="Deuda de meses anteriores" value={pesos((atrasados || []).reduce((a, c) => a + Number(c.monto), 0))} tone={atrasados?.length ? "bad" : "default"} />
      </div>
      <Card
        title={
          <span className="flex items-center gap-2">
            Cobros de
            <Input type="month" className="w-auto py-1" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </span>
        }
        actions={can("tesoreria") && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNuevoCargo(true)}>Otro cargo</Button>
            <Button size="sm" loading={generando} icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={generar}>Generar alquileres del mes</Button>
          </div>
        )}
      >
        {isLoading ? <Loading /> : !cargos?.length ? (
          <Empty icon={<Building2 className="h-8 w-8" />}>
            No hay alquileres para este mes. {can("tesoreria") && "Usá «Generar alquileres del mes» (toma los contratos vigentes)."}
          </Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Inquilino</th><th className="th">Concepto</th><th className="th">Vence</th><th className="th text-right">Importe</th><th className="th">Estado</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{cargos.map(fila)}</tbody>
          </Table>
        )}
      </Card>

      {!!atrasados?.length && (
        <Card className="mt-5" title="Adeudado de meses anteriores">
          <Table><tbody className="divide-y divide-slate-100">{atrasados.map(fila)}</tbody></Table>
        </Card>
      )}

      <CobrarAlquiler cargo={cobrar} onClose={() => setCobrar(null)} />
      <NuevoCargo open={nuevoCargo} onClose={() => setNuevoCargo(false)} contratos={(contratos || []).filter((k) => k.estado === "vigente")} />
    </>
  );
}

function CobrarAlquiler({ cargo, onClose }: { cargo: AlquilerCargo | null; onClose: () => void }) {
  const { data: cuentas } = useCuentas();
  const { data: cfg } = useConfig();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ metodo: "Transferencia", cuenta: "", fecha: hoyISO(), monto: "", referencia: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cargo) {
      setF({ metodo: "Transferencia", cuenta: cfg?.cuenta_default_id || "", fecha: hoyISO(), monto: String(cargo.monto), referencia: "" });
      setError(null);
    }
  }, [cargo, cfg]);

  async function guardar() {
    const monto = Number(f.monto.replace(",", "."));
    if (!monto || monto <= 0) return setError("Ingresá un monto válido.");
    setSaving(true);
    const { data, error } = await supabase.rpc("registrar_pago_alquiler", {
      p_cargo_id: cargo!.id, p_metodo: f.metodo, p_cuenta_id: f.cuenta || null, p_fecha: f.fecha, p_referencia: f.referencia || null, p_monto: monto,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    if (cfg?.facturacion_auto) enviarFacturasEnCola().then(() => invalidate("facturas"));
    toast(`Cobro registrado. Recibo N° ${data.recibo_numero}.`);
    invalidate("alquileres", "movimientos", "dashboard", "facturas");
    onClose();
  }

  return (
    <Modal open={!!cargo} onClose={onClose} title="Cobrar alquiler"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="success" loading={saving} onClick={guardar}>Confirmar cobro</Button></>}>
      {cargo && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <b>{cargo.inquilino_nombre}</b> · {cargo.inmueble_nombre}
            <div className="text-slate-600">{cargo.concepto} · vence {fecha(cargo.vencimiento)} · <b>{pesos(cargo.monto)}</b></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Forma de pago">
              <Select value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}>{METODOS_PAGO.map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
            <Field label="Ingresa en">
              <Select value={f.cuenta} onChange={(e) => setF({ ...f, cuenta: e.target.value })}>
                <option value="">— Sin cuenta —</option>
                {cuentas?.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Fecha"><Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Field>
            <Field label="Monto cobrado"><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
          </div>
          <Field label="Referencia (opcional)"><Input value={f.referencia} onChange={(e) => setF({ ...f, referencia: e.target.value })} /></Field>
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}

function NuevoCargo({ open, onClose, contratos }: { open: boolean; onClose: () => void; contratos: AlquilerContrato[] }) {
  const { data: inmuebles } = useInmuebles();
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ contrato: "", tipo: "expensas", concepto: "", monto: "", vencimiento: hoyISO() });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setF({ contrato: contratos[0]?.id || "", tipo: "expensas", concepto: "", monto: "", vencimiento: hoyISO() }); setError(null); } }, [open, contratos]);

  async function guardar() {
    const monto = Number(f.monto.replace(",", "."));
    if (!f.contrato || !f.concepto.trim() || !monto) return setError("Completá contrato, concepto y monto.");
    const { error } = await supabase.from("alquiler_cargos").insert({
      contrato_id: f.contrato, tipo: f.tipo, concepto: f.concepto.trim(), monto, vencimiento: f.vencimiento, created_by: staff?.user_id,
    });
    if (error) return setError(traducirError(error.message));
    toast("Cargo agregado.");
    invalidate("alquileres");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Otro cargo a un inquilino"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={guardar}>Agregar</Button></>}>
      <div className="space-y-3">
        <Field label="Contrato">
          <Select value={f.contrato} onChange={(e) => setF({ ...f, contrato: e.target.value })}>
            {contratos.map((k) => <option key={k.id} value={k.id}>{k.inquilino_nombre} · {inmuebles?.find((i) => i.id === k.inmueble_id)?.nombre}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
              <option value="expensas">Expensas</option><option value="servicios">Servicios (luz, agua, gas)</option><option value="otro">Otro</option>
            </Select>
          </Field>
          <Field label="Vencimiento"><Input type="date" value={f.vencimiento} onChange={(e) => setF({ ...f, vencimiento: e.target.value })} /></Field>
        </div>
        <Field label="Concepto"><Input value={f.concepto} placeholder="Ej.: Expensas octubre" onChange={(e) => setF({ ...f, concepto: e.target.value })} /></Field>
        <Field label="Monto"><Input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inmuebles y contratos
// ---------------------------------------------------------------------------

function Inmuebles() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: inmuebles, isLoading } = useInmuebles();
  const { data: contratos } = useContratos();
  const [editInm, setEditInm] = useState<Inmueble | "nuevo" | null>(null);
  const [editContrato, setEditContrato] = useState<{ contrato: AlquilerContrato | null; inmueble: Inmueble } | null>(null);

  async function finalizar(k: AlquilerContrato) {
    if (!confirm(`¿Finalizar el contrato de ${k.inquilino_nombre}? No se le generan más alquileres.`)) return;
    const { error } = await supabase.from("alquiler_contratos").update({ estado: "finalizado", fecha_fin: k.fecha_fin || hoyISO() }).eq("id", k.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("alquileres");
  }

  if (isLoading) return <Loading />;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {inmuebles?.map((inm) => {
          const vigente = contratos?.find((k) => k.inmueble_id === inm.id && k.estado === "vigente");
          const anteriores = (contratos || []).filter((k) => k.inmueble_id === inm.id && k.estado !== "vigente");
          return (
            <Card
              key={inm.id}
              title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-600" />{inm.nombre}</span>}
              actions={can("tesoreria") && <button className="text-slate-400 hover:text-slate-700" onClick={() => setEditInm(inm)}><Pencil className="h-4 w-4" /></button>}
            >
              <div className="space-y-3 p-4 text-sm">
                <div className="text-slate-600">{inm.direccion || <span className="text-amber-700">Cargá la dirección</span>}</div>
                {inm.descripcion && <div className="text-xs text-slate-500">{inm.descripcion}</div>}
                {vigente ? (
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{vigente.inquilino_nombre}</div>
                        <div className="text-xs text-slate-500">
                          {vigente.inquilino_cuit ? `CUIT ${formatCuit(vigente.inquilino_cuit)}` : "Sin CUIT"}
                          {vigente.inquilino_telefono && ` · ${vigente.inquilino_telefono}`}
                        </div>
                      </div>
                      <Badge tone="green">Vigente</Badge>
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums">{pesos(vigente.monto_mensual)}<span className="text-xs font-normal text-slate-500"> /mes</span></div>
                    <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                      <div>Del {fecha(vigente.fecha_inicio)} {vigente.fecha_fin ? `al ${fecha(vigente.fecha_fin)}` : "(sin fecha de fin)"} · vence el día {vigente.dia_vencimiento}</div>
                      <div>
                        Ajuste: {AJUSTES[vigente.ajuste_indice]}
                        {vigente.ajuste_cada_meses && ` cada ${vigente.ajuste_cada_meses} meses`}
                        {vigente.proximo_ajuste && (
                          <span className={vigente.proximo_ajuste <= hoyISO() ? "font-semibold text-amber-700" : ""}> · próximo {fecha(vigente.proximo_ajuste)}</span>
                        )}
                      </div>
                      {vigente.deposito && <div>Depósito en garantía: {pesos(vigente.deposito)}</div>}
                      <div>{vigente.facturar ? "Se factura cada cobro" : "No se factura"}</div>
                    </div>
                    {can("tesoreria") && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditContrato({ contrato: vigente, inmueble: inm })}>Editar / ajustar</Button>
                        <Button size="sm" variant="ghost" onClick={() => finalizar(vigente)}>Finalizar</Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center">
                    <div className="text-slate-500">Sin contrato vigente</div>
                    {can("tesoreria") && (
                      <Button size="sm" className="mt-2" icon={<FileSignature className="h-3.5 w-3.5" />} onClick={() => setEditContrato({ contrato: null, inmueble: inm })}>Cargar contrato</Button>
                    )}
                  </div>
                )}
                {anteriores.length > 0 && (
                  <div className="text-xs text-slate-500">
                    Contratos anteriores: {anteriores.map((k) => `${k.inquilino_nombre} (${fecha(k.fecha_inicio)}–${fecha(k.fecha_fin)})`).join(" · ")}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {can("tesoreria") && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditInm("nuevo")}>Agregar inmueble</Button>
        </div>
      )}
      <InmuebleModal inmueble={editInm} onClose={() => setEditInm(null)} total={inmuebles?.length || 0} />
      <ContratoModal datos={editContrato} onClose={() => setEditContrato(null)} />
    </>
  );
}

function InmuebleModal({ inmueble, onClose, total }: { inmueble: Inmueble | "nuevo" | null; onClose: () => void; total: number }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({ nombre: "", direccion: "", descripcion: "" });
  useEffect(() => {
    if (inmueble) setF(inmueble === "nuevo" ? { nombre: "", direccion: "", descripcion: "" } : { nombre: inmueble.nombre, direccion: inmueble.direccion || "", descripcion: inmueble.descripcion || "" });
  }, [inmueble]);

  async function guardar() {
    if (!f.nombre.trim()) return;
    const datos = { nombre: f.nombre.trim(), direccion: f.direccion.trim() || null, descripcion: f.descripcion.trim() || null };
    const { error } = inmueble === "nuevo"
      ? await supabase.from("inmuebles").insert({ ...datos, orden: total + 1 })
      : await supabase.from("inmuebles").update(datos).eq("id", (inmueble as Inmueble).id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("alquileres");
    onClose();
  }

  return (
    <Modal open={!!inmueble} onClose={onClose} title={inmueble === "nuevo" ? "Nuevo inmueble" : "Editar inmueble"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={f.nombre} placeholder="Ej.: Local planta baja" onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Field>
        <Field label="Dirección"><Input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></Field>
        <Field label="Descripción"><Textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

const contratoVacio = {
  inquilino_nombre: "", inquilino_cuit: "", inquilino_condicion_iva: "" as CondicionIva | "", inquilino_email: "", inquilino_telefono: "",
  inquilino_domicilio: "", socio_id: "", fecha_inicio: hoyISO(), fecha_fin: "", monto_mensual: "", dia_vencimiento: "10",
  ajuste_indice: "icl" as AjusteIndice, ajuste_cada_meses: "6", ajuste_porcentaje: "", proximo_ajuste: "", deposito: "", facturar: true, observaciones: "",
};

function ContratoModal({ datos, onClose }: { datos: { contrato: AlquilerContrato | null; inmueble: Inmueble } | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const [f, setF] = useState(contratoVacio);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const montoOriginal = datos?.contrato ? Number(datos.contrato.monto_mensual) : null;

  useEffect(() => {
    if (!datos) return;
    setError(null);
    const k = datos.contrato;
    setF(k ? {
      inquilino_nombre: k.inquilino_nombre, inquilino_cuit: k.inquilino_cuit || "", inquilino_condicion_iva: k.inquilino_condicion_iva || "",
      inquilino_email: k.inquilino_email || "", inquilino_telefono: k.inquilino_telefono || "", inquilino_domicilio: k.inquilino_domicilio || "",
      socio_id: k.socio_id || "", fecha_inicio: k.fecha_inicio, fecha_fin: k.fecha_fin || "", monto_mensual: String(k.monto_mensual),
      dia_vencimiento: String(k.dia_vencimiento), ajuste_indice: k.ajuste_indice, ajuste_cada_meses: k.ajuste_cada_meses ? String(k.ajuste_cada_meses) : "",
      ajuste_porcentaje: k.ajuste_porcentaje ? String(k.ajuste_porcentaje) : "", proximo_ajuste: k.proximo_ajuste || "",
      deposito: k.deposito ? String(k.deposito) : "", facturar: k.facturar, observaciones: k.observaciones || "",
    } : contratoVacio);
  }, [datos]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);

  // Si se cambió el monto de un contrato con ajuste periódico, se propone correr el próximo ajuste
  const montoNuevo = num(f.monto_mensual);
  const cambioMonto = montoOriginal !== null && montoNuevo !== null && montoNuevo !== montoOriginal;

  async function guardar() {
    if (!f.inquilino_nombre.trim() || !montoNuevo || montoNuevo <= 0) return setError("Completá el inquilino y el monto mensual.");
    setSaving(true);
    let proximo = f.proximo_ajuste || null;
    if (!proximo && f.ajuste_indice !== "ninguno" && f.ajuste_cada_meses) proximo = sumarMeses(f.fecha_inicio, Number(f.ajuste_cada_meses));
    if (cambioMonto && f.ajuste_cada_meses && proximo && proximo <= hoyISO()) proximo = sumarMeses(proximo, Number(f.ajuste_cada_meses));
    const payload = {
      inmueble_id: datos!.inmueble.id,
      inquilino_nombre: f.inquilino_nombre.trim(), inquilino_cuit: f.inquilino_cuit.trim() || null,
      inquilino_condicion_iva: f.inquilino_condicion_iva || null, inquilino_email: f.inquilino_email.trim() || null,
      inquilino_telefono: f.inquilino_telefono.trim() || null, inquilino_domicilio: f.inquilino_domicilio.trim() || null,
      socio_id: f.socio_id || null, fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin || null, monto_mensual: montoNuevo,
      dia_vencimiento: Math.min(28, Math.max(1, Number(f.dia_vencimiento) || 10)), ajuste_indice: f.ajuste_indice,
      ajuste_cada_meses: f.ajuste_indice === "ninguno" ? null : num(f.ajuste_cada_meses),
      ajuste_porcentaje: f.ajuste_indice === "porcentaje" ? num(f.ajuste_porcentaje) : null,
      proximo_ajuste: f.ajuste_indice === "ninguno" ? null : proximo, deposito: num(f.deposito), facturar: f.facturar,
      observaciones: f.observaciones.trim() || null,
    };
    const { error } = datos!.contrato
      ? await supabase.from("alquiler_contratos").update(payload).eq("id", datos!.contrato.id)
      : await supabase.from("alquiler_contratos").insert(payload);
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast(cambioMonto ? "Contrato actualizado. El nuevo monto se aplica desde el próximo alquiler que generes." : "Contrato guardado.");
    invalidate("alquileres");
    onClose();
  }

  return (
    <Modal open={!!datos} onClose={onClose} size="lg" title={`${datos?.contrato ? "Contrato" : "Nuevo contrato"} · ${datos?.inmueble.nombre || ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inquilino (razón social o nombre) *" className="sm:col-span-2"><Input value={f.inquilino_nombre} onChange={(e) => set("inquilino_nombre", e.target.value)} /></Field>
        <Field label="CUIT / CUIL"><Input value={f.inquilino_cuit} onChange={(e) => set("inquilino_cuit", e.target.value)} /></Field>
        <Field label="Condición frente al IVA">
          <Select value={f.inquilino_condicion_iva} onChange={(e) => set("inquilino_condicion_iva", e.target.value as CondicionIva | "")}>
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
          </Select>
        </Field>
        <Field label="WhatsApp / teléfono"><Input value={f.inquilino_telefono} onChange={(e) => set("inquilino_telefono", e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={f.inquilino_email} onChange={(e) => set("inquilino_email", e.target.value)} /></Field>
        <Field label="Domicilio fiscal" className="sm:col-span-2"><Input value={f.inquilino_domicilio} onChange={(e) => set("inquilino_domicilio", e.target.value)} /></Field>
        <Field label="¿Es socio del CeCIP?" className="sm:col-span-2">
          <Select value={f.socio_id} onChange={(e) => set("socio_id", e.target.value)}>
            <option value="">No / no vincular</option>
            {socios?.filter((s) => s.estado !== "baja").map((s) => <option key={s.id} value={s.id}>{s.nombre_comercial || s.razon_social}</option>)}
          </Select>
        </Field>
        <Field label="Inicio del contrato"><Input type="date" value={f.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} /></Field>
        <Field label="Fin del contrato"><Input type="date" value={f.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} /></Field>
        <Field label="Monto mensual *" hint={cambioMonto ? `Antes: ${pesos(montoOriginal)}` : undefined}>
          <Input inputMode="decimal" value={f.monto_mensual} onChange={(e) => set("monto_mensual", e.target.value)} />
        </Field>
        <Field label="Día de vencimiento"><Input type="number" min={1} max={28} value={f.dia_vencimiento} onChange={(e) => set("dia_vencimiento", e.target.value)} /></Field>
        <Field label="Actualización">
          <Select value={f.ajuste_indice} onChange={(e) => set("ajuste_indice", e.target.value as AjusteIndice)}>
            {Object.entries(AJUSTES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {f.ajuste_indice !== "ninguno" && (
          <>
            <Field label="Cada (meses)"><Input type="number" min={1} max={24} value={f.ajuste_cada_meses} onChange={(e) => set("ajuste_cada_meses", e.target.value)} /></Field>
            {f.ajuste_indice === "porcentaje" && (
              <Field label="Porcentaje de ajuste (%)"><Input inputMode="decimal" value={f.ajuste_porcentaje} onChange={(e) => set("ajuste_porcentaje", e.target.value)} /></Field>
            )}
            <Field label="Próximo ajuste" hint="Se avisa en Cobros cuando llega la fecha."><Input type="date" value={f.proximo_ajuste} onChange={(e) => set("proximo_ajuste", e.target.value)} /></Field>
          </>
        )}
        <Field label="Depósito en garantía"><Input inputMode="decimal" value={f.deposito} onChange={(e) => set("deposito", e.target.value)} /></Field>
        <div className="flex items-end pb-2"><Checkbox checked={f.facturar} onChange={(v) => set("facturar", v)} label="Facturar cada cobro (ARCA)" /></div>
        <Field label="Observaciones" className="sm:col-span-2"><Textarea rows={2} value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}
