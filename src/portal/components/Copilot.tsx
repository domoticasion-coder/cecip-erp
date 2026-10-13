import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

/** Botón flotante que lleva al chat del Copiloto (pantalla completa en /copiloto) */
export function BotonCopiloto() {
  return (
    <Link to="/copiloto"
      className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-brand-700 py-3 pl-3.5 pr-4 text-sm font-semibold text-white shadow-xl shadow-brand-900/30 transition hover:bg-brand-800 hover:shadow-2xl">
      <Sparkles className="h-5 w-5" /> Preguntale al Copiloto
    </Link>
  );
}
