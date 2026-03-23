import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusSolicitacao, Prioridade, TipoContato, StatusAtendimento, StatusTarefa, EstagioFunil } from "@/types/database";
const statusConfig: Record<StatusSolicitacao, { label: string; className: string }> = {
  aberta: { label: "Aberta", className: "bg-info-soft text-info border-info-muted" },
  classificada: { label: "Classificada", className: "bg-brand-soft text-brand border-brand/30" },
  em_atendimento: { label: "Em Atendimento", className: "bg-warning-soft text-warning border-warning-muted" },
  aguardando_execucao: { label: "Aguardando Execução", className: "bg-muted text-muted-foreground border-border" },
  concluida: { label: "Concluída", className: "bg-success-soft text-success border-success-muted" },
  cancelada: { label: "Cancelada", className: "bg-danger-soft text-danger border-danger-muted" },
  reaberta: { label: "Reaberta", className: "bg-warning-soft text-warning border-warning-muted" },
};

const prioridadeConfig: Record<Prioridade, { label: string; className: string }> = {
  critica: { label: "Crítica", className: "bg-danger-soft text-danger border-danger-muted" },
  alta: { label: "Alta", className: "bg-warning-soft text-warning border-warning-muted" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
  baixa: { label: "Baixa", className: "bg-secondary text-secondary-foreground border-border" },
};

const tipoContatoConfig: Record<TipoContato, { label: string; className: string }> = {
  cliente: { label: "Cliente", className: "bg-brand-soft text-brand border-brand/30" },
  fornecedor: { label: "Fornecedor", className: "bg-info-soft text-info border-info-muted" },
  loja: { label: "Loja", className: "bg-success-soft text-success border-success-muted" },
  colaborador: { label: "Colaborador", className: "bg-warning-soft text-warning border-warning-muted" },
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

const atendimentoStatusConfig: Record<StatusAtendimento, { label: string; className: string }> = {
  aguardando: { label: "Aguardando", className: "bg-warning-soft text-warning border-warning-muted" },
  em_atendimento: { label: "Em Atendimento", className: "bg-info-soft text-info border-info-muted" },
  encerrado: { label: "Encerrado", className: "bg-muted text-muted-foreground border-border" },
};

export function AtendimentoStatusBadge({ status }: { status: StatusAtendimento }) {
  const config = atendimentoStatusConfig[status];
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}

const tarefaStatusConfig: Record<StatusTarefa, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "bg-warning-soft text-warning border-warning-muted" },
  em_andamento: { label: "Em Andamento", className: "bg-info-soft text-info border-info-muted" },
  concluida: { label: "Concluída", className: "bg-success-soft text-success border-success-muted" },
  cancelada: { label: "Cancelada", className: "bg-danger-soft text-danger border-danger-muted" },
};

export function TarefaStatusBadge({ status }: { status: StatusTarefa }) {
  const config = tarefaStatusConfig[status];
  return <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>{config.label}</Badge>;
}
