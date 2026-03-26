import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useExemplos() {
  return useQuery({
    queryKey: ["ia_exemplos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_exemplos" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function ExemplosTab() {
  const { data: exemplos } = useExemplos();
  const [dialog, setDialog] = useState(false);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const toggleExemplo = async (id: string, ativo: boolean) => {
    const { error } = await supabase.from("ia_exemplos" as any).update({ ativo } as any).eq("id", id);
    if (error) toast.error(error.message);
    else queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
  };

  const deleteExemplo = async (id: string) => {
    const { error } = await supabase.from("ia_exemplos" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
      toast.success("Exemplo removido");
    }
  };

  const filtered = exemplos?.filter((ex: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return ex.pergunta?.toLowerCase().includes(s) || ex.resposta_ideal?.toLowerCase().includes(s) || ex.categoria?.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar exemplos..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Exemplo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Exemplo Modelo</DialogTitle></DialogHeader>
            <CreateExemploForm onSuccess={() => { setDialog(false); queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground">
        {exemplos?.length || 0} exemplos modelo — até 30 são injetados no prompt da IA.
      </p>

      {!filtered?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum exemplo encontrado.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto">
          {filtered.map((ex: any) => (
            <div key={ex.id} className="border rounded-lg p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">{ex.categoria}</Badge>
                <div className="flex items-center gap-1">
                  <Switch checked={ex.ativo} onCheckedChange={(v) => toggleExemplo(ex.id, v)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteExemplo(ex.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className="text-muted-foreground"><strong>Pergunta:</strong> {ex.pergunta}</p>
              <p><strong>Resposta ideal:</strong> {ex.resposta_ideal}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateExemploForm({ onSuccess }: { onSuccess: () => void }) {
  const [categoria, setCategoria] = useState("produtos");
  const [pergunta, setPergunta] = useState("");
  const [respostaIdeal, setRespostaIdeal] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.from("ia_exemplos" as any).insert({
        categoria, pergunta, resposta_ideal: respostaIdeal,
      } as any);
      if (error) throw error;
      toast.success("Exemplo criado!");
      onSuccess();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Categoria</Label>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="produtos">Produtos</SelectItem>
            <SelectItem value="reclamacao">Reclamação</SelectItem>
            <SelectItem value="orcamento">Orçamento</SelectItem>
            <SelectItem value="informacoes">Informações</SelectItem>
            <SelectItem value="correcao">Correção</SelectItem>
            <SelectItem value="geral">Geral</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Pergunta do cliente *</Label>
        <Textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)} rows={2} placeholder="Ex: Quanto custa a lente multifocal?" className="text-xs" required />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Resposta ideal *</Label>
        <Textarea value={respostaIdeal} onChange={(e) => setRespostaIdeal(e.target.value)} rows={3} placeholder="Ex: As lentes multifocais começam a partir de R$..." className="text-xs" required />
      </div>
      <Button type="submit" className="w-full" size="sm" disabled={saving || !pergunta || !respostaIdeal}>
        {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</> : "Criar Exemplo"}
      </Button>
    </form>
  );
}
