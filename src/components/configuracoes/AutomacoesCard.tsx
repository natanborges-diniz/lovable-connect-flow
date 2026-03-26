import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Zap, Trash2, MessageSquare, FileText, CheckSquare, Settings2 } from "lucide-react";
import { useAutomacoes, useCreateAutomacao, useUpdateAutomacao, useDeleteAutomacao } from "@/hooks/useAutomacoes";

const STATUS_AGENDAMENTO = [
  "agendado", "confirmado", "atendido", "orcamento",
  "venda_fechada", "no_show", "recuperacao", "reagendado",
  "abandonado", "cancelado",
];

const TIPOS_ACAO = [
  { value: "enviar_template", label: "Enviar Template WhatsApp", icon: MessageSquare },
  { value: "enviar_mensagem", label: "Enviar Mensagem Livre", icon: MessageSquare },
  { value: "atualizar_campo", label: "Atualizar Campo", icon: Settings2 },
  { value: "criar_tarefa", label: "Criar Tarefa", icon: CheckSquare },
];

export function AutomacoesCard() {
  const { data: automacoes = [], isLoading } = useAutomacoes();
  const createAutomacao = useCreateAutomacao();
  const updateAutomacao = useUpdateAutomacao();
  const deleteAutomacao = useDeleteAutomacao();
  const [dialogOpen, setDialogOpen] = useState(false);

  const agendamentoAutomacoes = automacoes.filter((a) => a.entidade === "agendamento");
  const contatoAutomacoes = automacoes.filter((a) => a.entidade === "contato");

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="h-5 w-5" /> Automações de Pipeline
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Automação</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nova Automação</DialogTitle></DialogHeader>
            <CreateAutomacaoForm
              onSubmit={(data) => {
                createAutomacao.mutate(data, { onSuccess: () => setDialogOpen(false) });
              }}
              loading={createAutomacao.isPending}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Automações são executadas quando um card muda de coluna/status no pipeline — seja manualmente pelo operador ou automaticamente pelo sistema.
          Use <code className="text-xs bg-muted px-1 rounded">{"{{primeiro_nome}}"}</code>, <code className="text-xs bg-muted px-1 rounded">{"{{loja}}"}</code>, <code className="text-xs bg-muted px-1 rounded">{"{{hora}}"}</code>, <code className="text-xs bg-muted px-1 rounded">{"{{data}}"}</code> como variáveis.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : (
          <>
            {/* Agendamentos */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Pipeline de Agendamentos</h3>
              {agendamentoAutomacoes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">Nenhuma automação configurada</p>
              ) : (
                <AutomacoesTable
                  automacoes={agendamentoAutomacoes}
                  onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                  onDelete={(id) => deleteAutomacao.mutate(id)}
                  showStatus
                />
              )}
            </div>

            {/* Contatos/Vendas */}
            {contatoAutomacoes.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Pipeline de Vendas</h3>
                <AutomacoesTable
                  automacoes={contatoAutomacoes}
                  onToggle={(id, ativo) => updateAutomacao.mutate({ id, ativo })}
                  onDelete={(id) => deleteAutomacao.mutate(id)}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AutomacoesTable({
  automacoes,
  onToggle,
  onDelete,
  showStatus,
}: {
  automacoes: any[];
  onToggle: (id: string, ativo: boolean) => void;
  onDelete: (id: string) => void;
  showStatus?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showStatus && <TableHead>Status Alvo</TableHead>}
          <TableHead>Ação</TableHead>
          <TableHead>Detalhe</TableHead>
          <TableHead>Ativo</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {automacoes.map((a) => {
          const tipoInfo = TIPOS_ACAO.find((t) => t.value === a.tipo_acao);
          return (
            <TableRow key={a.id}>
              {showStatus && (
                <TableCell>
                  <Badge variant="outline" className="text-xs">{a.status_alvo || "—"}</Badge>
                </TableCell>
              )}
              <TableCell>
                <div className="flex items-center gap-1.5">
                  {tipoInfo && <tipoInfo.icon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-sm">{tipoInfo?.label || a.tipo_acao}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                {a.config?.template_name || a.config?.texto?.substring(0, 60) || a.config?.titulo || "—"}
              </TableCell>
              <TableCell>
                <Switch checked={a.ativo} onCheckedChange={(v) => onToggle(a.id, v)} />
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CreateAutomacaoForm({
  onSubmit,
  loading,
}: {
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [entidade, setEntidade] = useState("agendamento");
  const [statusAlvo, setStatusAlvo] = useState("");
  const [tipoAcao, setTipoAcao] = useState("enviar_template");
  const [templateName, setTemplateName] = useState("");
  const [templateParams, setTemplateParams] = useState("");
  const [texto, setTexto] = useState("");
  const [tituloTarefa, setTituloTarefa] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const config: Record<string, any> = {};

    if (tipoAcao === "enviar_template") {
      config.template_name = templateName;
      config.template_params = templateParams.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (tipoAcao === "enviar_mensagem") {
      config.texto = texto;
    } else if (tipoAcao === "criar_tarefa") {
      config.titulo = tituloTarefa;
    }

    onSubmit({
      entidade,
      status_alvo: entidade === "agendamento" ? statusAlvo || null : null,
      tipo_acao: tipoAcao,
      config,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Pipeline</Label>
          <Select value={entidade} onValueChange={setEntidade}>
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

      <div className="space-y-2">
        <Label>Tipo de Ação</Label>
        <Select value={tipoAcao} onValueChange={setTipoAcao}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIPOS_ACAO.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tipoAcao === "enviar_template" && (
        <>
          <div className="space-y-2">
            <Label>Nome do Template</Label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Ex: confirmacao_agendamento" />
          </div>
          <div className="space-y-2">
            <Label>Parâmetros (separados por vírgula)</Label>
            <Input value={templateParams} onChange={(e) => setTemplateParams(e.target.value)} placeholder="{{primeiro_nome}}, {{loja}}, {{hora}}" />
          </div>
        </>
      )}

      {tipoAcao === "enviar_mensagem" && (
        <div className="space-y-2">
          <Label>Texto da Mensagem</Label>
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="Olá {{primeiro_nome}}! ..." />
        </div>
      )}

      {tipoAcao === "criar_tarefa" && (
        <div className="space-y-2">
          <Label>Título da Tarefa</Label>
          <Input value={tituloTarefa} onChange={(e) => setTituloTarefa(e.target.value)} placeholder="Verificar agendamento {{loja}}" />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Criando..." : "Criar Automação"}
      </Button>
    </form>
  );
}
