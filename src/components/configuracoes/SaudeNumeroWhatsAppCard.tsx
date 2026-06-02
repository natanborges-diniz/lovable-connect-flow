import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type QualityData = {
  quality_rating?: string | null;
  messaging_limit_tier?: string | null;
  display_phone_number?: string | null;
  verified_name?: string | null;
};

const TIER_LABELS: Record<string, string> = {
  TIER_50: "50 conversas/dia",
  TIER_250: "250 conversas/dia",
  TIER_1K: "1.000 conversas/dia",
  TIER_10K: "10.000 conversas/dia",
  TIER_100K: "100.000 conversas/dia",
  TIER_UNLIMITED: "Ilimitado",
};

function QualityBadge({ rating }: { rating?: string | null }) {
  const map: Record<string, { label: string; className: string }> = {
    GREEN: { label: "Alta", className: "bg-success-soft text-success border-success" },
    YELLOW: { label: "Média", className: "bg-warning-soft text-warning border-warning-muted" },
    RED: { label: "Baixa", className: "bg-destructive/10 text-destructive border-destructive/40" },
  };
  const cfg = (rating && map[rating]) || { label: "Sem dados", className: "bg-muted text-muted-foreground border-border" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

export function SaudeNumeroWhatsAppCard() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QualityData | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerificar = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: fnError } = await supabase.functions.invoke(
        "manage-whatsapp-templates",
        { body: { action: "quality" } }
      );
      if (fnError) throw fnError;
      setData(resp as QualityData);
      setCheckedAt(new Date());
    } catch (e: any) {
      setError(
        "Não foi possível verificar a saúde do número agora. Tente novamente em instantes."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" /> Saúde do número WhatsApp
        </CardTitle>
        <Button size="sm" onClick={handleVerificar} disabled={loading}>
          {loading ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Verificando...</>
          ) : (
            "Verificar qualidade"
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!data && !error && !loading && (
          <p className="text-sm text-muted-foreground">
            Clique em "Verificar qualidade" para consultar o status atual do número junto à Meta.
          </p>
        )}

        {data && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Qualidade</span>
              <div><QualityBadge rating={data.quality_rating} /></div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Limite de mensagens</span>
              <p className="text-sm font-medium">
                {(data.messaging_limit_tier && TIER_LABELS[data.messaging_limit_tier]) || "—"}
              </p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Número</span>
              <p className="text-sm font-mono">{data.display_phone_number || "—"}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Nome verificado</span>
              <p className="text-sm font-medium">{data.verified_name || "—"}</p>
            </div>
          </div>
        )}

        {checkedAt && (
          <p className="text-xs text-muted-foreground">
            Última verificação: {checkedAt.toLocaleString("pt-BR")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
