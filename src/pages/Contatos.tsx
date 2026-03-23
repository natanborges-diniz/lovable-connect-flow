import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useContatos, useCreateContato, useUpdateContato } from "@/hooks/useContatos";
import { TipoContatoBadge, EstagioFunilBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { TipoContato, EstagioFunil } from "@/types/database";

export default function Contatos() {
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContato, setEditingContato] = useState<any>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const filters = {
    search: search || undefined,
    tipo: tipoFilter !== "todos" ? (tipoFilter as TipoContato) : undefined,
  };

  const { data: contatos, isLoading } = useContatos(filters);

  return (
    <>
      <PageHeader
        title="Contatos"
        description="Gerencie todos os contatos do CRM"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Contato</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo Contato</DialogTitle>
              </DialogHeader>
              <ContatoForm onSuccess={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        }
      />

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
          </DialogHeader>
          {editingContato && (
            <ContatoForm
              initialData={editingContato}
              onSuccess={() => {
                setEditDialogOpen(false);
                setEditingContato(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contatos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="cliente">Cliente</SelectItem>
                <SelectItem value="fornecedor">Fornecedor</SelectItem>
                <SelectItem value="loja">Loja</SelectItem>
                <SelectItem value="colaborador">Colaborador</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : !contatos?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum contato encontrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contatos.map((contato) => (
                  <TableRow key={contato.id}>
                    <TableCell className="font-medium">{contato.nome}</TableCell>
                    <TableCell><TipoContatoBadge tipo={contato.tipo} /></TableCell>
                    <TableCell><EstagioFunilBadge estagio={contato.estagio} /></TableCell>
                    <TableCell className="text-muted-foreground">{contato.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{contato.telefone ?? "—"}</TableCell>
                    <TableCell>
                      {contato.tags?.length ? (
                        <div className="flex gap-1 flex-wrap">
                          {contato.tags.map((tag) => (
                            <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">{tag}</span>
                          ))}
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingContato(contato);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ContatoForm({ onSuccess, initialData }: { onSuccess: () => void; initialData?: any }) {
  const createContato = useCreateContato();
  const updateContato = useUpdateContato();
  const isEditing = !!initialData;

  const [form, setForm] = useState({
    nome: initialData?.nome ?? "",
    tipo: (initialData?.tipo ?? "cliente") as TipoContato,
    estagio: (initialData?.estagio ?? "lead") as EstagioFunil,
    email: initialData?.email ?? "",
    telefone: initialData?.telefone ?? "",
    documento: initialData?.documento ?? "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      tipo: form.tipo,
      estagio: form.estagio,
      email: form.email || null,
      telefone: form.telefone || null,
      documento: form.documento || null,
    };

    if (isEditing) {
      updateContato.mutate({ id: initialData.id, ...payload }, { onSuccess });
    } else {
      createContato.mutate(payload, { onSuccess });
    }
  };

  const isPending = isEditing ? updateContato.isPending : createContato.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome *</Label>
        <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
      </div>
      <div className="space-y-2">
        <Label>Tipo</Label>
        <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoContato })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cliente">Cliente</SelectItem>
            <SelectItem value="fornecedor">Fornecedor</SelectItem>
            <SelectItem value="loja">Loja</SelectItem>
            <SelectItem value="colaborador">Colaborador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Estágio do Funil</Label>
        <Select value={form.estagio} onValueChange={(v) => setForm({ ...form, estagio: v as EstagioFunil })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="qualificado">Qualificado</SelectItem>
            <SelectItem value="proposta">Proposta</SelectItem>
            <SelectItem value="fechado">Fechado</SelectItem>
            <SelectItem value="perdido">Perdido</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Telefone</Label>
          <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Documento (CPF/CNPJ)</Label>
        <Input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (isEditing ? "Salvando..." : "Criando...") : (isEditing ? "Salvar Alterações" : "Criar Contato")}
      </Button>
    </form>
  );
}