import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCriarGrupo } from "@/hooks/useMensagensInternas";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (grupoId: string) => void;
}

export function NovoGrupoDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<{ id: string; nome: string }[]>([]);
  const criar = useCriarGrupo();

  useEffect(() => {
    if (!open) return;
    setNome("");
    setBusca("");
    setSelecionados(new Set());
    supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => {
        setProfiles((data || []).filter((p) => p.id !== user?.id));
      });
  }, [open, user?.id]);

  const filtrados = profiles.filter((p) =>
    p.nome.toLowerCase().includes(busca.toLowerCase())
  );

  const toggle = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCriar = async () => {
    if (!user) return;
    if (!nome.trim()) {
      toast.error("Dê um nome ao grupo");
      return;
    }
    if (selecionados.size < 2) {
      toast.error("Selecione pelo menos 2 participantes");
      return;
    }
    try {
      const grupo = await criar.mutateAsync({
        nome: nome.trim(),
        participantes: Array.from(selecionados),
        criadoPor: user.id,
      });
      toast.success("Grupo criado");
      onOpenChange(false);
      onCreated?.(grupo.id);
    } catch (e: any) {
      toast.error("Erro ao criar grupo: " + (e?.message || ""));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo grupo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="grupo-nome" className="text-xs">Nome do grupo</Label>
            <Input
              id="grupo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Equipe Loja Centro"
              maxLength={80}
            />
          </div>
          <div>
            <Label className="text-xs">Participantes ({selecionados.size})</Label>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar usuário..."
              className="mt-1 h-8 text-sm"
            />
            <ScrollArea className="h-64 mt-2 border rounded">
              {filtrados.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={selecionados.has(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                  />
                  <span>{p.nome}</span>
                </label>
              ))}
              {filtrados.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum usuário</p>
              )}
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCriar} disabled={criar.isPending}>
            {criar.isPending ? "Criando..." : "Criar grupo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
