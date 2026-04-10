import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, UserCheck, Phone } from "lucide-react";
import { toast } from "sonner";

interface Responsavel {
  id: string;
  fluxo_chave: string;
  nome: string;
  telefone: string;
  tipo: string;
  ativo: boolean;
}

interface TelefoneCorporativo {
  id: string;
  nome_loja: string;
  nome_colaborador: string | null;
  telefone: string;
  tipo: string;
  cargo: string | null;
  departamento: string | null;
}

function getLabel(t: TelefoneCorporativo): string {
  if (t.tipo === "colaborador" && t.nome_colaborador) {
    return `${t.nome_colaborador}${t.cargo ? ` (${t.cargo})` : ""} — ${t.telefone}`;
  }
  if (t.tipo === "departamento") {
    return `${t.nome_loja}${t.departamento ? ` / ${t.departamento}` : ""} — ${t.telefone}`;
  }
  return `${t.nome_loja} — ${t.telefone}`;
}

function getNome(t: TelefoneCorporativo): string {
  if (t.tipo === "colaborador" && t.nome_colaborador) return t.nome_colaborador;
  return t.nome_loja;
}

export function FluxoResponsaveisSection({ fluxoChave }: { fluxoChave: string }) {
  const queryClient = useQueryClient();
  const [selectedTelefoneId, setSelectedTelefoneId] = useState("");
  const [tipo, setTipo] = useState("primario");

  const { data: responsaveis, isLoading } = useQuery({
    queryKey: ["fluxo_responsaveis", fluxoChave],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fluxo_responsaveis")
        .select("*")
        .eq("fluxo_chave", fluxoChave)
        .order("tipo, nome");
      if (error) throw error;
      return (data || []) as Responsavel[];
    },
    enabled: !!fluxoChave,
  });

  const { data: telefonesCorporativos } = useQuery({
    queryKey: ["telefones_lojas_ativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("id, nome_loja, nome_colaborador, telefone, tipo, cargo, departamento")
        .eq("ativo", true)
        .order("tipo, nome_loja");
      if (error) throw error;
      return (data || []) as TelefoneCorporativo[];
    },
  });

  const addResponsavel = useMutation({
    mutationFn: async () => {
      const selected = telefonesCorporativos?.find((t) => t.id === selectedTelefoneId);
      if (!selected) throw new Error("Selecione um telefone corporativo");
      const { error } = await (supabase as any).from("fluxo_responsaveis").insert({
        fluxo_chave: fluxoChave,
        nome: getNome(selected),
        telefone: selected.telefone.replace(/\D/g, ""),
        tipo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fluxo_responsaveis", fluxoChave] });
      setSelectedTelefoneId("");
      toast.success("Responsável adicionado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any).from("fluxo_responsaveis").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fluxo_responsaveis", fluxoChave] }),
  });

  const removeResponsavel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("fluxo_responsaveis").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fluxo_responsaveis", fluxoChave] });
      toast.success("Responsável removido");
    },
  });

  if (!fluxoChave) return null;

  // Group by tipo
  const grouped = (telefonesCorporativos || []).reduce<Record<string, TelefoneCorporativo[]>>((acc, t) => {
    const key = t.tipo === "loja" ? "Lojas" : t.tipo === "colaborador" ? "Colaboradores" : "Departamentos";
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
      <Label className="text-sm font-semibold flex items-center gap-1.5">
        <UserCheck className="h-4 w-4" /> Responsáveis pelo Fluxo
      </Label>
      <p className="text-xs text-muted-foreground">
        Responsáveis recebem notificação via WhatsApp quando uma solicitação é criada por este fluxo.
      </p>

      {/* List */}
      {responsaveis?.map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-1.5 px-2 rounded bg-background border">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">{r.nome}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Phone className="h-3 w-3" /> {r.telefone}
            </span>
          </div>
          <Badge variant={r.tipo === "primario" ? "default" : "secondary"} className="text-[10px]">
            {r.tipo === "primario" ? "Primário" : "Contingência"}
          </Badge>
          <Switch
            checked={r.ativo}
            onCheckedChange={(v) => toggleAtivo.mutate({ id: r.id, ativo: v })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => removeResponsavel.mutate(r.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {!isLoading && !responsaveis?.length && (
        <p className="text-xs text-muted-foreground text-center py-2">Nenhum responsável cadastrado</p>
      )}

      {/* Add form */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Telefone Corporativo</Label>
          <Select value={selectedTelefoneId} onValueChange={setSelectedTelefoneId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {Object.entries(grouped).map(([grupo, items]) => (
                <div key={grupo}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {grupo}
                  </div>
                  {items.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {getLabel(t)}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[120px] space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="primario">Primário</SelectItem>
              <SelectItem value="contingencia">Contingência</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={() => addResponsavel.mutate()}
          disabled={!selectedTelefoneId}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
