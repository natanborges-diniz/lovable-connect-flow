import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Agendamento {
  id: string;
  contato_id: string;
  atendimento_id: string | null;
  loja_nome: string;
  loja_telefone: string | null;
  data_horario: string;
  status: string;
  observacoes: string | null;
  lembrete_enviado: boolean;
  confirmacao_enviada: boolean;
  noshow_enviado: boolean;
  cobranca_loja_enviada: boolean;
  loja_confirmou_presenca: boolean | null;
  tentativas_recuperacao: number;
  tentativas_lembrete: number;
  tentativas_cobranca_loja: number;
  valor_orcamento: number | null;
  valor_venda: number | null;
  numero_venda: string | null;
  numeros_os: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  contato?: { nome: string; telefone: string | null };
}

export function useAgendamentos(filtroLoja?: string, filtroStatus?: string) {
  return useQuery({
    queryKey: ["agendamentos", filtroLoja, filtroStatus],
    queryFn: async () => {
      let query = (supabase as any)
        .from("agendamentos")
        .select("*, contato:contatos(nome, telefone)")
        .order("data_horario", { ascending: false });

      if (filtroLoja) {
        query = query.eq("loja_nome", filtroLoja);
      }
      if (filtroStatus) {
        query = query.eq("status", filtroStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Agendamento[];
    },
  });
}

export function useAgendamentoStats() {
  return useQuery({
    queryKey: ["agendamentos-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agendamentos")
        .select("status, loja_nome");

      if (error) throw error;

      const stats: Record<string, number> = {};
      for (const ag of data || []) {
        stats[ag.status] = (stats[ag.status] || 0) + 1;
      }
      return stats;
    },
  });
}
