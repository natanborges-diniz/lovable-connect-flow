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
import { Plus, Bot, GripVertical, Trash2, Loader2, Pencil, ChevronRight, FolderOpen, MessageSquare, Zap } from "lucide-react";
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
  tipo: string;
  parent_id: string | null;
  setor_id: string | null;
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

const TIPOS_OPCAO = [
  { value: "fluxo", label: "Fluxo", icon: Zap },
  { value: "submenu", label: "Sub-menu", icon: FolderOpen },
  { value: "falar_equipe", label: "Falar com Equipe", icon: MessageSquare },
];

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

function useSetores() {
  return useQuery({
    queryKey: ["setores_ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setores")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data || [];
    },
  });
}

// Build tree structure from flat list
function buildTree(opcoes: MenuOpcao[], parentId: string | null = null, depth = 0): Array<MenuOpcao & { depth: number }> {
  const result: Array<MenuOpcao & { depth: number }> = [];
  const children = opcoes.filter(o => o.parent_id === parentId).sort((a, b) => a.ordem - b.ordem);
  for (const child of children) {
    result.push({ ...child, depth });
    result.push(...buildTree(opcoes, child.id, depth + 1));
  }
  return result;
}

function getTipoIcon(tipo: string) {
  const found = TIPOS_OPCAO.find(t => t.value === tipo);
  return found?.icon || Zap;
}

function getTipoBadgeVariant(tipo: string): "default" | "secondary" | "outline" | "destructive" {
  if (tipo === "submenu") return "default";
  if (tipo === "falar_equipe") return "secondary";
  return "outline";
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

  const allFiltered = opcoes?.filter(o => filterTipoBot === "all" || o.tipo_bot === filterTipoBot) || [];
  const treeItems = buildTree(allFiltered, null);

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
                allOpcoes={opcoes || []}
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
          Menu hierárquico com sub-menus por setor. Opções tipo "Sub-menu" agrupam fluxos; "Falar com Equipe" notifica o setor internamente.
        </p>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !treeItems.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma opção cadastrada</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fluxo</TableHead>
                <TableHead>Bot</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {treeItems.map((op) => {
                const Icon = getTipoIcon(op.tipo);
                return (
                  <TableRow key={op.id} className={!op.ativo ? "opacity-40" : ""}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      <GripVertical className="h-4 w-4 inline mr-1 text-muted-foreground/50" />
                      {op.ordem}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1" style={{ paddingLeft: `${op.depth * 20}px` }}>
                        {op.depth > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                        <span className="text-lg mr-1">{op.emoji}</span>
                        {op.titulo}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getTipoBadgeVariant(op.tipo)} className="text-xs gap-1">
                        <Icon className="h-3 w-3" />
                        {TIPOS_OPCAO.find(t => t.value === op.tipo)?.label || op.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {op.tipo === "fluxo" && (
                        <Badge variant="outline" className="font-mono text-[10px]">{op.fluxo}</Badge>
                      )}
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
                );
              })}
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
              allOpcoes={opcoes || []}
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

function CreateOpcaoForm({ nextOrdem, allOpcoes, onSubmit }: { nextOrdem: number; allOpcoes: MenuOpcao[]; onSubmit: () => void }) {
  const [titulo, setTitulo] = useState("");
  const [emoji, setEmoji] = useState(`${nextOrdem}️⃣`);
  const [tipoBot, setTipoBot] = useState("loja");
  const [tipo, setTipo] = useState("fluxo");
  const [fluxo, setFluxo] = useState("");
  const [parentId, setParentId] = useState<string>("_none");
  const [setorId, setSetorId] = useState<string>("_none");
  const [loading, setLoading] = useState(false);
  const { data: fluxos } = useFluxosForSelect(tipoBot);
  const { data: setores } = useSetores();

  const subMenuParents = allOpcoes.filter(o => o.tipo === "submenu" && o.ativo);

  const chave = titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const handleCreate = async () => {
    if (!titulo.trim()) return;
    if (tipo === "fluxo" && !fluxo) return;
    setLoading(true);
    try {
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .insert({
          chave,
          titulo,
          emoji,
          fluxo: tipo === "fluxo" ? fluxo : (tipo === "submenu" ? "_submenu" : "_falar_equipe"),
          ordem: nextOrdem,
          tipo_bot: tipoBot,
          tipo,
          parent_id: parentId === "_none" ? null : parentId,
          setor_id: setorId === "_none" ? null : setorId,
        });
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
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: 💳 Cobranças" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Emoji</Label>
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="1️⃣" />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_OPCAO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo de Bot</Label>
          <Select value={tipoBot} onValueChange={(v) => { setTipoBot(v); setFluxo(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Pai (sub-menu)</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger><SelectValue placeholder="Raiz" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Raiz —</SelectItem>
              {subMenuParents.map(p => <SelectItem key={p.id} value={p.id}>{p.titulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {tipo === "fluxo" && (
        <div className="space-y-1.5">
          <Label>Fluxo</Label>
          <Select value={fluxo} onValueChange={setFluxo}>
            <SelectTrigger><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
            <SelectContent>
              {fluxos?.map(f => <SelectItem key={f.chave} value={f.chave}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {(tipo === "submenu" || tipo === "falar_equipe") && (
        <div className="space-y-1.5">
          <Label>Setor vinculado</Label>
          <Select value={setorId} onValueChange={setSetorId}>
            <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Nenhum —</SelectItem>
              {setores?.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {chave && (
        <p className="text-xs text-muted-foreground">Chave: <code className="bg-muted px-1 rounded">{chave}</code></p>
      )}
      <Button onClick={handleCreate} disabled={loading || !titulo.trim() || (tipo === "fluxo" && !fluxo)} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Criar Opção
      </Button>
    </div>
  );
}

function EditOpcaoForm({ item, allOpcoes, onSubmit }: { item: MenuOpcao; allOpcoes: MenuOpcao[]; onSubmit: () => void }) {
  const [titulo, setTitulo] = useState(item.titulo);
  const [emoji, setEmoji] = useState(item.emoji);
  const [tipoBot, setTipoBot] = useState(item.tipo_bot);
  const [tipo, setTipo] = useState(item.tipo || "fluxo");
  const [fluxo, setFluxo] = useState(item.fluxo);
  const [ordem, setOrdem] = useState(item.ordem);
  const [parentId, setParentId] = useState<string>(item.parent_id || "_none");
  const [setorId, setSetorId] = useState<string>(item.setor_id || "_none");
  const [descricao, setDescricao] = useState(item.descricao || "");
  const [loading, setLoading] = useState(false);
  const { data: fluxos } = useFluxosForSelect(tipoBot);
  const { data: setores } = useSetores();

  const subMenuParents = allOpcoes.filter(o => o.tipo === "submenu" && o.ativo && o.id !== item.id);

  const handleSave = async () => {
    if (!titulo.trim()) return;
    setLoading(true);
    try {
      const chave = titulo
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      const { error } = await (supabase as any)
        .from("bot_menu_opcoes")
        .update({
          titulo,
          emoji,
          fluxo: tipo === "fluxo" ? fluxo : (tipo === "submenu" ? "_submenu" : "_falar_equipe"),
          ordem,
          tipo_bot: tipoBot,
          tipo,
          chave,
          descricao: descricao || null,
          parent_id: parentId === "_none" ? null : parentId,
          setor_id: setorId === "_none" ? null : setorId,
        })
        .eq("id", item.id);
      if (error) throw error;
      toast.success("Opção atualizada");
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
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Emoji</Label>
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Ordem</Label>
          <Input type="number" value={ordem} onChange={(e) => setOrdem(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_OPCAO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tipo de Bot</Label>
          <Select value={tipoBot} onValueChange={(v) => { setTipoBot(v); setFluxo(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Pai (sub-menu)</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger><SelectValue placeholder="Raiz" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Raiz —</SelectItem>
              {subMenuParents.map(p => <SelectItem key={p.id} value={p.id}>{p.titulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {tipo === "fluxo" && (
        <div className="space-y-1.5">
          <Label>Fluxo</Label>
          <Select value={fluxo} onValueChange={setFluxo}>
            <SelectTrigger><SelectValue placeholder="Selecione um fluxo" /></SelectTrigger>
            <SelectContent>
              {fluxos?.map(f => <SelectItem key={f.chave} value={f.chave}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {(tipo === "submenu" || tipo === "falar_equipe") && (
        <div className="space-y-1.5">
          <Label>Setor vinculado</Label>
          <Select value={setorId} onValueChange={setSetorId}>
            <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Nenhum —</SelectItem>
              {setores?.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Descrição (opcional)</Label>
        <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Texto auxiliar" />
      </div>
      <Button onClick={handleSave} disabled={loading || !titulo.trim() || (tipo === "fluxo" && !fluxo)} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        Salvar Alterações
      </Button>
    </div>
  );
}
