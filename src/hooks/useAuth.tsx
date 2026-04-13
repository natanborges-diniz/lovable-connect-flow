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

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data as Profile | null);
  };

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId);
    setRoles((data as any[] || []).map((r) => ({
      id: r.id,
      role: r.role as AppRole,
      setor_id: r.setor_id,
      loja_nome: r.loja_nome || null,
    })));
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id);
            fetchRoles(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRoles([]);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        fetchRoles(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

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
