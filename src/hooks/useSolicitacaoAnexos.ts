import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSolicitacaoAnexos(solicitacaoId: string | undefined) {
  return useQuery({
    queryKey: ["solicitacao_anexos", solicitacaoId],
    enabled: !!solicitacaoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("solicitacao_anexos")
        .select("*")
        .eq("solicitacao_id", solicitacaoId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}
