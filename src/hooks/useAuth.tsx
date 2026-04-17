import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "admin" | "operador" | "setor_usuario";

interface UserRole {
  id: string;
  role: AppRole;
  setor_id: string | null;
  loja_nome: string | null;
}

interface Profile {
  id: string;
  nome: string;
  email: string | null;
  cargo: string | null;
  setor_id: string | null;
  avatar_url: string | null;
  ativo: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  loading: boolean;
  isAdmin: boolean;
  isOperador: boolean;
  hasRole: (role: AppRole) => boolean;
  getUserSetorIds: () => string[];
  getEffectiveSetorIds: () => string[];
  getUserLojaNames: () => string[];
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  roles: [],
  loading: true,
  isAdmin: false,
  isOperador: false,
  hasRole: () => false,
  getUserSetorIds: () => [],
  getUserLojaNames: () => [],
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) throw error;
    return data as Profile | null;
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId);
    if (error) throw error;
    return ((data as any[] | null) || []).map((r) => ({
      id: r.id,
      role: r.role as AppRole,
      setor_id: r.setor_id,
      loja_nome: r.loja_nome || null,
    }));
  }, []);

  const hydrateAuthState = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRoles([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [nextProfile, nextRoles] = await Promise.all([
        fetchProfile(nextSession.user.id),
        fetchRoles(nextSession.user.id),
      ]);

      setProfile(nextProfile);
      setRoles(nextRoles);
    } catch {
      setProfile(null);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, fetchRoles]);

  useEffect(() => {
    setLoading(true);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        // Sincronamente sinaliza loading para evitar flash de "roles vazias"
        // entre o evento SIGNED_IN e a hidratação do profile/roles.
        if (nextSession?.user) setLoading(true);
        setTimeout(() => {
          void hydrateAuthState(nextSession);
        }, 0);
      }
    );

    void supabase.auth.getSession().then(({ data: { session } }) => hydrateAuthState(session));

    return () => subscription.unsubscribe();
  }, [hydrateAuthState]);

  const isAdmin = roles.some((r) => r.role === "admin");
  const isOperador = roles.some((r) => r.role === "operador");

  const hasRole = useCallback(
    (role: AppRole) => roles.some((r) => r.role === role),
    [roles]
  );

  const getUserSetorIds = useCallback(
    () => roles.filter((r) => r.setor_id).map((r) => r.setor_id!),
    [roles]
  );

  const getUserLojaNames = useCallback(
    () => roles.filter((r) => r.loja_nome).map((r) => r.loja_nome!),
    [roles]
  );

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, roles, loading, isAdmin, isOperador, hasRole, getUserSetorIds, getUserLojaNames, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
