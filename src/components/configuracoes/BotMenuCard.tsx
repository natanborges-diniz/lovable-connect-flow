import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Bot, GripVertical, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface MenuOpcao {
  id: string;
  chave: string;
  titulo: string;
  emoji: string;
  descricao: string | null;
  fluxo: string;
  ordem: number;
  ativo: boolean;
}

function useMenuOpcoes() {
  return useQuery({
    queryKey: ["bot_menu_opcoes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .select("*")
        .order("ordem");
      if (error) throw error;
      return (data || []) as MenuOpcao[];
    },
  });
}

export function BotMenuCard() {
  const { data: opcoes, isLoading } = useMenuOpcoes();
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
    },
  });

  const deleteOpcao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
      toast.success("Opção removida");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const createOpcao = useMutation({
    mutationFn: async (opcao: { chave: string; titulo: string; emoji: string; fluxo: string; ordem: number }) => {
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .insert(opcao);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
      toast.success("Opção criada");
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const fluxosDisponiveis = [
    { value: "link_pagamento", label: "Link de Pagamento" },
    { value: "gerar_boleto", label: "Gerar Boleto" },
    { value: "consulta_cpf", label: "Consulta CPF" },
    { value: "confirmar_comparecimento", label: "Confirmar Comparecimento" },
  ];

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" /> Menu do Bot (Lojas)
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Opção</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Opção do Menu</DialogTitle></DialogHeader>
            <CreateOpcaoForm
              fluxos={fluxosDisponiveis}
              nextOrdem={(opcoes?.length || 0) + 1}
              onSubmit={(data) => createOpcao.mutate(data)}
              loading={createOpcao.isPending}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Configure as opções exibidas no menu interativo do bot de autoatendimento das lojas.
        </p>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !opcoes?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma opção cadastrada</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-16">Emoji</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Fluxo</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opcoes.map((op) => (
                <TableRow key={op.id}>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    <GripVertical className="h-4 w-4 inline mr-1 text-muted-foreground/50" />
                    {op.ordem}
                  </TableCell>
                  <TableCell className="text-lg">{op.emoji}</TableCell>
                  <TableCell className="font-medium">{op.titulo}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">{op.fluxo}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={op.ativo}
                      onCheckedChange={(v) => toggleAtivo.mutate({ id: op.id, ativo: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteOpcao.mutate(op.id)}
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

function CreateOpcaoForm({
  fluxos,
  nextOrdem,
  onSubmit,
  loading,
}: {
  fluxos: { value: string; label: string }[];
  nextOrdem: number;
  onSubmit: (data: { chave: string; titulo: string; emoji: string; fluxo: string; ordem: number }) => void;
  loading: boolean;
}) {
  const [titulo, setTitulo] = useState("");
  const [emoji, setEmoji] = useState(`${nextOrdem}️⃣`);
  const [fluxo, setFluxo] = useState(fluxos[0]?.value || "");

  const chave = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Título</Label>
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Consultar Estoque" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Emoji</Label>
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="1️⃣" />
        </div>
        <div className="space-y-1.5">
          <Label>Fluxo</Label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={fluxo}
            onChange={(e) => setFluxo(e.target.value)}
          >
            {fluxos.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>
      {chave && (
        <p className="text-xs text-muted-foreground">Chave: <code className="bg-muted px-1 rounded">{chave}</code></p>
      )}
      <Button
        onClick={() => onSubmit({ chave, titulo, emoji, fluxo, ordem: nextOrdem })}
        disabled={loading || !titulo.trim() || !fluxo}
        className="w-full"
      >
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Criar Opção
      </Button>
    </div>
  );
}
