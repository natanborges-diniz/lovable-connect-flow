import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface OrfaoRow {
  atendimento_id: string;
  contato_id: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  modo: string;
  status: string;
  ultima_mensagem_at: string;
  ultima_mensagem_conteudo: string;
  setor_id: string | null;
  setor_nome: string | null;
  minutos_pendente: number;
}

export type PublicoFiltro = "clientes" | "internos" | "todos";

export function useAtendimentosOrfaos(filtros: {
  idade_min: number;
  setor_id?: string;
  modo?: string;
  publico?: PublicoFiltro;
}) {
  return useQuery({
    queryKey: ["atendimentos-orfaos", filtros],
    refetchInterval: 30_000,
    queryFn: async (): Promise<{
      total: number;
      orfaos: OrfaoRow[];
      por_publico: { clientes: number; internos: number };
    }> => {
      const params = new URLSearchParams({
        action: "list",
        idade_min: String(filtros.idade_min),
      });
      if (filtros.setor_id) params.set("setor_id", filtros.setor_id);
      if (filtros.modo) params.set("modo", filtros.modo);
      if (filtros.publico) params.set("publico", filtros.publico);

      const { data, error } = await supabase.functions.invoke(
        `recuperar-atendimentos?${params.toString()}`,
        { method: "GET" },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useRecuperarAtendimentos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      acao: "acionar_ia" | "escalar_humano" | "mensagem_desculpas" | "lote_inteligente";
      atendimento_ids: string[];
      mensagem?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("recuperar-atendimentos", {
        method: "POST",
        body: payload,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const ok = (data?.results || []).filter((r: any) => r.ok).length;
      const fail = (data?.results || []).length - ok;
      if (fail === 0) toast.success(`${ok} atendimento(s) recuperados com sucesso`);
      else toast.warning(`${ok} ok, ${fail} falharam — veja log`);
      qc.invalidateQueries({ queryKey: ["atendimentos-orfaos"] });
      qc.invalidateQueries({ queryKey: ["atendimentos"] });
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });
}
