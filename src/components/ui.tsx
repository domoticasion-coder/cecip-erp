import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, X, CheckCircle2, AlertTriangle, Info } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Botones y campos
// ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({
  variant = "primary", size = "md", loading, icon, children, className, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variants[variant],
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx("input", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={4} {...p} className={cx("input", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx("input", p.className)} />;

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "bad" | "warn"; icon?: ReactNode }) {
  const tones = { default: "text-slate-900", good: "text-emerald-700", bad: "text-red-700", warn: "text-amber-700" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={cx("mt-1 whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl", tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

const badgeTones = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-800",
  purple: "bg-purple-100 text-purple-800",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone])}>{children}</span>;
}

export function SituacionBadge({ s }: { s: string }) {
  const map: Record<string, [keyof typeof badgeTones, string]> = {
    pendiente: ["amber", "Pendiente"],
    vencida: ["red", "Vencida"],
    pagada: ["green", "Pagada"],
    anulada: ["gray", "Anulada"],
    activo: ["green", "Activo"],
    suspendido: ["amber", "Suspendido"],
    baja: ["gray", "Baja"],
  };
  const [tone, label] = map[s] || ["gray", s];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-brand-600", className)} />;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-slate-500">
      {icon && <div className="text-slate-300">{icon}</div>}
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="min-w-full divide-y divide-slate-100">{children}</table>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            value === t.value ? "border-brand-700 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div className={cx("w-full rounded-xl bg-white shadow-xl", widths[size])}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avisos (toasts) y confirmaciones
// ---------------------------------------------------------------------------

type Toast = { id: number; tipo: "ok" | "error" | "info"; texto: string };
const ToastCtx = createContext<{ toast: (texto: string, tipo?: Toast["tipo"]) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx).toast;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((texto: string, tipo: Toast["tipo"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tipo, texto }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tipo === "error" ? 7000 : 4000);
  }, []);
  const icons = { ok: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, error: <AlertTriangle className="h-5 w-5 text-red-500" />, info: <Info className="h-5 w-5 text-blue-500" /> };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="no-print fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg">
            {icons[t.tipo]}
            <span className="flex-1 whitespace-pre-line">{t.texto}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Mensaje de error legible a partir de cualquier excepción */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
