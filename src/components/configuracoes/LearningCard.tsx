import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Plus, Trash2, ThumbsUp, ThumbsDown, ArrowRight, Loader2 } from "lucide-react";
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

function useFeedbackStats() {
  return useQuery({
    queryKey: ["ia_feedbacks_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_feedbacks" as any)
        .select("avaliacao")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const total = data?.length || 0;
      const positivos = data?.filter((f: any) => f.avaliacao === "positivo").length || 0;
      const negativos = data?.filter((f: any) => f.avaliacao !== "positivo").length || 0;
      return { total, positivos, negativos, taxa: total > 0 ? Math.round((positivos / total) * 100) : 0 };
    },
  });
}

function useRecentNegativeFeedbacks() {
  return useQuery({
    queryKey: ["ia_feedbacks_negativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_feedbacks" as any)
        .select("*")
        .neq("avaliacao", "positivo")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function LearningCard() {
  const { data: exemplos } = useExemplos();
  const { data: stats } = useFeedbackStats();
  const { data: negativos } = useRecentNegativeFeedbacks();
  const [dialog, setDialog] = useState(false);
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

  const promoteToExample = async (feedback: any) => {
    if (!feedback.resposta_corrigida) {
      toast.error("Este feedback não tem resposta corrigida para promover");
      return;
    }
    const { error } = await supabase.from("ia_exemplos" as any).insert({
      categoria: "correcao",
      pergunta: feedback.motivo || "Contexto não especificado",
      resposta_ideal: feedback.resposta_corrigida,
    } as any);
    if (error) toast.error(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
      toast.success("Feedback promovido a exemplo modelo!");
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="h-5 w-5" /> Aprendizado da IA
        </CardTitle>
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Exemplo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Exemplo Modelo</DialogTitle></DialogHeader>
            <CreateExemploForm onSuccess={() => { setDialog(false); queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] }); }} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-[10px] text-muted-foreground">Total feedbacks</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-emerald-600">{stats.positivos}</p>
              <p className="text-[10px] text-muted-foreground">Positivos</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-destructive">{stats.negativos}</p>
              <p className="text-[10px] text-muted-foreground">Negativos</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">{stats.taxa}%</p>
              <p className="text-[10px] text-muted-foreground">Taxa acerto</p>
            </div>
          </div>
        )}

        {/* Exemplos */}
        <div>
          <h4 className="text-sm font-medium mb-2">Exemplos Modelo ({exemplos?.length || 0})</h4>
          {!exemplos?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum exemplo cadastrado. Adicione exemplos para melhorar as respostas da IA.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-auto">
              {exemplos.map((ex: any) => (
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

        {/* Recent negative feedbacks */}
        {negativos && negativos.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Feedbacks negativos recentes</h4>
            <div className="space-y-2 max-h-40 overflow-auto">
              {negativos.map((f: any) => (
                <div key={f.id} className="border border-destructive/20 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-destructive font-medium">👎 {f.avaliacao}</span>
                    {f.resposta_corrigida && (
                      <Button variant="outline" size="sm" className="h-5 text-[10px] gap-1" onClick={() => promoteToExample(f)}>
                        <ArrowRight className="h-3 w-3" /> Promover a exemplo
                      </Button>
                    )}
                  </div>
                  {f.motivo && <p className="text-muted-foreground"><strong>Motivo:</strong> {f.motivo}</p>}
                  {f.resposta_corrigida && <p><strong>Correção:</strong> {f.resposta_corrigida}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
        categoria,
        pergunta,
        resposta_ideal: respostaIdeal,
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
