import { ArrowUpRight, Bot, Code2, GraduationCap, Lock, ShieldCheck } from "lucide-react";

/**
 * Bloque de respaldo (Portal → ComercIA; los blancos van en style para que no los cambie el modo oscuro del Portal): quién está detrás de ComercIA (Instituto IEC), con una captura real de su sitio
 * dentro de un marco de navegador. Textos tomados de www.iec-ia.com.ar.
 */
const URL_IEC = "https://www.iec-ia.com.ar";

const PILARES = [
  { icono: GraduationCap, etiqueta: "Capacitación", texto: "Robótica e IA" },
  { icono: Code2, etiqueta: "Desarrollo", texto: "La FactorIA" },
  { icono: Bot, etiqueta: "Implementación", texto: "Inteligencia Operativa" },
];

export default function RespaldoIEC({ logo = "/logo-iec.webp", captura = "/iec-sitio.webp" }: { logo?: string; captura?: string }) {
  return (
    <div className="ri tema-fijo relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#040b1d] p-6 text-white sm:p-10">
      <style>{CSS}</style>
      <div className="pointer-events-none absolute -left-24 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-[#00a3e0]/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-violet-600/25 blur-3xl" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="flex items-center gap-4">
            <span className="ri-logo relative grid h-16 w-16 shrink-0 place-items-center rounded-full p-1.5 shadow-[0_0_40px_rgba(0,163,224,.45)]" style={{ background: "#fff" }}>
              <img src={logo} alt="Instituto IEC" className="h-full w-full object-contain" />
              <span className="ri-orbita absolute -inset-2 rounded-full border border-dashed border-[#7dd3fc]/50" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              <ShieldCheck size={13} /> Respaldo académico y tecnológico
            </span>
          </div>
          <h3 className="font-display mt-5 text-2xl font-bold leading-tight sm:text-4xl">
            Detrás de ComercIA está el <span className="ri-degradado">Instituto IEC</span>
          </h3>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#cbd5e1] sm:text-base">
            El Instituto privado en Economía del Conocimiento de Paraná: <b className="text-white">forma, desarrolla, implementa y mide</b>.
            Capacita en robótica e inteligencia artificial e implementa Inteligencia Operativa en empresas e instituciones.
          </p>
          <ul className="mt-6 grid gap-2.5 sm:grid-cols-3">
            {PILARES.map(({ icono: Icono, etiqueta, texto }, i) => (
              <li key={etiqueta} className="ri-pilar rounded-2xl border border-white/10 bg-white/[.05] p-3.5" style={{ animationDelay: `${i * 0.12}s` }}>
                <Icono size={18} className="text-[#7dd3fc]" />
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#7dd3fc]">{etiqueta}</div>
                <div className="text-sm font-semibold">{texto}</div>
              </li>
            ))}
          </ul>
          <a href={URL_IEC} target="_blank" rel="noopener noreferrer"
            className="ri-cta group mt-7 inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold transition hover:-translate-y-0.5" style={{ background: "#fff", color: "#0c2356" }}>
            Conocé el Instituto IEC <ArrowUpRight size={17} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* el sitio real del IEC en un navegador */}
        <a href={URL_IEC} target="_blank" rel="noopener noreferrer" className="ri-navegador group block" aria-label="Abrir el sitio del Instituto IEC">
          <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#0b1224] shadow-[0_40px_80px_-30px_rgba(0,0,0,.9),0_0_60px_-10px_rgba(0,163,224,.35)] transition duration-500 group-hover:shadow-[0_40px_80px_-30px_rgba(0,0,0,.9),0_0_80px_-5px_rgba(0,163,224,.55)]">
            <div className="flex items-center gap-3 border-b border-white/10 bg-[#111a30] px-4 py-2.5">
              <span className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></span>
              <span className="flex flex-1 items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1 text-xs text-[#cbd5e1]">
                <Lock size={11} className="text-emerald-400" /> iec-ia.com.ar
              </span>
              <ArrowUpRight size={15} className="text-[#94a3b8] transition group-hover:text-white" />
            </div>
            <div className="relative aspect-[16/10] overflow-hidden">
              <img src={captura} alt="Sitio web del Instituto IEC" loading="lazy" className="ri-captura h-full w-full object-cover object-top" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#040b1d]/50 via-transparent to-transparent" />
              <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-[#0c2356] opacity-0 shadow-lg transition group-hover:opacity-100">
                Visitar el sitio <ArrowUpRight size={13} />
              </span>
            </div>
          </div>
        </a>
      </div>
    </div>
  );
}

const CSS = `
.ri-degradado { background: linear-gradient(90deg, #7dd3fc, #00a3e0 45%, #a78bfa); -webkit-background-clip: text; background-clip: text; color: transparent; }
.ri-orbita { animation: ri-gira 14s linear infinite; }
@keyframes ri-gira { to { transform: rotate(360deg); } }
.ri-navegador { transform: perspective(1400px) rotateY(-8deg) rotateX(3deg); transition: transform .6s cubic-bezier(.2,.8,.2,1); }
.ri-navegador:hover { transform: perspective(1400px) rotateY(0) rotateX(0) translateY(-4px); }
.ri-captura { animation: ri-paneo 16s ease-in-out infinite alternate; }
@keyframes ri-paneo { from { transform: scale(1.02); } to { transform: scale(1.1) translate(-2%, -2%); } }
.ri-cta { box-shadow: 0 14px 34px -14px rgba(255,255,255,.5); }
.ri-pilar { animation: ri-sube .6s cubic-bezier(.2,.9,.3,1) both; }
@keyframes ri-sube { from { opacity: 0; transform: translateY(10px); } }
@media (max-width: 1023px) { .ri-navegador, .ri-navegador:hover { transform: none; } }
@media (prefers-reduced-motion: reduce) { .ri *, .ri { animation: none !important; } }
`;
