import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DisparoRow {
  id: string;
  fonte: string;
  template_nome: string | null;
  alias: string | null;
  cliente_nome: string | null;
  telefone: string | null;
  loja_nome: string | null;
  atendimento_id: string | null;
  contato_id: string | null;
  enviado_at: string | null;
  wa_status: string | null;
  wa_status_at: string | null;
  falha_motivo: string | null;
  params: any;
  whatsapp_message_id: string | null;
}

export interface DisparosKpis {
  total: number;
  entregues: number;
  lidos: number;
  invalidos: number;
  falhas: number;
  respondidos_24h: number;
  taxa_entrega: number;
  taxa_leitura: number;
  taxa_resposta_24h: number;
  taxa_invalido: number;
}

export interface DisparosFilter {
  periodo_dias: number;
  fontes: string[] | null;
  status: string[] | null;
  busca: string;
  pagina: number;
  por_pagina: number;
}

export function useDisparosKpis(filter: Pick<DisparosFilter, "periodo_dias" | "fontes">) {
  return useQuery({
    queryKey: ["disparos-kpis", filter.periodo_dias, filter.fontes],
    queryFn: async (): Promise<DisparosKpis> => {
      const { data, error } = await (supabase.rpc as any)("disparos_kpis", {
        periodo_dias: filter.periodo_dias,
        fontes: filter.fontes,
      });
      if (error) throw error;
      return data as DisparosKpis;
    },
  });
}

export function useDisparosListar(filter: DisparosFilter) {
  return useQuery({
    queryKey: [
      "disparos-listar",
      filter.periodo_dias,
      filter.fontes,
      filter.status,
      filter.busca,
      filter.pagina,
      filter.por_pagina,
    ],
    queryFn: async (): Promise<DisparoRow[]> => {
      const { data, error } = await (supabase.rpc as any)("disparos_listar", {
        periodo_dias: filter.periodo_dias,
        fontes: filter.fontes,
        status_filtro: filter.status,
        busca: filter.busca || null,
        pagina: filter.pagina,
        por_pagina: filter.por_pagina,
      });
      if (error) throw error;
      return (data || []) as DisparoRow[];
    },
  });
}
