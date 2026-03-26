import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function useFeedbackStats() {
  return useQuery({
    queryKey: ["ia_feedbacks_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_feedbacks" as any)
        .select("avaliacao")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const total = data?.length || 0;
      const positivos = data?.filter((f: any) => f.avaliacao === "positivo").length || 0;
      const negativos = total - positivos;
      return { total, positivos, negativos, taxa: total > 0 ? Math.round((positivos / total) * 100) : 0 };
    },
  });
}

function useRecentNegativeFeedbacks() {
  return useQuery({
    queryKey: ["ia_feedbacks_negativos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_feedbacks" as any)
        .select("*")
        .neq("avaliacao", "positivo")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function FeedbacksTab() {
  const { data: stats } = useFeedbackStats();
  const { data: negativos } = useRecentNegativeFeedbacks();
  const queryClient = useQueryClient();

  const promoteToExample = async (feedback: any) => {
    if (!feedback.resposta_corrigida) {
      toast.error("Sem resposta corrigida para promover");
      return;
    }
    const { error } = await supabase.from("ia_exemplos" as any).insert({
      categoria: "correcao",
      pergunta: feedback.motivo || "Contexto não especificado",
      resposta_ideal: feedback.resposta_corrigida,
    } as any);
    if (error) toast.error(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
      toast.success("Promovido a exemplo modelo!");
    }
  };

  const promoteToRule = async (feedback: any) => {
    if (!feedback.motivo) {
      toast.error("Sem motivo para criar regra");
      return;
    }
    const regra = feedback.resposta_corrigida
      ? `${feedback.motivo}. Correto: ${feedback.resposta_corrigida}`
      : feedback.motivo;
    const { error } = await supabase.from("ia_regras_proibidas" as any).insert({
      regra,
      categoria: "informacao_falsa",
    } as any);
    if (error) toast.error(error.message);
    else {
      queryClient.invalidateQueries({ queryKey: ["ia_regras_proibidas"] });
      toast.success("Promovido a regra proibida!");
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold text-emerald-600">{stats.positivos}</p>
            <p className="text-[10px] text-muted-foreground">Positivos</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold text-destructive">{stats.negativos}</p>
            <p className="text-[10px] text-muted-foreground">Negativos</p>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold">{stats.taxa}%</p>
            <p className="text-[10px] text-muted-foreground">Acerto</p>
          </div>
        </div>
      )}

      {/* Negative feedbacks */}
      {!negativos?.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum feedback negativo recente.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-auto">
          {negativos.map((f: any) => (
            <div key={f.id} className="border border-destructive/20 rounded-lg p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-destructive font-medium">👎 {f.avaliacao}</span>
                <div className="flex gap-1">
                  {f.resposta_corrigida && (
                    <Button variant="outline" size="sm" className="h-5 text-[10px] gap-1" onClick={() => promoteToExample(f)}>
                      <ArrowRight className="h-3 w-3" /> Exemplo
                    </Button>
                  )}
                  {f.motivo && (
                    <Button variant="outline" size="sm" className="h-5 text-[10px] gap-1 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => promoteToRule(f)}>
                      <ShieldAlert className="h-3 w-3" /> Regra
                    </Button>
                  )}
                </div>
              </div>
              {f.motivo && <p className="text-muted-foreground"><strong>Motivo:</strong> {f.motivo}</p>}
              {f.resposta_corrigida && <p><strong>Correção:</strong> {f.resposta_corrigida}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
