import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PipelineColuna {
  id: string;
  nome: string;
  cor: string;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export function usePipelineColunas() {
  return useQuery({
    queryKey: ["pipeline_colunas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_colunas")
        .select("*")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as PipelineColuna[];
    },
  });
}

export function useCreatePipelineColuna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (coluna: { nome: string; cor?: string; ordem: number }) => {
      const { data, error } = await supabase
        .from("pipeline_colunas")
        .insert({ nome: coluna.nome, cor: coluna.cor ?? "muted-foreground", ordem: coluna.ordem })
        .select()
        .single();
      if (error) throw error;
      return data as PipelineColuna;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_colunas"] });
      toast.success("Coluna criada");
    },
    onError: (e) => toast.error("Erro ao criar coluna: " + e.message),
  });
}

export function useUpdatePipelineColuna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; nome?: string; cor?: string; ordem?: number }) => {
      const { data, error } = await supabase
        .from("pipeline_colunas")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PipelineColuna;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_colunas"] });
      toast.success("Coluna atualizada");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });
}

export function useDeletePipelineColuna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipeline_colunas")
        .update({ ativo: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_colunas"] });
      qc.invalidateQueries({ queryKey: ["contatos"] });
      toast.success("Coluna removida");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });
}
