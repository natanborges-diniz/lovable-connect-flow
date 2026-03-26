import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, ShieldAlert } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useRegrasProibidas() {
  return useQuery({
    queryKey: ["ia_regras_proibidas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_regras_proibidas" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

const CATEGORIAS = [
  { value: "informacao_falsa", label: "Informação Falsa" },
  { value: "comportamento", label: "Comportamento" },
  { value: "compliance", label: "Compliance / Legal" },
];

export function RegrasProibidasTab() {
  const { data: regras } = useRegrasProibidas();
  const [dialog, setDialog] = useState(false);
  const queryClient = useQueryClient();

  const toggleRegra = async (id: string, ativo: boolean) => {
    const { error } = await supabase.from("ia_regras_proibidas" as any).update({ ativo } as any).eq("id", id);
    if (error) toast.error(error.message);
    else queryClient.invalidateQueries({ queryKey: ["ia_regras_proibidas"] });
  };

  const deleteRegra = async (id: string) => {
    const { error } = await supabase.from("ia_regras_proibidas" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ["ia_regras_proibidas"] });
      toast.success("Regra removida");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Regras que a IA <strong>nunca</strong> deve violar. Têm peso máximo no prompt.
        </p>
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Regra</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Regra Proibida</DialogTitle></DialogHeader>
            <CreateRegraForm onSuccess={() => { setDialog(false); queryClient.invalidateQueries({ queryKey: ["ia_regras_proibidas"] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      {!regras?.length ? (
        <div className="text-center py-8 space-y-2">
          <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada.</p>
          <p className="text-xs text-muted-foreground">Adicione regras como "Óticas não fazem exame de vista".</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto">
          {regras.map((r: any) => (
            <div key={r.id} className="border border-destructive/20 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                  {CATEGORIAS.find(c => c.value === r.categoria)?.label || r.categoria}
                </Badge>
                <div className="flex items-center gap-1">
                  <Switch checked={r.ativo} onCheckedChange={(v) => toggleRegra(r.id, v)} />
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteRegra(r.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className={!r.ativo ? "opacity-50" : ""}>{r.regra}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateRegraForm({ onSuccess }: { onSuccess: () => void }) {
  const [regra, setRegra] = useState("");
  const [categoria, setCategoria] = useState("informacao_falsa");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.from("ia_regras_proibidas" as any).insert({ regra, categoria } as any);
      if (error) throw error;
      toast.success("Regra criada!");
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
            {CATEGORIAS.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Regra *</Label>
        <Textarea
          value={regra}
          onChange={(e) => setRegra(e.target.value)}
          rows={3}
          placeholder="Ex: Óticas Diniz NÃO fazem exame de vista. É proibido por lei em óticas. Podemos indicar profissionais próximos."
          className="text-xs"
          required
        />
      </div>
      <Button type="submit" className="w-full" size="sm" disabled={saving || !regra.trim()}>
        {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</> : "Criar Regra"}
      </Button>
    </form>
  );
}
