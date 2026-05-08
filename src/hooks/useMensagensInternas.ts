import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

function makeConversaId(a: string, b: string) {
  return [a, b].sort().join("_");
}

export function makeGroupConversaId(grupoId: string) {
  return `grupo_${grupoId}`;
}

export interface Conversa {
  conversa_id: string;
  outro_id: string;
  outro_nome: string;
  ultima_mensagem: string;
  ultima_data: string;
  nao_lidas: number;
  ultima_remetente_id?: string;
  ultima_lida?: boolean;
  is_grupo?: boolean;
  participantes?: string[];
  grupo_id?: string;
}

export function useMensagensInternas() {
  const { user, isAuthReady } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;

  // Realtime subscription
  useEffect(() => {
    if (!uid || !isAuthReady) return;
    const channelName = `mensagens_internas_rt_${uid}_${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelName);
    channel
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
        (payload) => {
          const msg = payload.new as any;
          qc.invalidateQueries({ queryKey: ["conversas-internas"] });
          qc.invalidateQueries({ queryKey: ["total-nao-lidas"] });
          if (msg?.conversa_id) {
            qc.invalidateQueries({ queryKey: ["mensagens-conversa", msg.conversa_id] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversas_grupo" },
        () => {
          qc.invalidateQueries({ queryKey: ["conversas-internas"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [uid, qc, isAuthReady]);

  // List conversations (1:1 + grupos)
  const conversas = useQuery({
    queryKey: ["conversas-internas", uid],
    enabled: !!uid && isAuthReady,
    queryFn: async () => {
      const { data: msgs, error } = await supabase
        .from("mensagens_internas")
        .select("*")
        .or(`remetente_id.eq.${uid},destinatario_id.eq.${uid}`)
        .not("conversa_id", "like", "demanda_%")
        .not("conversa_id", "like", "ponte_%")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const map = new Map<string, { msgs: typeof msgs; outro_id: string | null; isGrupo: boolean }>();
      for (const m of msgs || []) {
        const isGrupo = m.conversa_id.startsWith("grupo_");
        if (!map.has(m.conversa_id)) {
          const outroId = isGrupo ? null : (m.remetente_id === uid ? m.destinatario_id : m.remetente_id);
          map.set(m.conversa_id, { msgs: [], outro_id: outroId, isGrupo });
        }
        map.get(m.conversa_id)!.msgs.push(m);
      }

      // Profiles 1:1
      const outroIds = [...new Set([...map.values()].filter(v => !v.isGrupo).map(v => v.outro_id!).filter(Boolean))];
      const { data: profiles } = outroIds.length > 0
        ? await supabase.from("profiles").select("id, nome").in("id", outroIds)
        : { data: [] };
      const nameMap = new Map((profiles || []).map((p) => [p.id, p.nome]));

      // Grupos: junta os já presentes em mensagens + os grupos onde o usuário é participante (mesmo sem mensagens)
      const grupoIdsComMsg = [...map.keys()].filter(k => k.startsWith("grupo_")).map(k => k.slice(6));
      const { data: gruposMembro } = await supabase
        .from("conversas_grupo")
        .select("id, nome, participantes, created_at")
        .contains("participantes", [uid!]);
      const gruposMap = new Map<string, any>();
      for (const g of (gruposMembro as any[] | null) || []) gruposMap.set(g.id, g);
      // Garante presença mesmo se já listado por mensagem (para acesso a created_at quando não houver msg)
      if (grupoIdsComMsg.length) {
        const faltantes = grupoIdsComMsg.filter(id => !gruposMap.has(id));
        if (faltantes.length) {
          const { data: extras } = await supabase
            .from("conversas_grupo")
            .select("id, nome, participantes, created_at")
            .in("id", faltantes);
          for (const g of (extras as any[] | null) || []) gruposMap.set(g.id, g);
        }
      }
      const grupoMap = gruposMap;

      const result: Conversa[] = [];
      for (const [cid, { msgs: cmsgs, outro_id, isGrupo }] of map) {
        const naoLidas = cmsgs.filter((m) => m.destinatario_id === uid && !m.lida).length;
        if (isGrupo) {
          const gid = cid.slice(6);
          const g: any = grupoMap.get(gid);
          if (!g) continue; // grupo deletado / sem acesso
          result.push({
            conversa_id: cid,
            outro_id: gid,
            outro_nome: g.nome,
            ultima_mensagem: cmsgs[0].conteudo,
            ultima_data: cmsgs[0].created_at,
            nao_lidas: naoLidas,
            is_grupo: true,
            participantes: g.participantes,
            grupo_id: gid,
          });
        } else {
          result.push({
            conversa_id: cid,
            outro_id: outro_id!,
            outro_nome: nameMap.get(outro_id!) || "Usuário",
            ultima_mensagem: cmsgs[0].conteudo,
            ultima_data: cmsgs[0].created_at,
            nao_lidas: naoLidas,
          });
        }
      }
      // Inclui grupos onde o usuário é membro mas ainda não há mensagens
      for (const [gid, g] of grupoMap) {
        const cid = `grupo_${gid}`;
        if (map.has(cid)) continue;
        result.push({
          conversa_id: cid,
          outro_id: gid,
          outro_nome: g.nome,
          ultima_mensagem: "Grupo criado — envie a primeira mensagem",
          ultima_data: g.created_at,
          nao_lidas: 0,
          is_grupo: true,
          participantes: g.participantes,
          grupo_id: gid,
        });
      }
      result.sort((a, b) => new Date(b.ultima_data).getTime() - new Date(a.ultima_data).getTime());
      return result;
    },
  });

  const totalNaoLidas = useQuery({
    queryKey: ["total-nao-lidas", uid],
    enabled: !!uid && isAuthReady,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("mensagens_internas")
        .select("*", { count: "exact", head: true })
        .eq("destinatario_id", uid!)
        .eq("lida", false)
        .not("conversa_id", "like", "demanda_%")
        .not("conversa_id", "like", "ponte_%");
      if (error) throw error;
      return count || 0;
    },
  });

  return { conversas, totalNaoLidas, makeConversaId, makeGroupConversaId };
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

      // Em grupo, deduplicar pela linha "minha cópia" (cada msg foi inserida N-1 vezes, uma por destinatário)
      if (conversaId?.startsWith("grupo_")) {
        const seen = new Set<string>();
        const out: any[] = [];
        for (const m of data || []) {
          // chave: remetente + conteudo + created_at(segundo) — mesma mensagem duplicada
          const key = `${m.remetente_id}|${m.conteudo}|${(m as any).anexo_url || ""}|${new Date(m.created_at).toISOString().slice(0, 19)}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push(m);
          }
        }
        return out;
      }
      return data || [];
    },
  });
}

export function useEnviarMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      remetenteId,
      destinatarioId,
      conteudo,
      grupoId,
      participantes,
    }: {
      remetenteId: string;
      destinatarioId?: string;
      conteudo: string;
      grupoId?: string;
      participantes?: string[];
    }) => {
      if (grupoId && participantes) {
        const conversa_id = makeGroupConversaId(grupoId);
        const outros = participantes.filter((p) => p !== remetenteId);
        if (outros.length === 0) throw new Error("Grupo sem outros participantes");
        const rows = outros.map((d) => ({
          remetente_id: remetenteId,
          destinatario_id: d,
          conversa_id,
          conteudo,
        }));
        const { error } = await supabase.from("mensagens_internas").insert(rows);
        if (error) throw error;
      } else {
        if (!destinatarioId) throw new Error("Destinatário obrigatório");
        const conversa_id = makeConversaId(remetenteId, destinatarioId);
        const { error } = await supabase.from("mensagens_internas").insert({
          remetente_id: remetenteId,
          destinatario_id: destinatarioId,
          conversa_id,
          conteudo,
        });
        if (error) throw error;
      }
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

export function useEditMensagemInterna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      novoConteudo,
      conteudoAnterior,
      metadata,
    }: {
      id: string;
      novoConteudo: string;
      conteudoAnterior: string;
      metadata?: Record<string, any> | null;
    }) => {
      const historico = Array.isArray((metadata as any)?.historico_edicoes)
        ? [...(metadata as any).historico_edicoes]
        : [];
      historico.push({ at: new Date().toISOString(), conteudo_anterior: conteudoAnterior });
      const newMeta = { ...(metadata || {}), historico_edicoes: historico };
      const { error } = await supabase
        .from("mensagens_internas")
        .update({
          conteudo: novoConteudo,
          editada_at: new Date().toISOString(),
          metadata: newMeta,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mensagens-conversa"] });
      qc.invalidateQueries({ queryKey: ["conversas-internas"] });
    },
  });
}

export function useDeleteMensagemInterna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const { error } = await supabase
        .from("mensagens_internas")
        .update({
          deletada_at: new Date().toISOString(),
          deletada_por: userId,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mensagens-conversa"] });
      qc.invalidateQueries({ queryKey: ["conversas-internas"] });
    },
  });
}

// Criar grupo (apenas admin via RLS) — sempre derivado de setor ou loja
export function useCriarGrupo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      nome,
      criadoPor,
      tipoOrigem,
      origemRef,
    }: {
      nome: string;
      criadoPor: string;
      tipoOrigem: "setor" | "loja";
      origemRef: string;
    }) => {
      // participantes são derivados pelo trigger no banco; passamos array vazio
      const { data, error } = await supabase
        .from("conversas_grupo")
        .insert({
          nome,
          criado_por: criadoPor,
          participantes: [criadoPor],
          tipo_origem: tipoOrigem,
          origem_ref: origemRef,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversas-internas"] });
    },
  });
}
