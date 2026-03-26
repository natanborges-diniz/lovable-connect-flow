import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Automacao {
  id: string;
  pipeline_coluna_id: string | null;
  entidade: string;
  status_alvo: string | null;
  tipo_acao: string;
  config: Record<string, any>;
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export function useAutomacoes(entidade?: string) {
  return useQuery({
    queryKey: ["pipeline_automacoes", entidade],
    queryFn: async () => {
      let query = (supabase as any)
        .from("pipeline_automacoes")
        .select("*")
        .order("ordem");

      if (entidade) query = query.eq("entidade", entidade);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Automacao[];
    },
  });
}

export function useCreateAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (automacao: {
      pipeline_coluna_id?: string | null;
      entidade: string;
      status_alvo?: string | null;
      tipo_acao: string;
      config: Record<string, any>;
      ordem?: number;
    }) => {
      const { data, error } = await (supabase as any)
        .from("pipeline_automacoes")
        .insert(automacao)
        .select()
        .single();
      if (error) throw error;
      return data as Automacao;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_automacoes"] });
      toast.success("Automação criada");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });
}

export function useUpdateAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { data, error } = await (supabase as any)
        .from("pipeline_automacoes")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Automacao;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_automacoes"] });
      toast.success("Automação atualizada");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });
}

export function useDeleteAutomacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("pipeline_automacoes")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_automacoes"] });
      toast.success("Automação removida");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });
}
