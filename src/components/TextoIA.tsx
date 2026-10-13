import { Fragment, type ReactNode } from "react";

/**
 * Muestra texto con formato simple (párrafos, listas con "- " o "* ", **negritas** y links)
 * sin usar HTML, así una respuesta de la IA nunca puede inyectar código en la página.
 */
export function TextoIA({ texto, className }: { texto: string; className?: string }) {
  const bloques = texto.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={className}>
      {bloques.map((b, i) => {
        const lineas = b.split("\n").filter((l) => l.trim());
        const esLista = lineas.length > 0 && lineas.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (esLista) {
          return (
            <ul key={i} className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">
              {lineas.map((l, j) => <li key={j}>{enLinea(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>)}
            </ul>
          );
        }
        return (
          <p key={i} className="mb-2 last:mb-0">
            {lineas.map((l, j) => (
              <Fragment key={j}>{j > 0 && <br />}{enLinea(l.replace(/^#+\s*/, ""))}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function enLinea(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).filter(Boolean).map((parte, i) => {
    if (parte.startsWith("**") && parte.endsWith("**")) return <strong key={i}>{parte.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(parte)) {
      return <a key={i} href={parte} target="_blank" rel="noopener noreferrer" className="break-all underline">{parte}</a>;
    }
    return parte.replace(/\*/g, "");
  });
}
