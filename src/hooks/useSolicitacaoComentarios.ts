import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useSolicitacaoComentarios(solicitacaoId: string | undefined) {
  return useQuery({
    queryKey: ["solicitacao_comentarios", solicitacaoId],
    enabled: !!solicitacaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("solicitacao_comentarios")
        .select("*")
        .eq("solicitacao_id", solicitacaoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{
        id: string;
        solicitacao_id: string;
        autor_id: string | null;
        autor_nome: string | null;
        conteudo: string;
        tipo: string;
        created_at: string;
      }>;
    },
  });
}

export function useCreateComentario() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      solicitacao_id,
      conteudo,
      tipo,
    }: {
      solicitacao_id: string;
      conteudo: string;
      tipo: "interno" | "resposta_cliente" | "retorno_setor" | "resposta_loja";
    }) => {
      // Diálogo setor↔loja: via edge function (insere + notifica o outro lado)
      if (tipo === "retorno_setor" || tipo === "resposta_loja") {
        const destino = tipo === "retorno_setor" ? "loja" : "setor";
        const { data, error } = await supabase.functions.invoke("comentar-solicitacao", {
          body: { solicitacao_id, conteudo, destino },
        });
        if (error) throw error;
        return data;
      }

      // Insert comment (interno / resposta_cliente)
      const { data, error } = await (supabase as any)
        .from("solicitacao_comentarios")
        .insert({
          solicitacao_id,
          autor_id: user?.id || null,
          autor_nome: profile?.nome || "Sistema",
          conteudo,
          tipo,
        })
        .select()
        .single();
      if (error) throw error;

      if (tipo === "resposta_cliente") {
        const { error: fnError } = await supabase.functions.invoke("responder-solicitacao", {
          body: { solicitacao_id, mensagem: conteudo },
        });
        if (fnError) throw fnError;
      }

      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["solicitacao_comentarios", vars.solicitacao_id] });
      const msg =
        vars.tipo === "resposta_cliente" ? "Resposta enviada ao solicitante via WhatsApp" :
        vars.tipo === "retorno_setor" ? "Observação enviada à loja" :
        vars.tipo === "resposta_loja" ? "Resposta enviada ao setor" :
        "Comentário adicionado";
      toast.success(msg);
    },
    onError: (error: any) => {
      toast.error("Erro: " + error.message);
    },
  });
}
