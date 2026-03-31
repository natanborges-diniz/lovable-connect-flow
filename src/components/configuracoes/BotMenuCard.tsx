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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Bot, GripVertical, Trash2, Loader2, Pencil } from "lucide-react";
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
  tipo_bot: string;
}

interface Fluxo {
  id: string;
  chave: string;
  nome: string;
  tipo_bot: string;
}

const TIPOS_BOT = [
  { value: "loja", label: "Loja" },
  { value: "colaborador", label: "Colaborador" },
  { value: "cliente_lab", label: "Cliente Lab" },
];

function useMenuOpcoes() {
  return useQuery({
    queryKey: ["bot_menu_opcoes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .select("*")
        .order("tipo_bot, ordem");
      if (error) throw error;
      return (data || []) as MenuOpcao[];
    },
  });
}

function useFluxosForSelect(tipoBot: string) {
  return useQuery({
    queryKey: ["bot_fluxos_select", tipoBot],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bot_fluxos")
        .select("id, chave, nome, tipo_bot")
        .eq("ativo", true)
        .eq("tipo_bot", tipoBot)
        .order("nome");
      if (error) throw error;
      return (data || []) as Fluxo[];
    },
  });
}

export function BotMenuCard() {
  const { data: opcoes, isLoading } = useMenuOpcoes();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<MenuOpcao | null>(null);
  const [filterTipoBot, setFilterTipoBot] = useState<string>("all");
  const queryClient = useQueryClient();

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any).from("bot_menu_opcoes").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] }),
  });

  const deleteOpcao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("bot_menu_opcoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
      toast.success("Opção removida");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const filtered = opcoes?.filter(o => filterTipoBot === "all" || o.tipo_bot === filterTipoBot) || [];

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" /> Menu do Bot
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={filterTipoBot} onValueChange={setFilterTipoBot}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Opção</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova Opção do Menu</DialogTitle></DialogHeader>
              <CreateOpcaoForm
                nextOrdem={(opcoes?.length || 0) + 1}
                onSubmit={() => {
                  queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
                  setDialogOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Configure as opções exibidas no menu interativo do bot. Filtre por tipo de bot para gerenciar menus específicos.
        </p>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma opção cadastrada</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-16">Emoji</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Fluxo</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((op) => (
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
                    <Badge variant="secondary" className="text-xs">{op.tipo_bot}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch checked={op.ativo} onCheckedChange={(v) => toggleAtivo.mutate({ id: op.id, ativo: v })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditItem(op)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteOpcao.mutate(op.id)}>
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

      <Dialog open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Opção do Menu</DialogTitle></DialogHeader>
          {editItem && (
            <EditOpcaoForm
              item={editItem}
              onSubmit={() => {
                queryClient.invalidateQueries({ queryKey: ["bot_menu_opcoes"] });
                setEditItem(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateOpcaoForm({ nextOrdem, onSubmit }: { nextOrdem: number; onSubmit: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [emoji, setEmoji] = useState(`${nextOrdem}️⃣`);
  const [tipoBot, setTipoBot] = useState("loja");
  const [fluxo, setFluxo] = useState("");
  const [loading, setLoading] = useState(false);
  const { data: fluxos } = useFluxosForSelect(tipoBot);

  const chave = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const handleCreate = async () => {
    if (!titulo.trim() || !fluxo) return;
    setLoading(true);
    try {
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .insert({ chave, titulo, emoji, fluxo, ordem: nextOrdem, tipo_bot: tipoBot });
      if (error) throw error;
      toast.success("Opção criada");
      onSubmit();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setLoading(false);
    }
  };

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
          <Label>Tipo de Bot</Label>
          <Select value={tipoBot} onValueChange={(v) => { setTipoBot(v); setFluxo(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Fluxo</Label>
        <Select value={fluxo} onValueChange={setFluxo}>
          <SelectTrigger><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
          <SelectContent>
            {fluxos?.map(f => <SelectItem key={f.chave} value={f.chave}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {chave && (
        <p className="text-xs text-muted-foreground">Chave: <code className="bg-muted px-1 rounded">{chave}</code></p>
      )}
      <Button onClick={handleCreate} disabled={loading || !titulo.trim() || !fluxo} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Criar Opção
      </Button>
    </div>
  );
}
