import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { StatusSolicitacao, Prioridade, TipoCanal } from "@/types/database";

export function useSolicitacoes(filters?: { status?: StatusSolicitacao; prioridade?: Prioridade; search?: string }) {
  return useQuery({
    queryKey: ["solicitacoes", filters],
    queryFn: async () => {
      let query = supabase.from("solicitacoes").select("*, contato:contatos(id, nome, tipo)").order("created_at", { ascending: false });
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.prioridade) query = query.eq("prioridade", filters.prioridade);
      if (filters?.search) query = query.ilike("assunto", `%${filters.search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useSolicitacao(id: string | undefined) {
  return useQuery({
    queryKey: ["solicitacao", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("solicitacoes").select("*, contato:contatos(*)").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateSolicitacao() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (solicitacao: { contato_id: string; assunto: string; descricao?: string | null; tipo?: string | null; prioridade: Prioridade; canal_origem: TipoCanal; status?: StatusSolicitacao }) => {
      const { data, error } = await supabase.from("solicitacoes").insert({
        contato_id: solicitacao.contato_id,
        assunto: solicitacao.assunto,
        descricao: solicitacao.descricao,
        tipo: solicitacao.tipo,
        prioridade: solicitacao.prioridade,
        canal_origem: solicitacao.canal_origem,
        status: solicitacao.status ?? "aberta",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitacoes"] });
      toast.success("Solicitação criada com sucesso");
    },
    onError: (error) => {
      toast.error("Erro ao criar solicitação: " + error.message);
    },
  });
}

export function useUpdateSolicitacaoStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusSolicitacao }) => {
      const { data, error } = await supabase.from("solicitacoes").update({ status }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["solicitacoes"] });
      queryClient.invalidateQueries({ queryKey: ["solicitacao", data.id] });
      toast.success("Status atualizado");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar status: " + error.message);
    },
  });
}
