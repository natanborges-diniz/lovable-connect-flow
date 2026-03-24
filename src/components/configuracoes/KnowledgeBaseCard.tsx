import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, BookOpen, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useConhecimentos() {
  return useQuery({
    queryKey: ["conhecimento_ia"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conhecimento_ia" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

const CATEGORIAS = [
  { value: "produtos", label: "Produtos" },
  { value: "servicos", label: "Serviços" },
  { value: "politicas", label: "Políticas" },
  { value: "faq", label: "FAQ" },
];

export function KnowledgeBaseCard() {
  const { data: items, isLoading } = useConhecimentos();
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const createItem = useMutation({
    mutationFn: async (item: { categoria: string; titulo: string; conteudo: any }) => {
      const { error } = await supabase
        .from("conhecimento_ia" as any)
        .insert(item as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conhecimento_ia"] });
      toast.success("Item adicionado à base de conhecimento");
      setDialogOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase
        .from("conhecimento_ia" as any)
        .update({ ativo } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conhecimento_ia"] }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("conhecimento_ia" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conhecimento_ia"] });
      toast.success("Item removido");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Base de Conhecimento
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Item</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Novo Item de Conhecimento</DialogTitle></DialogHeader>
            <CreateKnowledgeForm
              onSubmit={(data) => createItem.mutate(data)}
              loading={createItem.isPending}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Cole aqui JSONs com dados de produtos, serviços, políticas ou FAQ. A IA consultará automaticamente essa base para responder perguntas dos clientes.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando...</p>
        ) : !items?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum item cadastrado na base de conhecimento</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => {
                const preview = JSON.stringify(item.conteudo).slice(0, 80);
                const catLabel = CATEGORIAS.find(c => c.value === item.categoria)?.label || item.categoria;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.titulo}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{catLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono max-w-[200px] truncate">
                      {preview}{preview.length >= 80 ? "…" : ""}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.ativo}
                        onCheckedChange={(v) => toggleAtivo.mutate({ id: item.id, ativo: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteItem.mutate(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CreateKnowledgeForm({ onSubmit, loading }: {
  onSubmit: (data: { categoria: string; titulo: string; conteudo: any }) => void;
  loading: boolean;
}) {
  const [categoria, setCategoria] = useState("produtos");
  const [titulo, setTitulo] = useState("");
  const [conteudoStr, setConteudoStr] = useState("");
  const [jsonError, setJsonError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(conteudoStr);
      setJsonError("");
      onSubmit({ categoria, titulo, conteudo: parsed });
    } catch {
      setJsonError("JSON inválido. Verifique a formatação.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Categoria *</Label>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIAS.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Título *</Label>
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          required
          placeholder="Ex: Catálogo de Produtos Março 2025"
        />
      </div>
      <div className="space-y-2">
        <Label>Conteúdo JSON *</Label>
        <Textarea
          value={conteudoStr}
          onChange={(e) => { setConteudoStr(e.target.value); setJsonError(""); }}
          rows={10}
          className="font-mono text-xs"
          placeholder='[{"nome": "Produto X", "preco": 150, "disponivel": true}]'
          required
        />
        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
        <p className="text-xs text-muted-foreground">{conteudoStr.length} caracteres</p>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !titulo || !conteudoStr}>
        {loading ? "Salvando..." : "Adicionar à Base"}
      </Button>
    </form>
  );
}
