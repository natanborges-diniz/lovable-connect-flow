import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Acessos, ModulosMap } from "@/lib/acessos";



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
  tipo_usuario?: "loja" | "colaborador" | "setor_operador" | "admin";
  cargo_loja?: "supervisor" | "gerente" | "operador" | null;
  lojas?: string[];
}

interface SetorInfo {
  id: string;
  nome: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  setores: SetorInfo[];
  acessos: Acessos | null;
  loading: boolean;
  /** True quando a sessão está restaurada E perfil/roles/setores foram hidratados (ou não há usuário logado). */
  isAuthReady: boolean;
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
  setores: [],
  acessos: null,
  loading: true,
  isAuthReady: false,
  isAdmin: false,
  isOperador: false,
  hasRole: () => false,
  getUserSetorIds: () => [],
  getEffectiveSetorIds: () => [],
  getUserLojaNames: () => [],
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [setores, setSetores] = useState<SetorInfo[]>([]);
  const [acessos, setAcessos] = useState<Acessos | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);



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

  const fetchSetoresByIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return [] as SetorInfo[];
    const { data, error } = await supabase
      .from("setores")
      .select("id, nome")
      .in("id", ids);
    if (error) throw error;
    return (data || []) as SetorInfo[];
  }, []);

  const fetchAcessos = useCallback(async (userId: string): Promise<Acessos | null> => {
    const { data, error } = await supabase
      .from("user_acessos")
      .select("modulos, lojas, setores, acesso_total")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[useAuth] fetchAcessos error", error);
      return null;
    }
    if (!data) return null;
    return {
      modulos: (data.modulos as ModulosMap) || {},
      lojas: data.lojas,
      setores: data.setores,
      acessoTotal: !!data.acesso_total,
    };
  }, []);

  const hydrateAuthState = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRoles([]);
      setSetores([]);
      setAcessos(null);
      setLoading(false);
      setIsAuthReady(true); // anônimo já está "pronto"
      return;
    }

    setLoading(true);
    setIsAuthReady(false);

    try {
      const [nextProfile, nextRoles, nextAcessos] = await Promise.all([
        fetchProfile(nextSession.user.id),
        fetchRoles(nextSession.user.id),
        fetchAcessos(nextSession.user.id),
      ]);

      // Setor efetivo: roles primeiro, depois profile como fallback
      const setorIdsFromRoles = nextRoles.filter((r) => r.setor_id).map((r) => r.setor_id!);
      const effectiveIds =
        setorIdsFromRoles.length > 0
          ? setorIdsFromRoles
          : nextProfile?.setor_id
          ? [nextProfile.setor_id]
          : [];

      const nextSetores = await fetchSetoresByIds([...new Set(effectiveIds)]);

      console.log("[useAuth] hydrated", {
        userId: nextSession.user.id,
        email: nextSession.user.email,
        profile: nextProfile,
        roles: nextRoles,
        setores: nextSetores,
        acessos: nextAcessos,
      });

      setProfile(nextProfile);
      setRoles(nextRoles);
      setSetores(nextSetores);
      setAcessos(nextAcessos);
    } catch (err) {
      console.error("[useAuth] hydrate error", err);
      setProfile(null);
      setRoles([]);
      setSetores([]);
      setAcessos(null);
    } finally {
      setLoading(false);
      setIsAuthReady(true);
    }
  }, [fetchProfile, fetchRoles, fetchSetoresByIds, fetchAcessos]);


  useEffect(() => {
    setLoading(true);
    setIsAuthReady(false);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (nextSession?.user) {
          setLoading(true);
          setIsAuthReady(false);
        }
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

  const getEffectiveSetorIds = useCallback(() => {
    const fromRoles = roles.filter((r) => r.setor_id).map((r) => r.setor_id!);
    if (fromRoles.length > 0) return fromRoles;
    if (profile?.setor_id) return [profile.setor_id];
    return [];
  }, [roles, profile]);

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
    setSetores([]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        setores,
        loading,
        isAuthReady,
        isAdmin,
        isOperador,
        hasRole,
        getUserSetorIds,
        getEffectiveSetorIds,
        getUserLojaNames,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
