import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, MessageSquareText, Smartphone, Radio } from "lucide-react";

export function CanalUnicoCard() {
  const { data: templates } = useQuery({
    queryKey: ["canal-unico-templates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_templates")
        .select("id, status")
        .eq("status", "approved");
      return data || [];
    },
  });

  const { data: pushTokens } = useQuery({
    queryKey: ["canal-unico-push-tokens"],
    queryFn: async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("ativo", true);
      return count || 0;
    },
  });

  const metaOk = (templates?.length || 0) >= 1;
  const appOk = (pushTokens || 0) >= 1; // proxy: usuários ativos prontos para receber via Realtime/app

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Radio className="h-5 w-5" /> Canal Único Ativo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Dois canais únicos: <strong>WhatsApp Meta Official</strong> só para clientes finais, e
          <strong> App Atrium Messenger</strong> para tudo interno (lojas, colaboradores, setores).
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium text-sm">
                <MessageSquareText className="h-4 w-4 text-primary" />
                WhatsApp (Meta Official)
              </div>
              {metaOk ? (
                <Badge className="bg-success-soft text-success border-success">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Pronto
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-warning-soft text-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Aguardando templates
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Clientes finais. Texto livre dentro de 24h; fora exige template aprovado pela Meta.
            </p>
            <p className="text-xs">
              Templates aprovados: <strong>{templates?.length || 0}</strong>
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Smartphone className="h-4 w-4 text-primary" />
                App Atrium Messenger
              </div>
              {appOk ? (
                <Badge className="bg-success-soft text-success border-success">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Pronto
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-warning-soft text-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Sem usuários
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Lojas, colaboradores, departamentos. Mensagens internas em tempo real + push.
            </p>
            <p className="text-xs">
              Usuários ativos: <strong>{pushTokens || 0}</strong>
            </p>
          </div>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground border">
          <strong>Importante:</strong> Bots de loja/colaborador via WhatsApp foram descontinuados.
          Toda interação corporativa migrou para o app Atrium Messenger.
        </div>
      </CardContent>
    </Card>
  );
}
