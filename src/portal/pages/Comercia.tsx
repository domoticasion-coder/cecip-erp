import { useEffect, useRef, useState } from "react";
import {
  BadgePercent, CheckCircle2, ExternalLink, Flame, GraduationCap, Hammer, Megaphone, MessageCircle,
  Search, Shield, Smartphone, Sparkles, Store, Wrench, XCircle, Zap, Clock, MapPin, CalendarDays,
  Globe, Camera, Truck, Briefcase, Gift,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { nombreSocio } from "../../lib/format";
import { abrirWhatsappFactoria } from "../../lib/whatsapp";
import type { Socio } from "../../lib/types";
import { cx, useToast } from "../../components/ui";
import type { BloqueConvenio, CursoIec, OfertaComercia, PromocionComercia, ServicioIec } from "../../../shared/comercia";
import { Loading } from "../../components/ui";
import { useConfigPortal } from "../data";
import { ConvenioComercia, HeroComercia } from "../components/ComerciaConvenio";
import { hoyISO } from "../../lib/format";

/*
 * Sección con el formato visual de la app ComercIA Paraná (tema oscuro, azul primario).
 * Usa colores fijos (no las clases de la paleta del portal) para verse igual en modo claro u oscuro.
 */

const ICONOS: Record<string, typeof Store> = {
  Store, Zap, Search, Wrench, BadgePercent, Shield, Flame, Megaphone, GraduationCap, Hammer, Smartphone, Globe, Camera, Truck, Sparkles, Briefcase,
};
const icono = (nombre: string) => ICONOS[nombre] || Store;

/** Contenido de ComercIA cargado desde ERP > Contenido (solo lo activo) */
function useContenidoComercia() {
  return useQuery({
    queryKey: ["portal-comercia-contenido"],
    queryFn: async () => {
      const [o, s, c, p, b, n] = await Promise.all([
        supabase.from("comercia_ofertas").select("*").eq("activa", true).order("orden"),
        supabase.from("iec_servicios").select("*").eq("activo", true).order("orden"),
        supabase.from("iec_cursos").select("*").eq("activo", true).order("orden"),
        supabase.from("comercia_promociones").select("*").eq("activa", true).or(`vigente_hasta.is.null,vigente_hasta.gte.${hoyISO()}`).order("orden"),
        supabase.from("comercia_convenio").select("*").eq("activo", true).order("orden"),
        supabase.from("comercia_novedades").select("id, titulo, cuerpo, imagen_url, created_at").eq("publicada", true).order("orden").order("created_at", { ascending: false }),
      ]);
      const promociones = (p.data || []) as PromocionComercia[];
      return {
        ofertas: (o.data || []) as OfertaComercia[], servicios: (s.data || []) as ServicioIec[], cursos: (c.data || []) as CursoIec[],
        // Las destacadas primero
        promociones: [...promociones].sort((x, y) => Number(y.destacada) - Number(x.destacada)),
        convenio: (b.data || []) as BloqueConvenio[],
        novedades: (n.data || []) as { id: string; titulo: string; cuerpo: string; imagen_url: string | null; created_at: string }[],
      };
    },
  });
}

type Tab = "convenio" | "ofertas" | "iec" | "cursos";

export default function Comercia({ socioId, socio }: { socioId: string; socio?: Socio }) {
  const { socioUsuario, session } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("convenio");
  const { data: contenido, isLoading } = useContenidoComercia();
  const { data: cfg } = useConfigPortal();

  /** Abre WhatsApp de FactorIA con el pedido y lo registra para que el CeCIP lo vea en el ERP */
  async function pedirInfo(servicio: string, detalle: string) {
    const empresa = socio ? nombreSocio(socio) : "mi comercio";
    const quien = socioUsuario?.nombre ? `${socioUsuario.nombre} de ${empresa}` : empresa;
    const texto =
      `¡Hola FactorIA! Soy ${quien}, socio del CeCIP${socio?.numero_socio ? ` (N° ${socio.numero_socio})` : ""}. ` +
      `Quiero información sobre: *${servicio}*.` + (detalle ? `\n${detalle}` : "") +
      "\n(Consulta enviada desde el Portal de Socios del CeCIP - ComercIA)";

    // Se abre primero (si no, el navegador puede bloquear la ventana)
    const abierto = abrirWhatsappFactoria(texto, cfg?.factoria_whatsapp);
    const { error } = await supabase.from("comercia_solicitudes").insert({
      socio_id: socioId,
      servicio,
      detalle: detalle || null,
      contacto_nombre: socioUsuario?.nombre || null,
      contacto_email: session?.user.email || null,
      contacto_telefono: socioUsuario?.telefono || socio?.whatsapp || null,
    });
    if (!abierto) {
      toast(error
        ? "No pudimos registrar tu consulta. Probá de nuevo o comunicate con el CeCIP."
        : "¡Consulta registrada! El equipo de ComercIA se va a comunicar con vos.", error ? "error" : "ok");
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-[#1e293b] bg-[#020617] text-[#e2e8f0] shadow-xl">
      {/* Portada */}
      <HeroComercia
        promo={contenido?.promociones[0]}
        onSumarme={() => pedirInfo("ComercIA · Quiero sumarme al convenio", "")}
        onVerPromos={() => {
          setTab("convenio");
          setTimeout(() => document.getElementById("comercia-promos")?.scrollIntoView({ behavior: "smooth" }), 50);
        }}
      />

      {/* Pestañas */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-[#1e293b] bg-[#0f172a] px-3 py-2.5 sm:px-6">
        {([
          ["convenio", "El convenio", Gift],
          ["ofertas", "Ofertas para tu comercio", Store],
          ["iec", "IEC Services", Wrench],
          ["cursos", "Cursos IEC", GraduationCap],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cx("flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold uppercase tracking-tight transition",
              tab === id ? "bg-[#3B82F6] text-white shadow shadow-[#3B82F6]/30" : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white")}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {isLoading || !contenido ? <Loading /> : (
          <>
            {tab === "convenio" && (
              <ConvenioComercia promociones={contenido.promociones} bloques={contenido.convenio} novedades={contenido.novedades} onPedir={pedirInfo}
                urlAdhesion={cfg?.comercia_url_adhesion || "https://iec-ia.com.ar/formulariofactoria.html"} />
            )}
            {tab === "ofertas" && <Ofertas ofertas={contenido.ofertas} onPedir={pedirInfo} />}
            {tab === "iec" && <IecServices servicios={contenido.servicios} onPedir={pedirInfo} />}
            {tab === "cursos" && <Cursos cursos={contenido.cursos} onPedir={pedirInfo} />}
          </>
        )}
      </div>

      {/* Adhesión (en "El convenio" ya está el llamado final) */}
      {tab !== "convenio" && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1e293b] bg-[#0f172a] px-5 py-4 sm:px-8">
        <div>
          <div className="text-sm font-bold text-white">¿Querés sumar tu comercio a ComercIA?</div>
          <div className="text-xs text-[#94a3b8]">Completá el formulario oficial de adhesión y recibí asesoramiento sin costo.</div>
        </div>
        <a href={cfg?.comercia_url_adhesion || "https://iec-ia.com.ar/formulariofactoria.html"} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#334155] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1e293b]">
          Formulario de adhesión <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>}
    </div>
  );
}

type Pedir = (servicio: string, detalle: string) => Promise<void>;


function BotonPedir({ onClick, children = "Pedir información" }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#3B82F6] px-4 py-2.5 text-sm font-bold text-white shadow shadow-[#3B82F6]/25 transition hover:bg-[#2563eb] active:scale-[0.99]">
      <MessageCircle className="h-4 w-4" /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function Ofertas({ ofertas, onPedir }: { ofertas: OfertaComercia[]; onPedir: Pedir }) {
  return (
    <>
      <h2 className="text-lg font-extrabold text-white">Ofertas disponibles para tu comercio</h2>
      <p className="mb-5 text-sm text-[#94a3b8]">Elegí la que te interese y te contactamos por WhatsApp desde FactorIA.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {ofertas.map((o) => <OfertaCard key={o.id} o={o} onPedir={onPedir} />)}
        {!ofertas.length && <p className="text-sm text-[#94a3b8]">Pronto vas a ver acá las ofertas disponibles.</p>}
      </div>
    </>
  );
}

function OfertaCard({ o, onPedir }: { o: OfertaComercia; onPedir: Pedir }) {
  const Icon = icono(o.icono);
  return (
    <div className={cx("flex flex-col rounded-2xl border bg-[#0f172a] p-5", o.destacada ? "border-[#3B82F6]/50" : "border-[#1e293b]")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/15 text-[#60A5FA]"><Icon className="h-5 w-5" /></div>
        <span className="rounded-full bg-[#1e293b] px-2.5 py-1 text-[11px] font-bold uppercase text-[#93c5fd]">{o.etiqueta}</span>
      </div>
      <h3 className="text-base font-bold text-white">{o.titulo}</h3>
      <div className="mt-3 grid gap-2 text-sm">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold uppercase text-[#fca5a5]"><XCircle className="h-3.5 w-3.5" /> Sin ComercIA</div>
          <p className="text-[#cbd5e1]">{o.problema}</p>
        </div>
        <div className="rounded-xl border border-[#3B82F6]/25 bg-[#3B82F6]/5 p-3">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-bold uppercase text-[#93c5fd]"><CheckCircle2 className="h-3.5 w-3.5" /> Con ComercIA</div>
          <p className="text-[#e2e8f0]">{o.solucion}</p>
        </div>
      </div>
      <ul className="mb-4 mt-3 flex-1 space-y-1 text-sm text-[#cbd5e1]">
        {o.incluye.map((i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" /> {i}</li>)}
      </ul>
      <BotonPedir onClick={() => onPedir(`ComercIA · ${o.titulo}`, "")} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function IecServices({ servicios, onPedir }: { servicios: ServicioIec[]; onPedir: Pedir }) {
  const [sel, setSel] = useState<ServicioIec | null>(null);
  const [subtipo, setSubtipo] = useState("");
  const [detalle, setDetalle] = useState("");
  const detalleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sel) detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sel]);

  function elegir(s: ServicioIec) {
    setSel(sel?.id === s.id ? null : s);
    setSubtipo(s.subtipos[0] || "");
    setDetalle("");
  }

  return (
    <>
      <h2 className="text-lg font-extrabold text-white">IEC Services</h2>
      <p className="mb-5 text-sm text-[#94a3b8]">Técnicos y profesionales verificados para tu comercio en Paraná. Elegí el servicio y contanos qué necesitás.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {servicios.map((s) => {
          const Icon = icono(s.icono);
          const activo = sel?.id === s.id;
          return (
            <button key={s.id} onClick={() => elegir(s)}
              className={cx("rounded-2xl border p-4 text-left transition",
                activo ? "border-[#3B82F6] bg-[#3B82F6]/10" : "border-[#1e293b] bg-[#0f172a] hover:border-[#334155]")}>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-[#fbbf24]"><Icon className="h-5 w-5" /></div>
              <div className="text-sm font-bold text-white">{s.nombre}</div>
              <div className="mt-0.5 text-xs text-[#94a3b8]">{s.subtitulo}</div>
            </button>
          );
        })}
      </div>

      {sel && (
        <div ref={detalleRef} className="mt-5 rounded-2xl border border-[#3B82F6]/40 bg-[#0f172a] p-5">
          <h3 className="text-base font-bold text-white">{sel.nombre}</h3>
          <p className="mt-1 text-sm text-[#cbd5e1]">{sel.descripcion}</p>
          <div className="mt-4 text-[11px] font-bold uppercase text-[#94a3b8]">¿Qué necesitás?</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {sel.subtipos.map((t) => (
              <button key={t} onClick={() => setSubtipo(t)}
                className={cx("rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                  subtipo === t ? "border-[#3B82F6] bg-[#3B82F6] text-white" : "border-[#334155] text-[#cbd5e1] hover:bg-[#1e293b]")}>
                {t}
              </button>
            ))}
          </div>
          <textarea rows={3} value={detalle} onChange={(e) => setDetalle(e.target.value)}
            placeholder="Contanos brevemente el problema o lo que querés hacer (opcional)"
            className="mt-4 w-full rounded-xl border border-[#334155] bg-[#020617] px-3 py-2 text-sm text-white outline-none placeholder:text-[#64748b] focus:border-[#3B82F6]" />
          <div className="mt-3 sm:max-w-xs">
            <BotonPedir onClick={() => onPedir(`IEC Services · ${sel.nombre}${subtipo ? ` (${subtipo})` : ""}`, detalle.trim())} />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Cursos({ cursos, onPedir }: { cursos: CursoIec[]; onPedir: Pedir }) {
  return (
    <>
      <h2 className="text-lg font-extrabold text-white">Cursos y capacitaciones IEC</h2>
      <p className="mb-5 text-sm text-[#94a3b8]">Formación técnica con certificación para vos o tu equipo. Pedí información o reservá tu cupo.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {cursos.map((c) => <CursoCard key={c.id} c={c} onPedir={onPedir} />)}
        {!cursos.length && <p className="text-sm text-[#94a3b8]">No hay cursos publicados por ahora.</p>}
      </div>
    </>
  );
}

function CursoCard({ c, onPedir }: { c: CursoIec; onPedir: Pedir }) {
  return (
    <div className="flex flex-col rounded-2xl border border-[#1e293b] bg-[#0f172a] p-5">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/15 text-[#c4b5fd]"><GraduationCap className="h-5 w-5" /></div>
      <h3 className="text-base font-bold text-white">{c.nombre}</h3>
      <p className="mt-0.5 text-sm text-[#94a3b8]">{c.subtitulo}</p>
      <div className="mt-3 grid gap-1.5 text-xs text-[#cbd5e1]">
        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#60A5FA]" /> {c.duracion} · {c.frecuencia}</span>
        <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-[#60A5FA]" /> {c.modalidad}</span>
        <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#60A5FA]" /> {c.lugar}</span>
      </div>
      <ul className="mb-4 mt-3 flex-1 space-y-1 text-sm text-[#cbd5e1]">
        {c.temario.map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34d399]" /> {t}</li>)}
      </ul>
      <div className="mb-4 rounded-xl bg-[#020617] p-3 text-xs text-[#94a3b8]">
        <b className="text-[#cbd5e1]">Salida laboral:</b> {c.salida_laboral}
        <br /><b className="text-[#cbd5e1]">Requisitos:</b> {c.requisitos}
      </div>
      <BotonPedir onClick={() => onPedir(`Curso IEC · ${c.nombre}`, "Quiero información y reservar cupo.")}>Pedir información / cupo</BotonPedir>
    </div>
  );
}
