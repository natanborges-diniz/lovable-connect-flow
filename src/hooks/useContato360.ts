import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export interface TimelineItem {
  fonte: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  ocorrido_at: string;
  referencia_tipo: string | null;
  referencia_id: string | null;
  metadata: Record<string, unknown> | null;
}

export function useContato(id?: string) {
  return useQuery({
    queryKey: ["contato-360", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("contatos").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useContatoKpis(id?: string) {
  return useQuery({
    queryKey: ["contato-kpis", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contato_kpis" as any, { _contato_id: id });
      if (error) throw error;
      return data as Record<string, any>;
    },
  });
}

export function useContatoTimeline(id?: string, filtros?: string[]) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`contato-timeline-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "eventos_crm", filter: `contato_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["contato-timeline", id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  return useQuery({
    queryKey: ["contato-timeline", id, filtros],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contato_timeline" as any, {
        _contato_id: id,
        _limit: 300,
        _offset: 0,
        _filtros: filtros && filtros.length > 0 ? filtros : null,
      });
      if (error) throw error;
      return (data || []) as TimelineItem[];
    },
  });
}

export function useContatoCanais(id?: string) {
  return useQuery({
    queryKey: ["contato-canais", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("canais").select("*").eq("contato_id", id!);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useContatoCashback(id?: string) {
  return useQuery({
    queryKey: ["contato-cashback", id],
    enabled: !!id,
    queryFn: async () => {
      const [creditos, resgates] = await Promise.all([
        supabase.from("cashback_credito").select("*").eq("contato_id", id!).order("criado_em", { ascending: false }),
        supabase.from("cashback_resgate").select("*").eq("contato_id", id!).order("data_uso", { ascending: false }),
      ]);
      return { creditos: creditos.data || [], resgates: resgates.data || [] };
    },
  });
}

export function useContatoConsentimentos(id?: string) {
  return useQuery({
    queryKey: ["contato-consentimentos", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("regua_inscricao")
        .select("id,numero_venda,termos_versao,canal_consentimento,consentimento_status,pin_confirmado_at,ip_origem_consultor,criado_em")
        .eq("contato_id", id!)
        .not("pin_confirmado_at", "is", null)
        .order("pin_confirmado_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}
