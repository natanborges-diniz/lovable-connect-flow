import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CashbackKpis = {
  vendas_inscritas: number;
  valor_lancado: number;
  pin_confirmados: number;
  pin_expirados: number;
  taxa_confirmacao_pin: number;
  match: number;
  divergente: number;
  sem_venda: number;
  creditos_gerados_valor: number;
  creditos_ativos_qtd: number;
  creditos_ativos_saldo: number;
  creditos_vencidos_valor: number;
  a_vencer_30d_qtd: number;
  a_vencer_30d_valor: number;
  resgates_qtd: number;
  resgates_valor: number;
  ticket_medio_resgate: number;
  conversao_pct: number;
};

export type CashbackPorLoja = {
  cod_empresa: string | null;
  vendas: number;
  valor_lancado: number;
  match: number;
  divergente: number;
  sem_venda: number;
  pin_ok: number;
  cashback_gerado: number;
  cashback_resgatado: number;
};

export type CashbackSerie = { semana: string; gerado: number; resgatado: number };

export type CashbackDashboardData = {
  periodo: { de: string; ate: string };
  kpis: CashbackKpis;
  por_loja: CashbackPorLoja[];
  serie_semanal: CashbackSerie[];
};

export function useCashbackDashboard(de: string, ate: string) {
  return useQuery<CashbackDashboardData>({
    queryKey: ["cashback-dashboard", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cashback_dashboard_kpis", { _de: de, _ate: ate });
      if (error) throw error;
      return data as unknown as CashbackDashboardData;
    },
  });
}
