import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Store, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function TelefonesLojasCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: telefones, isLoading } = useQuery({
    queryKey: ["telefones_lojas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("telefones_lojas" as any)
        .update({ ativo } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] }),
  });

  const deleteTelefone = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("telefones_lojas" as any)
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
    mutationFn: async (data: { telefone: string; nome_loja: string; cod_empresa?: string; departamento?: string }) => {
      const { error } = await supabase
        .from("telefones_lojas" as any)
        .insert(data as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telefones_lojas"] });
      toast.success("Telefone de loja cadastrado");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Store className="h-5 w-5" /> Telefones de Lojas
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Loja</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cadastrar Telefone de Loja</DialogTitle></DialogHeader>
            <CreateLojaForm onSubmit={(data) => createTelefone.mutate(data)} loading={createTelefone.isPending} />
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
                <TableHead>Cód. Empresa</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {telefones.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-sm">{t.telefone}</TableCell>
                  <TableCell className="font-medium">{t.nome_loja}</TableCell>
                  <TableCell className="text-muted-foreground">{t.cod_empresa || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.departamento || "geral"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={t.ativo}
                      onCheckedChange={(v) => toggleAtivo.mutate({ id: t.id, ativo: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteTelefone.mutate(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateLojaForm({ onSubmit, loading }: { onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ telefone: "", nome_loja: "", cod_empresa: "", departamento: "geral" });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          telefone: form.telefone.replace(/\D/g, ""),
          nome_loja: form.nome_loja,
          cod_empresa: form.cod_empresa || undefined,
          departamento: form.departamento || "geral",
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
        {loading ? "Cadastrando..." : "Cadastrar Loja"}
      </Button>
    </form>
  );
}
