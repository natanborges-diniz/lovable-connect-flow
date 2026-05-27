import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ConfirmacaoEstoqueRow {
  id: string;
  numero_curto: number;
  protocolo: string;
  referencia: string;
  codigo_produto: string;
  descricao_peca: string | null;
  foto_url: string | null;
  observacao_estoque: string | null;
  loja_nome: string;
  loja_telefone: string | null;
  pipeline_coluna_id: string | null;
  status: "aguardando" | "confirmada" | "sem_estoque" | "faturada" | "cancelada";
  resposta_loja: "sim" | "nao" | null;
  resposta_observacao: string | null;
  respondida_por: string | null;
  respondida_at: string | null;
  tentativas_lembrete: number;
  proximo_lembrete_at: string | null;
  solicitante_id: string | null;
  solicitante_nome: string | null;
  demanda_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export function useConfirmacoesEstoque() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("confirmacoes-estoque-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "confirmacoes_estoque" }, () => {
        qc.invalidateQueries({ queryKey: ["confirmacoes-estoque"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return useQuery({
    queryKey: ["confirmacoes-estoque"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("confirmacoes_estoque")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data || []) as ConfirmacaoEstoqueRow[];
    },
  });
}

export interface NovaConfirmacaoInput {
  referencia: string;
  codigo_produto: string;
  descricao_peca?: string | null;
  observacao_estoque?: string | null;
  foto_url?: string | null;
  lojas: Array<{ nome_loja: string; telefone?: string | null }>;
}

export function useCreateConfirmacaoEstoque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovaConfirmacaoInput) => {
      const { data, error } = await supabase.functions.invoke("criar-confirmacao-estoque", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["confirmacoes-estoque"] });
      const n = (data?.cards?.length ?? 0);
      toast.success(`Solicitação enviada para ${n} loja(s)`);
    },
    onError: (e: any) => toast.error("Falha: " + (e?.message || "erro")),
  });
}

export function useResponderConfirmacaoEstoque() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { confirmacao_id: string; resposta: "sim" | "nao"; observacao?: string }) => {
      const { data, error } = await supabase.functions.invoke("responder-confirmacao-estoque", { body: input });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["confirmacoes-estoque"] });
      qc.invalidateQueries({ queryKey: ["demanda-mensagens"] });
      qc.invalidateQueries({ queryKey: ["demandas-list"] });
      toast.success("Resposta registrada");
    },
    onError: (e: any) => toast.error("Falha: " + (e?.message || "erro")),
  });
}

export function useUpdateConfirmacaoColuna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, coluna_id, status }: { id: string; coluna_id: string; status?: ConfirmacaoEstoqueRow["status"] }) => {
      const patch = { pipeline_coluna_id: coluna_id, ...(status ? { status } : {}) };
      const { error } = await supabase.from("confirmacoes_estoque").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["confirmacoes-estoque"] }),
    onError: (e: any) => toast.error("Falha: " + (e?.message || "erro")),
  });
}
