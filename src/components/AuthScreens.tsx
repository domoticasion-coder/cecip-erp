import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { supabase, traducirError } from "../lib/supabase";
import { appMode, appUrl } from "../lib/appMode";
import { useAuth } from "../lib/auth";
import { ThemeToggle } from "../lib/theme";
import { demoLogins } from "@backend";
import { Button, ErrorBox, Field, Input } from "./ui";

const PRESENTACION = {
  erp: {
    etiqueta: "ERP administrativo",
    titulo: "Toda la gestión del Centro Comercial en un solo lugar",
    items: ["Socios, cuotas y cobranzas", "Links de pago de Mercado Pago", "Tesorería y recibos", "Comunicación con los socios"],
  },
  portal: {
    etiqueta: "Portal de Socios",
    titulo: "Tu cuenta con el CeCIP, siempre a mano",
    items: ["Consultá y pagá tus cuotas online", "Descargá tus recibos", "Comunicados oficiales", "Eventos, capacitaciones y ComercIA"],
  },
};

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const p = PRESENTACION[appMode.app];
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca (escritorio) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-[28rem] w-[28rem] rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          <img src="/logo.png" alt="CeCIP Paraná" className="h-12 rounded-lg bg-white p-1.5" />
          <div className="leading-tight">
            <div className="font-bold">CeCIP Paraná</div>
            <div className="text-sm text-brand-200">{p.etiqueta}</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">{p.titulo}</h2>
          <ul className="mt-6 space-y-3">
            {p.items.map((i) => (
              <li key={i} className="flex items-center gap-3 text-brand-100">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" /> {i}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-brand-200">Centro Comercial e Industrial de Paraná</div>
      </aside>

      {/* Formulario */}
      <main className="relative flex items-center justify-center bg-white px-6 py-12">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src="/logo.png" alt="CeCIP Paraná" className="h-11 rounded-lg bg-white p-1 ring-1 ring-slate-200" />
            <div className="leading-tight">
              <div className="font-bold text-slate-900">CeCIP Paraná</div>
              <div className="text-sm text-slate-500">{p.etiqueta}</div>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-8 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

export function LoginForm({ onForgot }: { onForgot: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pruebas = demoLogins.filter((d) => d.app === appMode.app);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(traducirError(error.message));
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input type="email" autoComplete="email" required className="pl-9" placeholder="nombre@empresa.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </Field>
        <Field label="Contraseña">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input type={ver ? "text" : "password"} autoComplete="current-password" required className="pl-9 pr-10"
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setVer(!ver)} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
              aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end">
          <button type="button" onClick={onForgot} className="text-sm text-brand-600 hover:underline">Olvidé mi contraseña</button>
        </div>
        <ErrorBox error={error} />
        <Button type="submit" loading={loading} className="w-full py-2.5">Ingresar</Button>
      </form>

      {pruebas.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="mb-2 font-semibold">Modo demo · usuarios de prueba (contraseña: {pruebas[0].password})</div>
          <div className="grid gap-1.5">
            {pruebas.map((d) => (
              <button key={d.email} type="button"
                onClick={() => { setEmail(d.email); setPassword(d.password); setError(null); }}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-left hover:bg-amber-100">
                <span className="font-medium">{d.etiqueta}</span>
                <span className="text-amber-700">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl("/definir-clave") });
    setLoading(false);
    if (error) setError(traducirError(error.message));
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4 text-sm text-slate-600">
        <p>Si el email está registrado, vas a recibir un enlace para crear una nueva contraseña. Revisá también la carpeta de spam.</p>
        <Button variant="secondary" onClick={onBack} className="w-full">Volver</Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email de tu cuenta">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" loading={loading} className="w-full">Enviar enlace</Button>
      <button type="button" onClick={onBack} className="block w-full text-center text-sm text-brand-600 hover:underline">Volver</button>
    </form>
  );
}

/** Pantalla para definir contraseña (tras invitación o recuperación). */
export function DefinirClave() {
  const { session, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (p1.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (p1 !== p2) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setLoading(false);
    if (error) return setError(traducirError(error.message));
    clearRecovery();
    window.history.replaceState(null, "", window.location.pathname);
    navigate("/", { replace: true });
  }

  if (!session) {
    return (
      <AuthLayout title="Enlace inválido o vencido" subtitle="Pedí un nuevo enlace desde la pantalla de ingreso.">
        <Button onClick={() => navigate("/")} className="w-full">Ir al ingreso</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Definí tu contraseña" subtitle={session.user.email}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
          <Input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
        </Field>
        <Field label="Repetir contraseña">
          <Input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={loading} className="w-full">Guardar contraseña</Button>
      </form>
    </AuthLayout>
  );
}
