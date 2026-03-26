import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Zap, Trash2, MessageSquare, CheckSquare, Settings2,
  Eye, Pencil, ChevronRight, Workflow, AlertCircle,
} from "lucide-react";
import {
  useAutomacoes, useCreateAutomacao, useUpdateAutomacao, useDeleteAutomacao,
  type Automacao,
} from "@/hooks/useAutomacoes";

const STATUS_AGENDAMENTO = [
  "agendado", "confirmado", "atendido", "orcamento",
  "venda_fechada", "no_show", "recuperacao", "reagendado",
  "abandonado", "cancelado",
];

const TIPOS_ACAO = [
  { value: "enviar_template", label: "Enviar Template WhatsApp", icon: MessageSquare, color: "text-emerald-600" },
  { value: "enviar_mensagem", label: "Enviar Mensagem Livre", icon: MessageSquare, color: "text-blue-600" },
  { value: "atualizar_campo", label: "Atualizar Campo", icon: Settings2, color: "text-amber-600" },
  { value: "criar_tarefa", label: "Criar Tarefa", icon: CheckSquare, color: "text-purple-600" },
];

const ENTIDADE_LABELS: Record<string, string> = {
  agendamento: "Pipeline de Agendamentos",
  contato: "Pipeline de Vendas",
};

type DialogMode = "view" | "edit" | "create";

export function AutomacoesCard() {
  const { data: automacoes = [], isLoading } = useAutomacoes();
  const createAutomacao = useCreateAutomacao();
  const updateAutomacao = useUpdateAutomacao();
  const deleteAutomacao = useDeleteAutomacao();

  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [selected, setSelected] = useState<Automacao | null>(null);

  const agendamentoAutomacoes = automacoes.filter((a) => a.entidade === "agendamento");
  const contatoAutomacoes = automacoes.filter((a) => a.entidade === "contato");

  const openView = (a: Automacao) => { setSelected(a); setDialogMode("view"); };
  const openEdit = (a: Automacao) => { setSelected(a); setDialogMode("edit"); };
  const openCreate = () => { setSelected(null); setDialogMode("create"); };
  const close = () => { setDialogMode(null); setSelected(null); };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta automação?")) {
      deleteAutomacao.mutate(id);
    }
  };

  return (
    <>
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Hub de Automações
            </CardTitle>
            <CardDescription className="mt-1">
              Regras executadas automaticamente quando cards mudam de coluna/status no pipeline.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
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
            <EmptyState onCreateClick={openCreate} />
          ) : (
            <>
              <AutomacaoSection
                title="Pipeline de Agendamentos"
                subtitle={`${agendamentoAutomacoes.length} regra(s)`}
                automacoes={agendamentoAutomacoes}
                showStatus
                onView={openView}
                onEdit={openEdit}
                onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                onDelete={handleDelete}
              />
              <AutomacaoSection
                title="Pipeline de Vendas"
                subtitle={`${contatoAutomacoes.length} regra(s)`}
                automacoes={contatoAutomacoes}
                onView={openView}
                onEdit={openEdit}
                onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                onDelete={handleDelete}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Dialog: View / Edit / Create ─── */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {dialogMode === "view" && selected && (
            <ViewAutomacao
              automacao={selected}
              onEdit={() => setDialogMode("edit")}
              onClose={close}
            />
          )}
          {dialogMode === "edit" && selected && (
            <AutomacaoForm
              mode="edit"
              initial={selected}
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

/* ─── Section per pipeline ─── */

function AutomacaoSection({
  title, subtitle, automacoes, showStatus, onView, onEdit, onToggle, onDelete,
}: {
  title: string;
  subtitle: string;
  automacoes: Automacao[];
  showStatus?: boolean;
  onView: (a: Automacao) => void;
  onEdit: (a: Automacao) => void;
  onToggle: (id: string, ativo: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (automacoes.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {showStatus && <TableHead className="w-[120px]">Gatilho</TableHead>}
              <TableHead>Ação</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead className="w-[70px] text-center">Ativo</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {automacoes.map((a) => {
              const tipoInfo = TIPOS_ACAO.find((t) => t.value === a.tipo_acao);
              return (
                <TableRow key={a.id} className="group">
                  {showStatus && (
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-mono">
                        {a.status_alvo || "—"}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {tipoInfo && <tipoInfo.icon className={`h-3.5 w-3.5 ${tipoInfo.color}`} />}
                      <span className="text-sm">{tipoInfo?.label || a.tipo_acao}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {getDetailPreview(a)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={a.ativo} onCheckedChange={(v) => onToggle(a.id, v)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onView(a)} title="Ver detalhes">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(a)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(a.id)} title="Excluir">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ─── View Dialog ─── */

function ViewAutomacao({ automacao, onEdit, onClose }: { automacao: Automacao; onEdit: () => void; onClose: () => void }) {
  const tipoInfo = TIPOS_ACAO.find((t) => t.value === automacao.tipo_acao);
  const config = automacao.config || {};

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
  mode, initial, loading, onSubmit, onCancel,
}: {
  mode: "create" | "edit";
  initial?: Automacao;
  loading: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const config = initial?.config || {};
  const [entidade, setEntidade] = useState(initial?.entidade || "agendamento");
  const [statusAlvo, setStatusAlvo] = useState(initial?.status_alvo || "");
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
      tipo_acao: tipoAcao,
      config: cfg,
      ordem: parseInt(ordem) || 0,
    });
  };

  const tipoInfo = TIPOS_ACAO.find((t) => t.value === tipoAcao);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {mode === "create" ? <Plus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
          {mode === "create" ? "Nova Automação" : "Editar Automação"}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 py-2">
        {/* Pipeline + Gatilho */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Pipeline</Label>
            <Select value={entidade} onValueChange={setEntidade} disabled={mode === "edit"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="agendamento">Agendamentos</SelectItem>
                <SelectItem value="contato">Vendas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {entidade === "agendamento" && (
            <div className="space-y-2">
              <Label>Status que dispara</Label>
              <Select value={statusAlvo} onValueChange={setStatusAlvo}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {STATUS_AGENDAMENTO.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Ação */}
        <div className="space-y-2">
          <Label>Tipo de Ação</Label>
          <Select value={tipoAcao} onValueChange={setTipoAcao}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
          <p className="text-[10px] text-muted-foreground">Se houver múltiplas ações na mesma coluna, define a sequência.</p>
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
              <p className="text-[10px] text-muted-foreground">Serão resolvidos com os dados do contato/agendamento.</p>
            </div>
          </div>
        )}

        {tipoAcao === "enviar_mensagem" && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-blue-600" /> Mensagem Livre
            </h4>
            <div className="space-y-2">
              <Label>Texto da Mensagem</Label>
              <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} placeholder="Olá {{primeiro_nome}}! ..." />
            </div>
            {texto && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Preview (exemplo)</Label>
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
              <Textarea value={descricaoTarefa} onChange={(e) => setDescricaoTarefa(e.target.value)} rows={3} placeholder="Detalhes da tarefa..." />
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
  if (a.tipo_acao === "enviar_template") return (c.template_name as string) || "—";
  if (a.tipo_acao === "enviar_mensagem") return ((c.texto as string) || "").substring(0, 60) || "—";
  if (a.tipo_acao === "criar_tarefa") return (c.titulo as string) || "—";
  return "—";
}
