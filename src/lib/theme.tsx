import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cx } from "../components/ui";

/** Tema guardado por el usuario; si no eligió ninguno se sigue el del sistema operativo. */
type Tema = "light" | "dark";
const KEY = "cecip-tema";

const sistema = (): Tema => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function guardado(): Tema | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function aplicar(t: Tema) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(() => guardado() ?? sistema());

  useEffect(() => {
    aplicar(tema);
  }, [tema]);

  // Si el usuario no eligió, acompaña los cambios del sistema
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => !guardado() && setTema(sistema());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const alternar = () => {
    const nuevo: Tema = tema === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, nuevo); } catch { /* sin storage */ }
    setTema(nuevo);
  };

  return { tema, alternar };
}

/** Botón sol/luna. variant "sidebar" para fondos azules (sidebar, encabezado del portal). */
export function ThemeToggle({ variant = "default", conTexto = false }: { variant?: "default" | "sidebar"; conTexto?: boolean }) {
  const { tema, alternar } = useTema();
  const oscuro = tema === "dark";
  return (
    <button
      onClick={alternar}
      title={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={cx(
        "flex items-center gap-2 rounded-lg text-sm transition",
        conTexto ? "w-full px-3 py-2" : "p-2",
        variant === "sidebar" ? "text-brand-100 hover:bg-white/10 hover:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      )}
    >
      {oscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {conTexto && (oscuro ? "Modo claro" : "Modo oscuro")}
    </button>
  );
}
