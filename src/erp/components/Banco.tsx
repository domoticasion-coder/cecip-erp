import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Landmark, RefreshCw, Search, Upload } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { api } from "../../lib/api";
import { parseCSV } from "../../lib/csv";
import { fecha, formatCuit, hoyISO, nombreSocio, pesos } from "../../lib/format";
import { CATEGORIAS_MOVIMIENTO, type AlquilerCargo, type BancoMovimiento, type CuotaDetalle } from "../../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Stat, Table, Tabs, useToast } from "../../components/ui";
import { enviarFacturasEnCola, useConfig, useInvalidate, useSociosMin } from "../data";

const ESTADOS: Record<BancoMovimiento["estado"], { label: string; tone: "amber" | "green" | "gray" }> = {
  nuevo: { label: "Sin conciliar", tone: "amber" },
  conciliado: { label: "Conciliado", tone: "green" },
  ignorado: { label: "Ignorado", tone: "gray" },
};

/** Movimientos de la cuenta del Santander: llegan por n8n (API del banco) o importando el extracto */
export function BancoSantander() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [estado, setEstado] = useState<BancoMovimiento["estado"] | "">("nuevo");
  const [q, setQ] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [conciliar, setConciliar] = useState<BancoMovimiento | null>(null);
  const [importar, setImportar] = useState(false);

  const { data: movs, isLoading } = useQuery({
    queryKey: ["banco", "movimientos"],
    queryFn: async () => unwrap(await supabase.from("banco_movimientos").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).range(0, 1999)) as BancoMovimiento[],
  });

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (movs || []).filter((m) => (!estado || m.estado === estado) &&
      (!t || `${m.descripcion} ${m.referencia || ""} ${m.contraparte_nombre || ""} ${m.contraparte_cuit || ""} ${m.monto}`.toLowerCase().includes(t)));
  }, [movs, estado, q]);

  const nuevos = (movs || []).filter((m) => m.estado === "nuevo");
  const ultimoSaldo = (movs || []).find((m) => m.saldo !== null);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const r = await api<{ nuevos: number; pendiente?: boolean }>("integraciones/banco-sincronizar", { desde, hasta: hoyISO() });
      toast(r.pendiente ? "Pedido enviado: los movimientos van a aparecer cuando n8n los envíe." : `Sincronizado: ${r.nuevos} movimientos nuevos.`);
      invalidate("banco");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSincronizando(false);
    }
  }

  async function ignorar(m: BancoMovimiento) {
    const { error } = await supabase.from("banco_movimientos").update({ estado: m.estado === "ignorado" ? "nuevo" : "ignorado" }).eq("id", m.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("banco");
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Sin conciliar" value={nuevos.length} tone={nuevos.length ? "warn" : "good"} />
        <Stat label="Créditos sin conciliar" value={pesos(nuevos.filter((m) => m.monto > 0).reduce((a, m) => a + Number(m.monto), 0))} />
        <Stat label="Débitos sin conciliar" value={pesos(Math.abs(nuevos.filter((m) => m.monto < 0).reduce((a, m) => a + Number(m.monto), 0)))} />
        <Stat label="Último saldo informado" value={ultimoSaldo ? pesos(ultimoSaldo.saldo) : "—"} hint={ultimoSaldo ? fecha(ultimoSaldo.fecha) : undefined} />
      </div>
      <Card
        title={<span className="flex items-center gap-2"><Landmark className="h-4 w-4 text-red-600" />Cuenta Banco Santander</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setImportar(true)}>Importar extracto</Button>
            <Button size="sm" loading={sincronizando} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={sincronizar}>Sincronizar con Santander</Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Buscar por descripción, CUIT, importe…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value as BancoMovimiento["estado"] | "")}>
            <option value="nuevo">Sin conciliar</option>
            <option value="conciliado">Conciliados</option>
            <option value="ignorado">Ignorados</option>
            <option value="">Todos</option>
          </Select>
        </div>
        {isLoading ? <Loading /> : !lista.length ? (
          <Empty icon={<Landmark className="h-8 w-8" />}>
            {movs?.length ? "No hay movimientos con ese filtro." : "Todavía no hay movimientos. Sincronizá con Santander (vía n8n) o importá el extracto en CSV."}
          </Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Fecha</th><th className="th">Descripción</th><th className="th text-right">Importe</th><th className="th">Estado</th><th className="th"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((m) => (
                <tr key={m.id}>
                  <td className="td whitespace-nowrap text-xs">{fecha(m.fecha)}</td>
                  <td className="td text-sm">
                    {m.descripcion}
                    <div className="text-xs text-slate-500">
                      {[m.contraparte_nombre, m.contraparte_cuit && `CUIT ${formatCuit(m.contraparte_cuit)}`, m.referencia && `Ref. ${m.referencia}`].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className={`td text-right font-medium tabular-nums ${m.monto > 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {m.monto < 0 && "−"}{pesos(Math.abs(m.monto))}
                    {m.saldo !== null && <div className="text-[11px] font-normal text-slate-400">saldo {pesos(m.saldo)}</div>}
                  </td>
                  <td className="td"><Badge tone={ESTADOS[m.estado].tone}>{ESTADOS[m.estado].label}</Badge></td>
                  <td className="td whitespace-nowrap text-right">
                    {m.estado !== "conciliado" && (
                      <>
                        {m.estado === "nuevo" && <Button size="sm" onClick={() => setConciliar(m)}>Conciliar</Button>}
                        <Button size="sm" variant="ghost" className="text-slate-400" title={m.estado === "ignorado" ? "Volver a pendiente" : "Ignorar (no es del CeCIP o ya está registrado)"} onClick={() => ignorar(m)}>
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="border-t border-slate-100 p-3 text-xs text-slate-500">
          La API de Santander requiere un convenio con el banco (Santander Empresas / Open Banking). Con el acceso habilitado, un flujo de n8n
          consulta los movimientos y los envía al ERP; mientras tanto podés importar el extracto que descargás de Online Banking Empresas.
        </p>
      </Card>
      <ConciliarModal mov={conciliar} onClose={() => setConciliar(null)} />
      <ImportarExtracto open={importar} onClose={() => setImportar(false)} />
    </>
  );
}

type Modo = "cuota" | "alquiler" | "tesoreria";

function ConciliarModal({ mov, onClose }: { mov: BancoMovimiento | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: socios } = useSociosMin();
  const { data: cfg } = useConfig();
  const credito = (mov?.monto || 0) > 0;
  const [modo, setModo] = useState<Modo>("cuota");
  const [socioId, setSocioId] = useState("");
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mov) return;
    setModo(mov.monto > 0 ? "cuota" : "tesoreria");
    setCategoria(mov.monto > 0 ? "Otros ingresos" : "Comisiones bancarias");
    setDetalle(mov.descripcion);
    setError(null);
    // Si el banco informa el CUIT de quien transfirió y es socio, se elige solo
    const cuit = (mov.contraparte_cuit || "").replace(/\D/g, "");
    setSocioId("");
    setBuscar("");
    if (cuit.length === 11) {
      supabase.from("socios").select("id").eq("cuit", formatCuit(cuit)).maybeSingle().then(({ data }) => data && setSocioId(data.id));
    }
  }, [mov]);

  // Cuotas pendientes: las del socio elegido o, si no hay socio, las que coinciden con el importe
  const { data: cuotas } = useQuery({
    queryKey: ["banco", "cuotas", mov?.id, socioId],
    enabled: !!mov && credito && modo === "cuota",
    queryFn: async () => {
      let qy = supabase.from("cuotas_detalle").select("*").eq("estado", "pendiente").order("vencimiento").limit(50);
      if (socioId) qy = qy.eq("socio_id", socioId);
      else qy = qy.gte("monto", Math.floor(mov!.monto * 0.8)).lte("monto", Math.ceil(mov!.monto));
      return unwrap(await qy) as CuotaDetalle[];
    },
  });

  const { data: cargos } = useQuery({
    queryKey: ["banco", "alquileres", mov?.id],
    enabled: !!mov && credito && modo === "alquiler",
    queryFn: async () => unwrap(await supabase.from("alquiler_cargos_detalle").select("*").eq("estado", "pendiente").order("vencimiento")) as AlquilerCargo[],
  });

  const sociosFiltrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    if (!t) return [];
    return (socios || []).filter((s) => `${s.razon_social} ${s.nombre_comercial || ""} ${s.numero_socio || ""}`.toLowerCase().includes(t)).slice(0, 8);
  }, [socios, buscar]);

  async function aplicar(params: { p_cuota?: string; p_cargo?: string; p_categoria?: string; p_detalle?: string }) {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("conciliar_banco", { p_mov: mov!.id, ...params });
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    // El cobro deja la factura en cola si la facturación automática está activa
    if (cfg?.facturacion_auto && (params.p_cuota || params.p_cargo)) enviarFacturasEnCola().then(() => invalidate("facturas"));
    toast("Movimiento conciliado.");
    invalidate("banco", "cuotas", "socios", "socio", "movimientos", "dashboard", "alquileres", "facturas");
    onClose();
  }

  if (!mov) return null;
  const socioSel = socios?.find((s) => s.id === socioId);
  return (
    <Modal open onClose={onClose} size="lg" title="Conciliar movimiento del banco">
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span>{fecha(mov.fecha)} · {mov.descripcion}</span>
            <b className={mov.monto > 0 ? "text-emerald-700" : "text-red-700"}>{mov.monto < 0 && "−"}{pesos(Math.abs(mov.monto))}</b>
          </div>
          {(mov.contraparte_nombre || mov.contraparte_cuit) && (
            <div className="text-xs text-slate-500">{mov.contraparte_nombre} {mov.contraparte_cuit && `· CUIT ${formatCuit(mov.contraparte_cuit)}`}</div>
          )}
        </div>

        {credito && (
          <Tabs<Modo> value={modo} onChange={setModo} tabs={[
            { value: "cuota", label: "Pago de cuota" },
            { value: "alquiler", label: "Pago de alquiler" },
            { value: "tesoreria", label: "Otro ingreso" },
          ]} />
        )}

        {credito && modo === "cuota" && (
          <>
            <Field label="Socio que pagó" hint={socioSel ? undefined : "Sin socio elegido se muestran las cuotas pendientes con importe parecido."}>
              {socioSel ? (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>{nombreSocio(socioSel)} {socioSel.numero_socio && <span className="text-slate-500">· N° {socioSel.numero_socio}</span>}</span>
                  <button className="text-xs text-brand-600 hover:underline" onClick={() => setSocioId("")}>Cambiar</button>
                </div>
              ) : (
                <>
                  <Input placeholder="Buscar socio por nombre o N°…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
                  {sociosFiltrados.length > 0 && (
                    <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                      {sociosFiltrados.map((s) => (
                        <li key={s.id}><button className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setSocioId(s.id); setBuscar(""); }}>{nombreSocio(s)} {s.numero_socio && <span className="text-slate-500">· N° {s.numero_socio}</span>}</button></li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Field>
            {!cuotas ? <Loading /> : !cuotas.length ? (
              <p className="text-sm text-slate-500">No hay cuotas pendientes {socioId ? "de este socio" : "con un importe parecido"}.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {cuotas.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div>
                      {!socioId && <div className="font-medium">{nombreSocio(c)}</div>}
                      <div>{c.concepto}</div>
                      <div className="text-xs text-slate-500">vence {fecha(c.vencimiento)} · total hoy {pesos(c.total)}</div>
                    </div>
                    <Button size="sm" variant="success" loading={saving} onClick={() => aplicar({ p_cuota: c.id })}>Imputar</Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">Se registra el pago con el importe del banco, se emite el recibo y, si corresponde, la factura.</p>
          </>
        )}

        {credito && modo === "alquiler" && (
          !cargos ? <Loading /> : !cargos.length ? <p className="text-sm text-slate-500">No hay alquileres pendientes.</p> : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {cargos.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div><div className="font-medium">{c.inquilino_nombre}</div><div className="text-xs text-slate-500">{c.concepto} · {pesos(c.monto)}</div></div>
                  <Button size="sm" variant="success" loading={saving} onClick={() => aplicar({ p_cargo: c.id })}>Imputar</Button>
                </li>
              ))}
            </ul>
          )
        )}

        {(!credito || modo === "tesoreria") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={credito ? "Categoría del ingreso" : "Categoría del egreso"}>
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {CATEGORIAS_MOVIMIENTO[credito ? "ingreso" : "egreso"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Detalle"><Input value={detalle} onChange={(e) => setDetalle(e.target.value)} /></Field>
            <div className="sm:col-span-2 text-right">
              <Button loading={saving} onClick={() => aplicar({ p_categoria: categoria, p_detalle: detalle })}>Registrar en tesorería</Button>
            </div>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// Importación del extracto (CSV o Excel guardado como CSV)
const COL = {
  fecha: ["fecha", "fecha_operacion", "fecha_de_operacion", "fecha_movimiento"],
  descripcion: ["descripcion", "concepto", "detalle", "movimiento"],
  importe: ["importe", "monto", "importe_en_pesos"],
  debito: ["debito", "debitos", "egreso"],
  credito: ["credito", "creditos", "ingreso"],
  saldo: ["saldo", "saldo_en_pesos"],
  referencia: ["referencia", "comprobante", "nro_comprobante", "numero_de_comprobante", "codigo"],
};
const valor = (r: Record<string, string>, k: keyof typeof COL) => {
  for (const c of COL[k]) if (r[c] !== undefined && r[c] !== "") return r[c];
  return "";
};
const aNumero = (t: string) => {
  const s = t.replace(/[$\s]/g, "");
  if (!s) return NaN;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
};
const aFecha = (t: string) => {
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
};
const huella = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "csv-" + (h >>> 0).toString(36);
};

function ImportarExtracto({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<{ fecha: string; descripcion: string; monto: number; saldo: number | null; referencia: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function leer(file: File) {
    setError(null);
    const texto = await file.text();
    const rows = parseCSV(texto);
    const out = rows.map((r) => {
      const importe = valor(r, "importe");
      const monto = importe ? aNumero(importe) : (aNumero(valor(r, "credito")) || 0) - (aNumero(valor(r, "debito")) || 0);
      const saldo = aNumero(valor(r, "saldo"));
      return { fecha: aFecha(valor(r, "fecha")), descripcion: valor(r, "descripcion") || "Movimiento", monto, saldo: Number.isFinite(saldo) ? saldo : null, referencia: valor(r, "referencia") || null };
    }).filter((f) => f.fecha && Number.isFinite(f.monto) && f.monto !== 0);
    if (!out.length) setError("No se reconocieron movimientos. El archivo tiene que tener columnas Fecha, Descripción/Concepto e Importe (o Débito y Crédito).");
    setFilas(out);
  }

  async function guardar() {
    setSaving(true);
    const { data: cuenta } = await supabase.from("cuentas").select("id").eq("nombre", "Banco Santander").maybeSingle();
    const payload = filas.map((f) => ({
      banco: "Santander", cuenta_id: cuenta?.id || null, fecha: f.fecha, descripcion: f.descripcion.slice(0, 300), monto: f.monto,
      saldo: f.saldo, referencia: f.referencia, id_externo: huella(`${f.fecha}|${f.monto}|${f.descripcion}|${f.referencia || ""}|${f.saldo ?? ""}`),
    }));
    const { data, error } = await supabase.from("banco_movimientos").upsert(payload, { onConflict: "banco,id_externo", ignoreDuplicates: true }).select("id");
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast(`Extracto importado: ${data?.length || 0} movimientos nuevos (los repetidos se omiten).`);
    invalidate("banco");
    setFilas([]);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Importar extracto de Santander"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} disabled={!filas.length} onClick={guardar}>Importar {filas.length || ""} movimientos</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Descargá los movimientos desde Online Banking Empresas en formato Excel/CSV (si es Excel, guardalo como CSV) y elegí el archivo.
          Se reconocen las columnas <b>Fecha</b>, <b>Descripción/Concepto</b>, <b>Importe</b> (o <b>Débito</b> y <b>Crédito</b>), <b>Saldo</b> y <b>Referencia</b>.
          Se puede importar el mismo período más de una vez: los movimientos repetidos no se duplican.
        </p>
        <input ref={input} type="file" accept=".csv,text/csv,.txt" className="block text-sm" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
        <ErrorBox error={error} />
        {filas.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {filas.slice(0, 100).map((f, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">{fecha(f.fecha)}</td>
                    <td className="px-2 py-1">{f.descripcion}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${f.monto > 0 ? "text-emerald-700" : "text-red-700"}`}>{pesos(f.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
