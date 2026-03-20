import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSolicitacoes, useCreateSolicitacao, useUpdateSolicitacaoStatus } from "@/hooks/useSolicitacoes";
import { useContatos } from "@/hooks/useContatos";
import { StatusBadge, PrioridadeBadge, TipoContatoBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { StatusSolicitacao, Prioridade, TipoCanal, TipoContato } from "@/types/database";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

export default function Solicitacoes() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filters = {
    search: search || undefined,
    status: statusFilter !== "todos" ? (statusFilter as StatusSolicitacao) : undefined,
  };

  const { data: solicitacoes, isLoading } = useSolicitacoes(filters);
  const updateStatus = useUpdateSolicitacaoStatus();

  const detailItem = detailId ? solicitacoes?.find((s) => s.id === detailId) : null;

  return (
    <>
      <PageHeader
        title="Solicitações"
        description="Gerencie todas as solicitações do sistema"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Solicitação</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nova Solicitação</DialogTitle>
              </DialogHeader>
              <CreateSolicitacaoForm onSuccess={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por assunto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aberta">Aberta</SelectItem>
                <SelectItem value="classificada">Classificada</SelectItem>
                <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                <SelectItem value="aguardando_execucao">Aguardando Execução</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
                <SelectItem value="reaberta">Reaberta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : !solicitacoes?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhuma solicitação encontrada</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {solicitacoes.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(s.id)}>
                    <TableCell className="font-medium">{s.assunto}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{(s.contato as any)?.nome}</span>
                        {(s.contato as any)?.tipo && <TipoContatoBadge tipo={(s.contato as any).tipo as TipoContato} />}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell><PrioridadeBadge prioridade={s.prioridade} /></TableCell>
                    <TableCell className="text-muted-foreground capitalize">{s.canal_origem}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(s.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
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
          {detailItem && (
            <>
              <DialogHeader>
                <DialogTitle>{detailItem.assunto}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <StatusBadge status={detailItem.status} />
                  <PrioridadeBadge prioridade={detailItem.prioridade} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Contato:</span>
                    <p className="font-medium">{(detailItem.contato as any)?.nome}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Canal:</span>
                    <p className="font-medium capitalize">{detailItem.canal_origem}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Criada em:</span>
                    <p className="font-medium">{format(new Date(detailItem.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                  </div>
                  {detailItem.tipo && (
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <p className="font-medium">{detailItem.tipo}</p>
                    </div>
                  )}
                </div>
                {detailItem.descricao && (
                  <div>
                    <span className="text-sm text-muted-foreground">Descrição:</span>
                    <p className="text-sm mt-1">{detailItem.descricao}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Label className="text-sm whitespace-nowrap">Alterar status:</Label>
                  <Select
                    value={detailItem.status}
                    onValueChange={(v) => updateStatus.mutate({ id: detailItem.id, status: v as StatusSolicitacao })}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aberta">Aberta</SelectItem>
                      <SelectItem value="classificada">Classificada</SelectItem>
                      <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                      <SelectItem value="aguardando_execucao">Aguardando Execução</SelectItem>
                      <SelectItem value="concluida">Concluída</SelectItem>
                      <SelectItem value="cancelada">Cancelada</SelectItem>
                      <SelectItem value="reaberta">Reaberta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateSolicitacaoForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: contatos } = useContatos();
  const createSolicitacao = useCreateSolicitacao();
  const [form, setForm] = useState({
    contato_id: "",
    assunto: "",
    descricao: "",
    tipo: "",
    prioridade: "normal" as Prioridade,
    canal_origem: "sistema" as TipoCanal,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSolicitacao.mutate(
      {
        contato_id: form.contato_id,
        assunto: form.assunto,
        descricao: form.descricao || null,
        tipo: form.tipo || null,
        prioridade: form.prioridade,
        canal_origem: form.canal_origem,
      },
      { onSuccess }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Contato *</Label>
        <Select value={form.contato_id} onValueChange={(v) => setForm({ ...form, contato_id: v })}>
          <SelectTrigger><SelectValue placeholder="Selecione um contato" /></SelectTrigger>
          <SelectContent>
            {contatos?.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nome} ({c.tipo})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Assunto *</Label>
        <Input value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })} required />
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
          <Label>Canal de Origem</Label>
          <Select value={form.canal_origem} onValueChange={(v) => setForm({ ...form, canal_origem: v as TipoCanal })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sistema">Sistema</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="telefone">Telefone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Tipo</Label>
        <Input value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} placeholder="Ex: Troca, Dúvida, Financeiro..." />
      </div>
      <Button type="submit" className="w-full" disabled={createSolicitacao.isPending || !form.contato_id}>
        {createSolicitacao.isPending ? "Criando..." : "Criar Solicitação"}
      </Button>
    </form>
  );
}
