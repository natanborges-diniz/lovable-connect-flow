import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LojaOption {
  nome_loja: string;
  telefone: string;
}

/**
 * Lista de lojas distintas (tipo='loja', ativo=true) para combobox/checklist
 * de acionamento de demandas. Distinct por nome_loja.
 */
export function useLojas() {
  return useQuery<LojaOption[]>({
    queryKey: ["lojas-options"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("nome_loja, telefone")
        .eq("tipo", "loja")
        .eq("ativo", true)
        .order("nome_loja", { ascending: true });
      if (error) throw error;
      const seen = new Set<string>();
      const out: LojaOption[] = [];
      for (const row of data ?? []) {
        const nome = (row as any).nome_loja?.trim();
        if (!nome || seen.has(nome.toLowerCase())) continue;
        seen.add(nome.toLowerCase());
        out.push({ nome_loja: nome, telefone: (row as any).telefone });
      }
      return out;
    },
  });
}
