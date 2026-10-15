import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { subirImagen } from "../lib/imagenes";
import { cx } from "./ui";

/** Campo para adjuntar una imagen: se sube a Supabase Storage y devuelve la URL pública */
export function ImagenInput({ value, onChange, carpeta, label = "Imagen (opcional)", hint }: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  carpeta?: string;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  async function subir(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    setSubiendo(true);
    try {
      onChange(await subirImagen(file, carpeta));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      {label && <span className="label">{label}</span>}
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="" className="max-h-48 max-w-full rounded-lg border border-slate-200 object-contain" />
          <button type="button" onClick={() => onChange(null)} title="Quitar imagen"
            className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); subir(e.dataTransfer.files?.[0]); }}
          onPaste={(e) => subir(Array.from(e.clipboardData.files)[0])}
          className={cx(
            "flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-sm transition",
            arrastrando ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500 hover:border-brand-400 hover:text-brand-700"
          )}
        >
          {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          {subiendo ? "Subiendo…" : "Elegí, arrastrá o pegá una imagen (JPG, PNG, WEBP o GIF)"}
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => subir(e.target.files?.[0])} />
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}
