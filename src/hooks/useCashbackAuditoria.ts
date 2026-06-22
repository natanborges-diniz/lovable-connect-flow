import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AuditoriaRow = {
  id: string;
  numero_venda: string;
  cod_empresa: string | null;
  nome_cliente: string | null;
  valor_total_informado: number | null;
  valor_total_validado: number | null;
  valor_status: string | null;
  tentativas_reconciliacao: number | null;
  ultima_tentativa_at: string | null;
  demanda_divergencia_id: string | null;
  criado_em: string;
};

export function useAuditoriaCashback(filtro: "divergente" | "sem_venda_persistente" | "todas" = "divergente") {
  return useQuery<AuditoriaRow[]>({
    queryKey: ["cashback-auditoria", filtro],
    queryFn: async () => {
      let q = supabase
        .from("regua_inscricao")
        .select("id, numero_venda, cod_empresa, nome_cliente, valor_total_informado, valor_total_validado, valor_status, tentativas_reconciliacao, ultima_tentativa_at, demanda_divergencia_id, criado_em")
        .order("ultima_tentativa_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (filtro === "divergente") q = q.eq("valor_status", "divergente");
      else if (filtro === "sem_venda_persistente") q = q.eq("valor_status", "sem_venda_persistente");
      else q = q.in("valor_status", ["divergente", "sem_venda_persistente"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditoriaRow[];
    },
  });
}

export function useAprovarDivergencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inscricao_id: string; valor_aceito: number; origem: string; motivo?: string }) => {
      const { data, error } = await supabase.rpc("cashback_aprovar_divergencia", {
        _inscricao_id: input.inscricao_id,
        _valor_aceito: input.valor_aceito,
        _origem: input.origem,
        _motivo: input.motivo ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cashback confirmado (silencioso ao cliente)");
      qc.invalidateQueries({ queryKey: ["cashback-auditoria"] });
      qc.invalidateQueries({ queryKey: ["demandas"] });
    },
    onError: (e: any) => toast.error("Falha: " + (e?.message ?? "erro")),
  });
}

export function useCancelarInscricaoCashback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inscricao_id: string; motivo?: string }) => {
      const { data, error } = await supabase.rpc("cashback_cancelar_inscricao", {
        _inscricao_id: input.inscricao_id,
        _motivo: input.motivo ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Inscrição cancelada");
      qc.invalidateQueries({ queryKey: ["cashback-auditoria"] });
    },
    onError: (e: any) => toast.error("Falha: " + (e?.message ?? "erro")),
  });
}

export function useReprocessarReconciliacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("regua-reconciliacao", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Reconciliação disparada");
      qc.invalidateQueries({ queryKey: ["cashback-auditoria"] });
    },
    onError: (e: any) => toast.error("Falha: " + (e?.message ?? "erro")),
  });
}
