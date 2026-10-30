import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Mail, MessageCircle, Pencil, Plus, Radio, Search, Trash2, Upload } from "lucide-react";
import readXlsxFile from "read-excel-file";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCSV, parseCSV } from "../../lib/csv";
import { abrirWhatsapp } from "../../lib/whatsapp";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Table, Textarea, useToast } from "../../components/ui";
import { useInvalidate } from "../data";

/** Canales y medios a los que comunica el CeCIP (gacetillas, conferencias, avisos de prensa) */
export interface MedioPrensa {
  id: string; medio: string; tipo: string | null; contacto: string | null; cargo: string | null; email: string | null;
  telefono: string | null; whatsapp: string | null; web: string | null; redes: string | null; localidad: string | null;
  temas: string | null; notas: string | null; activo: boolean;
}
type Campos = Omit<MedioPrensa, "id" | "activo">;

export const TIPOS_MEDIO = ["Diario", "Radio", "TV", "Portal web", "Revista", "Agencia", "Redes / Influencer", "Institucional", "Otro"];

const VACIO: Campos = { medio: "", tipo: "", contacto: "", cargo: "", email: "", telefono: "", whatsapp: "", web: "", redes: "", localidad: "", temas: "", notas: "" };

// Encabezados del Excel que se reconocen para cada campo (sin acentos, en minúscula)
const SINONIMOS: Record<keyof Campos, string[]> = {
  medio: ["medio", "nombre del medio", "canal", "medio de comunicacion", "nombre", "empresa", "programa"],
  tipo: ["tipo", "tipo de medio", "categoria", "formato", "soporte"],
  contacto: ["contacto", "periodista", "responsable", "nombre de contacto", "conductor", "productor", "referente"],
  cargo: ["cargo", "puesto", "funcion", "rol"],
  email: ["email", "e-mail", "mail", "correo", "correo electronico"],
  telefono: ["telefono", "tel", "celular", "cel", "movil", "telefonos"],
  whatsapp: ["whatsapp", "wsp", "wpp", "whats app"],
  web: ["web", "sitio", "sitio web", "pagina", "pagina web", "url", "link"],
  redes: ["redes", "redes sociales", "instagram", "facebook", "twitter", "x", "tiktok"],
  localidad: ["localidad", "ciudad", "zona", "provincia", "alcance"],
  temas: ["temas", "seccion", "secciones", "area", "cobertura", "programa / seccion"],
  notas: ["notas", "observaciones", "comentarios", "obs"],
};
const clave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_]+/g, " ").trim();

/** Convierte las filas del Excel (primera fila = encabezados) en medios */
function filasAMedios(filas: unknown[][]): Campos[] {
  const inicio = filas.findIndex((f) => f.filter((c) => c !== null && String(c).trim()).length >= 2);
  if (inicio < 0) return [];
  const enc = filas[inicio].map((c) => clave(String(c ?? "")));
  const indice: Partial<Record<keyof Campos, number>> = {};
  (Object.keys(SINONIMOS) as (keyof Campos)[]).forEach((campo) => {
    const i = enc.findIndex((h) => SINONIMOS[campo].includes(h));
    if (i >= 0) indice[campo] = i;
  });
  // si no hay columna "medio", se toma la primera columna
  if (indice.medio === undefined) indice.medio = 0;
  return filas.slice(inicio + 1).map((f) => {
    const m = { ...VACIO };
    (Object.keys(indice) as (keyof Campos)[]).forEach((campo) => {
      const v = f[indice[campo]!];
      m[campo] = v === null || v === undefined ? "" : String(v).trim();
    });
    if (m.email) m.email = m.email.toLowerCase().replace(/^mailto:/, "");
    return m;
  }).filter((m) => m.medio || m.email);
}

export function PortalPrensa() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("prensa");
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [inactivos, setInactivos] = useState(false);
  const [editar, setEditar] = useState<MedioPrensa | "nuevo" | null>(null);
  const [importar, setImportar] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["prensa_medios"],
    queryFn: async () => unwrap(await supabase.from("prensa_medios").select("*").order("medio")) as MedioPrensa[],
  });

  const tipos = [...new Set([...TIPOS_MEDIO, ...(data || []).map((m) => m.tipo).filter(Boolean) as string[]])];
  const lista = useMemo(() => (data || []).filter((m) => {
    if (!inactivos && !m.activo) return false;
    if (tipo && m.tipo !== tipo) return false;
    const t = q.trim().toLowerCase();
    return !t || [m.medio, m.contacto, m.email, m.localidad, m.temas, m.tipo].some((x) => x?.toLowerCase().includes(t));
  }), [data, q, tipo, inactivos]);
  const conEmail = lista.filter((m) => m.email);

  async function copiarEmails() {
    const emails = [...new Set(conEmail.map((m) => m.email!))].join(", ");
    try { await navigator.clipboard.writeText(emails); toast(`${conEmail.length} emails copiados: pegalos en "CCO" para mandar la gacetilla.`); }
    catch { prompt("Copiá los emails:", emails); }
  }

  async function eliminar(m: MedioPrensa) {
    if (!confirm(`¿Eliminar "${m.medio}" de la lista de prensa?`)) return;
    const { error } = await supabase.from("prensa_medios").delete().eq("id", m.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("prensa_medios");
  }

  const porTipo = useMemo(() => {
    const c: Record<string, number> = {};
    (data || []).filter((m) => m.activo).forEach((m) => { const k = m.tipo || "Sin tipo"; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <>
      <Card
        title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 text-sky-600" /> Portal de prensa · canales y medios</span>}
        actions={<div className="flex flex-wrap gap-2">
          {puede && <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setImportar(true)}>Importar Excel</Button>}
          <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} disabled={!lista.length}
            onClick={() => descargarCSV("medios-de-prensa-cecip", lista.map(({ id, activo, ...r }) => r))}>Exportar</Button>
          {puede && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditar("nuevo")}>Agregar medio</Button>}
        </div>}
      >
        {porTipo.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-2 text-xs">
            {porTipo.map(([t, n]) => (
              <button key={t} type="button" onClick={() => setTipo(tipo === t ? "" : t)}
                className={`rounded-full px-2.5 py-1 font-medium ${tipo === t ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{t} · {n}</button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar medio, periodista, email, tema…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {tipos.map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Checkbox checked={inactivos} onChange={setInactivos} label="Ver inactivos" />
          <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} disabled={!conEmail.length} onClick={copiarEmails}>
            Copiar emails ({conEmail.length})
          </Button>
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : !lista.length ? (
          <Empty icon={<Radio className="h-8 w-8" />}>
            {data?.length ? "No hay medios con este filtro." : "Todavía no hay medios cargados. Importá el Excel con los canales y medios del CeCIP o agregalos uno por uno."}
          </Empty>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Medio</th><th className="th">Contacto</th><th className="th">Email y teléfono</th><th className="th">Temas</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((m) => (
                <tr key={m.id} className={m.activo ? "" : "opacity-50"}>
                  <td className="td">
                    <div className="font-medium">{m.medio}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">{m.tipo && <Badge tone="blue">{m.tipo}</Badge>}{m.localidad && <span className="text-xs text-slate-500">{m.localidad}</span>}</div>
                  </td>
                  <td className="td text-sm">{m.contacto || "—"}{m.cargo && <div className="text-xs text-slate-500">{m.cargo}</div>}</td>
                  <td className="td text-sm">{m.email && <div>{m.email}</div>}<div className="text-xs text-slate-500">{[m.telefono, m.whatsapp && m.whatsapp !== m.telefono ? `WA ${m.whatsapp}` : ""].filter(Boolean).join(" · ")}</div></td>
                  <td className="td max-w-[14rem] text-xs text-slate-600">{m.temas}</td>
                  <td className="td whitespace-nowrap text-right">
                    {m.email && <a href={`mailto:${m.email}`} title="Escribir email"><Button size="sm" variant="ghost" icon={<Mail className="h-4 w-4" />} /></a>}
                    {(m.whatsapp || m.telefono) && <Button size="sm" variant="ghost" title="WhatsApp" icon={<MessageCircle className="h-4 w-4" />} onClick={() => abrirWhatsapp(m.whatsapp || m.telefono!, `Hola ${m.contacto || ""}, te escribimos del Centro Comercial e Industrial de Paraná (CeCIP).`)} />}
                    {puede && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditar(m)} />}
                    {puede && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => eliminar(m)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <MedioForm value={editar} onClose={() => setEditar(null)} />
      <ImportarMedios open={importar} existentes={data || []} onClose={() => setImportar(false)} />
    </>
  );
}

function MedioForm({ value, onClose }: { value: MedioPrensa | "nuevo" | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState<Campos & { activo: boolean }>({ ...VACIO, activo: true });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!value) return;
    setError(null);
    if (value === "nuevo") setF({ ...VACIO, activo: true });
    else { const { id, ...resto } = value; setF(Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, v ?? ""])) as Campos & { activo: boolean }); }
  }, [value]);

  const set = (k: keyof Campos) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.medio.trim()) return setError("Escribí el nombre del medio.");
    setSaving(true);
    const payload = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])), updated_at: new Date().toISOString() };
    const res = value && value !== "nuevo"
      ? await supabase.from("prensa_medios").update(payload).eq("id", value.id)
      : await supabase.from("prensa_medios").insert(payload);
    setSaving(false);
    if (res.error) return setError(traducirError(res.error.message));
    toast("Medio guardado.");
    invalidate("prensa_medios");
    onClose();
  }

  return (
    <Modal open={!!value} onClose={onClose} size="lg" title={value === "nuevo" ? "Agregar medio" : "Editar medio"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Medio o canal"><Input value={f.medio} onChange={set("medio")} placeholder="Ej. El Diario de Paraná" /></Field>
        <Field label="Tipo">
          <Select value={f.tipo || ""} onChange={set("tipo")}><option value="">—</option>{TIPOS_MEDIO.map((t) => <option key={t}>{t}</option>)}</Select>
        </Field>
        <Field label="Contacto (periodista o responsable)"><Input value={f.contacto || ""} onChange={set("contacto")} /></Field>
        <Field label="Cargo o programa"><Input value={f.cargo || ""} onChange={set("cargo")} /></Field>
        <Field label="Email"><Input type="email" value={f.email || ""} onChange={set("email")} /></Field>
        <Field label="Teléfono"><Input value={f.telefono || ""} onChange={set("telefono")} /></Field>
        <Field label="WhatsApp"><Input value={f.whatsapp || ""} onChange={set("whatsapp")} /></Field>
        <Field label="Localidad o alcance"><Input value={f.localidad || ""} onChange={set("localidad")} /></Field>
        <Field label="Sitio web"><Input value={f.web || ""} onChange={set("web")} /></Field>
        <Field label="Redes"><Input value={f.redes || ""} onChange={set("redes")} placeholder="@usuario" /></Field>
        <Field label="Temas que cubre" className="sm:col-span-2"><Input value={f.temas || ""} onChange={set("temas")} placeholder="Economía, comercio, ciudad…" /></Field>
        <Field label="Notas" className="sm:col-span-2"><Textarea rows={3} value={f.notas || ""} onChange={set("notas")} /></Field>
        <Checkbox checked={f.activo} onChange={(v) => setF({ ...f, activo: v })} label="Activo (se incluye al copiar emails)" />
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}

function ImportarMedios({ open, existentes, onClose }: { open: boolean; existentes: MedioPrensa[]; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<Campos[]>([]);
  const [archivo, setArchivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setFilas([]); setArchivo(""); setError(null); } }, [open]);

  const ya = useMemo(() => new Set(existentes.map((m) => `${clave(m.medio)}|${(m.email || "").toLowerCase()}`)), [existentes]);
  const nuevas = filas.filter((m) => !ya.has(`${clave(m.medio)}|${(m.email || "").toLowerCase()}`));

  async function leer(file: File | undefined) {
    if (!file) return;
    setError(null);
    setArchivo(file.name);
    try {
      let medios: Campos[];
      if (/\.csv$|\.txt$/i.test(file.name)) {
        const obj = parseCSV(await file.text());
        medios = filasAMedios([Object.keys(obj[0] || {}), ...obj.map((o) => Object.values(o))]);
      } else {
        medios = filasAMedios(await readXlsxFile(file));
      }
      if (!medios.length) setError("No se encontraron filas. La primera fila tiene que tener los encabezados (Medio, Tipo, Contacto, Email, Teléfono…).");
      setFilas(medios);
    } catch {
      setError("No se pudo leer el archivo. Guardalo como Excel (.xlsx) o CSV y probá de nuevo.");
    }
  }

  async function importar() {
    if (!nuevas.length) return;
    setSaving(true);
    const payload = nuevas.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v || "").trim() || null])));
    const { error } = await supabase.from("prensa_medios").insert(payload);
    setSaving(false);
    if (error) return setError(traducirError(error.message));
    toast(`${nuevas.length} medios importados.`);
    invalidate("prensa_medios");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Importar canales y medios desde Excel"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={saving} disabled={!nuevas.length} onClick={importar}>Importar {nuevas.length || ""}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Subí el Excel (.xlsx) o CSV con los medios. La primera fila tiene que tener los títulos de las columnas; se reconocen
          <b> Medio, Tipo, Contacto/Periodista, Cargo, Email, Teléfono, WhatsApp, Web, Redes, Localidad, Temas y Notas</b>.
          Los que ya están (mismo medio y email) no se duplican.
        </p>
        <input ref={input} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => { leer(e.target.files?.[0]); e.target.value = ""; }} />
        <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()}>{archivo || "Elegir archivo"}</Button>
        <ErrorBox error={error} />
        {filas.length > 0 && (
          <>
            <div className="text-xs text-slate-500">{filas.length} filas leídas · <b className="text-emerald-700">{nuevas.length} nuevas</b>{filas.length - nuevas.length > 0 && ` · ${filas.length - nuevas.length} ya estaban`}</div>
            <div className="max-h-72 overflow-auto rounded border border-slate-200">
              <Table>
                <thead className="bg-slate-50"><tr><th className="th">Medio</th><th className="th">Tipo</th><th className="th">Contacto</th><th className="th">Email</th><th className="th">Teléfono</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.slice(0, 100).map((m, i) => (
                    <tr key={i}><td className="td">{m.medio}</td><td className="td">{m.tipo}</td><td className="td">{m.contacto}</td><td className="td">{m.email}</td><td className="td">{m.telefono}</td></tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
