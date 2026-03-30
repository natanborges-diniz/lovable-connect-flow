import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus, Zap, Trash2, MessageSquare, CheckSquare, Settings2,
  Eye, Pencil, ChevronDown, ChevronRight, Workflow, AlertCircle,
  ArrowRight, Circle, PlayCircle, Target,
} from "lucide-react";
import {
  useAutomacoes, useCreateAutomacao, useUpdateAutomacao, useDeleteAutomacao,
  type Automacao,
} from "@/hooks/useAutomacoes";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const STATUS_AGENDAMENTO = [
  "agendado", "lembrete_enviado", "confirmado", "atendido", "orcamento",
  "venda_fechada", "no_show", "recuperacao", "reagendado",
  "abandonado", "cancelado",
];

const TIPOS_ACAO = [
  { value: "enviar_template", label: "Enviar Template WhatsApp", icon: MessageSquare, color: "text-emerald-600", bg: "bg-emerald-500/10" },
  { value: "enviar_mensagem", label: "Enviar Mensagem Livre", icon: MessageSquare, color: "text-blue-600", bg: "bg-blue-500/10" },
  { value: "atualizar_campo", label: "Atualizar Campo", icon: Settings2, color: "text-amber-600", bg: "bg-amber-500/10" },
  { value: "criar_tarefa", label: "Criar Tarefa", icon: CheckSquare, color: "text-purple-600", bg: "bg-purple-500/10" },
];

const ENTIDADE_LABELS: Record<string, string> = {
  agendamento: "Agendamentos",
  contato: "Vendas (Contatos)",
  solicitacao: "Financeiro (Solicitações)",
};

type DialogMode = "view" | "edit" | "create";

export function AutomacoesCard() {
  const { data: automacoes = [], isLoading } = useAutomacoes();
  const createAutomacao = useCreateAutomacao();
  const updateAutomacao = useUpdateAutomacao();
  const deleteAutomacao = useDeleteAutomacao();

  // Load all columns with setor info
  const { data: allColunas = [] } = useQuery({
    queryKey: ["all_pipeline_colunas_with_setor"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_colunas")
        .select("*, setor:setores(id, nome)")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return data as any[];
    },
  });

  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [selected, setSelected] = useState<Automacao | null>(null);

  const openView = (a: Automacao) => { setSelected(a); setDialogMode("view"); };
  const openEdit = (a: Automacao) => { setSelected(a); setDialogMode("edit"); };
  const openCreate = (defaults?: Partial<Automacao>) => {
    setSelected(defaults ? defaults as Automacao : null);
    setDialogMode("create");
  };
  const close = () => { setDialogMode(null); setSelected(null); };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta automação?")) {
      deleteAutomacao.mutate(id);
    }
  };

  // Group automations by pipeline
  const groups = useMemo(() => {
    const agendamento = automacoes.filter(a => a.entidade === "agendamento");
    const contato = automacoes.filter(a => a.entidade === "contato");
    const solicitacao = automacoes.filter(a => a.entidade === "solicitacao");

    // Group contato automations by column
    const vendasColunas = allColunas.filter(c => !c.setor_id);
    const financeiroColunas = allColunas.filter(c => c.setor?.nome === "Financeiro");

    return { agendamento, contato, solicitacao, vendasColunas, financeiroColunas };
  }, [automacoes, allColunas]);

  return (
    <>
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Hub de Automações
            </CardTitle>
            <CardDescription className="mt-1">
              Visualize e gerencie todas as automações do sistema em fluxo visual.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-1" /> Nova Automação
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Variables help */}
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border">
            <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis:{" "}
              {["{{primeiro_nome}}", "{{nome}}", "{{loja}}", "{{hora}}", "{{data}}", "{{telefone}}"].map((v) => (
                <code key={v} className="bg-background px-1 py-0.5 rounded text-[10px] mx-0.5 border">{v}</code>
              ))}
            </p>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando automações...</p>
          ) : automacoes.length === 0 ? (
            <EmptyState onCreateClick={() => openCreate()} />
          ) : (
            <div className="space-y-4">
              {/* Agendamentos Pipeline Flow */}
              <PipelineFlowDiagram
                title="Pipeline de Agendamentos"
                icon={<Target className="h-4 w-4" />}
                steps={STATUS_AGENDAMENTO.map(s => ({
                  id: s,
                  label: s.replace(/_/g, " "),
                  automacoes: groups.agendamento.filter(a => a.status_alvo === s),
                }))}
                automacoes={groups.agendamento}
                onView={openView}
                onEdit={openEdit}
                onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                onDelete={handleDelete}
                onCreateForStep={(stepId) => openCreate({ entidade: "agendamento", status_alvo: stepId } as any)}
              />

              {/* Vendas Pipeline Flow */}
              <PipelineFlowDiagram
                title="Pipeline de Vendas"
                icon={<Workflow className="h-4 w-4" />}
                steps={groups.vendasColunas.map(c => ({
                  id: c.id,
                  label: c.nome,
                  automacoes: groups.contato.filter(a => a.pipeline_coluna_id === c.id),
                }))}
                automacoes={groups.contato}
                onView={openView}
                onEdit={openEdit}
                onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                onDelete={handleDelete}
                onCreateForStep={(stepId) => openCreate({ entidade: "contato", pipeline_coluna_id: stepId } as any)}
              />

              {/* Financeiro Pipeline Flow */}
              <PipelineFlowDiagram
                title="Pipeline Financeiro"
                icon={<Workflow className="h-4 w-4" />}
                steps={groups.financeiroColunas.map(c => ({
                  id: c.id,
                  label: c.nome,
                  automacoes: groups.solicitacao.filter(a => a.pipeline_coluna_id === c.id),
                }))}
                automacoes={groups.solicitacao}
                onView={openView}
                onEdit={openEdit}
                onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                onDelete={handleDelete}
                onCreateForStep={(stepId) => openCreate({ entidade: "solicitacao", pipeline_coluna_id: stepId } as any)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {dialogMode === "view" && selected && (
            <ViewAutomacao
              automacao={selected}
              colunas={allColunas}
              onEdit={() => setDialogMode("edit")}
              onClose={close}
            />
          )}
          {dialogMode === "edit" && selected && (
            <AutomacaoForm
              mode="edit"
              initial={selected}
              colunas={allColunas}
              loading={updateAutomacao.isPending}
              onSubmit={(data) => {
                updateAutomacao.mutate({ id: selected.id, ...data }, { onSuccess: close });
              }}
              onCancel={close}
            />
          )}
          {dialogMode === "create" && (
            <AutomacaoForm
              mode="create"
              initial={selected || undefined}
              colunas={allColunas}
              loading={createAutomacao.isPending}
              onSubmit={(data) => {
                createAutomacao.mutate(data, { onSuccess: close });
              }}
              onCancel={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Empty State ─── */

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Workflow className="h-12 w-12 text-muted-foreground/40 mb-3" />
      <h3 className="text-sm font-medium mb-1">Nenhuma automação configurada</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-xs">
        Crie regras para enviar mensagens, templates ou criar tarefas automaticamente quando um card muda de etapa.
      </p>
      <Button size="sm" onClick={onCreateClick}>
        <Plus className="h-4 w-4 mr-1" /> Criar primeira automação
      </Button>
    </div>
  );
}

/* ─── Pipeline Flow Diagram ─── */

interface FlowStep {
  id: string;
  label: string;
  automacoes: Automacao[];
}

function PipelineFlowDiagram({
  title, icon, steps, automacoes, onView, onEdit, onToggle, onDelete, onCreateForStep,
}: {
  title: string;
  icon: React.ReactNode;
  steps: FlowStep[];
  automacoes: Automacao[];
  onView: (a: Automacao) => void;
  onEdit: (a: Automacao) => void;
  onToggle: (id: string, ativo: boolean) => void;
  onDelete: (id: string) => void;
  onCreateForStep: (stepId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalAutomacoes = automacoes.length;
  const stepsWithAutomations = steps.filter(s => s.automacoes.length > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {icon}
            <span className="font-semibold text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totalAutomacoes} regra{totalAutomacoes !== 1 ? "s" : ""}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {stepsWithAutomations.length}/{steps.length} etapas
            </Badge>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 overflow-x-auto pb-2">
          <div className="flex items-start gap-1 min-w-max px-2">
            {steps.map((step, idx) => (
              <div key={step.id} className="flex items-start">
                <FlowStepNode
                  step={step}
                  onView={onView}
                  onEdit={onEdit}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onCreateHere={() => onCreateForStep(step.id)}
                />
                {idx < steps.length - 1 && (
                  <div className="flex items-center pt-5 px-0.5">
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FlowStepNode({
  step, onView, onEdit, onToggle, onDelete, onCreateHere,
}: {
  step: FlowStep;
  onView: (a: Automacao) => void;
  onEdit: (a: Automacao) => void;
  onToggle: (id: string, ativo: boolean) => void;
  onDelete: (id: string) => void;
  onCreateHere: () => void;
}) {
  const hasAutomations = step.automacoes.length > 0;

  return (
    <div className={cn(
      "w-44 rounded-lg border p-2 transition-all",
      hasAutomations
        ? "bg-primary/5 border-primary/30 shadow-sm"
        : "bg-background border-border/50 opacity-70 hover:opacity-100"
    )}>
      {/* Step header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Circle className={cn("h-2.5 w-2.5 shrink-0", hasAutomations ? "fill-primary text-primary" : "text-muted-foreground")} />
        <span className="text-xs font-semibold truncate capitalize">{step.label}</span>
        {hasAutomations && (
          <Badge variant="default" className="ml-auto text-[9px] px-1 py-0 h-4">
            {step.automacoes.length}
          </Badge>
        )}
      </div>

      {/* Automations list */}
      {hasAutomations && (
        <div className="space-y-1 mb-1.5">
          {step.automacoes.map(a => {
            const tipoInfo = TIPOS_ACAO.find(t => t.value === a.tipo_acao);
            return (
              <div
                key={a.id}
                className={cn(
                  "flex items-center gap-1 p-1.5 rounded text-[10px] group cursor-pointer hover:ring-1 hover:ring-primary/30",
                  tipoInfo?.bg || "bg-muted/50"
                )}
                onClick={() => onView(a)}
              >
                {tipoInfo && <tipoInfo.icon className={cn("h-3 w-3 shrink-0", tipoInfo.color)} />}
                <span className="truncate flex-1 font-medium">{getDetailPreview(a)}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-0.5 hover:text-primary"
                    onClick={(e) => { e.stopPropagation(); onEdit(a); }}
                    title="Editar"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    className="p-0.5 hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}
                    title="Excluir"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
                <Switch
                  checked={a.ativo}
                  onCheckedChange={(v) => { onToggle(a.id, v); }}
                  className="scale-[0.5] origin-right"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Add button */}
      <button
        className="w-full flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-primary py-1 rounded border border-dashed border-border/50 hover:border-primary/30 transition-colors"
        onClick={onCreateHere}
      >
        <Plus className="h-2.5 w-2.5" /> Automação
      </button>
    </div>
  );
}

/* ─── View Dialog ─── */

function ViewAutomacao({ automacao, colunas, onEdit, onClose }: { automacao: Automacao; colunas: any[]; onEdit: () => void; onClose: () => void }) {
  const tipoInfo = TIPOS_ACAO.find((t) => t.value === automacao.tipo_acao);
  const config = automacao.config || {};
  const coluna = colunas.find(c => c.id === automacao.pipeline_coluna_id);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" /> Detalhes da Automação
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <DetailRow label="Pipeline" value={ENTIDADE_LABELS[automacao.entidade] || automacao.entidade} />
        {automacao.entidade === "agendamento" && (
          <DetailRow label="Status gatilho" value={automacao.status_alvo || "Não definido"} />
        )}
        {coluna && (
          <DetailRow label="Coluna gatilho" value={coluna.nome} />
        )}
        <DetailRow
          label="Tipo de ação"
          value={
            <div className="flex items-center gap-1.5">
              {tipoInfo && <tipoInfo.icon className={`h-4 w-4 ${tipoInfo.color}`} />}
              {tipoInfo?.label || automacao.tipo_acao}
            </div>
          }
        />
        <DetailRow label="Ordem" value={String(automacao.ordem)} />
        <DetailRow label="Ativo" value={automacao.ativo ? "Sim" : "Não"} />

        <Separator />

        <h4 className="text-sm font-medium">Configuração</h4>

        {automacao.tipo_acao === "enviar_template" && (
          <>
            <DetailRow label="Nome do template" value={config.template_name || "—"} />
            <DetailRow label="Parâmetros" value={
              (config.template_params as string[])?.length
                ? (config.template_params as string[]).join(", ")
                : "Nenhum"
            } />
          </>
        )}
        {automacao.tipo_acao === "enviar_mensagem" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Texto da mensagem</Label>
            <div className="p-3 rounded-md bg-muted/50 border text-sm whitespace-pre-wrap">
              {(config.texto as string) || "—"}
            </div>
          </div>
        )}
        {automacao.tipo_acao === "criar_tarefa" && (
          <>
            <DetailRow label="Título da tarefa" value={(config.titulo as string) || "—"} />
            <DetailRow label="Descrição" value={(config.descricao as string) || "—"} />
            <DetailRow label="Prioridade" value={(config.prioridade as string) || "normal"} />
          </>
        )}
        {automacao.tipo_acao === "atualizar_campo" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Atualizações (JSON)</Label>
            <pre className="p-3 rounded-md bg-muted/50 border text-xs overflow-auto">
              {JSON.stringify(config.updates || config, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button onClick={onEdit}>
          <Pencil className="h-4 w-4 mr-1" /> Editar
        </Button>
      </DialogFooter>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/* ─── Create / Edit Form ─── */

function AutomacaoForm({
  mode, initial, colunas, loading, onSubmit, onCancel,
}: {
  mode: "create" | "edit";
  initial?: Automacao;
  colunas: any[];
  loading: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const config = initial?.config || {};
  const [entidade, setEntidade] = useState(initial?.entidade || "agendamento");
  const [statusAlvo, setStatusAlvo] = useState(initial?.status_alvo || "");
  const [pipelineColunaId, setPipelineColunaId] = useState(initial?.pipeline_coluna_id || "");
  const [tipoAcao, setTipoAcao] = useState(initial?.tipo_acao || "enviar_template");
  const [ordem, setOrdem] = useState(String(initial?.ordem ?? 0));
  const [templateName, setTemplateName] = useState((config.template_name as string) || "");
  const [templateParams, setTemplateParams] = useState(
    Array.isArray(config.template_params) ? (config.template_params as string[]).join(", ") : ""
  );
  const [texto, setTexto] = useState((config.texto as string) || "");
  const [tituloTarefa, setTituloTarefa] = useState((config.titulo as string) || "");
  const [descricaoTarefa, setDescricaoTarefa] = useState((config.descricao as string) || "");
  const [prioridadeTarefa, setPrioridadeTarefa] = useState((config.prioridade as string) || "normal");

  // Filter columns based on entity
  const filteredColunas = useMemo(() => {
    if (entidade === "contato") return colunas.filter(c => !c.setor_id);
    if (entidade === "solicitacao") return colunas.filter(c => c.setor?.nome === "Financeiro");
    return [];
  }, [entidade, colunas]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cfg: Record<string, any> = {};

    if (tipoAcao === "enviar_template") {
      cfg.template_name = templateName;
      cfg.template_params = templateParams.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (tipoAcao === "enviar_mensagem") {
      cfg.texto = texto;
    } else if (tipoAcao === "criar_tarefa") {
      cfg.titulo = tituloTarefa;
      cfg.descricao = descricaoTarefa;
      cfg.prioridade = prioridadeTarefa;
    }

    onSubmit({
      entidade,
      status_alvo: entidade === "agendamento" ? statusAlvo || null : null,
      pipeline_coluna_id: entidade !== "agendamento" ? pipelineColunaId || null : null,
      tipo_acao: tipoAcao,
      config: cfg,
      ordem: parseInt(ordem) || 0,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {mode === "create" ? <Plus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
          {mode === "create" ? "Nova Automação" : "Editar Automação"}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-2">
        {/* Pipeline */}
        <div className="space-y-2">
          <Label>Pipeline</Label>
          <Select value={entidade} onValueChange={(v) => { setEntidade(v); setPipelineColunaId(""); setStatusAlvo(""); }} disabled={mode === "edit"}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agendamento">Agendamentos</SelectItem>
              <SelectItem value="contato">Vendas (Contatos)</SelectItem>
              <SelectItem value="solicitacao">Financeiro (Solicitações)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Trigger */}
        {entidade === "agendamento" && (
          <div className="space-y-2">
            <Label>Status que dispara</Label>
            <Select value={statusAlvo} onValueChange={setStatusAlvo}>
              <SelectTrigger><SelectValue placeholder="Selecione o status" /></SelectTrigger>
              <SelectContent>
                {STATUS_AGENDAMENTO.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(entidade === "contato" || entidade === "solicitacao") && (
          <div className="space-y-2">
            <Label>Coluna que dispara</Label>
            <Select value={pipelineColunaId} onValueChange={setPipelineColunaId}>
              <SelectTrigger><SelectValue placeholder="Selecione a coluna" /></SelectTrigger>
              <SelectContent>
                {filteredColunas.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Ação */}
        <div className="space-y-2">
          <Label>Tipo de Ação</Label>
          <Select value={tipoAcao} onValueChange={setTipoAcao}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_ACAO.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <div className="flex items-center gap-2">
                    <t.icon className={`h-4 w-4 ${t.color}`} />
                    {t.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Ordem */}
        <div className="space-y-2">
          <Label>Ordem de execução</Label>
          <Input type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} min={0} className="w-24" />
        </div>

        <Separator />

        {/* Config por tipo */}
        {tipoAcao === "enviar_template" && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-emerald-600" /> Configuração do Template
            </h4>
            <div className="space-y-2">
              <Label>Nome do Template (Meta)</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Ex: confirmacao_agendamento" />
            </div>
            <div className="space-y-2">
              <Label>Parâmetros (separados por vírgula)</Label>
              <Input value={templateParams} onChange={(e) => setTemplateParams(e.target.value)} placeholder="{{primeiro_nome}}, {{loja}}, {{hora}}" />
            </div>
          </div>
        )}

        {tipoAcao === "enviar_mensagem" && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-blue-600" /> Mensagem Livre
            </h4>
            <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Olá {{primeiro_nome}}! ..." />
            {texto && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <div className="p-3 rounded-md bg-muted/50 border text-sm whitespace-pre-wrap">
                  {texto
                    .replace(/\{\{primeiro_nome\}\}/g, "João")
                    .replace(/\{\{nome\}\}/g, "João Silva")
                    .replace(/\{\{loja\}\}/g, "Ótica Centro")
                    .replace(/\{\{hora\}\}/g, "14:30")
                    .replace(/\{\{data\}\}/g, "26/03/2026")
                    .replace(/\{\{telefone\}\}/g, "5511999999999")}
                </div>
              </div>
            )}
          </div>
        )}

        {tipoAcao === "criar_tarefa" && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <CheckSquare className="h-4 w-4 text-purple-600" /> Criar Tarefa
            </h4>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={tituloTarefa} onChange={(e) => setTituloTarefa(e.target.value)} placeholder="Verificar agendamento {{loja}}" />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={descricaoTarefa} onChange={(e) => setDescricaoTarefa(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={prioridadeTarefa} onValueChange={setPrioridadeTarefa}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {tipoAcao === "atualizar_campo" && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Settings2 className="h-4 w-4 text-amber-600" /> Atualizar Campo
            </h4>
            <p className="text-xs text-muted-foreground">
              Configuração avançada — os campos a atualizar são definidos no JSON de configuração.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Salvando..." : mode === "create" ? "Criar Automação" : "Salvar Alterações"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/* ─── Helpers ─── */

function getDetailPreview(a: Automacao): string {
  const c = a.config || {};
  if (a.tipo_acao === "enviar_template") return (c.template_name as string) || "Template";
  if (a.tipo_acao === "enviar_mensagem") return ((c.texto as string) || "").substring(0, 30) || "Mensagem";
  if (a.tipo_acao === "criar_tarefa") return (c.titulo as string) || "Tarefa";
  return a.tipo_acao;
}
