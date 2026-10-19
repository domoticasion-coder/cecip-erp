import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, CheckCircle2, MapPin, Monitor, Ticket, Users, Clock, GraduationCap } from "lucide-react";
import { supabase, traducirError } from "../../lib/supabase";
import { appUrl } from "../../lib/appMode";
import { pesos } from "../../lib/format";
import { CONDICIONES_IVA, DIAS_SEMANA, type CondicionIva, type PreguntaFormulario } from "../../lib/types";
import { Button, ErrorBox, Field, Input, Loading, Select, Textarea } from "../../components/ui";
import { ThemeToggle } from "../../lib/theme";

interface EventoPublico {
  titulo: string;
  descripcion: string | null;
  tipo: "evento" | "capacitacion";
  fecha_inicio: string;
  fecha_fin: string | null;
  lugar: string | null;
  modalidad: "presencial" | "virtual" | "mixta";
  costo: number;
  precio_no_socio: number;
  dias_semana: number[] | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  cantidad_clases: number | null;
  docente: string | null;
  pide_facturacion: boolean;
  cupo: number | null;
  cupo_disponible: number | null;
  imagen_url: string | null;
  preguntas: PreguntaFormulario[];
  abierta: boolean;
}

const fechaLarga = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });

/** Link para agendar en Google Calendar */
function linkCalendario(e: EventoPublico) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fin = e.fecha_fin || new Date(new Date(e.fecha_inicio).getTime() + 2 * 3600_000).toISOString();
  const p = new URLSearchParams({
    action: "TEMPLATE", text: e.titulo, dates: `${f(e.fecha_inicio)}/${f(fin)}`,
    details: "Inscripción confirmada · Centro Comercial e Industrial de Paraná", location: e.lugar || "",
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/**
 * Formulario público de inscripción (no requiere cuenta): se comparte por WhatsApp, redes o email
 * para que se anoten personas que no son socias. Ruta: /inscripcion/:slug del portal.
 */
export default function InscripcionPublica() {
  const { slug = "" } = useParams();
  const [f, setF] = useState({ nombre: "", email: "", telefono: "", empresa: "", cuit: "", razon_social: "", condicion_iva: "", web: "" });
  const [resp, setResp] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ es_socio: boolean } | null>(null);

  const { data: ev, isLoading } = useQuery({
    queryKey: ["evento-publico", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("evento_publico", { p_slug: slug });
      if (error) throw new Error(traducirError(error.message));
      return data as EventoPublico | null;
    },
  });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (f.web) return; // campo trampa: solo lo completan los robots
    setError(null);
    setEnviando(true);
    const { data, error } = await supabase.rpc("inscribir_publico", {
      p_slug: slug, p_nombre: f.nombre, p_email: f.email, p_telefono: f.telefono || null,
      p_empresa: f.empresa || null, p_cuit: f.cuit || null, p_respuestas: resp,
      p_razon_social: f.razon_social || null, p_condicion_iva: (f.condicion_iva || null) as CondicionIva | null,
    });
    setEnviando(false);
    if (error) return setError(traducirError(error.message));
    setListo({ es_socio: !!(data as { es_socio?: boolean })?.es_socio });
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="min-h-full bg-slate-100 dark:bg-slate-950">
      <header className="bg-brand-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-9 rounded bg-[#ffffff] p-0.5" />
            <div className="leading-tight">
              <div className="text-sm font-bold text-white">CeCIP Paraná</div>
              <div className="text-xs text-brand-200">Centro Comercial e Industrial de Paraná</div>
            </div>
          </div>
          <ThemeToggle variant="sidebar" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {isLoading ? <Loading /> : !ev ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <CalendarDays className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <h1 className="text-lg font-semibold">Formulario no disponible</h1>
            <p className="mt-1 text-sm text-slate-500">El link no es válido o la inscripción ya no está publicada.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {ev.imagen_url && <img src={ev.imagen_url} alt="" className="max-h-80 w-full object-cover" />}
            <div className="p-5 sm:p-7">
              <span className="inline-block rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                {ev.tipo === "capacitacion" ? "Capacitación" : "Evento"}
              </span>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">{ev.titulo}</h1>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                <li className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brand-600" /><span className="first-letter:uppercase">{fechaLarga(ev.fecha_inicio)} hs</span></li>
                <li className="flex items-center gap-2">
                  {ev.modalidad === "virtual" ? <Monitor className="h-4 w-4 text-brand-600" /> : <MapPin className="h-4 w-4 text-brand-600" />}
                  {ev.modalidad === "virtual" ? "Virtual (te enviamos el link por email)" : ev.lugar || "A confirmar"}{ev.modalidad === "mixta" && " · también virtual"}
                </li>
                {ev.cantidad_clases && ev.cantidad_clases > 1 && (
                  <li className="flex items-center gap-2"><Clock className="h-4 w-4 text-brand-600" />
                    {ev.cantidad_clases} clases{ev.dias_semana?.length ? ` · ${[...ev.dias_semana].sort().map((d) => DIAS_SEMANA[d - 1]).join(", ")}` : ""}
                    {ev.hora_inicio && ` de ${ev.hora_inicio.slice(0, 5)} a ${(ev.hora_fin || "").slice(0, 5)} hs`}
                  </li>
                )}
                {ev.docente && <li className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-brand-600" />Docente: {ev.docente}</li>}
                <li className="flex items-center gap-2"><Ticket className="h-4 w-4 text-brand-600" />
                  {Number(ev.precio_no_socio) > 0 || Number(ev.costo) > 0
                    ? Number(ev.precio_no_socio) !== Number(ev.costo)
                      ? <>{pesos(ev.precio_no_socio)} · socios del CeCIP {Number(ev.costo) > 0 ? pesos(ev.costo) : "sin cargo"}</>
                      : pesos(ev.costo)
                    : "Sin costo"}
                </li>
                {ev.cupo_disponible !== null && (
                  <li className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-600" />{ev.cupo_disponible > 0 ? `Quedan ${ev.cupo_disponible} lugares` : "Cupo completo"}</li>
                )}
              </ul>
              {ev.descripcion && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{ev.descripcion}</p>}

              <div className="mt-6 border-t border-slate-100 pt-6">
                {listo ? (
                  <div className="text-center">
                    <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                    <h2 className="mt-2 text-xl font-bold">¡Listo, ya estás inscripto/a!</h2>
                    <p className="mt-1 text-sm text-slate-600">Te esperamos. Si necesitamos avisarte algo te escribimos a <b>{f.email}</b>.</p>
                    <a href={linkCalendario(ev)} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block">
                      <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" />}>Agendar en mi calendario</Button>
                    </a>
                    {!listo.es_socio && (
                      <div className="mt-6 rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
                        ¿Tenés un comercio, industria o servicio en Paraná? <b>Asociate al CeCIP</b> y accedé a capacitaciones, beneficios y representación.{" "}
                        <a href={`${appUrl("/")}?registro`} className="font-semibold underline">Quiero ser socio</a>
                      </div>
                    )}
                  </div>
                ) : !ev.abierta ? (
                  <p className="text-center text-sm font-medium text-slate-600">La inscripción está cerrada{ev.cupo_disponible === 0 ? " (cupo completo)" : ""}.</p>
                ) : (
                  <form onSubmit={enviar} className="space-y-3">
                    <h2 className="text-lg font-semibold">Inscripción</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Nombre y apellido *" className="sm:col-span-2"><Input required minLength={3} value={f.nombre} onChange={set("nombre")} autoComplete="name" /></Field>
                      <Field label="Email *"><Input required type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
                      <Field label="WhatsApp / teléfono"><Input value={f.telefono} onChange={set("telefono")} autoComplete="tel" /></Field>
                      <Field label="Empresa o comercio"><Input value={f.empresa} onChange={set("empresa")} autoComplete="organization" /></Field>
                      {ev.pide_facturacion ? (
                        <div className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
                          <div className="mb-2 text-sm font-semibold">Datos para la factura</div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="CUIT / CUIL *" hint="Si tu empresa es socia del CeCIP, se aplica el precio de socio.">
                              <Input required inputMode="numeric" value={f.cuit} onChange={set("cuit")} placeholder="20-12345678-9" />
                            </Field>
                            <Field label="Condición frente al IVA">
                              <Select value={f.condicion_iva} onChange={set("condicion_iva")}>
                                <option value="">Elegí</option>
                                {CONDICIONES_IVA.map((c) => <option key={c} value={c}>{c === "RI" ? "Responsable Inscripto" : c}</option>)}
                              </Select>
                            </Field>
                            <Field label="Razón social / nombre para la factura" className="sm:col-span-2">
                              <Input value={f.razon_social} onChange={set("razon_social")} placeholder="Si es distinto de tu nombre" />
                            </Field>
                          </div>
                        </div>
                      ) : (
                        <Field label="CUIT (opcional)" hint="Si tu empresa es socia del CeCIP, la reconocemos."><Input value={f.cuit} onChange={set("cuit")} /></Field>
                      )}
                      {ev.preguntas.map((p) => (
                        <Field key={p.id} label={p.etiqueta + (p.requerida ? " *" : "")} className="sm:col-span-2">
                          {p.tipo === "opciones" ? (
                            <Select required={p.requerida} value={resp[p.id] || ""} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })}>
                              <option value="">Elegí una opción</option>
                              {(p.opciones || []).map((o) => <option key={o}>{o}</option>)}
                            </Select>
                          ) : p.tipo === "si_no" ? (
                            <Select required={p.requerida} value={resp[p.id] || ""} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })}>
                              <option value="">Elegí</option><option>Sí</option><option>No</option>
                            </Select>
                          ) : (
                            <Textarea rows={2} required={p.requerida} value={resp[p.id] || ""} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })} />
                          )}
                        </Field>
                      ))}
                    </div>
                    {/* Campo trampa para robots (oculto para las personas) */}
                    <input tabIndex={-1} autoComplete="off" value={f.web} onChange={set("web")} className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
                    <ErrorBox error={error} />
                    <Button type="submit" loading={enviando} className="w-full py-2.5">Inscribirme</Button>
                    <p className="text-center text-xs text-slate-400">Tus datos se usan solo para organizar esta actividad del CeCIP.</p>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
