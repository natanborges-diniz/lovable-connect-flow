import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, BellRing } from "lucide-react";
import { toast } from "sonner";

interface FallbackCfg {
  setor_id: string | null;
  user_ids: string[];
  incluir_admins: boolean;
}

const KEY = "fallback_destinatarios_atendimento";

export function FallbackNotificacoesCard() {
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<FallbackCfg>({ setor_id: null, user_ids: [], incluir_admins: false });

  const { data: setores } = useQuery({
    queryKey: ["setores-ativos"],
    queryFn: async () => {
      const { data } = await supabase.from("setores").select("id,nome").eq("ativo", true).order("nome");
      return data ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-ativos-corp"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,nome,tipo_usuario,ativo")
        .eq("ativo", true)
        .neq("tipo_usuario", "loja")
        .order("nome");
      return data ?? [];
    },
  });

  const { data: row, isLoading } = useQuery({
    queryKey: ["cfg-fallback"],
    queryFn: async () => {
      const { data } = await supabase.from("configuracoes_ia").select("valor").eq("chave", KEY).maybeSingle();
      return data?.valor as unknown as FallbackCfg | undefined;
    },
  });

  useEffect(() => {
    if (row) setCfg({
      setor_id: row.setor_id ?? null,
      user_ids: row.user_ids ?? [],
      incluir_admins: !!row.incluir_admins,
    });
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("configuracoes_ia")
        .upsert({ chave: KEY, valor: cfg as any }, { onConflict: "chave" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plantão de notificações atualizado");
      qc.invalidateQueries({ queryKey: ["cfg-fallback"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao salvar"),
  });

  const toggleUser = (id: string) =>
    setCfg((c) => ({
      ...c,
      user_ids: c.user_ids.includes(id) ? c.user_ids.filter((u) => u !== id) : [...c.user_ids, id],
    }));

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BellRing className="h-5 w-5" /> Plantão de notificações (fallback)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Quando um atendimento não tem atendente atribuído nem setor definido na coluna do pipeline,
          quem recebe a notificação? <strong>Sem configuração, ninguém recebe</strong> — evite ruído notificando
          todos os admins.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Setor responsável</Label>
              <Select
                value={cfg.setor_id ?? "none"}
                onValueChange={(v) => setCfg((c) => ({ ...c, setor_id: v === "none" ? null : v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {setores?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Todos os usuários ativos vinculados a este setor receberão.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-2">
              <div>
                <Label className="text-xs">Incluir todos os admins</Label>
                <p className="text-[10px] text-muted-foreground">
                  Marque apenas se admins devem receber tudo que cair no fallback.
                </p>
              </div>
              <Switch
                checked={cfg.incluir_admins}
                onCheckedChange={(v) => setCfg((c) => ({ ...c, incluir_admins: v }))}
              />
            </div>

            <div>
              <Label className="text-xs">Usuários extras (opcional)</Label>
              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto rounded-md border p-2 mt-1">
                {profiles?.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={cfg.user_ids.includes(p.id)}
                      onCheckedChange={() => toggleUser(p.id)}
                    />
                    <span className="truncate">{p.nome}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Salvar plantão
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
