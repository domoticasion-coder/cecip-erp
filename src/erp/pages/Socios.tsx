import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Mail, Plus, Search, Upload, Users } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV, parseCSV } from "../../lib/csv";
import { formatCuit, nombreSocio, pesos } from "../../lib/format";
import type { SocioResumen } from "../../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, SituacionBadge, Table, useToast } from "../../components/ui";
import { useCategorias, useInvalidate } from "../data";
import { SocioForm } from "../components/SocioForm";
import { EnviarEmailModal } from "../components/EnviarEmail";

export function useSociosResumen() {
  return useQuery({
    queryKey: ["socios", "resumen"],
    queryFn: async () =>
      unwrap(await supabase.from("socios_resumen").select("*").order("razon_social").range(0, 4999)) as SocioResumen[],
  });
}

export default function Socios() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const { data: socios, isLoading } = useSociosResumen();
  const { data: categorias } = useCategorias();

  const [q, setQ] = useState("");
  const estado = params.get("estado") || "activo";
  const categoria = params.get("categoria") || "";
  const filtro = params.get("filtro") || "";
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [nuevo, setNuevo] = useState(false);
  const [importar, setImportar] = useState(false);
  const [email, setEmail] = useState(false);
  const [bulkCat, setBulkCat] = useState("");

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
    setSel(new Set());
  };

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    return (socios || []).filter((s) => {
      if (estado && s.estado !== estado) return false;
      if (categoria && s.categoria_id !== categoria) return false;
      if (filtro === "sin-categoria" && s.categoria_id) return false;
      if (filtro === "con-deuda" && !(s.deuda > 0)) return false;
      if (filtro === "vencidas" && !(s.cuotas_vencidas > 0)) return false;
      if (filtro === "sin-email" && s.email) return false;
      if (!t) return true;
      return (
        s.razon_social.toLowerCase().includes(t) ||
        (s.nombre_comercial || "").toLowerCase().includes(t) ||
        (s.rubro || "").toLowerCase().includes(t) ||
        (s.email || "").toLowerCase().includes(t) ||
        (digits.length >= 3 && (s.cuit || "").replace(/\D/g, "").includes(digits)) ||
        String(s.numero_socio || "") === t
      );
    });
  }, [socios, q, estado, categoria, filtro]);

  const allSelected = lista.length > 0 && lista.every((s) => sel.has(s.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(lista.map((s) => s.id)));
  const toggle = (id: string) => setSel((x) => {
    const n = new Set(x);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function asignarCategoria() {
    if (!bulkCat || sel.size === 0) return;
    const { error } = await supabase.from("socios").update({ categoria_id: bulkCat === "ninguna" ? null : bulkCat }).in("id", [...sel]);
    if (error) return toast(traducirError(error.message), "error");
    toast(`Categoría asignada a ${sel.size} socios.`);
    setBulkCat("");
    setSel(new Set());
    invalidate("socios", "socios-min");
  }

  function exportar() {
    descargarCSV("socios-cecip", lista.map((s) => ({ ...s, cuit: formatCuit(s.cuit) })) as any, [
      { key: "numero_socio", label: "N° socio" },
      { key: "razon_social", label: "Razón social" },
      { key: "nombre_comercial", label: "Nombre de fantasía" },
      { key: "cuit", label: "CUIT" },
      { key: "categoria_nombre", label: "Categoría" },
      { key: "estado", label: "Estado" },
      { key: "rubro", label: "Rubro" },
      { key: "email", label: "Email" },
      { key: "whatsapp", label: "WhatsApp" },
      { key: "telefono", label: "Teléfono" },
      { key: "direccion", label: "Dirección" },
      { key: "localidad", label: "Localidad" },
      { key: "deuda", label: "Deuda" },
      { key: "cuotas_vencidas", label: "Cuotas vencidas" },
    ]);
  }

  const puedeEditar = can("atencion", "tesoreria");

  return (
    <>
      <PageHeader
        title="Socios"
        subtitle={socios ? `${socios.filter((s) => s.estado === "activo").length} activos · ${socios.length} en total` : undefined}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportar}>Exportar</Button>
            {puedeEditar && <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImportar(true)}>Importar</Button>}
            {puedeEditar && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNuevo(true)}>Nuevo socio</Button>}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Buscar por nombre, CUIT, rubro, email o N°…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={estado} onChange={(e) => setParam("estado", e.target.value)}>
            <option value="activo">Activos</option>
            <option value="suspendido">Suspendidos</option>
            <option value="baja">Bajas</option>
            <option value="">Todos los estados</option>
          </Select>
          <Select className="w-auto" value={categoria} onChange={(e) => setParam("categoria", e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
          <Select className="w-auto" value={filtro} onChange={(e) => setParam("filtro", e.target.value)}>
            <option value="">Sin filtro adicional</option>
            <option value="con-deuda">Con deuda</option>
            <option value="vencidas">Con cuotas vencidas</option>
            <option value="sin-categoria">Sin categoría</option>
            <option value="sin-email">Sin email</option>
          </Select>
        </div>

        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
            <b>{sel.size} seleccionados</b>
            <Button size="sm" variant="secondary" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => setEmail(true)}>Enviar email</Button>
            {puedeEditar && (
              <>
                <Select className="w-auto py-1 text-xs" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
                  <option value="">Asignar categoría…</option>
                  {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  <option value="ninguna">Quitar categoría</option>
                </Select>
                <Button size="sm" disabled={!bulkCat} onClick={asignarCategoria}>Aplicar</Button>
              </>
            )}
            <button className="ml-auto text-xs text-slate-500 hover:underline" onClick={() => setSel(new Set())}>Limpiar selección</button>
          </div>
        )}

        {isLoading ? (
          <Loading />
        ) : lista.length === 0 ? (
          <Empty icon={<Users className="h-10 w-10" />}>No hay socios que coincidan con los filtros.</Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="th w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="th">Socio</th>
                <th className="th hidden md:table-cell">Categoría</th>
                <th className="th hidden lg:table-cell">Contacto</th>
                <th className="th">Estado</th>
                <th className="th text-right">Deuda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/socios/${s.id}`)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} />
                  </td>
                  <td className="td">
                    <div className="font-medium text-slate-900">{nombreSocio(s)}</div>
                    <div className="text-xs text-slate-500">
                      {s.numero_socio && <>N° {s.numero_socio} · </>}
                      {s.nombre_comercial ? s.razon_social : s.rubro}
                      {s.cuit && <> · {formatCuit(s.cuit)}</>}
                    </div>
                  </td>
                  <td className="td hidden md:table-cell">
                    {s.categoria_nombre ? <span className="text-sm">{s.categoria_nombre}</span> : <Badge tone="amber">Sin categoría</Badge>}
                  </td>
                  <td className="td hidden text-xs text-slate-500 lg:table-cell">
                    <div>{s.email || <span className="text-amber-600">sin email</span>}</div>
                    <div>{s.whatsapp || s.telefono}</div>
                  </td>
                  <td className="td"><SituacionBadge s={s.estado} /></td>
                  <td className="td text-right tabular-nums">
                    {s.deuda > 0 ? (
                      <div>
                        <div className={s.cuotas_vencidas > 0 ? "font-semibold text-red-700" : "font-medium"}>{pesos(s.deuda)}</div>
                        {s.cuotas_vencidas > 0 && <div className="text-xs text-red-600">{s.cuotas_vencidas} vencida{s.cuotas_vencidas > 1 ? "s" : ""}</div>}
                      </div>
                    ) : (
                      <span className="text-xs text-emerald-600">Al día</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <SocioForm socio={nuevo ? "nuevo" : null} onClose={() => setNuevo(false)} onSaved={(id) => navigate(`/socios/${id}`)} />
      <ImportarModal open={importar} onClose={() => setImportar(false)} />
      <EnviarEmailModal open={email} onClose={() => setEmail(false)} socioIds={[...sel]} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Importación desde Excel/CSV
// ---------------------------------------------------------------------------

const ALIAS: Record<string, string[]> = {
  numero_socio: ["numero_socio", "n_socio", "nro_socio", "numero", "nro", "socio_n", "n"],
  razon_social: ["razon_social", "nombre", "empresa", "socio"],
  nombre_comercial: ["nombre_comercial", "nombre_de_fantasia", "fantasia"],
  cuit: ["cuit", "cuil"],
  rubro: ["rubro", "actividad"],
  categoria: ["categoria"],
  email: ["email", "mail", "correo", "e_mail"],
  whatsapp: ["whatsapp", "celular", "movil"],
  telefono: ["telefono", "tel"],
  direccion: ["direccion", "domicilio"],
  localidad: ["localidad", "ciudad"],
  contacto_nombre: ["contacto", "contacto_nombre", "responsable"],
};

function ImportarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: categorias } = useCategorias();
  const { data: existentes } = useSociosResumen();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mapeadas = useMemo(() => rows.map((r) => {
    const get = (campo: string) => {
      for (const a of ALIAS[campo]) if (r[a]) return r[a];
      return "";
    };
    const catNombre = get("categoria").toLowerCase();
    const cat = categorias?.find((c) => c.nombre.toLowerCase() === catNombre);
    const num = parseInt(get("numero_socio"), 10);
    return {
      numero_socio: Number.isFinite(num) ? num : null,
      razon_social: get("razon_social"),
      nombre_comercial: get("nombre_comercial") || null,
      cuit: get("cuit") || null,
      rubro: get("rubro") || null,
      categoria_id: cat?.id || null,
      email: get("email").toLowerCase() || null,
      whatsapp: get("whatsapp") || null,
      telefono: get("telefono") || null,
      direccion: get("direccion") || null,
      localidad: get("localidad") || null,
      contacto_nombre: get("contacto_nombre") || null,
    };
  }).filter((r) => r.razon_social), [rows, categorias]);

  async function leer(file: File) {
    setError(null);
    const text = await file.text();
    const r = parseCSV(text);
    if (!r.length) return setError("No se encontraron filas. Guardá el Excel como CSV (delimitado por comas o punto y coma).");
    setRows(r);
  }

  async function importar() {
    setSaving(true);
    setError(null);
    const porCuit = new Map((existentes || []).filter((s) => s.cuit).map((s) => [s.cuit!.replace(/\D/g, ""), s.id]));
    const porNumero = new Map((existentes || []).filter((s) => s.numero_socio).map((s) => [s.numero_socio!, s.id]));
    let creados = 0, actualizados = 0;
    const errores: string[] = [];

    for (const r of mapeadas) {
      const id = (r.cuit && porCuit.get(r.cuit.replace(/\D/g, ""))) || (r.numero_socio && porNumero.get(r.numero_socio));
      // No pisar con vacíos los datos existentes
      const datos = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== ""));
      const res = id
        ? await supabase.from("socios").update(datos).eq("id", id)
        : await supabase.from("socios").insert(datos);
      if (res.error) errores.push(`${r.razon_social}: ${traducirError(res.error.message)}`);
      else if (id) actualizados++;
      else creados++;
    }

    setSaving(false);
    await invalidate("socios", "socios-min", "dashboard");
    if (errores.length) setError(`Con errores (${errores.length}):\n` + errores.slice(0, 10).join("\n"));
    else {
      toast(`Importación lista: ${creados} nuevos, ${actualizados} actualizados.`);
      setRows([]);
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { setRows([]); onClose(); }}
      size="lg"
      title="Importar socios desde Excel / CSV"
      footer={
        <>
          <Button variant="secondary" onClick={() => { setRows([]); onClose(); }}>Cancelar</Button>
          <Button loading={saving} disabled={!mapeadas.length} onClick={importar}>Importar {mapeadas.length || ""} socios</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Subí un archivo CSV (en Excel: <i>Archivo → Guardar como → CSV</i>). La primera fila debe tener los títulos de las columnas.
          Se reconocen: <b>razon_social</b> (o nombre), nombre_comercial, cuit, numero_socio, rubro, categoria, email, whatsapp, telefono,
          direccion, localidad, contacto.
        </p>
        <p className="text-slate-600">Si un socio ya existe (mismo CUIT o mismo N° de socio) se actualizan sus datos; si no, se crea.</p>
        <Field label="Archivo">
          <Input type="file" accept=".csv,text/csv,.txt" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
        </Field>
        {mapeadas.length > 0 && (
          <div className="max-h-56 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="th">Razón social</th><th className="th">CUIT</th><th className="th">Email</th><th className="th">Categoría</th></tr></thead>
              <tbody>
                {mapeadas.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-1">{r.razon_social}</td>
                    <td className="px-3 py-1">{r.cuit}</td>
                    <td className="px-3 py-1">{r.email}</td>
                    <td className="px-3 py-1">{categorias?.find((c) => c.id === r.categoria_id)?.nombre || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mapeadas.length > 50 && <div className="p-2 text-center text-xs text-slate-500">… y {mapeadas.length - 50} más</div>}
          </div>
        )}
        {error && <div className="whitespace-pre-line"><ErrorBox error={error} /></div>}
      </div>
    </Modal>
  );
}
