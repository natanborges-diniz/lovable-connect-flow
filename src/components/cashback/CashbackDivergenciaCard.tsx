import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAprovarDivergencia } from "@/hooks/useCashbackAuditoria";
import { Check, FileSignature } from "lucide-react";

type Metadata = {
  inscricao_id?: string;
  numero_venda?: string;
  cliente_nome?: string;
  valor_lancado?: number;
  valor_sistema?: number;
  diff?: number;
};

/**
 * Card que a loja vê dentro da DemandaThreadView quando tipo_chave='cashback_divergencia'.
 * Ações: ajustar para o valor do sistema (aprova na hora) OU manter lançado (escala supervisor).
 *
 * IMPORTANTE: nenhuma das ações dispara comunicação ao cliente.
 */
export function CashbackDivergenciaCard({
  metadata,
  jaDecidida,
  decisaoAnterior,
}: {
  metadata: Metadata;
  jaDecidida: boolean;
  decisaoAnterior?: string;
}) {
  const aprovar = useAprovarDivergencia();

  const valorSistema = Number(metadata.valor_sistema ?? 0);
  const valorLancado = Number(metadata.valor_lancado ?? 0);
  const inscricaoId = metadata.inscricao_id;

  if (!inscricaoId) return null;

  const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (jaDecidida) {
    return (
      <div className="rounded-md border border-emerald-300/40 bg-emerald-50/50 dark:bg-emerald-950/30 p-3 text-sm">
        <Badge variant="secondary">Divergência decidida</Badge>
        <p className="mt-2 text-muted-foreground">
          {decisaoAnterior === "loja_ajustou_sistema" && "Loja optou por ajustar para o valor do sistema."}
          {decisaoAnterior === "loja_manteve_lancado" && "Loja pediu manter o valor lançado — aguardando supervisor."}
          {decisaoAnterior === "supervisor_aprovou_sistema" && "Supervisor aprovou o valor do sistema."}
          {decisaoAnterior === "supervisor_aprovou_lancado" && "Supervisor manteve o valor lançado."}
          {decisaoAnterior === "supervisor_override" && "Supervisor aplicou override."}
          {decisaoAnterior === "cancelado" && "Inscrição cancelada."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Divergência de cashback</p>
          <p className="text-xs text-muted-foreground">Venda {metadata.numero_venda} • {metadata.cliente_nome ?? "cliente"}</p>
        </div>
        <Badge variant="outline">Aguardando decisão</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded border bg-background p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Lançado no Atrium</p>
          <p className="font-semibold">{fmt(valorLancado)}</p>
        </div>
        <div className="rounded border bg-background p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Sistema</p>
          <p className="font-semibold">{fmt(valorSistema)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          className="flex-1"
          disabled={aprovar.isPending}
          onClick={() => aprovar.mutate({ inscricao_id: inscricaoId, valor_aceito: valorSistema, origem: "loja_ajustou_sistema" })}
        >
          <Check className="mr-1 h-4 w-4" /> Ajustar para sistema ({fmt(valorSistema)})
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={aprovar.isPending}
          onClick={() => aprovar.mutate({ inscricao_id: inscricaoId, valor_aceito: valorLancado, origem: "loja_manteve_lancado", motivo: "Loja optou por manter — aguarda supervisor" })}
        >
          <FileSignature className="mr-1 h-4 w-4" /> Manter lançado ({fmt(valorLancado)})
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        O cliente não recebe nenhuma mensagem sobre este ajuste.
      </p>
    </div>
  );
}
