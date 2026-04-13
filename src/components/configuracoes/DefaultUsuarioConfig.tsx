import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type AppRole = "admin" | "operador" | "setor_usuario";

function useConfigValue(chave: string) {
  return useQuery({
    queryKey: ["config-ia", chave],
    queryFn: async () => {
      const { data } = await supabase
        .from("configuracoes_ia")
        .select("valor")
        .eq("chave", chave)
        .maybeSingle();
      return data?.valor || "";
    },
  });
}

function useSetores() {
  return useQuery({
    queryKey: ["setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("*").eq("ativo", true).order("nome");
      if (error) throw error;
      return data;
    },
  });
}

export function DefaultUsuarioConfig() {
  const queryClient = useQueryClient();
  const { data: defaultRole } = useConfigValue("default_role");
  const { data: defaultSetorId } = useConfigValue("default_setor_id");
  const { data: setores } = useSetores();

  const upsertConfig = useMutation({
    mutationFn: async ({ chave, valor }: { chave: string; valor: string }) => {
      const { data: existing } = await supabase
        .from("configuracoes_ia")
        .select("id")
        .eq("chave", chave)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("configuracoes_ia")
          .update({ valor })
          .eq("chave", chave);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("configuracoes_ia")
          .insert({ chave, valor });
        if (error) throw error;
      }
    },
    onSuccess: (_, { chave }) => {
      queryClient.invalidateQueries({ queryKey: ["config-ia", chave] });
      toast.success("Configuração salva");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="flex flex-wrap items-end gap-4 p-4 rounded-lg border bg-muted/30 mb-4">
      <p className="w-full text-sm font-medium text-muted-foreground">
        Padrão para novos usuários (aplicado automaticamente no primeiro login)
      </p>
      <div className="space-y-1">
        <Label className="text-xs">Role padrão</Label>
        <Select
          value={defaultRole || "none"}
          onValueChange={(v) =>
            upsertConfig.mutate({ chave: "default_role", valor: v === "none" ? "" : v })
          }
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Nenhuma" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhuma</SelectItem>
            <SelectItem value="setor_usuario">Setor</SelectItem>
            <SelectItem value="operador">Operador</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Setor padrão</Label>
        <Select
          value={defaultSetorId || "none"}
          onValueChange={(v) =>
            upsertConfig.mutate({ chave: "default_setor_id", valor: v === "none" ? "" : v })
          }
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Nenhum" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum</SelectItem>
            {setores?.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
