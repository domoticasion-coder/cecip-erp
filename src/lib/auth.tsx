import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Staff, SocioUsuario } from "./types";
import { tienePermiso, veSeccion, type Permiso, type Seccion } from "../../shared/roles";

interface AuthState {
  session: Session | null;
  loading: boolean;
  staff: Staff | null;
  socioUsuario: SocioUsuario | null;
  /** true si el link del email era de recuperación de contraseña o invitación */
  recovery: boolean;
  refresh: () => Promise<void>;
  clearRecovery: () => void;
  signOut: () => Promise<void>;
  /** ¿Puede modificar datos de alguno de estos grupos? (sin argumentos: solo el administrador del sistema) */
  can: (...permisos: Permiso[]) => boolean;
  /** ¿Ve esta sección del ERP? */
  ve: (seccion: Seccion) => boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [socioUsuario, setSocioUsuario] = useState<SocioUsuario | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(() => /type=(recovery|invite)/.test(window.location.hash));

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setStaff(null);
      setSocioUsuario(null);
      return;
    }
    const [st, su] = await Promise.all([
      supabase.from("staff").select("*").eq("user_id", s.user.id).maybeSingle(),
      supabase.from("socio_usuarios").select("*").eq("user_id", s.user.id).maybeSingle(),
    ]);
    setStaff(st.data && st.data.activo ? (st.data as Staff) : null);
    setSocioUsuario((su.data as SocioUsuario) || null);
  }, []);

  useEffect(() => {
    let active = true;
    let userId: string | null = null;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      userId = data.session?.user.id ?? null;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      // Solo se recarga el perfil cuando cambia el usuario (ingreso / salida)
      const nuevoId = s?.user.id ?? null;
      if (nuevoId === userId) {
        setSession(s);
        return;
      }
      userId = nuevoId;
      // Evita bloquear el callback de Supabase
      setTimeout(async () => {
        setLoading(true);
        setSession(s);
        await loadProfile(s);
        setLoading(false);
      }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value: AuthState = {
    session,
    loading,
    staff,
    socioUsuario,
    recovery,
    refresh: () => loadProfile(session),
    clearRecovery: () => setRecovery(false),
    signOut: async () => {
      setRecovery(false);
      await supabase.auth.signOut();
    },
    can: (...permisos) => !!staff && tienePermiso(staff.rol, permisos),
    ve: (seccion) => !!staff && veSeccion(staff.rol, seccion),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
