import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { CreditCard, Receipt, ShoppingBag, ShoppingCart, Store, Tag } from "lucide-react";

/**
 * Animación de inicio de la pantalla de ingreso (ERP y Portal de Socios).
 *
 * Una calle comercial se arma (vidrieras con toldos que se despliegan y luces que se encienden),
 * de los locales salen bolsas, carritos, etiquetas y tickets, y aparece el logo del CeCIP.
 * De fondo, una red de comercios conectados sigue al puntero.
 *
 * Interactiva: parallax con el mouse/dedo, la red reacciona al puntero, las vidrieras responden
 * al pasar por encima y se saltea con un clic, una tecla o el botón "Saltar".
 * Con "reducir movimiento" activado en el sistema se muestra solo un fundido corto.
 */

const DURACION = 4200; // ms hasta que empieza a salir sola
const SALIDA = 650;

// Colores del logo
const CELESTE = "#5ec4ff";
const INDIGO = "#4a63b8";
const MARINO = "#0f3d75";

const LOCALES = [
  { x: 0, w: 104, h: 118, toldo: CELESTE, rubro: "Moda" },
  { x: 112, w: 92, h: 140, toldo: INDIGO, rubro: "Café" },
  { x: 212, w: 128, h: 124, toldo: MARINO, rubro: "Industria" },
  { x: 348, w: 92, h: 146, toldo: CELESTE, rubro: "Farmacia" },
  { x: 448, w: 112, h: 116, toldo: INDIGO, rubro: "Almacén" },
];

const ICONOS = [
  { Icono: ShoppingBag, desde: 52, dx: -150, dy: -250, delay: 1.15 },
  { Icono: Tag, desde: 158, dx: -60, dy: -300, delay: 1.3 },
  { Icono: ShoppingCart, desde: 276, dx: 10, dy: -330, delay: 1.2 },
  { Icono: Receipt, desde: 394, dx: 80, dy: -290, delay: 1.4 },
  { Icono: CreditCard, desde: 504, dx: 160, dy: -240, delay: 1.25 },
  { Icono: Store, desde: 276, dx: -230, dy: -150, delay: 1.5 },
];

export function IntroCecip({ onFin }: { onFin: () => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const puntero = useRef({ x: -9999, y: -9999 });
  const [saliendo, setSaliendo] = useState(false);
  const reducido = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const salir = useCallback(() => setSaliendo(true), []);

  // Termina sola, o al tocar una tecla
  useEffect(() => {
    const t = setTimeout(salir, reducido ? 900 : DURACION);
    const tecla = () => salir();
    window.addEventListener("keydown", tecla);
    return () => { clearTimeout(t); window.removeEventListener("keydown", tecla); };
  }, [salir, reducido]);

  useEffect(() => {
    if (!saliendo) return;
    const t = setTimeout(onFin, SALIDA);
    return () => clearTimeout(t);
  }, [saliendo, onFin]);

  // Red de comercios conectados (fondo interactivo)
  useEffect(() => {
    if (reducido) return;
    const cv = lienzo.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let ancho = 0, alto = 0, raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const medir = () => {
      ancho = cv.clientWidth; alto = cv.clientHeight;
      cv.width = ancho * dpr; cv.height = alto * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    medir();
    const cantidad = Math.round(Math.min(70, (ancho * alto) / 16000));
    const nodos = Array.from({ length: cantidad }, () => ({
      x: Math.random() * ancho, y: Math.random() * alto,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      r: 1.5 + Math.random() * 2.2, local: Math.random() < 0.18,
    }));
    const inicio = performance.now();
    const cuadro = (t: number) => {
      const aparicion = Math.min(1, (t - inicio) / 900);
      ctx.clearRect(0, 0, ancho, alto);
      const { x: px, y: py } = puntero.current;
      for (const n of nodos) {
        // El puntero atrae suavemente a los comercios cercanos
        const dx = px - n.x, dy = py - n.y, d = Math.hypot(dx, dy);
        if (d < 180 && d > 1) { n.vx += (dx / d) * 0.02; n.vy += (dy / d) * 0.02; }
        n.vx *= 0.985; n.vy *= 0.985;
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > ancho) n.vx *= -1;
        if (n.y < 0 || n.y > alto) n.vy *= -1;
      }
      for (let i = 0; i < nodos.length; i++) {
        for (let j = i + 1; j < nodos.length; j++) {
          const a = nodos[i], b = nodos[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.strokeStyle = `rgba(74, 99, 184, ${(1 - d / 130) * 0.28 * aparicion})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const n = nodos[i];
        const dp = Math.hypot(px - n.x, py - n.y);
        if (dp < 180) {
          ctx.strokeStyle = `rgba(94, 196, 255, ${(1 - dp / 180) * 0.6 * aparicion})`;
          ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(px, py); ctx.stroke();
        }
        ctx.fillStyle = n.local ? `rgba(94, 196, 255, ${0.9 * aparicion})` : `rgba(74, 99, 184, ${0.55 * aparicion})`;
        if (n.local) {
          // algunos nodos son "locales": un cuadradito con toldo
          ctx.fillRect(n.x - n.r * 1.4, n.y - n.r, n.r * 2.8, n.r * 2.2);
          ctx.fillStyle = `rgba(15, 61, 117, ${0.8 * aparicion})`;
          ctx.fillRect(n.x - n.r * 1.7, n.y - n.r * 1.7, n.r * 3.4, n.r * 0.8);
        } else {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      raf = requestAnimationFrame(cuadro);
    };
    raf = requestAnimationFrame(cuadro);
    window.addEventListener("resize", medir);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", medir); };
  }, [reducido]);

  function mover(e: PointerEvent<HTMLDivElement>) {
    puntero.current = { x: e.clientX, y: e.clientY };
    const r = raiz.current;
    if (!r) return;
    r.style.setProperty("--mx", String(e.clientX / window.innerWidth - 0.5));
    r.style.setProperty("--my", String(e.clientY / window.innerHeight - 0.5));
  }

  return (
    <div
      ref={raiz}
      role="dialog"
      aria-label="Bienvenida CeCIP Paraná"
      onPointerMove={mover}
      onPointerLeave={() => (puntero.current = { x: -9999, y: -9999 })}
      onClick={salir}
      className={`intro-cecip ${saliendo ? "intro-sale" : ""} ${reducido ? "intro-reducida" : ""}`}
    >
      <style>{CSS}</style>
      <canvas ref={lienzo} className="intro-red" aria-hidden />
      <div className="intro-halo" aria-hidden />

      <div className="intro-escena">
        {/* Logo */}
        <div className="intro-capa" style={{ "--f": 14 } as CSSProperties}>
          <div className="intro-logo">
            <img src="/logo.png" alt="CeCIP · Centro Comercial e Industrial de Paraná" draggable={false} />
            <span className="intro-brillo" aria-hidden />
          </div>
          <p className="intro-lema">Conectando comercios, impulsando Paraná</p>
        </div>

        {/* Calle comercial */}
        <div className="intro-capa intro-calle-cont" style={{ "--f": -10 } as CSSProperties}>
          <div className="intro-iconos" aria-hidden>
            {ICONOS.map(({ Icono, desde, dx, dy, delay }, i) => (
              <span key={i} className="intro-icono"
                style={{ left: desde, "--dx": `${dx}px`, "--dy": `${dy}px`, animationDelay: `${delay}s` } as CSSProperties}>
                <Icono className="h-5 w-5" />
              </span>
            ))}
          </div>
          <svg viewBox="-10 0 580 170" className="intro-calle" aria-hidden>
            {LOCALES.map((l, i) => {
              const y = 160 - l.h;
              const tiras = Math.floor(l.w / 13);
              return (
                <g key={i} className="intro-local" style={{ animationDelay: `${0.15 + i * 0.12}s` } as CSSProperties}>
                  <rect x={l.x} y={y} width={l.w} height={l.h} rx="6" className="intro-fachada" />
                  <rect x={l.x + 8} y={y + 8} width={l.w - 16} height="12" rx="3" className="intro-cartel" />
                  <text x={l.x + l.w / 2} y={y + 17.5} textAnchor="middle" className="intro-rubro">{l.rubro}</text>
                  {/* Toldo a rayas que se despliega */}
                  <g className="intro-toldo" style={{ animationDelay: `${0.55 + i * 0.12}s`, transformOrigin: `${l.x}px ${y + 26}px` } as CSSProperties}>
                    {Array.from({ length: tiras }, (_, k) => (
                      <path key={k}
                        d={`M${l.x - 4 + (k * (l.w + 8)) / tiras} ${y + 26} h${(l.w + 8) / tiras} v14 a${(l.w + 8) / tiras / 2} 6 0 0 1 -${(l.w + 8) / tiras} 0 z`}
                        fill={k % 2 ? "#ffffff" : l.toldo} />
                    ))}
                  </g>
                  {/* Vidriera que se enciende */}
                  <rect x={l.x + 10} y={y + 52} width={l.w * 0.5} height={l.h - 62} rx="4" className="intro-vidriera"
                    style={{ animationDelay: `${0.9 + i * 0.15}s` } as CSSProperties} />
                  <rect x={l.x + l.w * 0.5 + 16} y={y + 64} width={l.w * 0.5 - 26} height={l.h - 64} rx="3" className="intro-puerta" />
                </g>
              );
            })}
            <rect x="-10" y="160" width="580" height="6" rx="3" className="intro-vereda" />
          </svg>
        </div>
      </div>

      <div className="intro-pie">
        <span>Tocá o presioná una tecla para continuar</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); salir(); }}>Saltar</button>
      </div>
    </div>
  );
}

const CSS = `
.intro-cecip {
  --mx: 0; --my: 0;
  position: fixed; inset: 0; z-index: 100; overflow: hidden; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(1200px 700px at 50% 35%, #ffffff 0%, #eef4fb 55%, #d6e4f5 100%);
  transition: opacity ${SALIDA}ms ease, transform ${SALIDA}ms cubic-bezier(.7,0,.3,1), filter ${SALIDA}ms ease;
}
.intro-sale { opacity: 0; transform: scale(1.06); filter: blur(6px); pointer-events: none; }
.intro-red { position: absolute; inset: 0; width: 100%; height: 100%; }
.intro-halo {
  position: absolute; width: 620px; height: 620px; border-radius: 9999px; pointer-events: none;
  background: radial-gradient(circle, rgba(94,196,255,.28), rgba(94,196,255,0) 65%);
  transform: translate(calc(var(--mx) * 60px), calc(var(--my) * 60px - 40px));
  animation: intro-pulso 3.2s ease-in-out infinite;
}
.intro-escena { position: relative; display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 0 16px; width: 600px; max-width: 100%; }
@media (min-width: 1100px) and (min-height: 720px) { .intro-escena { zoom: 1.3; } }
.intro-capa { transform: translate(calc(var(--mx) * var(--f) * 1px), calc(var(--my) * var(--f) * 1px)); transition: transform .25s ease-out; display: flex; flex-direction: column; align-items: center; width: 100%; }
.intro-logo { position: relative; overflow: hidden; border-radius: 22px; background: #fff; padding: 6px 18px;
  box-shadow: 0 20px 50px -18px rgba(15,61,117,.35), 0 0 0 1px rgba(15,61,117,.06);
  animation: intro-logo 1s cubic-bezier(.2,.9,.25,1.2) 1.55s both; }
.intro-logo { padding: 16px 22px; }
/* el PNG trae mucho margen blanco: se recorta con márgenes negativos (en % del ancho) */
.intro-logo img { display: block; width: min(340px, 70vw); height: auto; user-select: none; margin: -14% -5% -18%; }
.intro-brillo { position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.95) 50%, transparent 65%);
  transform: translateX(-120%); animation: intro-brillo 1.1s ease-in-out 2.45s both; }
.intro-lema { margin-top: 14px; font-weight: 600; letter-spacing: .02em; color: ${MARINO}; font-size: clamp(14px, 2.4vw, 18px);
  animation: intro-sube .7s ease-out 2.35s both; text-align: center; }
.intro-calle-cont { position: relative; }
.intro-calle { width: 100%; max-width: 560px; overflow: visible; }
.intro-local { animation: intro-local .7s cubic-bezier(.2,.9,.3,1.15) both; transform-box: fill-box; transform-origin: bottom; cursor: pointer; }
.intro-local:hover { animation: none; transform: translateY(-6px); transition: transform .2s; }
.intro-local:hover .intro-vidriera { fill: #fff3b0; }
.intro-fachada { fill: #ffffff; stroke: rgba(15,61,117,.14); stroke-width: 1.5; }
.intro-cartel { fill: #eef4fb; }
.intro-rubro { font: 700 8px system-ui, sans-serif; fill: ${MARINO}; letter-spacing: .04em; }
.intro-toldo { animation: intro-toldo .55s cubic-bezier(.3,1.4,.5,1) both; }
.intro-vidriera { fill: #dbe7f5; animation: intro-luz .5s steps(2, end) both; }
.intro-puerta { fill: ${INDIGO}; opacity: .85; }
.intro-vereda { fill: rgba(15,61,117,.18); }
.intro-iconos { position: absolute; left: 50%; bottom: 40px; width: 560px; max-width: 100%; transform: translateX(-50%); pointer-events: none; }
.intro-icono { position: absolute; bottom: 0; display: grid; place-items: center; width: 40px; height: 40px; margin-left: -20px; border-radius: 12px;
  background: #fff; color: ${INDIGO}; box-shadow: 0 10px 24px -10px rgba(15,61,117,.45);
  animation: intro-vuela 1.6s cubic-bezier(.25,.8,.3,1) both; }
.intro-pie { position: absolute; bottom: 22px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 14px;
  font-size: 12px; color: rgba(15,61,117,.65); animation: intro-sube .6s ease-out 1.2s both; padding: 0 16px; flex-wrap: wrap; }
.intro-pie button { cursor: pointer; border-radius: 9999px; padding: 6px 14px; font-weight: 600; color: ${MARINO};
  background: rgba(255,255,255,.8); box-shadow: 0 0 0 1px rgba(15,61,117,.15); }
.intro-pie button:hover { background: #fff; }

@keyframes intro-pulso { 0%, 100% { opacity: .75 } 50% { opacity: 1 } }
@keyframes intro-local { from { opacity: 0; transform: translateY(60px) scaleY(.6) } to { opacity: 1; transform: none } }
@keyframes intro-toldo { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes intro-luz { from { fill: #dbe7f5 } to { fill: #fff6c7 } }
@keyframes intro-vuela {
  0% { opacity: 0; transform: translate(0, 0) scale(.4) rotate(-20deg) }
  15% { opacity: 1 }
  70% { opacity: 1; transform: translate(var(--dx), var(--dy)) scale(1) rotate(8deg) }
  100% { opacity: 0; transform: translate(calc(var(--dx) * .2), calc(var(--dy) - 60px)) scale(.3) }
}
@keyframes intro-logo { from { opacity: 0; transform: translateY(24px) scale(.82); clip-path: inset(0 100% 0 0 round 22px) } to { opacity: 1; transform: none; clip-path: inset(0 0 0 0 round 22px) } }
@keyframes intro-brillo { to { transform: translateX(120%) } }
@keyframes intro-sube { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }

.intro-reducida *, .intro-reducida { animation-duration: .01ms !important; animation-delay: 0s !important; }
.intro-reducida .intro-icono { display: none; }

@media (max-width: 640px) {
  .intro-icono { width: 34px; height: 34px; }
  .intro-iconos { bottom: 24px; }
}
.dark .intro-cecip { background: radial-gradient(1200px 700px at 50% 35%, #12305a 0%, #0b2e59 50%, #081f3d 100%); }
.dark .intro-lema { color: #d6e4f5; }
.dark .intro-pie { color: rgba(214,228,245,.7); }
.dark .intro-pie button { color: #fff; background: rgba(255,255,255,.1); }
`;
