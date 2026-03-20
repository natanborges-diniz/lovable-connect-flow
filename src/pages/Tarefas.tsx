import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useTarefas, useCreateTarefa, useUpdateTarefaStatus, useChecklistItems, useCreateChecklistItem, useToggleChecklistItem } from "@/hooks/useTarefas";
import { PrioridadeBadge, TarefaStatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Plus, Search, CheckSquare, ListTodo } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { StatusTarefa, Prioridade } from "@/types/database";

export default function Tarefas() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filters = {
    search: search || undefined,
    status: statusFilter !== "todos" ? (statusFilter as StatusTarefa) : undefined,
  };

  const { data: tarefas, isLoading } = useTarefas(filters);
  const updateStatus = useUpdateTarefaStatus();

  return (
    <>
      <PageHeader
        title="Tarefas"
        description="Execução operacional e checklists"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Tarefa</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Nova Tarefa</DialogTitle></DialogHeader>
              <CreateTarefaForm onSuccess={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por título..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : !tarefas?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma tarefa encontrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Solicitação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tarefas.map((t: any) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(t.id)}>
                    <TableCell className="font-medium">{t.titulo}</TableCell>
                    <TableCell className="text-muted-foreground">{t.solicitacao?.assunto ?? "—"}</TableCell>
                    <TableCell><TarefaStatusBadge status={t.status} /></TableCell>
                    <TableCell><PrioridadeBadge prioridade={t.prioridade} /></TableCell>
                    <TableCell className="text-muted-foreground">{t.responsavel_nome ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {t.prazo_at ? format(new Date(t.prazo_at), "dd/MM/yy", { locale: ptBR }) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(t.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          {detailId && <TarefaDetail id={detailId} onStatusChange={(status) => updateStatus.mutate({ id: detailId, status })} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TarefaDetail({ id, onStatusChange }: { id: string; onStatusChange: (s: StatusTarefa) => void }) {
  const { data: tarefas } = useTarefas();
  const tarefa = tarefas?.find((t: any) => t.id === id) as any;
  const { data: checklist } = useChecklistItems(id);
  const createItem = useCreateChecklistItem();
  const toggleItem = useToggleChecklistItem();
  const [newItem, setNewItem] = useState("");

  const total = checklist?.length ?? 0;
  const done = checklist?.filter((c: any) => c.concluido).length ?? 0;
  const progress = total > 0 ? (done / total) * 100 : 0;

  const handleAddItem = () => {
    if (!newItem.trim()) return;
    createItem.mutate({ tarefa_id: id, titulo: newItem.trim(), ordem: total });
    setNewItem("");
  };

  if (!tarefa) return null;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          {tarefa.titulo}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <TarefaStatusBadge status={tarefa.status} />
          <PrioridadeBadge prioridade={tarefa.prioridade} />
          {tarefa.responsavel_nome && <span className="text-sm text-muted-foreground">• {tarefa.responsavel_nome}</span>}
        </div>

        {tarefa.descricao && (
          <div>
            <span className="text-sm text-muted-foreground">Descrição:</span>
            <p className="text-sm mt-1">{tarefa.descricao}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          {tarefa.solicitacao?.assunto && (
            <div>
              <span className="text-muted-foreground">Solicitação:</span>
              <p className="font-medium">{tarefa.solicitacao.assunto}</p>
            </div>
          )}
          {tarefa.prazo_at && (
            <div>
              <span className="text-muted-foreground">Prazo:</span>
              <p className="font-medium">{format(new Date(tarefa.prazo_at), "dd/MM/yyyy", { locale: ptBR })}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Label className="text-sm whitespace-nowrap">Alterar status:</Label>
          <Select value={tarefa.status} onValueChange={(v) => onStatusChange(v as StatusTarefa)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="em_andamento">Em Andamento</SelectItem>
              <SelectItem value="concluida">Concluída</SelectItem>
              <SelectItem value="cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Checklist */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Checklist
            </h4>
            {total > 0 && <span className="text-xs text-muted-foreground">{done}/{total}</span>}
          </div>

          {total > 0 && <Progress value={progress} className="h-1.5 mb-3" />}

          <div className="space-y-1">
            {checklist?.map((item: any) => (
              <div key={item.id} className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={item.concluido}
                  onCheckedChange={(checked) =>
                    toggleItem.mutate({ id: item.id, concluido: !!checked, tarefa_id: id })
                  }
                />
                <span className={`text-sm ${item.concluido ? "line-through text-muted-foreground" : ""}`}>
                  {item.titulo}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-2">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Novo item..."
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddItem(); } }}
            />
            <Button size="sm" variant="outline" onClick={handleAddItem} disabled={!newItem.trim()}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function CreateTarefaForm({ onSuccess }: { onSuccess: () => void }) {
  const createTarefa = useCreateTarefa();
  const [form, setForm] = useState({
    titulo: "",
    descricao: "",
    prioridade: "normal" as Prioridade,
    responsavel_nome: "",
    prazo_at: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createTarefa.mutate(
      {
        titulo: form.titulo,
        descricao: form.descricao || null,
        prioridade: form.prioridade,
        responsavel_nome: form.responsavel_nome || null,
        prazo_at: form.prazo_at || null,
      },
      { onSuccess }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Título *</Label>
        <Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Prioridade</Label>
          <Select value={form.prioridade} onValueChange={(v) => setForm({ ...form, prioridade: v as Prioridade })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="baixa">Baixa</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="critica">Crítica</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Responsável</Label>
          <Input value={form.responsavel_nome} onChange={(e) => setForm({ ...form, responsavel_nome: e.target.value })} placeholder="Nome do responsável" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Prazo</Label>
        <Input type="date" value={form.prazo_at} onChange={(e) => setForm({ ...form, prazo_at: e.target.value })} />
      </div>
      <Button type="submit" className="w-full" disabled={createTarefa.isPending || !form.titulo}>
        {createTarefa.isPending ? "Criando..." : "Criar Tarefa"}
      </Button>
    </form>
  );
}
