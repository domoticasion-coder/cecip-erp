import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, Receipt, AlertCircle, Wallet, Megaphone, CalendarDays, Sparkles,
  UserCheck, Settings, LogOut, Menu, X, LayoutTemplate, Send,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { PORTAL_URL } from "../lib/appMode";
import { ROLES, type Rol } from "../lib/types";
import { AuthLayout, DefinirClave, ForgotForm, LoginForm } from "../components/AuthScreens";
import { Button, Loading, cx } from "../components/ui";
import Recibo from "../components/Recibo";
import { ThemeToggle } from "../lib/theme";
import Inicio from "./pages/Inicio";
import Socios from "./pages/Socios";
import SocioDetalle from "./pages/SocioDetalle";
import Cuotas from "./pages/Cuotas";
import Cobranzas from "./pages/Cobranzas";
import Tesoreria from "./pages/Tesoreria";
import Comunicacion from "./pages/Comunicacion";
import Eventos from "./pages/Eventos";
import Comercia from "./pages/Comercia";
import Accesos from "./pages/Accesos";
import Configuracion from "./pages/Configuracion";
import Contenido from "./pages/Contenido";
import DifusionComercia from "./pages/DifusionComercia";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  roles?: Rol[]; // undefined = todo el personal
  badge?: "accesos" | "comercia";
}

const NAV: NavItem[] = [
  { to: "/", label: "Inicio", icon: LayoutDashboard },
  { to: "/socios", label: "Socios", icon: Users },
  { to: "/cuotas", label: "Cuotas", icon: Receipt },
  { to: "/cobranzas", label: "Cobranzas y morosos", icon: AlertCircle },
  { to: "/tesoreria", label: "Tesorería", icon: Wallet, roles: ["tesoreria"] },
  { to: "/comunicacion", label: "Comunicación", icon: Megaphone },
  { to: "/eventos", label: "Eventos y capacitaciones", icon: CalendarDays },
  { to: "/comercia", label: "ComercIA", icon: Sparkles, badge: "comercia" },
  { to: "/contenido", label: "Contenido del portal", icon: LayoutTemplate, roles: ["atencion"] },
  { to: "/difusion", label: "Difusión ComercIA", icon: Send, roles: ["comercia"] },
  { to: "/accesos", label: "Accesos al portal", icon: UserCheck, roles: ["atencion", "tesoreria"], badge: "accesos" },
  { to: "/configuracion", label: "Configuración", icon: Settings, roles: [] },
];

export default function ErpApp() {
  const { session, staff, loading, recovery, signOut } = useAuth();
  const [forgot, setForgot] = useState(false);
  const location = useLocation();

  if (loading) return <Loading />;

  if (recovery || location.pathname === "/definir-clave") return <DefinirClave />;

  if (!session) {
    return (
      <AuthLayout
        title={forgot ? "Recuperar contraseña" : "ERP administrativo"}
        subtitle={forgot ? undefined : "Ingreso exclusivo para el personal de CeCIP Paraná"}
        footer={<a href={PORTAL_URL} className="hover:underline">¿Sos socio? Ingresá al Portal de Socios →</a>}
      >
        {forgot ? <ForgotForm onBack={() => setForgot(false)} /> : <LoginForm onForgot={() => setForgot(true)} />}
      </AuthLayout>
    );
  }

  if (!staff) {
    return (
      <AuthLayout title="Sin acceso al ERP" subtitle={session.user.email}>
        <p className="mb-4 text-sm text-slate-600">
          Tu usuario no pertenece al personal administrativo. Si sos socio, ingresá desde el Portal de Socios.
        </p>
        <div className="flex gap-2">
          <a href={PORTAL_URL} className="flex-1"><Button className="w-full">Ir al portal</Button></a>
          <Button variant="secondary" onClick={signOut}>Salir</Button>
        </div>
      </AuthLayout>
    );
  }

  return <Shell />;
}

function Shell() {
  const { staff, signOut, can } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const { data: badges } = useQuery({
    queryKey: ["badges"],
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from("socio_usuarios").select("user_id", { count: "exact", head: true }).eq("estado", "pendiente"),
        supabase.from("comercia_solicitudes").select("id", { count: "exact", head: true }).eq("estado", "nueva"),
      ]);
      return { accesos: a.count || 0, comercia: c.count || 0 };
    },
    refetchInterval: 60_000,
  });

  const esComercia = staff?.rol === "comercia";
  const items = esComercia
    ? NAV.filter((n) => ["/comercia", "/contenido", "/difusion"].includes(n.to)).map((n) => (n.to === "/contenido" ? { ...n, label: "Contenido ComercIA" } : n))
    : NAV.filter((n) => !n.roles || can(...n.roles));
  const isPrint = location.pathname.startsWith("/recibo/");

  if (isPrint) {
    return (
      <Routes>
        <Route path="/recibo/:id" element={<Recibo />} />
      </Routes>
    );
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4">
        <img src="/logo.png" alt="" className="h-9 rounded bg-white p-0.5" />
        <div className="leading-tight">
          <div className="text-sm font-bold text-white">CeCIP Paraná</div>
          <div className="text-xs text-brand-200">{esComercia ? "Panel ComercIA" : "ERP administrativo"}</div>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((n) => {
          const count = n.badge ? badges?.[n.badge] : 0;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  isActive ? "bg-white/15 font-medium text-white" : "text-brand-100 hover:bg-white/10 hover:text-white"
                )
              }
            >
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{n.label}</span>
              {!!count && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{count}</span>}
            </NavLink>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 px-1 text-xs">
          <div className="truncate font-medium text-white">{staff!.nombre}</div>
          <div className="text-brand-200">{ROLES[staff!.rol]}</div>
        </div>
        <ThemeToggle variant="sidebar" conTexto />
        <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-100 hover:bg-white/10 hover:text-white">
          <LogOut className="h-4 w-4" /> Cerrar sesión
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-brand-800 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-brand-800">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-4 text-white"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <span className="font-semibold">CeCIP · ERP</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {esComercia ? (
            // Equipo de ComercIA (externo): solo sus secciones
            <Routes>
              <Route path="/comercia" element={<Comercia />} />
              <Route path="/contenido" element={<Contenido />} />
              <Route path="/difusion" element={<DifusionComercia />} />
              <Route path="*" element={<Navigate to="/comercia" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/socios" element={<Socios />} />
              <Route path="/socios/:id" element={<SocioDetalle />} />
              <Route path="/cuotas" element={<Cuotas />} />
              <Route path="/cobranzas" element={<Cobranzas />} />
              {can("tesoreria") && <Route path="/tesoreria" element={<Tesoreria />} />}
              <Route path="/comunicacion" element={<Comunicacion />} />
              <Route path="/eventos" element={<Eventos />} />
              <Route path="/comercia" element={<Comercia />} />
              {can("atencion") && <Route path="/contenido" element={<Contenido />} />}
              {can("comercia") && <Route path="/difusion" element={<DifusionComercia />} />}
              {can("atencion", "tesoreria") && <Route path="/accesos" element={<Accesos />} />}
              {can() && <Route path="/configuracion" element={<Configuracion />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}
