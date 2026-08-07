import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  consultaCpfId?: string | null;
  onOpenConsulta?: (id: string) => void;
}

/**
 * Linha de rastreabilidade exibida no picote do boleto:
 * mostra a Consulta de CPF aprovada que originou a solicitação.
 */
export function BoletoConsultaOrigem({ consultaCpfId, onOpenConsulta }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["consulta-cpf-origem", consultaCpfId],
    enabled: !!consultaCpfId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("solicitacoes")
        .select("id, protocolo, created_at, metadata")
        .eq("id", consultaCpfId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!consultaCpfId) {
    return (
      <div className="pt-2 border-t border-dashed border-amber-300 text-[11px] text-amber-700">
        ⚠️ Sem consulta de CPF vinculada (registro legado)
      </div>
    );
  }

  const meta = (data?.metadata || {}) as Record<string, any>;
  const dataAnalise = meta.data_analise || data?.created_at;

  return (
    <div className="pt-2 border-t border-dashed border-amber-300 text-[11px] text-amber-900">
      <span className="text-amber-700">🪪 Origem: </span>
      {isLoading || !data ? (
        <span className="text-amber-700">carregando consulta…</span>
      ) : (
        <button
          type="button"
          onClick={() => onOpenConsulta?.(data.id)}
          className="underline underline-offset-2 font-medium hover:text-amber-950 disabled:no-underline"
          disabled={!onOpenConsulta}
        >
          Consulta CPF — {data.protocolo}
          {dataAnalise
            ? ` · aprovada em ${format(new Date(dataAnalise), "dd/MM/yyyy", { locale: ptBR })}`
            : ""}
          {meta.analista_nome
            ? ` por ${meta.analista_nome}`
            : " · analista não registrado (legado)"}
        </button>
      )}
    </div>
  );
}
