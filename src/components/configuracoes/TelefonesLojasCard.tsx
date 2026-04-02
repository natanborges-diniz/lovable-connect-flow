import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Store, Trash2, Pencil, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LojaFormData {
  telefone: string;
  nome_loja: string;
  cod_empresa?: string;
  departamento?: string;
  endereco?: string;
  horario_abertura?: string;
  horario_fechamento?: string;
  google_profile_url?: string;
}

export function TelefonesLojasCard() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingLoja, setEditingLoja] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: telefones, isLoading } = useQuery({
    queryKey: ["telefones_lojas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("telefones_lojas")
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }),
  });

  const deleteTelefone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("telefones_lojas")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] });
      toast.success("Telefone removido");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createTelefone = useMutation({
    mutationFn: async (data: LojaFormData) => {
      const { error } = await supabase
        .from("telefones_lojas")
        .insert({
          telefone: data.telefone,
          nome_loja: data.nome_loja,
          cod_empresa: data.cod_empresa,
          departamento: data.departamento,
          endereco: data.endereco,
          horario_abertura: data.horario_abertura,
          horario_fechamento: data.horario_fechamento,
          google_profile_url: data.google_profile_url,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] });
      toast.success("Telefone de loja cadastrado");
      setCreateDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateTelefone = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: LojaFormData }) => {
      const { error } = await supabase
        .from("telefones_lojas")
        .update({
          telefone: data.telefone,
          nome_loja: data.nome_loja,
          cod_empresa: data.cod_empresa,
          departamento: data.departamento,
          endereco: data.endereco,
          horario_abertura: data.horario_abertura,
          horario_fechamento: data.horario_fechamento,
          google_profile_url: data.google_profile_url,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] });
      toast.success("Loja atualizada");
      setEditDialogOpen(false);
      setEditingLoja(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleEdit = (loja: any) => {
    setEditingLoja(loja);
    setEditDialogOpen(true);
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Store className="h-5 w-5" /> Telefones de Lojas
        </CardTitle>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Loja</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cadastrar Telefone de Loja</DialogTitle></DialogHeader>
            <LojaForm onSubmit={(data) => createTelefone.mutate(data)} loading={createTelefone.isPending} submitLabel="Cadastrar Loja" />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Telefones cadastrados aqui são identificados automaticamente e direcionados ao bot de autoatendimento (em vez do assistente IA).
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : !telefones?.length ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum telefone de loja cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefone</TableHead>
                <TableHead>Loja</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Horário</TableHead>
                <TableHead>Google</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {telefones.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-sm">{t.telefone}</TableCell>
                  <TableCell className="font-medium">{t.nome_loja}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">{t.endereco || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">{t.horario_abertura || "—"} – {t.horario_fechamento || "—"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={t.ativo ?? true}
                      onCheckedChange={(v) => toggleAtivo.mutate({ id: t.id, ativo: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleEdit(t)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteTelefone.mutate(t.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingLoja(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Loja</DialogTitle></DialogHeader>
          {editingLoja && (
            <LojaForm
              initialData={{
                telefone: editingLoja.telefone,
                nome_loja: editingLoja.nome_loja,
                cod_empresa: editingLoja.cod_empresa || "",
                departamento: editingLoja.departamento || "geral",
                endereco: editingLoja.endereco || "",
                horario_abertura: editingLoja.horario_abertura || "09:00",
                horario_fechamento: editingLoja.horario_fechamento || "18:00",
              }}
              onSubmit={(data) => updateTelefone.mutate({ id: editingLoja.id, data })}
              loading={updateTelefone.isPending}
              submitLabel="Salvar Alterações"
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LojaForm({
  onSubmit,
  loading,
  submitLabel,
  initialData,
}: {
  onSubmit: (data: LojaFormData) => void;
  loading: boolean;
  submitLabel: string;
  initialData?: {
    telefone: string;
    nome_loja: string;
    cod_empresa: string;
    departamento: string;
    endereco: string;
    horario_abertura: string;
    horario_fechamento: string;
  };
}) {
  const [form, setForm] = useState(
    initialData || {
      telefone: "",
      nome_loja: "",
      cod_empresa: "",
      departamento: "geral",
      endereco: "",
      horario_abertura: "09:00",
      horario_fechamento: "18:00",
    }
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          telefone: form.telefone.replace(/\D/g, ""),
          nome_loja: form.nome_loja,
          cod_empresa: form.cod_empresa || undefined,
          departamento: form.departamento || "geral",
          endereco: form.endereco || undefined,
          horario_abertura: form.horario_abertura || "09:00",
          horario_fechamento: form.horario_fechamento || "18:00",
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>Telefone *</Label>
        <Input
          value={form.telefone}
          onChange={(e) => setForm({ ...form, telefone: e.target.value })}
          placeholder="5511999999999"
          className="font-mono"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Nome da Loja *</Label>
        <Input
          value={form.nome_loja}
          onChange={(e) => setForm({ ...form, nome_loja: e.target.value })}
          placeholder="Ex: Ótica Centro"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Endereço</Label>
        <Input
          value={form.endereco}
          onChange={(e) => setForm({ ...form, endereco: e.target.value })}
          placeholder="Ex: Av. Autonomistas, 1768, Loja E19, Osasco"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Horário Abertura</Label>
          <Input
            type="time"
            value={form.horario_abertura}
            onChange={(e) => setForm({ ...form, horario_abertura: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Horário Fechamento</Label>
          <Input
            type="time"
            value={form.horario_fechamento}
            onChange={(e) => setForm({ ...form, horario_fechamento: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Cód. Empresa</Label>
          <Input
            value={form.cod_empresa}
            onChange={(e) => setForm({ ...form, cod_empresa: e.target.value })}
            placeholder="Ex: 001"
          />
        </div>
        <div className="space-y-2">
          <Label>Departamento</Label>
          <Input
            value={form.departamento}
            onChange={(e) => setForm({ ...form, departamento: e.target.value })}
            placeholder="geral"
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !form.telefone || !form.nome_loja}>
        {loading ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
