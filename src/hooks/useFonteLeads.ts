import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FontePeriodo = "7d" | "30d" | "90d" | "all";

export interface FonteLeadRow {
  id: string;
  fonte: "site" | "instagram" | "outro";
  created_at: string;
}

const periodoToDate = (p: FontePeriodo): string | null => {
  if (p === "all") return null;
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

export function useFonteLeads(periodo: FontePeriodo = "30d") {
  return useQuery<FonteLeadRow[]>({
    queryKey: ["fonte-leads", periodo],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("contatos")
        .select("id, metadata, created_at")
        .eq("tipo", "cliente")
        .limit(5000);
      const since = periodoToDate(periodo);
      if (since) q = q.gte("created_at", since);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((c: any) => {
        const f = c.metadata?.fonte_lead;
        const fonte: FonteLeadRow["fonte"] =
          f === "site" || f === "instagram" ? f : "outro";
        return { id: c.id, fonte, created_at: c.created_at };
      });
    },
  });
}
