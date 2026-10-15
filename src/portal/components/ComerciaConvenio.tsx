import { useState, type ReactNode } from "react";
import {
  ArrowRight, BadgePercent, Briefcase, Camera, CheckCircle2, ChevronDown, Clock, ExternalLink, Flame, Gift, Globe,
  GraduationCap, Hammer, Megaphone, MessageCircle, Rocket, Search, Shield, Smartphone, Sparkles, Store, Truck, Users, Wrench, Zap,
} from "lucide-react";
import { cx } from "../../components/ui";
import type { BloqueConvenio, PromocionComercia } from "../../../shared/comercia";

/*
 * Página del convenio ComercIA (CeCIP + FactorIA + IEC Services) con estética de landing:
 * pensada para que el comercio entienda en segundos qué gana y se anime a sumarse.
 * Colores fijos (no la paleta del portal) para verse igual en modo claro u oscuro.
 */

const ICONOS: Record<string, typeof Store> = {
  Store, Zap, Search, Wrench, BadgePercent, Shield, Flame, Megaphone, GraduationCap, Hammer, Smartphone, Globe, Camera, Truck,
  Sparkles, Briefcase, MessageCircle, Gift, Rocket, Users,
};
const Icono = ({ nombre, className }: { nombre: string; className?: string }) => {
  const I = ICONOS[nombre] || Sparkles;
  return <I className={className} />;
};

const fechaLarga = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long" });

const diasRestantes = (d: string) => Math.ceil((new Date(d + "T23:59:59").getTime() - Date.now()) / 86400000);

type Pedir = (servicio: string, detalle: string) => Promise<void>;

/** Tamaño del texto grande según su largo ("25% OFF" enorme, "ACCESO PREFERENCIAL" más chico) */
const tamDescuento = (t: string, grande = false) =>
  t.length <= 8 ? (grande ? "text-5xl sm:text-6xl" : "text-5xl") : t.length <= 13 ? (grande ? "text-4xl sm:text-5xl" : "text-4xl") : (grande ? "text-3xl sm:text-4xl" : "text-3xl");

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

export function HeroComercia({ promo, onSumarme, onVerPromos }: {
  promo?: PromocionComercia; onSumarme: () => void; onVerPromos: () => void;
}) {
  return (
    <div className="relative overflow-hidden border-b border-[#1e293b] px-5 py-8 sm:px-8 sm:py-10">
      {/* Fondo: brillos y grilla */}
      <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 animate-pulse rounded-full bg-[#3B82F6]/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-0 h-72 w-72 animate-pulse rounded-full bg-purple-600/20 blur-3xl [animation-delay:1.5s]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#94a3b8_1px,transparent_1px),linear-gradient(90deg,#94a3b8_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <img src="/comercia-logo.png" alt="ComercIA" className="h-12 w-12 rounded-2xl object-contain" />
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#3B82F6]/40 bg-[#3B82F6]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#93c5fd]">
              <Sparkles className="h-3 w-3" /> Convenio CeCIP · Instituto IEC
            </div>
          </div>
          <h1 className="mt-5 text-3xl font-black leading-[1.1] text-white sm:text-5xl">
            Comerc<span className="text-[#60A5FA]">IA</span> Inteligente:{" "}
            <span className="bg-gradient-to-r from-[#60A5FA] via-[#a78bfa] to-[#f472b6] bg-clip-text text-transparent">tu comercio al futuro</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-[#94a3b8]">
            El programa integral del <b className="text-white">Instituto IEC</b> para transformar tu comercio con <b className="text-white">inteligencia artificial</b>,
            automatización, <b className="text-white">ventas online</b> y formación aplicada: trabajá con más eficiencia, reducí costos y vendé más.
            Con condiciones preferenciales por ser socio del CeCIP.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onSumarme}
              className="group inline-flex items-center gap-2 rounded-2xl bg-[#3B82F6] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#3B82F6]/40 transition hover:bg-[#2563eb] hover:shadow-[#3B82F6]/60 active:scale-[0.98]">
              <Rocket className="h-4 w-4" /> Quiero sumarme
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
            <button onClick={onVerPromos}
              className="inline-flex items-center gap-2 rounded-2xl border border-[#334155] bg-[#0f172a]/70 px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1e293b]">
              <Gift className="h-4 w-4 text-[#f472b6]" /> Ver promociones
            </button>
          </div>
        </div>

        {/* Promo destacada */}
        {promo ? (
          <div className="relative rounded-3xl bg-gradient-to-br from-[#3B82F6] via-[#a855f7] to-[#f472b6] p-[2px] shadow-2xl shadow-purple-900/40">
            <div className="rounded-[22px] bg-[#0b1224] p-6">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#f9a8d4]">
                <Gift className="h-3.5 w-3.5" /> Promo para socios
              </div>
              {promo.descuento && (
                <div className={cx("mt-2 break-words bg-gradient-to-r from-[#ffffff] to-[#c4b5fd] bg-clip-text font-black leading-none text-transparent", tamDescuento(promo.descuento, true))}>
                  {promo.descuento}
                </div>
              )}
              <div className="mt-3 text-lg font-bold text-white">{promo.titulo}</div>
              {promo.descripcion && <p className="mt-1 text-sm text-[#94a3b8]">{promo.descripcion}</p>}
              <button onClick={onVerPromos} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[#93c5fd] hover:text-white">
                Ver todas las promociones <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Cifras */}
      <div className="relative mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icono: Rocket, valor: "6", texto: "ejes complementarios" },
          { icono: Gift, valor: "12", texto: "beneficios incluidos" },
          { icono: Sparkles, valor: "1", texto: "ecosistema integrado" },
          { icono: Users, valor: "Mensual", texto: "simposios tecnológicos" },
        ].map((c) => (
          <div key={c.valor} className="rounded-2xl border border-[#1e293b] bg-[#0f172a]/80 p-4 backdrop-blur">
            <c.icono className="h-5 w-5 text-[#60A5FA]" />
            <div className="mt-2 text-2xl font-black text-white">{c.valor}</div>
            <div className="text-xs text-[#94a3b8]">{c.texto}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página del convenio
// ---------------------------------------------------------------------------

export function ConvenioComercia({ promociones, bloques, novedades, urlAdhesion, onPedir }: {
  promociones: PromocionComercia[]; bloques: BloqueConvenio[]; urlAdhesion: string; onPedir: Pedir;
  novedades: { id: string; titulo: string; cuerpo: string; imagen_url?: string | null; created_at: string }[];
}) {
  const de = (t: BloqueConvenio["tipo"]) => bloques.filter((b) => b.tipo === t);
  const partes = de("parte"), ejes = de("eje"), beneficios = de("beneficio"), pasos = de("paso"), preguntas = de("pregunta");

  return (
    <div className="space-y-14">
      {/* Novedades */}
      {novedades.length > 0 && (
        <section>
          <Titulo etiqueta="Últimas noticias" titulo="Novedades de ComercIA" />
          <div className="space-y-3">
            {novedades.map((n) => (
              <div key={n.id} className="relative overflow-hidden rounded-2xl border border-[#3B82F6]/30 bg-gradient-to-r from-[#0f1d3d] to-[#0f172a] p-5">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#60A5FA]">
                  <Megaphone className="h-3.5 w-3.5" /> {new Date(n.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                </div>
                <div className="mt-1 text-lg font-bold text-white">{n.titulo}</div>
                <p className="mt-1 whitespace-pre-line text-sm text-[#cbd5e1]">{n.cuerpo}</p>
                {n.imagen_url && <img src={n.imagen_url} alt="" className="mt-3 max-h-80 rounded-xl object-contain" />}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Promociones */}
      <section id="comercia-promos" className="scroll-mt-28">
        <Titulo etiqueta="Exclusivo socios" titulo="Promociones del convenio" texto="Beneficios pensados para que tu comercio dé el salto digital." />
        {promociones.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {promociones.map((p) => <TarjetaPromo key={p.id} p={p} onPedir={onPedir} />)}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#334155] p-6 text-center text-sm text-[#94a3b8]">Pronto vas a ver acá nuevas promociones.</p>
        )}
      </section>

      {/* Los ejes del programa */}
      {ejes.length > 0 && (
        <section>
          <Titulo etiqueta="El programa" titulo={`Los ${ejes.length} ejes de ComercIA Inteligente`}
            texto="Funcionan por separado, pero combinados te dan una ventaja competitiva sostenida." />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ejes.map((e, i) => (
              <div key={e.id} className="relative overflow-hidden rounded-2xl border border-[#1e293b] bg-gradient-to-br from-[#0f172a] to-[#131c38] p-5 transition hover:-translate-y-0.5 hover:border-[#a855f7]/50">
                <div className="pointer-events-none absolute -right-3 -top-6 select-none text-[88px] font-black leading-none text-[#ffffff]/[0.04]">{i + 1}</div>
                <div className="relative flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#a855f7] text-white shadow-lg shadow-purple-900/30">
                    <Icono nombre={e.icono} className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-wider text-[#a78bfa]">Eje {i + 1}</div>
                    <div className="text-base font-bold leading-tight text-white">{e.titulo}</div>
                  </div>
                </div>
                {e.texto && <p className="relative mt-3 text-sm text-[#94a3b8]">{e.texto}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Qué implica */}
      {beneficios.length > 0 && (
        <section>
          <Titulo etiqueta="El convenio" titulo="Qué implica para tu comercio" texto="Todo lo que ganás al sumarte a ComercIA." />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {beneficios.map((b, i) => (
              <div key={b.id} className="group rounded-2xl border border-[#1e293b] bg-[#0f172a] p-5 transition hover:-translate-y-0.5 hover:border-[#3B82F6]/50">
                <div className={cx("mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg",
                  ["from-[#3B82F6] to-[#6366f1]", "from-[#a855f7] to-[#ec4899]", "from-[#f59e0b] to-[#ef4444]", "from-[#10b981] to-[#06b6d4]"][i % 4])}>
                  <Icono nombre={b.icono} className="h-5 w-5" />
                </div>
                <div className="text-base font-bold text-white">{b.titulo}</div>
                {b.texto && <p className="mt-1 text-sm text-[#94a3b8]">{b.texto}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quiénes participan */}
      {partes.length > 0 && (
        <section>
          <Titulo etiqueta="Una alianza" titulo="Quiénes participan" />
          <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            {partes.map((p, i) => (
              <div key={p.id} className="contents">
                {i > 0 && <div className="self-center text-2xl font-black text-[#475569]">+</div>}
                <div className="flex-1 rounded-2xl border border-[#1e293b] bg-gradient-to-br from-[#0f172a] to-[#111a33] p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6]/15 text-[#60A5FA]"><Icono nombre={p.icono} className="h-5 w-5" /></div>
                    <div className="text-lg font-black text-white">{p.titulo}</div>
                  </div>
                  {p.texto && <p className="mt-2 text-sm text-[#94a3b8]">{p.texto}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cómo funciona */}
      {pasos.length > 0 && (
        <section>
          <Titulo etiqueta="Simple" titulo="Cómo sumarte" />
          <ol className="relative grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="pointer-events-none absolute left-6 right-6 top-6 hidden h-0.5 bg-gradient-to-r from-[#3B82F6] via-[#a855f7] to-[#f472b6] opacity-40 lg:block" />
            {pasos.map((p, i) => (
              <li key={p.id} className="relative">
                <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#3B82F6] to-[#a855f7] text-lg font-black text-white shadow-lg shadow-[#3B82F6]/30">
                  {i + 1}
                </div>
                <div className="mt-3 text-base font-bold text-white">{p.titulo}</div>
                {p.texto && <p className="mt-1 text-sm text-[#94a3b8]">{p.texto}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Preguntas frecuentes */}
      {preguntas.length > 0 && (
        <section>
          <Titulo etiqueta="Dudas" titulo="Preguntas frecuentes" />
          <div className="space-y-2">
            {preguntas.map((q) => <Pregunta key={q.id} titulo={q.titulo}>{q.texto}</Pregunta>)}
          </div>
        </section>
      )}

      {/* Llamado final */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1d4ed8] via-[#7c3aed] to-[#db2777] p-8 text-center sm:p-10">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <Rocket className="mx-auto h-10 w-10 text-white" />
        <h3 className="mt-3 text-2xl font-black text-white sm:text-3xl">Sumá tu comercio a ComercIA Inteligente</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-white/80">Una sola adhesión te conecta con todo el ecosistema de transformación tecnológica del Instituto IEC.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={() => onPedir("ComercIA · Quiero sumarme al convenio", "")}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#ffffff] px-5 py-3 text-sm font-black text-[#1e1b4b] shadow-xl transition hover:scale-[1.02]">
            <MessageCircle className="h-4 w-4" /> Quiero que me asesoren
          </button>
          <a href={urlAdhesion} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/40 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">
            Formulario de adhesión <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </section>
    </div>
  );
}

function Titulo({ etiqueta, titulo, texto }: { etiqueta: string; titulo: string; texto?: string }) {
  return (
    <div className="mb-6">
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#60A5FA]">{etiqueta}</div>
      <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">{titulo}</h2>
      {texto && <p className="mt-1 text-sm text-[#94a3b8]">{texto}</p>}
    </div>
  );
}

function TarjetaPromo({ p, onPedir }: { p: PromocionComercia; onPedir: Pedir }) {
  const dias = p.vigente_hasta ? diasRestantes(p.vigente_hasta) : null;
  return (
    <div className={cx("rounded-3xl p-[2px] transition hover:-translate-y-1",
      p.destacada ? "bg-gradient-to-br from-[#3B82F6] via-[#a855f7] to-[#f472b6] shadow-xl shadow-purple-900/30" : "bg-[#1e293b]")}>
      <div className="flex h-full flex-col rounded-[22px] bg-[#0b1224] p-6">
        <div className="flex items-start justify-between gap-2">
          {p.destacada ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#f59e0b] to-[#ef4444] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
              <Sparkles className="h-3 w-3" /> Destacada
            </span>
          ) : <span />}
          {dias !== null && (
            <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
              dias <= 7 ? "bg-red-500/15 text-[#fca5a5]" : "bg-[#1e293b] text-[#cbd5e1]")}>
              <Clock className="h-3 w-3" /> {dias <= 7 ? `¡Quedan ${dias} día${dias === 1 ? "" : "s"}!` : `Hasta el ${fechaLarga(p.vigente_hasta!)}`}
            </span>
          )}
        </div>
        {p.descuento && (
          <div className={cx("mt-4 break-words bg-gradient-to-r from-[#60A5FA] via-[#c084fc] to-[#f472b6] bg-clip-text font-black leading-none tracking-tight text-transparent", tamDescuento(p.descuento))}>
            {p.descuento}
          </div>
        )}
        <h3 className="mt-3 text-lg font-bold leading-snug text-white">{p.titulo}</h3>
        {p.descripcion && <p className="mt-2 flex-1 text-sm text-[#cbd5e1]">{p.descripcion}</p>}
        {p.condiciones && (
          <p className="mt-3 flex gap-1.5 text-xs text-[#64748b]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.condiciones}</p>
        )}
        <button onClick={() => onPedir(`Promoción ComercIA · ${p.titulo}`, "Quiero aprovechar esta promoción.")}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ffffff] py-3 text-sm font-black text-[#0b1224] transition hover:bg-[#e0e7ff] active:scale-[0.99]">
          <Gift className="h-4 w-4" /> ¡La quiero!
        </button>
      </div>
    </div>
  );
}

function Pregunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className={cx("rounded-2xl border bg-[#0f172a] transition", abierta ? "border-[#3B82F6]/50" : "border-[#1e293b]")}>
      <button onClick={() => setAbierta(!abierta)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="font-bold text-white">{titulo}</span>
        <ChevronDown className={cx("h-5 w-5 shrink-0 text-[#60A5FA] transition", abierta && "rotate-180")} />
      </button>
      {abierta && children && <p className="px-5 pb-4 text-sm text-[#94a3b8]">{children}</p>}
    </div>
  );
}
