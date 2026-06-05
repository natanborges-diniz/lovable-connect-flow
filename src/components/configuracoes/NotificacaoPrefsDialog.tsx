import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Bell } from "lucide-react";
import { toast } from "sonner";

type Escopo = "todos" | "nenhum" | "meus_setores" | "setores_especificos";

const TIPOS: Array<{ key: string; label: string; help: string }> = [
  { key: "atendimento_inbound", label: "Mensagens de clientes (atendimento)", help: "Nova mensagem em atendimento humano" },
  { key: "atendimento_humano", label: "Atendimento escalado para humano", help: "Quando IA escala um chat" },
  { key: "demanda_loja", label: "Demandas de loja", help: "Estoque, financeiro, TI, etc." },
  { key: "mensagem_interna", label: "Mensagens internas", help: "Chat 1-a-1 e grupos internos" },
];

const ESCOPO_LABELS: Record<Escopo, string> = {
  todos: "Receber todas",
  nenhum: "Não receber",
  meus_setores: "Apenas dos meus setores",
  setores_especificos: "Setores específicos",
};

interface Pref {
  id?: string;
  user_id: string;
  tipo: string;
  escopo: Escopo;
  setor_ids: string[];
  ativo: boolean;
}

interface Props {
  userId: string | null;
  userName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function NotificacaoPrefsDialog({ userId, userName, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});

  const { data: setores } = useQuery({
    queryKey: ["setores-ativos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("id,nome").eq("ativo", true).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ["notif-prefs", userId],
    enabled: !!userId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notificacao_preferencias")
        .select("*")
        .eq("user_id", userId!);
      if (error) throw error;
      return data as Pref[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const map: Record<string, Pref> = {};
    for (const t of TIPOS) {
      const found = existing?.find((p) => p.tipo === t.key);
      map[t.key] = found ?? {
        user_id: userId,
        tipo: t.key,
        escopo: "todos",
        setor_ids: [],
        ativo: true,
      };
    }
    setPrefs(map);
  }, [existing, userId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { data: who } = await supabase.auth.getUser();
      const updated_by = who?.user?.id ?? null;
      const rows = Object.values(prefs).map((p) => ({
        user_id: p.user_id,
        tipo: p.tipo,
        escopo: p.escopo,
        setor_ids: p.escopo === "setores_especificos" ? p.setor_ids : [],
        ativo: p.ativo,
        updated_by,
      }));
      const { error } = await supabase
        .from("notificacao_preferencias")
        .upsert(rows, { onConflict: "user_id,tipo" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferências salvas");
      qc.invalidateQueries({ queryKey: ["notif-prefs-summary"] });
      qc.invalidateQueries({ queryKey: ["notif-prefs", userId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const updatePref = (tipo: string, patch: Partial<Pref>) =>
    setPrefs((cur) => ({ ...cur, [tipo]: { ...cur[tipo], ...patch } }));

  const toggleSetor = (tipo: string, setorId: string) =>
    setPrefs((cur) => {
      const list = cur[tipo].setor_ids ?? [];
      const next = list.includes(setorId) ? list.filter((s) => s !== setorId) : [...list, setorId];
      return { ...cur, [tipo]: { ...cur[tipo], setor_ids: next } };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notificações — {userName ?? "usuário"}
          </DialogTitle>
          <DialogDescription>
            Defina, por tipo, se este usuário recebe notificações no app e pode restringi-las a setores
            específicos. Apenas admins veem esta tela.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {TIPOS.map((t) => {
              const pref = prefs[t.key];
              if (!pref) return null;
              return (
                <div key={t.key} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label className="text-sm">{t.label}</Label>
                      <p className="text-xs text-muted-foreground">{t.help}</p>
                    </div>
                    <Switch
                      checked={pref.ativo}
                      onCheckedChange={(v) => updatePref(t.key, { ativo: v })}
                    />
                  </div>
                  {pref.ativo && (
                    <>
                      <Select
                        value={pref.escopo}
                        onValueChange={(v) => updatePref(t.key, { escopo: v as Escopo })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ESCOPO_LABELS) as Escopo[]).map((e) => (
                            <SelectItem key={e} value={e}>{ESCOPO_LABELS[e]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {pref.escopo === "setores_especificos" && (
                        <div className="grid grid-cols-2 gap-1 pt-1">
                          {setores?.map((s: any) => (
                            <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={pref.setor_ids.includes(s.id)}
                                onCheckedChange={() => toggleSetor(t.key, s.id)}
                              />
                              {s.nome}
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
