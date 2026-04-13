import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

function makeConversaId(a: string, b: string) {
  return [a, b].sort().join("_");
}

export interface Conversa {
  conversa_id: string;
  outro_id: string;
  outro_nome: string;
  ultima_mensagem: string;
  ultima_data: string;
  nao_lidas: number;
}

export function useMensagensInternas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;

  // Realtime subscription
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel("mensagens_internas_rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensagens_internas" },
        (payload) => {
          const msg = payload.new as any;
          if (msg.remetente_id === uid || msg.destinatario_id === uid) {
            qc.invalidateQueries({ queryKey: ["conversas-internas"] });
            qc.invalidateQueries({ queryKey: ["mensagens-conversa", msg.conversa_id] });
            qc.invalidateQueries({ queryKey: ["total-nao-lidas"] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "mensagens_internas" },
        () => {
          qc.invalidateQueries({ queryKey: ["conversas-internas"] });
          qc.invalidateQueries({ queryKey: ["total-nao-lidas"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [uid, qc]);

  // List conversations
  const conversas = useQuery({
    queryKey: ["conversas-internas", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data: msgs, error } = await supabase
        .from("mensagens_internas")
        .select("*")
        .or(`remetente_id.eq.${uid},destinatario_id.eq.${uid}`)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Group by conversa_id
      const map = new Map<string, { msgs: typeof msgs; outro_id: string }>();
      for (const m of msgs || []) {
        if (!map.has(m.conversa_id)) {
          const outroId = m.remetente_id === uid ? m.destinatario_id : m.remetente_id;
          map.set(m.conversa_id, { msgs: [], outro_id: outroId });
        }
        map.get(m.conversa_id)!.msgs.push(m);
      }

      // Get profile names
      const outroIds = [...new Set([...map.values()].map((v) => v.outro_id))];
      const { data: profiles } = outroIds.length > 0
        ? await supabase.from("profiles").select("id, nome").in("id", outroIds)
        : { data: [] };
      const nameMap = new Map((profiles || []).map((p) => [p.id, p.nome]));

      const result: Conversa[] = [];
      for (const [cid, { msgs: cmsgs, outro_id }] of map) {
        const naoLidas = cmsgs.filter((m) => m.destinatario_id === uid && !m.lida).length;
        result.push({
          conversa_id: cid,
          outro_id,
          outro_nome: nameMap.get(outro_id) || "Usuário",
          ultima_mensagem: cmsgs[0].conteudo,
          ultima_data: cmsgs[0].created_at,
          nao_lidas: naoLidas,
        });
      }
      result.sort((a, b) => new Date(b.ultima_data).getTime() - new Date(a.ultima_data).getTime());
      return result;
    },
  });

  // Total unread count
  const totalNaoLidas = useQuery({
    queryKey: ["total-nao-lidas", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("mensagens_internas")
        .select("*", { count: "exact", head: true })
        .eq("destinatario_id", uid!)
        .eq("lida", false);
      if (error) throw error;
      return count || 0;
    },
  });

  return { conversas, totalNaoLidas, makeConversaId };
}

export function useMensagensConversa(conversaId: string | null) {
  return useQuery({
    queryKey: ["mensagens-conversa", conversaId],
    enabled: !!conversaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens_internas")
        .select("*")
        .eq("conversa_id", conversaId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useEnviarMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ remetenteId, destinatarioId, conteudo }: { remetenteId: string; destinatarioId: string; conteudo: string }) => {
      const conversa_id = makeConversaId(remetenteId, destinatarioId);
      const { error } = await supabase.from("mensagens_internas").insert({
        remetente_id: remetenteId,
        destinatario_id: destinatarioId,
        conversa_id,
        conteudo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversas-internas"] });
      qc.invalidateQueries({ queryKey: ["mensagens-conversa"] });
    },
  });
}

export function useMarcarLidas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversaId, userId }: { conversaId: string; userId: string }) => {
      const { error } = await supabase
        .from("mensagens_internas")
        .update({ lida: true })
        .eq("conversa_id", conversaId)
        .eq("destinatario_id", userId)
        .eq("lida", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversas-internas"] });
      qc.invalidateQueries({ queryKey: ["total-nao-lidas"] });
      qc.invalidateQueries({ queryKey: ["mensagens-conversa"] });
    },
  });
}
