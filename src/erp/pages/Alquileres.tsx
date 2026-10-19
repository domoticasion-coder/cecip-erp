import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, CalendarPlus, FileSignature, MessageCircle, Pencil, Plus, Receipt, Undo2 } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fecha, formatCuit, hoyISO, MESES, pesos } from "../../lib/format";
import { abrirWhatsapp, normalizarWhatsapp } from "../../lib/whatsapp";
import {
  AJUSTES, CONDICIONES_IVA, METODOS_PAGO, TIPOS_INMUEBLE, type AjusteIndice, type AlquilerCargo, type AlquilerContrato, type CondicionIva,
  type Inmueble, type Reserva, type TipoInmueble,
} from "../../lib/types";
import {
  Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, SituacionBadge, Stat, Table, Tabs, Textarea, useToast,
} from "../../components/ui";
import { enviarFacturasEnCola, useConfig, useCuentas, useInvalidate, useSociosMin } from "../data";

type Tab = "cobros" | "salones" | "inmuebles";
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
      <PageHeader title="Alquileres" subtitle="Inmuebles del CeCIP: contratos mensuales, alquiler temporal de salones (por día u horas) y cobros" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: "cobros", label: "Cobros" },
        { value: "salones", label: "Salones y reservas" },
        { value: "inmuebles", label: "Inmuebles y contratos" },
      ]} />
      {tab === "cobros" && <Cobros />}
      {tab === "salones" && <Salones />}
      {tab === "inmuebles" && <Inmuebles />}
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
  const [reservar, setReservar] = useState<string | null>(null);

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
          const mensuales = (contratos || []).filter((k) => k.inmueble_id === inm.id && k.modalidad !== "temporal");
          const vigente = mensuales.find((k) => k.estado === "vigente");
          const anteriores = mensuales.filter((k) => k.estado !== "vigente");
          const proximasReservas = (contratos || []).filter((k) => k.inmueble_id === inm.id && k.modalidad === "temporal" && k.estado === "vigente" && (k.fecha_fin || k.fecha_inicio) >= hoyISO());
          return (
            <Card
              key={inm.id}
              title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-600" />{inm.nombre} <Badge tone={inm.tipo === "salon" ? "purple" : "gray"}>{TIPOS_INMUEBLE[inm.tipo]}</Badge></span>}
              actions={can("tesoreria") && <button className="text-slate-400 hover:text-slate-700" onClick={() => setEditInm(inm)}><Pencil className="h-4 w-4" /></button>}
            >
              <div className="space-y-3 p-4 text-sm">
                <div className="text-slate-600">{inm.direccion || <span className="text-amber-700">Cargá la dirección</span>}</div>
                {inm.descripcion && <div className="text-xs text-slate-500">{inm.descripcion}</div>}
                {(inm.capacidad || inm.tarifa_hora || inm.tarifa_dia) && (
                  <div className="text-xs text-slate-500">
                    {[inm.capacidad && `Capacidad ${inm.capacidad} personas`, inm.tarifa_hora && `${pesos(inm.tarifa_hora)}/hora`, inm.tarifa_dia && `${pesos(inm.tarifa_dia)}/día`,
                      Number(inm.tarifa_socio_descuento) > 0 && `socios -${inm.tarifa_socio_descuento}%`].filter(Boolean).join(" · ")}
                  </div>
                )}
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
                    <div className="text-slate-500">Sin contrato mensual vigente</div>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      {can("tesoreria") && (
                        <Button size="sm" icon={<FileSignature className="h-3.5 w-3.5" />} onClick={() => setEditContrato({ contrato: null, inmueble: inm })}>Contrato mensual</Button>
                      )}
                      {can("tesoreria", "atencion") && (
                        <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setReservar(inm.id)}>Alquiler temporal</Button>
                      )}
                    </div>
                    {proximasReservas.length > 0 && (
                      <div className="mt-2 text-xs text-slate-500">
                        Próximas reservas: {proximasReservas.slice(0, 3).map((k) => `${fecha(k.fecha_inicio)} ${k.inquilino_nombre}`).join(" · ")}
                        {proximasReservas.length > 3 && ` y ${proximasReservas.length - 3} más`}
                      </div>
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
      <ReservaModal datos={reservar ? { inmueble: reservar } : null} onClose={() => setReservar(null)} />
    </>
  );
}

function InmuebleModal({ inmueble, onClose, total }: { inmueble: Inmueble | "nuevo" | null; onClose: () => void; total: number }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const vacio = { nombre: "", direccion: "", descripcion: "", tipo: "local" as TipoInmueble, capacidad: "", tarifa_hora: "", tarifa_dia: "", tarifa_socio_descuento: "0" };
  const [f, setF] = useState(vacio);
  useEffect(() => {
    if (inmueble) setF(inmueble === "nuevo" ? vacio : {
      nombre: inmueble.nombre, direccion: inmueble.direccion || "", descripcion: inmueble.descripcion || "", tipo: inmueble.tipo,
      capacidad: inmueble.capacidad ? String(inmueble.capacidad) : "", tarifa_hora: inmueble.tarifa_hora ? String(inmueble.tarifa_hora) : "",
      tarifa_dia: inmueble.tarifa_dia ? String(inmueble.tarifa_dia) : "", tarifa_socio_descuento: String(inmueble.tarifa_socio_descuento || 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inmueble]);
  const n = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);

  async function guardar() {
    if (!f.nombre.trim()) return;
    const datos = {
      nombre: f.nombre.trim(), direccion: f.direccion.trim() || null, descripcion: f.descripcion.trim() || null, tipo: f.tipo,
      capacidad: n(f.capacidad), tarifa_hora: n(f.tarifa_hora), tarifa_dia: n(f.tarifa_dia), tarifa_socio_descuento: n(f.tarifa_socio_descuento) || 0,
    };
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoInmueble })}>
              {Object.entries(TIPOS_INMUEBLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Capacidad (personas)"><Input inputMode="numeric" value={f.capacidad} onChange={(e) => setF({ ...f, capacidad: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="Tarifa por hora ($)" hint="Para alquiler temporal."><Input inputMode="decimal" value={f.tarifa_hora} onChange={(e) => setF({ ...f, tarifa_hora: e.target.value })} /></Field>
          <Field label="Tarifa por día ($)"><Input inputMode="decimal" value={f.tarifa_dia} onChange={(e) => setF({ ...f, tarifa_dia: e.target.value })} /></Field>
          <Field label="Descuento a socios (%)"><Input inputMode="decimal" value={f.tarifa_socio_descuento} onChange={(e) => setF({ ...f, tarifa_socio_descuento: e.target.value })} /></Field>
        </div>
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

// ---------------------------------------------------------------------------
// Salones: alquileres temporales (reservas por día u horas)
// ---------------------------------------------------------------------------

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");
const horario = (r: Pick<AlquilerContrato, "hora_inicio" | "hora_fin">) => (r.hora_inicio ? `${hm(r.hora_inicio)} a ${hm(r.hora_fin)} hs` : "Todo el día");
const cuandoReserva = (r: Pick<AlquilerContrato, "fecha_inicio" | "fecha_fin" | "hora_inicio" | "hora_fin">) =>
  `${fecha(r.fecha_inicio)}${r.fecha_fin && r.fecha_fin !== r.fecha_inicio ? ` al ${fecha(r.fecha_fin)}` : ""} · ${horario(r)}`;

function Salones() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: cfg } = useConfig();
  const { data: inmuebles } = useInmuebles();
  const [mes, setMes] = useState(mesActual());
  const [filtro, setFiltro] = useState("");
  const [nueva, setNueva] = useState<{ inmueble?: string; fecha?: string } | null>(null);
  const [cobrar, setCobrar] = useState<AlquilerCargo | null>(null);
  const [verCanceladas, setVerCanceladas] = useState(false);

  const { data: reservas, isLoading } = useQuery({
    queryKey: ["alquileres", "reservas"],
    queryFn: async () => unwrap(await supabase.from("reservas_detalle").select("*").order("fecha_inicio").order("hora_inicio")) as Reserva[],
  });
  const { data: cargos } = useQuery({
    queryKey: ["alquileres", "cargos-reservas"],
    queryFn: async () => {
      const ids = (reservas || []).map((r) => r.id);
      if (!ids.length) return [] as AlquilerCargo[];
      return unwrap(await supabase.from("alquiler_cargos_detalle").select("*").in("contrato_id", ids).neq("estado", "anulada").order("vencimiento")) as AlquilerCargo[];
    },
    enabled: !!reservas,
  });

  const lista = (reservas || []).filter((r) => (!filtro || r.inmueble_id === filtro) && (verCanceladas || r.estado !== "cancelado"));
  const proximas = lista.filter((r) => (r.fecha_fin || r.fecha_inicio) >= hoyISO() && r.estado === "vigente");

  // Calendario del mes
  const [y, m] = mes.split("-").map(Number);
  const primero = new Date(y, m - 1, 1);
  const offset = (primero.getDay() + 6) % 7;
  const diasMes = new Date(y, m, 0).getDate();
  const celdas = Array.from({ length: Math.ceil((offset + diasMes) / 7) * 7 }, (_, i) => i - offset + 1);
  const delDia = (d: number) => {
    const iso = `${mes}-${String(d).padStart(2, "0")}`;
    return lista.filter((r) => r.estado !== "cancelado" && r.fecha_inicio <= iso && (r.fecha_fin || r.fecha_inicio) >= iso);
  };

  async function cancelar(r: Reserva) {
    const motivo = prompt(`¿Cancelar la reserva de ${r.inquilino_nombre} (${cuandoReserva(r)})? Se anula lo que falta cobrar; lo ya cobrado queda registrado.\n\nMotivo (opcional):`);
    if (motivo === null) return;
    const { error } = await supabase.rpc("cancelar_reserva", { p_contrato: r.id, p_motivo: motivo || null });
    if (error) return toast(traducirError(error.message), "error");
    toast("Reserva cancelada.");
    invalidate("alquileres", "dashboard");
  }

  function confirmarPorWhatsapp(r: Reserva) {
    const pendientes = (cargos || []).filter((c) => c.contrato_id === r.id && c.estado === "pendiente");
    const datosPago = cfg?.cbu || cfg?.alias ? ` Podés transferir a ${cfg?.titular || cfg?.nombre_institucion}${cfg?.cbu ? ` · CBU ${cfg.cbu}` : ""}${cfg?.alias ? ` · Alias ${cfg.alias}` : ""}.` : "";
    const texto = `Hola ${r.inquilino_nombre}! Te confirmamos la reserva de ${r.inmueble_nombre} del CeCIP para el ${cuandoReserva(r)}` +
      `${r.motivo ? ` (${r.motivo})` : ""}. Total ${pesos(r.monto_mensual)}.` +
      (pendientes.length ? ` Falta abonar ${pendientes.map((c) => `${c.concepto.split(" ")[0].toLowerCase()} ${pesos(c.monto)} antes del ${fecha(c.vencimiento)}`).join(" y ")}.${datosPago}` : " ¡Ya está todo abonado!") +
      " Cualquier consulta, escribinos. Centro Comercial e Industrial de Paraná.";
    if (!abrirWhatsapp(r.inquilino_telefono, texto)) toast("La reserva no tiene un teléfono válido.", "error");
  }

  const salones = (inmuebles || []).filter((i) => i.activo);
  return (
    <>
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Input type="month" className="w-auto py-1" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
            <Select className="w-auto py-1 text-sm" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="">Todos los inmuebles</option>
              {salones.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </Select>
          </span>
        }
        actions={can("tesoreria", "atencion") && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNueva({ inmueble: filtro || undefined })}>Nueva reserva</Button>}
      >
        <div className="grid grid-cols-7 border-b border-slate-100 text-center text-[11px] font-semibold uppercase text-slate-500">
          {DIAS_CORTOS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((d, i) => {
            const valido = d >= 1 && d <= diasMes;
            const iso = valido ? `${mes}-${String(d).padStart(2, "0")}` : "";
            const res = valido ? delDia(d) : [];
            return (
              <div key={i}
                className={`min-h-20 border-b border-r border-slate-100 p-1 text-left ${valido ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/50"}`}
                onClick={() => valido && can("tesoreria", "atencion") && setNueva({ inmueble: filtro || undefined, fecha: iso })}>
                {valido && (
                  <>
                    <div className={`text-xs ${iso === hoyISO() ? "inline-block rounded-full bg-brand-700 px-1.5 font-bold text-white" : "text-slate-500"}`}>{d}</div>
                    <div className="mt-0.5 space-y-0.5">
                      {res.slice(0, 3).map((r) => (
                        <div key={r.id} title={`${r.inmueble_nombre} · ${r.inquilino_nombre} · ${horario(r)}`}
                          className={`truncate rounded px-1 text-[10px] leading-4 ${Number(r.pendiente) > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {r.hora_inicio ? hm(r.hora_inicio) + " " : ""}{r.inquilino_nombre}
                        </div>
                      ))}
                      {res.length > 3 && <div className="text-[10px] text-slate-500">+{res.length - 3} más</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="p-3 text-xs text-slate-500">Tocá un día para reservar. <span className="rounded bg-emerald-100 px-1 text-emerald-800">verde</span> = cobrada, <span className="rounded bg-amber-100 px-1 text-amber-800">amarillo</span> = falta cobrar.</p>
      </Card>

      <Card className="mt-5" title="Próximas reservas"
        actions={<label className="flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} /> Ver canceladas</label>}>
        {isLoading ? <Loading /> : !(verCanceladas ? lista : proximas).length ? (
          <Empty icon={<CalendarPlus className="h-8 w-8" />}>No hay reservas próximas.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(verCanceladas ? lista : proximas).map((r) => {
              const susCargos = (cargos || []).filter((c) => c.contrato_id === r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{cuandoReserva(r)}</span>
                      <Badge tone="blue">{r.inmueble_nombre}</Badge>
                      {r.estado === "cancelado" && <Badge tone="red">Cancelada</Badge>}
                    </div>
                    <div className="text-sm">
                      {r.inquilino_nombre}{r.socio_id && <span className="ml-1"><Badge tone="purple">Socio</Badge></span>}
                      {r.motivo && <span className="text-slate-500"> · {r.motivo}</span>}{r.personas && <span className="text-slate-500"> · {r.personas} personas</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[r.inquilino_telefono, r.inquilino_email, r.inquilino_cuit && `CUIT ${formatCuit(r.inquilino_cuit)}`].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {susCargos.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-0.5 text-xs">
                          {c.concepto.split(" ")[0]} {pesos(c.monto)} <SituacionBadge s={c.situacion} />
                          {c.estado === "pendiente" && can("tesoreria") && r.estado !== "cancelado" && (
                            <button className="font-semibold text-emerald-700 hover:underline" onClick={() => setCobrar(c)}>Cobrar</button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{pesos(r.monto_mensual)}</div>
                    {Number(r.pendiente) > 0 ? <div className="text-xs text-amber-700">Falta {pesos(r.pendiente)}</div> : <div className="text-xs text-emerald-700">Cobrada</div>}
                    {r.estado === "vigente" && (
                      <div className="mt-1 flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<MessageCircle className="h-3.5 w-3.5" />} disabled={!normalizarWhatsapp(r.inquilino_telefono)} onClick={() => confirmarPorWhatsapp(r)}>Confirmar</Button>
                        {can("tesoreria", "atencion") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => cancelar(r)}>Cancelar</Button>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ReservaModal datos={nueva} onClose={() => setNueva(null)} />
      <CobrarAlquiler cargo={cobrar} onClose={() => setCobrar(null)} />
    </>
  );
}

function ReservaModal({ datos, onClose }: { datos: { inmueble?: string; fecha?: string } | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: inmuebles } = useInmuebles();
  const { data: socios } = useSociosMin();
  const vacio = {
    inmueble: "", socio: "", cliente: "", cuit: "", condicion_iva: "" as CondicionIva | "", email: "", telefono: "",
    desde: hoyISO(), hasta: "", todoElDia: false, hora_inicio: "19:00", hora_fin: "23:00", motivo: "", personas: "",
    monto: "", sena: "", facturar: true, observaciones: "",
  };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!datos) return;
    const salon = inmuebles?.find((i) => i.tipo === "salon" && i.activo);
    setF({ ...vacio, inmueble: datos.inmueble || salon?.id || inmuebles?.[0]?.id || "", desde: datos.fecha || hoyISO() });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const inm = inmuebles?.find((i) => i.id === f.inmueble);

  // Precio sugerido según la tarifa del inmueble (por hora si es un solo día con horario, si no por día)
  const dias = f.hasta && f.hasta > f.desde ? Math.round((Date.parse(f.hasta) - Date.parse(f.desde)) / 86400000) + 1 : 1;
  const horas = !f.todoElDia && dias === 1 && f.hora_inicio && f.hora_fin
    ? Math.max(0, (Date.parse(`2000-01-01T${f.hora_fin}`) - Date.parse(`2000-01-01T${f.hora_inicio}`)) / 3600000) : 0;
  const base = inm ? (horas && inm.tarifa_hora ? Number(inm.tarifa_hora) * horas : inm.tarifa_dia ? Number(inm.tarifa_dia) * dias : 0) : 0;
  const sugerido = Math.round(base * (f.socio ? 1 - Number(inm?.tarifa_socio_descuento || 0) / 100 : 1));

  function elegirSocio(id: string) {
    const s = socios?.find((x) => x.id === id);
    setF((x) => ({ ...x, socio: id, cliente: s ? s.nombre_comercial || s.razon_social : x.cliente, email: s?.email || x.email, telefono: s?.whatsapp || x.telefono }));
  }

  async function guardar() {
    const monto = Number((f.monto || String(sugerido)).replace(",", "."));
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("crear_reserva", {
      p_inmueble: f.inmueble, p_cliente: f.cliente, p_desde: f.desde, p_hasta: f.hasta || null,
      p_hora_inicio: f.todoElDia ? null : f.hora_inicio || null, p_hora_fin: f.todoElDia ? null : f.hora_fin || null,
      p_monto: monto || 0, p_sena: Number(f.sena.replace(",", ".")) || 0, p_motivo: f.motivo || null,
      p_personas: f.personas ? Number(f.personas) : null, p_socio: f.socio || null, p_cuit: f.cuit ? formatCuit(f.cuit) : null,
      p_condicion_iva: f.condicion_iva || null, p_email: f.email || null, p_telefono: f.telefono || null, p_facturar: f.facturar,
      p_observaciones: f.observaciones || null,
    });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast("Reserva cargada. Los cobros quedaron en Alquileres → Cobros.");
    invalidate("alquileres", "dashboard");
    onClose();
  }

  return (
    <Modal open={!!datos} onClose={onClose} size="lg" title="Alquiler temporal (reserva)"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Reservar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inmueble / salón" className="sm:col-span-2"
          hint={inm && [inm.capacidad && `Capacidad ${inm.capacidad} personas`, inm.tarifa_hora && `${pesos(inm.tarifa_hora)}/hora`, inm.tarifa_dia && `${pesos(inm.tarifa_dia)}/día`, Number(inm.tarifa_socio_descuento) && `socios -${inm.tarifa_socio_descuento}%`].filter(Boolean).join(" · ") || undefined}>
          <Select value={f.inmueble} onChange={(e) => set("inmueble", e.target.value)}>
            {inmuebles?.filter((i) => i.activo).map((i) => <option key={i.id} value={i.id}>{i.nombre} ({TIPOS_INMUEBLE[i.tipo]})</option>)}
          </Select>
        </Field>
        <Field label="Desde"><Input type="date" value={f.desde} onChange={(e) => set("desde", e.target.value)} /></Field>
        <Field label="Hasta (si es más de un día)"><Input type="date" value={f.hasta} min={f.desde} onChange={(e) => set("hasta", e.target.value)} /></Field>
        <div className="flex items-end gap-3 sm:col-span-2">
          <Checkbox checked={f.todoElDia} onChange={(v) => set("todoElDia", v)} label="Todo el día" />
          {!f.todoElDia && (
            <>
              <Field label="Hora de inicio"><Input type="time" value={f.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} /></Field>
              <Field label="Hora de fin"><Input type="time" value={f.hora_fin} onChange={(e) => set("hora_fin", e.target.value)} /></Field>
            </>
          )}
        </div>
        <Field label="¿Es socio del CeCIP?">
          <Select value={f.socio} onChange={(e) => elegirSocio(e.target.value)}>
            <option value="">No socio</option>
            {socios?.filter((s) => s.estado === "activo").map((s) => <option key={s.id} value={s.id}>{s.nombre_comercial || s.razon_social}</option>)}
          </Select>
        </Field>
        <Field label="A nombre de *"><Input value={f.cliente} onChange={(e) => set("cliente", e.target.value)} /></Field>
        <Field label="WhatsApp / teléfono"><Input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="CUIT / CUIL (para la factura)"><Input value={f.cuit} onChange={(e) => set("cuit", e.target.value)} /></Field>
        <Field label="Condición frente al IVA">
          <Select value={f.condicion_iva} onChange={(e) => set("condicion_iva", e.target.value as CondicionIva | "")}>
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
          </Select>
        </Field>
        <Field label="Motivo / evento"><Input value={f.motivo} placeholder="Ej.: cumpleaños, capacitación, reunión" onChange={(e) => set("motivo", e.target.value)} /></Field>
        <Field label="Cantidad de personas" hint={inm?.capacidad && Number(f.personas) > inm.capacidad ? `Supera la capacidad (${inm.capacidad}).` : undefined}>
          <Input inputMode="numeric" value={f.personas} onChange={(e) => set("personas", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Precio total ($) *" hint={sugerido ? `Sugerido según tarifa: ${pesos(sugerido)}${horas ? ` (${horas} hs)` : dias > 1 ? ` (${dias} días)` : ""}` : "Cargá las tarifas del inmueble para que se sugiera el precio."}>
          <Input inputMode="decimal" value={f.monto} placeholder={sugerido ? String(sugerido) : ""} onChange={(e) => set("monto", e.target.value)} />
        </Field>
        <Field label="Seña ($)" hint="Opcional: se cobra ahora y el saldo vence el día del alquiler.">
          <Input inputMode="decimal" value={f.sena} onChange={(e) => set("sena", e.target.value)} />
        </Field>
        <div className="flex items-end pb-2"><Checkbox checked={f.facturar} onChange={(v) => set("facturar", v)} label="Facturar los cobros (ARCA)" /></div>
        <Field label="Observaciones" className="sm:col-span-2"><Textarea rows={2} value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}
