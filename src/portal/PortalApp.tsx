import { useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Home, LogOut, Megaphone, Menu, Receipt, Sparkles, Store, Building2, X, Clock, XCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase, traducirError, unwrap } from "../lib/supabase";
import { appUrl } from "../lib/appMode";
import { cuitValido, formatCuit, nombreSocio } from "../lib/format";
import type { Socio } from "../lib/types";
import { AuthLayout, DefinirClave, ForgotForm, LoginForm } from "../components/AuthScreens";
import { Button, ErrorBox, Field, Input, Loading, cx } from "../components/ui";
import Recibo from "../components/Recibo";
import { ThemeToggle } from "../lib/theme";
import Inicio from "./pages/Inicio";
import MisCuotas from "./pages/MisCuotas";
import Comunicados from "./pages/Comunicados";
import Eventos from "./pages/Eventos";
import Comercia from "./pages/Comercia";
import MiEmpresa from "./pages/MiEmpresa";
import { BotonCopiloto } from "./components/Copilot";
import Copiloto from "./pages/Copiloto";

export default function PortalApp() {
  const { session, socioUsuario, loading, recovery, signOut } = useAuth();
  const location = useLocation();
  const [vista, setVista] = useState<"login" | "registro" | "olvido">(() =>
    new URLSearchParams(window.location.search).has("registro") ? "registro" : "login"
  );

  if (loading) return <Loading />;
  if (recovery || location.pathname === "/definir-clave") return <DefinirClave />;

  if (!session) {
    if (vista === "registro") {
      return (
        <AuthLayout title="Crear cuenta de socio" subtitle="Registrate con los datos de tu empresa. La administración del CeCIP valida tu solicitud."
          footer={<button onClick={() => setVista("login")} className="hover:underline">¿Ya tenés cuenta? Ingresá</button>}>
          <Registro />
        </AuthLayout>
      );
    }
    return (
      <AuthLayout
        title={vista === "olvido" ? "Recuperar contraseña" : "Portal de Socios"}
        subtitle={vista === "olvido" ? undefined : "Centro Comercial e Industrial de Paraná"}
        footer={vista === "login" && <button onClick={() => setVista("registro")} className="hover:underline">¿Primera vez? <b>Creá tu cuenta de socio</b></button>}
      >
        {vista === "olvido" ? <ForgotForm onBack={() => setVista("login")} /> : <LoginForm onForgot={() => setVista("olvido")} />}
      </AuthLayout>
    );
  }

  if (!socioUsuario) {
    return (
      <AuthLayout title="Esta cuenta no es de socio" subtitle={session.user.email}>
        <p className="mb-4 text-sm text-slate-600">Tu usuario no está registrado como socio. Si sos parte del personal, ingresá al ERP.</p>
        <Button variant="secondary" onClick={signOut} className="w-full">Salir</Button>
      </AuthLayout>
    );
  }

  if (socioUsuario.estado !== "aprobado" || !socioUsuario.socio_id) {
    const rechazado = socioUsuario.estado === "rechazado";
    return (
      <AuthLayout title={rechazado ? "Solicitud no aprobada" : "Tu solicitud está en revisión"} subtitle={session.user.email}>
        <div className="mb-4 flex gap-3 text-sm text-slate-600">
          {rechazado ? <XCircle className="h-6 w-6 shrink-0 text-red-500" /> : <Clock className="h-6 w-6 shrink-0 text-amber-500" />}
          <p>
            {rechazado
              ? <>No pudimos validar tu cuenta.{socioUsuario.motivo_rechazo && <> Motivo: {socioUsuario.motivo_rechazo}</>} Comunicate con la administración del CeCIP.</>
              : <>La administración del CeCIP está verificando que <b>{socioUsuario.razon_social_declarada}</b> sea socio. Te vamos a avisar por email cuando tu acceso esté habilitado.</>}
          </p>
        </div>
        <Button variant="secondary" onClick={signOut} className="w-full">Salir</Button>
      </AuthLayout>
    );
  }

  return <Shell socioId={socioUsuario.socio_id} />;
}

function Registro() {
  const [f, setF] = useState({ nombre: "", email: "", telefono: "", razon_social: "", cuit: "", p1: "", p2: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cuitValido(f.cuit)) return setError("El CUIT no es válido. Revisá los 11 dígitos.");
    if (f.p1.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (f.p1 !== f.p2) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim().toLowerCase(),
      password: f.p1,
      options: {
        emailRedirectTo: appUrl("/"),
        data: { tipo: "socio", nombre: f.nombre.trim(), telefono: f.telefono.trim(), razon_social: f.razon_social.trim(), cuit: formatCuit(f.cuit) },
      },
    });
    setLoading(false);
    if (error) return setError(traducirError(error.message));
    // Supabase no revela si el email ya existía: en ese caso devuelve un usuario sin identidades
    if (data.user && data.user.identities?.length === 0) return setError("Ya existe una cuenta con ese email. Probá ingresar o recuperar la contraseña.");
    if (!data.session) setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        <p><b>¡Listo!</b> Te enviamos un email a <b>{f.email}</b> para confirmar tu dirección.</p>
        <p>Después de confirmarlo, la administración del CeCIP va a validar que tu empresa sea socia y te avisaremos cuando puedas ingresar.</p>
      </div>
    );
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Tu nombre y apellido"><Input required value={f.nombre} onChange={set("nombre")} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input type="email" required value={f.email} onChange={set("email")} /></Field>
        <Field label="Teléfono / WhatsApp"><Input value={f.telefono} onChange={set("telefono")} /></Field>
      </div>
      <Field label="Razón social de la empresa"><Input required value={f.razon_social} onChange={set("razon_social")} /></Field>
      <Field label="CUIT de la empresa"><Input required placeholder="30-12345678-9" value={f.cuit} onChange={set("cuit")} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contraseña"><Input type="password" required autoComplete="new-password" value={f.p1} onChange={set("p1")} /></Field>
        <Field label="Repetir"><Input type="password" required autoComplete="new-password" value={f.p2} onChange={set("p2")} /></Field>
      </div>
      <ErrorBox error={error} />
      <Button type="submit" loading={loading} className="w-full">Crear cuenta</Button>
    </form>
  );
}

const NAV = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/copiloto", label: "Copiloto IA", icon: Sparkles, ia: true },
  { to: "/cuotas", label: "Mis cuotas", icon: Receipt },
  { to: "/comunicados", label: "Comunicados", icon: Megaphone },
  { to: "/eventos", label: "Eventos y capacitaciones", icon: CalendarDays },
  { to: "/comercia", label: "ComercIA", icon: Store },
  { to: "/empresa", label: "Mi empresa", icon: Building2 },
];

function Shell({ socioId }: { socioId: string }) {
  const { signOut, socioUsuario } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const { data: socio } = useQuery({
    queryKey: ["mi-socio", socioId],
    queryFn: async () => unwrap(await supabase.from("socios").select("*").eq("id", socioId).single()) as Socio,
  });

  const esChat = location.pathname === "/copiloto";

  if (location.pathname.startsWith("/recibo/")) {
    return <Routes><Route path="/recibo/:id" element={<Recibo />} /></Routes>;
  }

  return (
    <div className={esChat ? "flex h-[100dvh] flex-col" : "min-h-full"}>
      <header className="sticky top-0 z-30 bg-brand-700 text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img src="/logo.png" alt="" className="h-9 rounded bg-white p-0.5" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{socio ? nombreSocio(socio) : "Portal de Socios"}</div>
            <div className="text-xs text-brand-100">Portal de Socios · CeCIP Paraná</div>
          </div>
          <div className="hidden text-right text-xs text-brand-100 sm:block">{socioUsuario?.nombre}</div>
          <ThemeToggle variant="sidebar" />
          <button onClick={signOut} className="hidden items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-brand-100 hover:bg-white/10 sm:flex">
            <LogOut className="h-4 w-4" /> Salir
          </button>
          <button className="sm:hidden" onClick={() => setOpen(!open)}>{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
        </div>
        <nav className={cx("mx-auto max-w-6xl gap-1 overflow-x-auto px-2 pb-2 sm:flex", open ? "block" : "hidden")}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setOpen(false)}
              className={({ isActive }) => cx("flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
                isActive ? "bg-white/15 font-medium" : "text-brand-100 hover:bg-white/10")}>
              <n.icon className="h-4 w-4" /> {n.label}
              {"ia" in n && <span className="rounded bg-amber-400 px-1 text-[10px] font-bold text-amber-950">NUEVO</span>}
            </NavLink>
          ))}
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-100 sm:hidden">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </nav>
      </header>
      <main className={esChat ? "flex min-h-0 w-full flex-1" : "mx-auto max-w-6xl p-4 sm:p-6"}>
        <Routes>
          <Route path="/" element={<Inicio socioId={socioId} />} />
          <Route path="/copiloto" element={<Copiloto />} />
          <Route path="/cuotas" element={<MisCuotas socioId={socioId} />} />
          <Route path="/comunicados" element={<Comunicados />} />
          <Route path="/eventos" element={<Eventos socioId={socioId} />} />
          <Route path="/comercia" element={<Comercia socioId={socioId} socio={socio} />} />
          <Route path="/empresa" element={<MiEmpresa socio={socio} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!esChat && <BotonCopiloto />}
    </div>
  );
}
