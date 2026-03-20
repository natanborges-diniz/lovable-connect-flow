import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { StatusAtendimento, TipoCanal } from "@/types/database";

export function useAtendimentos(filters?: { status?: StatusAtendimento; search?: string }) {
  return useQuery({
    queryKey: ["atendimentos", filters],
    queryFn: async () => {
      let query = supabase
        .from("atendimentos")
        .select("*, contato:contatos(id, nome, tipo), solicitacao:solicitacoes(id, assunto, status), fila:filas(id, nome, tipo)")
        .order("created_at", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.search) query = query.ilike("atendente_nome", `%${filters.search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useAtendimento(id: string | undefined) {
  return useQuery({
    queryKey: ["atendimento", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("*, contato:contatos(*), solicitacao:solicitacoes(*, contato:contatos(id, nome, tipo)), fila:filas(*, setor:setores(*))")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateAtendimento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (atendimento: {
      solicitacao_id: string;
      contato_id: string;
      fila_id?: string | null;
      canal?: TipoCanal;
      atendente_nome?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("atendimentos")
        .insert({
          solicitacao_id: atendimento.solicitacao_id,
          contato_id: atendimento.contato_id,
          fila_id: atendimento.fila_id ?? null,
          canal: atendimento.canal ?? "sistema",
          atendente_nome: atendimento.atendente_nome ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["atendimentos"] });
      toast.success("Atendimento criado com sucesso");
    },
    onError: (error) => {
      toast.error("Erro ao criar atendimento: " + error.message);
    },
  });
}

export function useUpdateAtendimentoStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusAtendimento }) => {
      const updates: Record<string, unknown> = { status };
      if (status === "em_atendimento") updates.inicio_at = new Date().toISOString();
      if (status === "encerrado") updates.fim_at = new Date().toISOString();
      const { data, error } = await supabase.from("atendimentos").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["atendimentos"] });
      queryClient.invalidateQueries({ queryKey: ["atendimento", data.id] });
      toast.success("Status do atendimento atualizado");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar: " + error.message);
    },
  });
}

export function useMensagens(atendimentoId: string | undefined) {
  return useQuery({
    queryKey: ["mensagens", atendimentoId],
    enabled: !!atendimentoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens")
        .select("*")
        .eq("atendimento_id", atendimentoId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateMensagem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mensagem: {
      atendimento_id: string;
      conteudo: string;
      direcao: "inbound" | "outbound" | "internal";
      remetente_nome?: string | null;
    }) => {
      const { data, error } = await supabase.from("mensagens").insert(mensagem).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mensagens", data.atendimento_id] });
    },
    onError: (error) => {
      toast.error("Erro ao enviar mensagem: " + error.message);
    },
  });
}
