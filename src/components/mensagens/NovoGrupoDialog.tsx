import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCriarGrupo } from "@/hooks/useMensagensInternas";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (grupoId: string) => void;
}

type TipoOrigem = "setor" | "loja";

export function NovoGrupoDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const [tipo, setTipo] = useState<TipoOrigem>("setor");
  const [origemRef, setOrigemRef] = useState<string>("");
  const [nome, setNome] = useState("");
  const [setores, setSetores] = useState<{ id: string; nome: string }[]>([]);
  const [lojas, setLojas] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ id: string; nome: string }[]>([]);
  const [existentes, setExistentes] = useState<Set<string>>(new Set());
  const criar = useCriarGrupo();

  // Carrega fontes (setores e lojas) e grupos já existentes para evitar duplicação
  useEffect(() => {
    if (!open) return;
    setTipo("setor");
    setOrigemRef("");
    setNome("");
    setPreview([]);

    (async () => {
      const [setRes, lojaRes, jaRes] = await Promise.all([
        supabase.from("setores").select("id, nome").eq("ativo", true).order("nome"),
        supabase
          .from("profiles")
          .select("metadata")
          .eq("ativo", true)
          .not("metadata->>loja_nome", "is", null),
        supabase
          .from("conversas_grupo")
          .select("tipo_origem, origem_ref")
          .neq("tipo_origem", "custom"),
      ]);
      setSetores((setRes.data as any[] | null) || []);
      const lojaSet = new Set<string>();
      for (const p of (lojaRes.data as any[] | null) || []) {
        const ln = p?.metadata?.loja_nome;
        if (ln) lojaSet.add(ln);
      }
      setLojas([...lojaSet].sort());
      setExistentes(
        new Set(((jaRes.data as any[] | null) || []).map((g) => `${g.tipo_origem}:${g.origem_ref}`))
      );
    })();
  }, [open]);

  // Preview dos membros derivados + nome sugerido
  useEffect(() => {
    if (!origemRef) {
      setPreview([]);
      return;
    }
    (async () => {
      let q = supabase.from("profiles").select("id, nome").eq("ativo", true).order("nome");
      if (tipo === "setor") q = q.eq("setor_id", origemRef);
      else q = q.eq("metadata->>loja_nome", origemRef);
      const { data } = await q;
      setPreview((data as any[]) || []);
      if (!nome) {
        const sugestao =
          tipo === "setor"
            ? `Setor — ${setores.find((s) => s.id === origemRef)?.nome ?? ""}`
            : `Loja — ${origemRef}`;
        setNome(sugestao);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, origemRef]);

  const opcoes = useMemo(
    () =>
      tipo === "setor"
        ? setores.map((s) => ({ value: s.id, label: s.nome }))
        : lojas.map((l) => ({ value: l, label: l })),
    [tipo, setores, lojas]
  );

  const jaExiste = origemRef ? existentes.has(`${tipo}:${origemRef}`) : false;

  const handleCriar = async () => {
    if (!user) return;
    if (!origemRef) {
      toast.error(tipo === "setor" ? "Escolha um setor" : "Escolha uma loja");
      return;
    }
    if (jaExiste) {
      toast.error("Já existe um grupo para essa opção");
      return;
    }
    if (preview.length === 0) {
      toast.error("Nenhum usuário ativo nessa origem");
      return;
    }
    try {
      const grupo = await criar.mutateAsync({
        nome: nome.trim(),
        tipoOrigem: tipo,
        origemRef,
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
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Origem</Label>
            <RadioGroup
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as TipoOrigem);
                setOrigemRef("");
                setNome("");
                setPreview([]);
              }}
              className="flex gap-4 mt-1"
            >
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="setor" /> Setor
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <RadioGroupItem value="loja" /> Loja
              </label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-1">
              Os mesmos canais usados no atendimento humano. Membros sincronizam automaticamente.
            </p>
          </div>

          <div>
            <Label className="text-xs">{tipo === "setor" ? "Setor" : "Loja"}</Label>
            <Select value={origemRef} onValueChange={setOrigemRef}>
              <SelectTrigger>
                <SelectValue placeholder={tipo === "setor" ? "Escolha um setor" : "Escolha uma loja"} />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((o) => {
                  const dup = existentes.has(`${tipo}:${o.value}`);
                  return (
                    <SelectItem key={o.value} value={o.value} disabled={dup}>
                      {o.label} {dup ? "(grupo já existe)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="grupo-nome" className="text-xs">Nome do grupo</Label>
            <Input
              id="grupo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome sugerido automaticamente"
              maxLength={80}
            />
          </div>

          {origemRef && (
            <div>
              <Label className="text-xs">Membros ({preview.length}) — somente leitura</Label>
              <ScrollArea className="h-40 mt-1 border rounded">
                {preview.map((p) => (
                  <div key={p.id} className="px-3 py-1.5 text-sm">{p.nome}</div>
                ))}
                {preview.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhum usuário ativo</p>
                )}
              </ScrollArea>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCriar} disabled={criar.isPending || jaExiste || !origemRef}>
            {criar.isPending ? "Criando..." : "Criar grupo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
