import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  solicitacao: any;
  onChanged?: () => void;
}

/**
 * Responsável pela operação do card no Financeiro.
 * Persistido em solicitacoes.metadata.responsavel_{id,nome,em}.
 */
export function ResponsavelSolicitacao({ solicitacao, onChanged }: Props) {
  const { user, profile } = useAuth() as any;
  const queryClient = useQueryClient();

  const meta = (solicitacao?.metadata || {}) as Record<string, any>;
  const respId: string | null = meta.responsavel_id ?? null;
  const respNome: string | null = meta.responsavel_nome ?? null;
  const souEu = !!user?.id && respId === user.id;

  const mutation = useMutation({
    mutationFn: async (assumir: boolean) => {
      const novoMeta = {
        ...meta,
        responsavel_id: assumir ? user?.id ?? null : null,
        responsavel_nome: assumir ? profile?.nome || user?.email || "Operador" : null,
        responsavel_em: assumir ? new Date().toISOString() : null,
      };
      const { error } = await supabase
        .from("solicitacoes")
        .update({ metadata: novoMeta } as any)
        .eq("id", solicitacao.id);
      if (error) throw error;

      await supabase.from("pipeline_card_eventos").insert({
        entidade: "solicitacao",
        entidade_id: solicitacao.id,
        tipo: assumir ? "responsavel_assumido" : "responsavel_liberado",
        descricao: assumir
          ? `${novoMeta.responsavel_nome} assumiu a operação`
          : `${respNome || "Operador"} liberou a operação`,
        usuario_id: user?.id ?? null,
        usuario_nome: profile?.nome || user?.email || null,
      });
    },
    onSuccess: (_d, assumir) => {
      toast.success(assumir ? "Você assumiu esta operação" : "Operação liberada");
      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      queryClient.invalidateQueries({ queryKey: ["solicitacoes"] });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e?.message || "Não foi possível atualizar o responsável"),
  });

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0 text-xs">
        <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Responsável:</span>
        <span className="font-medium truncate">{respNome || "ninguém ainda"}</span>
      </div>
      {respId && !souEu ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(true)}
        >
          Assumir para mim
        </Button>
      ) : respId && souEu ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(false)}
        >
          Liberar
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(true)}
        >
          <UserPlus className="h-3.5 w-3.5 mr-1" /> Assumir
        </Button>
      )}
    </div>
  );
}
