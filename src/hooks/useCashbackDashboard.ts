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
  vendas_com_resgate_qtd: number;
  vendas_com_resgate_valor: number;
  desconto_concedido_valor: number;
  ticket_medio_venda_resgate: number;
  desconto_medio_pct: number;
  conversao_pct: number;
};

export type CashbackPorLoja = {
  cod_empresa: string | null;
  nome_loja: string | null;
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

export function useCashbackDashboard(de: string, ate: string, lojas?: string[]) {
  const lojasKey = (lojas ?? []).slice().sort().join("|");
  return useQuery<CashbackDashboardData>({
    queryKey: ["cashback-dashboard", de, ate, lojasKey],
    queryFn: async () => {
      const params: Record<string, unknown> = { _de: de, _ate: ate };
      if (lojas && lojas.length > 0) params._lojas = lojas;
      const { data, error } = await supabase.rpc("cashback_dashboard_kpis", params as any);
      if (error) throw error;
      return data as unknown as CashbackDashboardData;
    },
  });
}

export function useCashbackLojas() {
  return useQuery<string[]>({
    queryKey: ["cashback-lojas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cashback_listar_lojas");
      if (error) throw error;
      return ((data ?? []) as { nome_loja: string }[]).map((r) => r.nome_loja).filter(Boolean);
    },
    staleTime: 5 * 60 * 1000,
  });
}
