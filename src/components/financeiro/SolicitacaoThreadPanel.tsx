import { useEffect, useState } from "react";
import { useSolicitacaoComentarios, useCreateComentario } from "@/hooks/useSolicitacaoComentarios";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  solicitacaoId: string;
  /** Perspectiva de quem está usando o painel: setor responde à loja, loja responde ao setor. */
  perspectiva?: "setor" | "loja";
  title?: string;
}

/**
 * Thread de diálogo dentro de uma solicitação (setor ↔ loja).
 * Reaproveitado no drawer do PipelineFinanceiro e na página Solicitações.
 * Não altera status/coluna do card — apenas troca de mensagens.
 */
export function SolicitacaoThreadPanel({ solicitacaoId, perspectiva = "setor", title }: Props) {
  const { data: comentarios, isLoading } = useSolicitacaoComentarios(solicitacaoId);
  const createComentario = useCreateComentario();
  const [texto, setTexto] = useState("");
  const queryClient = useQueryClient();

  // Realtime: recarrega ao chegar comentário novo (loja respondeu, etc.)
  useEffect(() => {
    if (!solicitacaoId) return;
    const channel = supabase
      .channel(`solicitacao_comentarios:${solicitacaoId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "solicitacao_comentarios",
          filter: `solicitacao_id=eq.${solicitacaoId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["solicitacao_comentarios", solicitacaoId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [solicitacaoId, queryClient]);

  const tipoEnvio = perspectiva === "setor" ? "retorno_setor" : "resposta_loja";
  const labelBotao = perspectiva === "setor" ? "Enviar à loja" : "Responder ao setor";
  const placeholder =
    perspectiva === "setor"
      ? "Ex.: Recebido. Vamos processar amanhã pela manhã."
      : "Ex.: Podem seguir. Cliente já foi avisado.";

  const handleSend = () => {
    if (!texto.trim()) return;
    createComentario.mutate(
      { solicitacao_id: solicitacaoId, conteudo: texto.trim(), tipo: tipoEnvio as any },
      { onSuccess: () => setTexto("") },
    );
  };

  return (
    <div className="border-t pt-3 space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-1.5">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        {title || "Diálogo com a loja"}
      </h4>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : comentarios && comentarios.length > 0 ? (
        <ScrollArea className="max-h-56">
          <div className="space-y-2 pr-2">
            {comentarios
              .filter((c) =>
                ["retorno_setor", "resposta_loja", "sistema", "operador_para_loja"].includes(c.tipo as string),
              )
              .map((c) => {
                const isSistema = c.tipo === "sistema" || c.tipo === "operador_para_loja";
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm",
                      c.tipo === "retorno_setor" && "bg-amber-500/10 border border-amber-500/30",
                      c.tipo === "resposta_loja" && "bg-emerald-500/10 border border-emerald-500/30",
                      isSistema && "bg-muted/40 border border-border",
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{c.autor_nome || "Sistema"}</span>
                      <div className="flex items-center gap-1.5">
                        {c.tipo === "retorno_setor" && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/50 text-amber-700">
                            Setor
                          </Badge>
                        )}
                        {c.tipo === "resposta_loja" && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/50 text-emerald-700">
                            Loja
                          </Badge>
                        )}
                        {isSistema && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            Sistema
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(c.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.conteudo}</p>
                    {(c as any).anexo_url && (
                      <a
                        href={(c as any).anexo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-primary underline break-all"
                      >
                        📎 {(c as any).anexo_nome || "Anexo"}
                      </a>
                    )}
                  </div>
                );
              })}
          </div>
        </ScrollArea>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
      )}

      <div className="flex gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          className="text-sm"
          placeholder={placeholder}
        />
        <Button
          size="icon"
          className="h-auto self-end"
          disabled={!texto.trim() || createComentario.isPending}
          onClick={handleSend}
          title={labelBotao}
        >
          {createComentario.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Não muda o status do card — apenas registra a conversa e notifica{" "}
        {perspectiva === "setor" ? "a loja" : "o setor"}.
      </p>
    </div>
  );
}
