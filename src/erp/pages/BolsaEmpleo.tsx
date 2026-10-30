import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CheckCircle2, Download, Mail, MessageCircle, Pencil, Search, Trash2, Upload } from "lucide-react";
import { supabase, traducirError, unwrap } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaHora, nombreSocio } from "../../lib/format";
import { abrirWhatsapp } from "../../lib/whatsapp";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Textarea, useToast } from "../../components/ui";
import { useInvalidate, useSociosMin } from "../data";

export interface BolsaCv {
  id: string; nombre: string; email: string | null; origen?: string; telefono: string | null; localidad: string | null; area: string | null;
  tipo_profesional: string | null; comentarios: string | null; archivo_path: string | null; archivo_nombre: string | null;
  archivo_tamano: string | null; estado: "nuevo" | "aprobado" | "contactado" | "archivado"; notas: string | null; created_at: string;
}

// Las mismas opciones que el formulario de la web
export const AREAS_CV = ["Administración", "Ventas y Comercial", "Industria y Producción", "Tecnología y Sistemas", "Soporte Técnico",
  "Logística y Depósito", "Atención al Cliente", "Oficios / Operativo", "Otros"];
export const PERFILES_CV = ["Estudiante / Junior", "Técnico Especialista", "Profesional Senior", "Oficios / Operario calificado", "Prácticas Profesionales"];

export const ESTADOS_CV: Record<BolsaCv["estado"], { label: string; tone: "blue" | "green" | "purple" | "gray" }> = {
  nuevo: { label: "Nuevo", tone: "blue" },
  aprobado: { label: "Visible para socios", tone: "green" },
  contactado: { label: "Contactado", tone: "purple" },
  archivado: { label: "Archivado", tone: "gray" },
};

/** Descarga el CV (bucket privado, con URL firmada de pocos minutos) */
export async function abrirCv(path: string | null, nombre?: string | null) {
  if (!path) return alert("Este CV no tiene archivo adjunto.");
  const { data, error } = await supabase.storage.from("bolsa-cvs").createSignedUrl(path, 300, nombre ? { download: nombre } : undefined);
  if (error || !data) return alert("No se pudo abrir el archivo.");
  window.open(data.signedUrl, "_blank", "noopener");
}

export default function BolsaEmpleo() {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const puede = can("atencion", "prensa");
  const [estado, setEstado] = useState("activos");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [ver, setVer] = useState<BolsaCv | null>(null);
  const [cargar, setCargar] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["bolsa"],
    queryFn: async () => unwrap(await supabase.from("bolsa_cvs").select("*").order("created_at", { ascending: false }).limit(1000)) as BolsaCv[],
    refetchInterval: 60_000,
  });
  const { data: intereses } = useQuery({
    queryKey: ["bolsa", "intereses"],
    queryFn: async () => unwrap(await supabase.from("bolsa_interes").select("cv_id, socio_id, created_at")) as { cv_id: string; socio_id: string; created_at: string }[],
  });
  const interesPorCv = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of intereses || []) m.set(i.cv_id, [...(m.get(i.cv_id) || []), i.socio_id]);
    return m;
  }, [intereses]);

  const areas = [...new Set((data || []).map((c) => c.area).filter(Boolean))] as string[];
  const lista = (data || []).filter((c) => {
    if (estado === "activos" ? c.estado === "archivado" : estado && c.estado !== estado) return false;
    if (area && c.area !== area) return false;
    const t = q.trim().toLowerCase();
    return !t || [c.nombre, c.email, c.telefono, c.localidad, c.comentarios, c.tipo_profesional].some((x) => x?.toLowerCase().includes(t));
  });

  async function cambiar(c: BolsaCv, cambios: Partial<BolsaCv>, aviso?: string) {
    const { error } = await supabase.from("bolsa_cvs").update({ ...cambios, revisado_at: new Date().toISOString() }).eq("id", c.id);
    if (error) return toast(traducirError(error.message), "error");
    if (aviso) toast(aviso);
    invalidate("bolsa");
  }

  return (
    <>
      <PageHeader title="Bolsa de empleo"
        subtitle="Currículums cargados en la web del CeCIP o por el personal. Los que marcás como visibles los ven los socios en el Portal y pueden indicar que les interesan."
        actions={puede && <Button icon={<Upload className="h-4 w-4" />} onClick={() => setCargar(true)}>Cargar CV</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className="input pl-8" placeholder="Buscar nombre, email, localidad…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="activos">Activos (sin archivados)</option>
            <option value="">Todos</option>
            {Object.entries(ESTADOS_CV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select className="w-auto" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </Select>
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : !lista.length ? <Empty icon={<Briefcase className="h-8 w-8" />}>No hay currículums con este filtro. Llegan desde la web del CeCIP (Bolsa de Empleo).</Empty> : (
          <Table>
            <thead className="bg-slate-50">
              <tr><th className="th">Postulante</th><th className="th">Área y perfil</th><th className="th">Recibido</th><th className="th">Estado</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((c) => {
                const int = interesPorCv.get(c.id)?.length || 0;
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setVer(c)}>
                    <td className="td"><div className="font-medium">{c.nombre}{c.origen === "carga" && <span className="ml-1.5 text-[10px] font-semibold uppercase text-slate-400">cargado</span>}</div><div className="text-xs text-slate-500">{[c.email, c.telefono, c.localidad].filter(Boolean).join(" · ")}</div></td>
                    <td className="td text-sm">{c.area || "—"}<div className="text-xs text-slate-500">{c.tipo_profesional}</div></td>
                    <td className="td whitespace-nowrap text-xs">{fechaHora(c.created_at)}</td>
                    <td className="td"><Badge tone={ESTADOS_CV[c.estado].tone}>{ESTADOS_CV[c.estado].label}</Badge>{int > 0 && <div className="mt-1 text-xs text-emerald-700">{int} comercio{int > 1 ? "s" : ""} interesado{int > 1 ? "s" : ""}</div>}</td>
                    <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                      {c.archivo_path && <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => abrirCv(c.archivo_path, c.archivo_nombre)}>CV</Button>}
                      {puede && c.estado === "nuevo" && <Button size="sm" variant="success" onClick={() => cambiar(c, { estado: "aprobado" }, "Ahora lo ven los socios en el Portal.")}>Mostrar a socios</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <CargarCvs open={cargar} onClose={() => setCargar(false)} />
      <DetalleCv cv={ver} interesados={ver ? interesPorCv.get(ver.id) || [] : []} puede={puede} onClose={() => setVer(null)}
        onCambiar={(cambios, aviso) => { if (ver) { cambiar(ver, cambios, aviso); setVer({ ...ver, ...cambios } as BolsaCv); } }} />
    </>
  );
}

function DetalleCv({ cv, interesados, puede, onClose, onCambiar }: {
  cv: BolsaCv | null; interesados: string[]; puede: boolean; onClose: () => void; onCambiar: (c: Partial<BolsaCv>, aviso?: string) => void;
}) {
  const { data: socios } = useSociosMin();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [notas, setNotas] = useState<string | null>(null);
  const [datos, setDatos] = useState<Pick<BolsaCv, "nombre" | "email" | "telefono" | "localidad" | "area" | "tipo_profesional"> | null>(null);
  if (!cv) return null;
  const nombres = interesados.map((id) => socios?.find((s) => s.id === id)).filter(Boolean);
  async function borrar() {
    if (!cv || !confirm(`¿Borrar el CV de ${cv.nombre}? No se puede deshacer.`)) return;
    if (cv.archivo_path) await supabase.storage.from("bolsa-cvs").remove([cv.archivo_path]);
    const { error } = await supabase.from("bolsa_cvs").delete().eq("id", cv.id);
    if (error) return toast(traducirError(error.message), "error");
    invalidate("bolsa");
    onClose();
  }
  return (
    <Modal open={!!cv} onClose={() => { setNotas(null); setDatos(null); onClose(); }} title={cv.nombre} size="lg">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={ESTADOS_CV[cv.estado].tone}>{ESTADOS_CV[cv.estado].label}</Badge>
          {cv.area && <Badge tone="blue">{cv.area}</Badge>}
          {cv.tipo_profesional && <Badge>{cv.tipo_profesional}</Badge>}
        </div>
        {datos ? (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
            <Field label="Nombre y apellido"><Input value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={datos.email || ""} onChange={(e) => setDatos({ ...datos, email: e.target.value })} /></Field>
            <Field label="Teléfono"><Input value={datos.telefono || ""} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} /></Field>
            <Field label="Localidad"><Input value={datos.localidad || ""} onChange={(e) => setDatos({ ...datos, localidad: e.target.value })} /></Field>
            <Field label="Área"><Select value={datos.area || ""} onChange={(e) => setDatos({ ...datos, area: e.target.value })}><option value="">—</option>{AREAS_CV.map((a) => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Perfil"><Select value={datos.tipo_profesional || ""} onChange={(e) => setDatos({ ...datos, tipo_profesional: e.target.value })}><option value="">—</option>{PERFILES_CV.map((a) => <option key={a}>{a}</option>)}</Select></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={!datos.nombre.trim()} onClick={() => {
                onCambiar(Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])) as Partial<BolsaCv>, "Datos guardados.");
                setDatos(null);
              }}>Guardar datos</Button>
              <Button size="sm" variant="secondary" onClick={() => setDatos(null)}>Cancelar</Button>
            </div>
          </div>
        ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div><span className="text-xs text-slate-500">Email</span><div>{cv.email || "—"}</div></div>
          <div><span className="text-xs text-slate-500">Teléfono</span><div>{cv.telefono || "—"}</div></div>
          <div><span className="text-xs text-slate-500">Localidad</span><div>{cv.localidad || "—"}</div></div>
          <div><span className="text-xs text-slate-500">{cv.origen === "carga" ? "Cargado" : "Recibido"}</span><div>{fechaHora(cv.created_at)}</div></div>
          {puede && <Button size="sm" variant="ghost" className="justify-self-start" icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => setDatos({ nombre: cv.nombre, email: cv.email, telefono: cv.telefono, localidad: cv.localidad, area: cv.area, tipo_profesional: cv.tipo_profesional })}>Editar datos</Button>}
        </div>
        )}
        {cv.comentarios && <div><span className="text-xs text-slate-500">Comentarios del postulante</span><p className="whitespace-pre-wrap">{cv.comentarios}</p></div>}
        <div className="flex flex-wrap gap-2">
          {cv.archivo_path && <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => abrirCv(cv.archivo_path, cv.archivo_nombre)}>Descargar CV{cv.archivo_tamano ? ` (${cv.archivo_tamano})` : ""}</Button>}
          {cv.email && <a href={`mailto:${cv.email}`}><Button size="sm" variant="secondary" icon={<Mail className="h-4 w-4" />}>Email</Button></a>}
          {cv.telefono && <Button size="sm" variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => abrirWhatsapp(cv.telefono, `Hola ${cv.nombre.split(" ")[0]}! Te escribimos del Centro Comercial e Industrial de Paraná por tu postulación en la Bolsa de Empleo.`)}>WhatsApp</Button>}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-slate-500">Comercios socios interesados</div>
          {nombres.length ? <ul className="list-inside list-disc">{nombres.map((s) => <li key={s!.id}>{nombreSocio(s!)}</li>)}</ul> : <p className="text-xs text-slate-500">Todavía ninguno.</p>}
        </div>
        {puede && (
          <>
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Notas internas</div>
              <Textarea rows={2} value={notas ?? cv.notas ?? ""} onChange={(e) => setNotas(e.target.value)} />
              {notas !== null && notas !== (cv.notas ?? "") && <Button size="sm" variant="secondary" className="mt-1" onClick={() => onCambiar({ notas }, "Notas guardadas.")}>Guardar notas</Button>}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {cv.estado !== "aprobado" && <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onCambiar({ estado: "aprobado" }, "Ahora lo ven los socios en el Portal.")}>Mostrar a los socios</Button>}
              {cv.estado === "aprobado" && <Button size="sm" variant="secondary" onClick={() => onCambiar({ estado: "nuevo" }, "Ya no lo ven los socios.")}>Ocultar a los socios</Button>}
              {cv.estado !== "contactado" && <Button size="sm" variant="secondary" onClick={() => onCambiar({ estado: "contactado" })}>Marcar contactado</Button>}
              {cv.estado !== "archivado" && <Button size="sm" variant="ghost" onClick={() => onCambiar({ estado: "archivado" })}>Archivar</Button>}
              <Button size="sm" variant="ghost" className="ml-auto text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={borrar}>Borrar</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Nombre probable del postulante a partir del archivo ("CV - Juan Pérez.pdf" → "Juan Pérez") */
function nombreDesdeArchivo(archivo: string) {
  const base = archivo.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ")
    .replace(/\b(cv|curriculum|vitae|resume|actualizado|final|\d{4,})\b/gi, " ").replace(/\s+/g, " ").trim();
  return base ? base.replace(/(^|\s)\p{L}/gu, (l) => l.toUpperCase()) : "Postulante";
}
const nombreSeguro = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").slice(-80) || "cv.pdf";

/** Carga de los CV que el CeCIP ya tenía (por email, impresos escaneados, etc.): uno o muchos archivos a la vez */
function CargarCvs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { staff } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [archivos, setArchivos] = useState<{ file: File; nombre: string }[]>([]);
  const [area, setArea] = useState("");
  const [perfil, setPerfil] = useState("");
  const [visibles, setVisibles] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function elegir(lista: FileList | null) {
    if (!lista) return;
    const validos = [...lista].filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    const grandes = validos.filter((f) => f.size > 5 * 1024 * 1024);
    setError(grandes.length ? `${grandes.length} archivo(s) superan los 5 MB y no se cargan: ${grandes.map((f) => f.name).join(", ")}` :
      validos.length < lista.length ? "Solo se cargan archivos PDF o Word." : null);
    setArchivos((prev) => [...prev, ...validos.filter((f) => f.size <= 5 * 1024 * 1024).map((file) => ({ file, nombre: nombreDesdeArchivo(file.name) }))]);
  }

  function cerrar() { setArchivos([]); setArea(""); setPerfil(""); setVisibles(false); setError(null); setProgreso(null); onClose(); }

  async function cargar() {
    let ok = 0;
    const fallidos: string[] = [];
    for (const [i, { file, nombre }] of archivos.entries()) {
      setProgreso(`Cargando ${i + 1} de ${archivos.length}…`);
      const ruta = `carga/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${nombreSeguro(file.name)}`;
      const subida = await supabase.storage.from("bolsa-cvs").upload(ruta, file, { contentType: file.type || "application/pdf", upsert: false });
      if (subida.error) { fallidos.push(file.name); continue; }
      const { error } = await supabase.from("bolsa_cvs").insert({
        nombre: nombre.trim() || "Postulante", area: area || null, tipo_profesional: perfil || null, origen: "carga",
        estado: visibles ? "aprobado" : "nuevo", archivo_path: ruta, archivo_nombre: file.name,
        archivo_tamano: `${(file.size / (1024 * 1024)).toFixed(1)} MB`, revisado_por: staff?.user_id ?? null,
      });
      if (error) { fallidos.push(file.name); await supabase.storage.from("bolsa-cvs").remove([ruta]); } else ok++;
    }
    setProgreso(null);
    invalidate("bolsa", "badges");
    if (fallidos.length) setError(`No se pudieron cargar: ${fallidos.join(", ")}`);
    if (ok) toast(`${ok} CV cargado${ok > 1 ? "s" : ""} en la Bolsa de empleo.`);
    if (!fallidos.length) cerrar();
    else setArchivos((prev) => prev.filter((a) => fallidos.includes(a.file.name)));
  }

  return (
    <Modal open={open} onClose={cerrar} size="lg" title="Cargar CV que ya tiene el CeCIP"
      footer={<><Button variant="secondary" onClick={cerrar}>Cancelar</Button>
        <Button loading={!!progreso} disabled={!archivos.length} onClick={cargar}>{progreso || `Cargar ${archivos.length || ""} CV`}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Elegí uno o varios archivos (PDF o Word, hasta 5 MB cada uno). El nombre se toma del archivo y lo podés corregir; después completás email y teléfono desde cada CV con "Editar datos".</p>
        <input ref={input} type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = ""; }} />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); elegir(e.dataTransfer.files); }}
          onClick={() => input.current?.click()}
          className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-slate-500 hover:border-sky-400 hover:bg-sky-50">
          <Upload className="mx-auto mb-1 h-6 w-6" />Arrastrá los CV acá o hacé clic para elegirlos
        </div>
        {archivos.length > 0 && (
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {archivos.map((a, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2">
                <Input className="flex-1" value={a.nombre} onChange={(e) => setArchivos(archivos.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                <span className="max-w-[10rem] truncate text-xs text-slate-400" title={a.file.name}>{a.file.name}</span>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setArchivos(archivos.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Área (para todos, opcional)"><Select value={area} onChange={(e) => setArea(e.target.value)}><option value="">—</option>{AREAS_CV.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Perfil (para todos, opcional)"><Select value={perfil} onChange={(e) => setPerfil(e.target.value)}><option value="">—</option>{PERFILES_CV.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visibles} onChange={(e) => setVisibles(e.target.checked)} /> Mostrarlos ya a los socios en el Portal</label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
