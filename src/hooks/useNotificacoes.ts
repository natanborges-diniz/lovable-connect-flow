import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useNotificacoes() {
  const { user, profile, isAuthReady } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["notificacoes", user?.id],
    enabled: !!user && isAuthReady,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notificacoes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Array<{
        id: string;
        usuario_id: string | null;
        setor_id: string | null;
        titulo: string;
        mensagem: string | null;
        tipo: string;
        referencia_id: string | null;
        lida: boolean;
        created_at: string;
      }>;
    },
  });

  const naoLidas = query.data?.filter((n) => !n.lida)?.length || 0;

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notificacoes-realtime")
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "notificacoes" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["notificacoes", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const marcarLida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("notificacoes")
        .update({ lida: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes", user?.id] }),
  });

  const marcarTodasLidas = useMutation({
    mutationFn: async () => {
      const ids = query.data?.filter((n) => !n.lida).map((n) => n.id) || [];
      if (!ids.length) return;
      const { error } = await (supabase as any)
        .from("notificacoes")
        .update({ lida: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notificacoes", user?.id] }),
  });

  return { ...query, naoLidas, marcarLida, marcarTodasLidas };
}
