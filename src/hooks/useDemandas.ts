import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface DemandaRow {
  id: string;
  numero_curto: number;
  protocolo: string | null;
  loja_nome: string;
  loja_telefone: string;
  pergunta: string;
  assunto: string | null;
  status: string;
  origem: string | null;
  vista_pelo_operador: boolean;
  ultima_mensagem_loja_at: string | null;
  created_at: string;
  solicitante_id: string | null;
  solicitante_nome: string | null;
  setor_destino_id: string | null;
  atendimento_cliente_id: string | null;
  contato_cliente_id: string | null;
  metadata: Record<string, any> | null;
}

interface UserContext {
  isAdmin: boolean;
  setorId: string | null;
  uid: string | null;
}

export function useUserContext(): UserContext & { ready: boolean } {
  const { user, isAuthReady } = useAuth();
  const uid = user?.id ?? null;

  const ctx = useQuery({
    queryKey: ["user-context", uid],
    enabled: !!uid && isAuthReady,
    queryFn: async () => {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("setor_id, tipo_usuario").eq("id", uid!).maybeSingle(),
        supabase.from("user_roles").select("role, setor_id").eq("user_id", uid!),
      ]);
      const isAdmin = (rolesRes.data || []).some((r) => r.role === "admin");
      const setorId = profileRes.data?.setor_id ?? null;
      return { isAdmin, setorId };
    },
  });

  return {
    isAdmin: ctx.data?.isAdmin ?? false,
    setorId: ctx.data?.setorId ?? null,
    uid,
    ready: isAuthReady && !!ctx.data,
  };
}

/** Lista demandas escopadas por papel.
 *  - admin: todas
 *  - setor_operador: setor_destino_id == setor + as que abriu
 */
export function useDemandas(filters?: { status?: string | "all"; setorFilter?: string | null }) {
  const { isAdmin, setorId, uid, ready } = useUserContext();
  const qc = useQueryClient();

  // Realtime
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`demandas-rt-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "demandas_loja" }, () => {
        qc.invalidateQueries({ queryKey: ["demandas-list"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demanda_mensagens" }, () => {
        qc.invalidateQueries({ queryKey: ["demandas-list"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);

  return useQuery({
    queryKey: ["demandas-list", { isAdmin, setorId, uid, ...filters }],
    enabled: ready,
    queryFn: async () => {
      let q = supabase
        .from("demandas_loja")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isAdmin) {
        // Setor: vê demandas do setor + as que abriu
        const ors: string[] = [];
        if (setorId) ors.push(`setor_destino_id.eq.${setorId}`);
        if (uid) ors.push(`solicitante_id.eq.${uid}`);
        if (ors.length > 0) q = q.or(ors.join(","));
      } else if (filters?.setorFilter) {
        q = q.eq("setor_destino_id", filters.setorFilter);
      }

      if (filters?.status && filters.status !== "all") {
        q = q.eq("status", filters.status);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as DemandaRow[];
    },
  });
}

export interface DemandaMensagemRow {
  id: string;
  demanda_id: string;
  direcao: string;
  autor_id: string | null;
  autor_nome: string | null;
  conteudo: string;
  anexo_url: string | null;
  anexo_mime: string | null;
  encaminhada_ao_cliente: boolean;
  created_at: string;
  metadata: Record<string, any> | null;
}

/** Realtime de mensagens de uma demanda específica. */
export function useDemandaMensagens(demandaId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!demandaId) return;
    const ch = supabase
      .channel(`demanda-msgs-${demandaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "demanda_mensagens", filter: `demanda_id=eq.${demandaId}` },
        () => qc.invalidateQueries({ queryKey: ["demanda-mensagens", demandaId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [demandaId, qc]);

  return useQuery({
    queryKey: ["demanda-mensagens", demandaId],
    enabled: !!demandaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demanda_mensagens")
        .select("*")
        .eq("demanda_id", demandaId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as DemandaMensagemRow[];
    },
  });
}
