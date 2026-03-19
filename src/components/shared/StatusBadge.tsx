import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusSolicitacao, Prioridade, TipoContato } from "@/types/database";

const statusConfig: Record<StatusSolicitacao, { label: string; className: string }> = {
  aberta: { label: "Aberta", className: "bg-info/15 text-info border-info/30" },
  classificada: { label: "Classificada", className: "bg-primary/15 text-primary border-primary/30" },
  em_atendimento: { label: "Em Atendimento", className: "bg-warning/15 text-warning border-warning/30" },
  aguardando_execucao: { label: "Aguardando Execução", className: "bg-muted text-muted-foreground border-border" },
  concluida: { label: "Concluída", className: "bg-success/15 text-success border-success/30" },
  cancelada: { label: "Cancelada", className: "bg-destructive/15 text-destructive border-destructive/30" },
  reaberta: { label: "Reaberta", className: "bg-warning/15 text-warning border-warning/30" },
};

const prioridadeConfig: Record<Prioridade, { label: string; className: string }> = {
  critica: { label: "Crítica", className: "bg-destructive/15 text-destructive border-destructive/30" },
  alta: { label: "Alta", className: "bg-warning/15 text-warning border-warning/30" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
  baixa: { label: "Baixa", className: "bg-secondary text-secondary-foreground border-border" },
};

const tipoContatoConfig: Record<TipoContato, { label: string; className: string }> = {
  cliente: { label: "Cliente", className: "bg-primary/15 text-primary border-primary/30" },
  fornecedor: { label: "Fornecedor", className: "bg-info/15 text-info border-info/30" },
  loja: { label: "Loja", className: "bg-success/15 text-success border-success/30" },
  colaborador: { label: "Colaborador", className: "bg-warning/15 text-warning border-warning/30" },
};

export function StatusBadge({ status }: { status: StatusSolicitacao }) {
  const config = statusConfig[status];
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}

export function PrioridadeBadge({ prioridade }: { prioridade: Prioridade }) {
  const config = prioridadeConfig[prioridade];
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}

export function TipoContatoBadge({ tipo }: { tipo: TipoContato }) {
  const config = tipoContatoConfig[tipo];
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}
