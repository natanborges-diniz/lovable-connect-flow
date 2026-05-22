import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Shield, CheckCircle2, XCircle, Loader2, FileText, AlertTriangle } from "lucide-react";

interface Props {
  metadata: any;
  isMine: boolean;
}

export function AutorizacaoExcecaoCard({ metadata, isMine }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [decisao, setDecisao] = useState<"aprovar" | "rejeitar" | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);

  const autorizacaoId = metadata?.autorizacao_id;
  const processoNome = metadata?.processo_nome || metadata?.processo_chave || "Exceção";
  const motivo = metadata?.motivo;
  const contexto = metadata?.contexto || {};

  const { data: autz, refetch } = useQuery({
    queryKey: ["autorizacao_excecao", autorizacaoId],
    queryFn: async () => {
      const { data } = await supabase
        .from("autorizacoes_excecao")
        .select("status, justificativa_resposta, respondido_at, autorizador_nome")
        .eq("id", autorizacaoId)
        .maybeSingle();
      return data;
    },
    enabled: !!autorizacaoId,
    refetchInterval: 8000,
  });

  const status = autz?.status || "pendente";
  const isAutorizador = !isMine && status === "pendente";

  const handleResponder = async (d: "aprovar" | "rejeitar") => {
    setEnviando(true);
    try {
      const { error } = await supabase.functions.invoke("responder-autorizacao", {
        body: {
          autorizacao_id: autorizacaoId,
          decisao: d,
          justificativa: justificativa.trim() || null,
        },
      });
      if (error) throw error;
      toast.success(d === "aprovar" ? "Exceção aprovada." : "Exceção rejeitada.");
      setDecisao(null);
      setJustificativa("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["mensagens_conversa"] });
    } catch (e: any) {
      toast.error("Erro: " + (e.message || "falha"));
    } finally {
      setEnviando(false);
    }
  };

  const statusBadge = () => {
    if (status === "aprovada") return <Badge className="bg-green-600">Aprovada</Badge>;
    if (status === "rejeitada") return <Badge variant="destructive">Não aprovada</Badge>;
    return <Badge variant="outline">Pendente</Badge>;
  };

  return (
    <div className="border rounded-lg p-3 bg-background text-foreground space-y-2 max-w-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          <Shield className="h-4 w-4 text-primary" />
          {processoNome}
        </div>
        {statusBadge()}
      </div>

      {motivo && (
        <p className="text-xs whitespace-pre-wrap border-l-2 border-primary/40 pl-2">{motivo}</p>
      )}

      {/* Detalhes de contexto (CPF, valores, etc.) */}
      {Object.keys(contexto).length > 0 && (
        <div className="text-[11px] grid grid-cols-2 gap-1 bg-muted/40 rounded p-2">
          {contexto.nome_cliente && <div><b>Cliente:</b> {contexto.nome_cliente}</div>}
          {contexto.cpf && <div><b>CPF:</b> {contexto.cpf}</div>}
          {contexto.valor_compra != null && <div><b>Compra:</b> R$ {Number(contexto.valor_compra).toFixed(2)}</div>}
          {contexto.valor_entrada != null && <div><b>Entrada:</b> R$ {Number(contexto.valor_entrada).toFixed(2)}</div>}
          {contexto.resultado_consulta && <div className="col-span-2"><b>Resultado:</b> {contexto.resultado_consulta}</div>}
        </div>
      )}

      {/* Documento da consulta (score) */}
      {contexto.documento_url ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs"
          onClick={async () => {
            try {
              const { data, error } = await supabase.storage
                .from("cpf-documentos")
                .createSignedUrl(contexto.documento_url, 600);
              if (error) throw error;
              window.open(data.signedUrl, "_blank");
            } catch (e: any) {
              toast.error("Erro ao abrir documento: " + (e.message || "falha"));
            }
          }}
        >
          <FileText className="h-3.5 w-3.5 mr-1" />
          Abrir documento da consulta (score)
        </Button>
      ) : (
        isAutorizador && (
          <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Pedido sem documento da consulta anexado. Considere não aprovar e pedir o score ao Financeiro.</span>
          </div>
        )
      )}

      {/* Resposta já dada */}
      {status !== "pendente" && (
        <div className="text-xs text-muted-foreground">
          {status === "aprovada" ? "✅ Aprovado" : "❌ Não aprovado"}
          {autz?.autorizador_nome && ` por ${autz.autorizador_nome}`}
          {autz?.justificativa_resposta && (
            <p className="italic mt-1">"{autz.justificativa_resposta}"</p>
          )}
        </div>
      )}

      {/* Botões de resposta para o autorizador */}
      {isAutorizador && (
        <div className="space-y-2 pt-1">
          {decisao && (
            <Textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder={decisao === "aprovar" ? "Observação (opcional)" : "Motivo da rejeição (recomendado)"}
              rows={2}
              className="text-xs"
            />
          )}
          <div className="flex gap-2">
            {!decisao ? (
              <>
                <Button
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8"
                  onClick={() => setDecisao("aprovar")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1 h-8"
                  onClick={() => setDecisao("rejeitar")}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Não aprovar
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className={`flex-1 h-8 ${decisao === "aprovar" ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                  variant={decisao === "rejeitar" ? "destructive" : "default"}
                  onClick={() => handleResponder(decisao)}
                  disabled={enviando}
                >
                  {enviando ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Confirmar {decisao === "aprovar" ? "aprovação" : "rejeição"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setDecisao(null)} disabled={enviando}>
                  Cancelar
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
