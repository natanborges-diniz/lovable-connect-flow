import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Pin, Loader2, Check, CheckCheck, ArrowRight, X, Users, ChevronDown, ChevronRight, Ban } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useDemandaMensagens, useEditDemandaMensagem, useDeleteDemandaMensagem, type DemandaRow } from "@/hooks/useDemandas";
import { useAuth } from "@/hooks/useAuth";
import { MessageActionsMenu } from "@/components/shared/MessageActionsMenu";
import { EditableMessageBubble } from "@/components/shared/EditableMessageBubble";
import { useResponderConfirmacaoEstoque } from "@/hooks/useConfirmacoesEstoque";

const dirColors: Record<string, string> = {
  operador_para_loja: "bg-primary text-primary-foreground ml-auto",
  loja_para_operador: "bg-muted text-foreground mr-auto",
  sistema: "bg-amber-500/10 text-amber-700 dark:text-amber-300 mx-auto text-center text-[11px] italic",
};

// Cor determinística por nome de loja (HSL com saturação/luminosidade fixas)
function lojaTone(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 45%)`;
}

export function DemandaThreadView({ demanda }: { demanda: DemandaRow }) {
  const { data: msgs = [] } = useDemandaMensagens(demanda.id);
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const editMsg = useEditDemandaMensagem();
  const deleteMsg = useDeleteDemandaMensagem();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forwardText, setForwardText] = useState("");
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [expandLojas, setExpandLojas] = useState(false);
  const [confestObs, setConfestObs] = useState("");
  const responderConfest = useResponderConfirmacaoEstoque();

  const isGrupo = demanda.metadata?.grupo === true;
  const lojasNomes: string[] = demanda.metadata?.lojas_nomes ?? [];
  const isConfest = (demanda as any).tipo_chave === "confirmacao_estoque"
    || demanda.metadata?.tipo_chave === "confirmacao_estoque";
  const confestId: string | undefined = demanda.metadata?.confirmacao_estoque_id;
  const confestRespondida = !!demanda.metadata?.confirmacao_respondida;

  // Marca como vista
  useEffect(() => {
    if (!demanda.vista_pelo_operador) {
      void supabase.from("demandas_loja").update({ vista_pelo_operador: true }).eq("id", demanda.id);
    }
  }, [demanda.id, demanda.vista_pelo_operador]);

  const toggleSelect = (m: { id: string; direcao: string; conteudo: string }) => {
    if (m.direcao !== "loja_para_operador") return;
    const next = new Set(selectedMsgIds);
    if (next.has(m.id)) next.delete(m.id);
    else {
      next.add(m.id);
      if (!forwardText.trim()) setForwardText(m.conteudo);
    }
    setSelectedMsgIds(next);
  };

  const handleForward = async () => {
    if (!forwardText.trim() || !demanda.atendimento_cliente_id) return;
    setForwarding(true);
    try {
      const { data, error } = await supabase.functions.invoke("encaminhar-demanda-cliente", {
        body: {
          demanda_id: demanda.id,
          texto: forwardText.trim(),
          mensagem_ids: Array.from(selectedMsgIds),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Encaminhado ao cliente");
      setForwardText("");
      setSelectedMsgIds(new Set());
    } catch (e: any) {
      toast.error("Falha: " + (e?.message || "erro"));
    } finally {
      setForwarding(false);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      const { data, error } = await supabase.functions.invoke("encerrar-demanda-loja", {
        body: { demanda_id: demanda.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Demanda encerrada");
    } catch (e: any) {
      toast.error("Falha ao encerrar: " + (e?.message || "erro"));
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">
            #{demanda.numero_curto} • {isGrupo ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> Grupo ({lojasNomes.length} lojas)
              </span>
            ) : demanda.loja_nome}
          </span>
          <Badge variant="outline" className="text-[10px] capitalize">{demanda.status}</Badge>
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {demanda.protocolo}
          {demanda.solicitante_nome && ` • aberta por ${demanda.solicitante_nome}`}
          {demanda.assunto && ` • ${demanda.assunto}`}
        </p>
        {isGrupo && lojasNomes.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setExpandLojas((v) => !v)}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {expandLojas ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expandLojas ? "ocultar lojas" : `ver ${lojasNomes.length} lojas`}
            </button>
            {expandLojas && (
              <div className="mt-1 flex flex-wrap gap-1">
                {lojasNomes.map((n) => (
                  <Badge
                    key={n}
                    variant="outline"
                    className="text-[10px]"
                    style={{ borderColor: lojaTone(n), color: lojaTone(n) }}
                  >
                    {n}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-app-bg px-4 py-3">
        {msgs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Sem mensagens ainda.</p>
        ) : (
          msgs.map((m) => {
            const isSelectable = m.direcao === "loja_para_operador";
            const isSelected = selectedMsgIds.has(m.id);
            return (
              <div
                key={m.id}
                onClick={() => toggleSelect(m)}
                className={cn(
                  "max-w-[80%] break-words rounded-lg px-3 py-2 text-sm",
                  dirColors[m.direcao] || "bg-muted",
                  isSelectable && "cursor-pointer",
                  isSelected && "ring-2 ring-primary ring-offset-1",
                )}
              >
                {m.autor_nome && m.direcao !== "sistema" && (() => {
                  const lojaNome = (m as any).metadata?.loja_nome as string | undefined;
                  const showLoja = isGrupo && m.direcao === "loja_para_operador" && lojaNome;
                  return (
                    <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium opacity-80">
                      {showLoja && (
                        <span
                          className="rounded-sm px-1 py-px text-[9px] font-semibold text-white"
                          style={{ backgroundColor: lojaTone(lojaNome!) }}
                        >
                          {lojaNome}
                        </span>
                      )}
                      <span>{m.autor_nome}</span>
                    </p>
                  );
                })()}
                <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                {m.anexo_url && (
                  <a href={m.anexo_url} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] underline opacity-80">
                    📎 Ver anexo
                  </a>
                )}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] opacity-60">{format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}</p>
                  <div className="flex items-center gap-1">
                    {m.direcao === "operador_para_loja" && (
                      m.visto_pela_loja_at ? (
                        <CheckCheck className="h-3 w-3 text-sky-300" aria-label="Visto pela loja" />
                      ) : (
                        <Check className="h-3 w-3 opacity-60" aria-label="Enviado" />
                      )
                    )}
                    {m.encaminhada_ao_cliente && <Check className="h-3 w-3 opacity-70" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {isConfest && confestId && demanda.status === "aberta" && !confestRespondida && (
        <div className="shrink-0 space-y-2 border-t bg-background p-3">
          <p className="text-[11px] font-medium">
            🔎 Confirmação de peça em estoque — responda abaixo
          </p>
          <Textarea
            value={confestObs}
            onChange={(e) => setConfestObs(e.target.value)}
            placeholder="Observação opcional (ex.: localização, lote, prazo)..."
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={responderConfest.isPending}
              onClick={() => responderConfest.mutate({ confirmacao_id: confestId, resposta: "sim", observacao: confestObs || undefined })}
              className="text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              {responderConfest.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              ✅ Tenho a peça
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={responderConfest.isPending}
              onClick={() => responderConfest.mutate({ confirmacao_id: confestId, resposta: "nao", observacao: confestObs || undefined })}
              className="text-xs"
            >
              <Ban className="mr-1 h-3 w-3" />
              ❌ Não tenho
            </Button>
          </div>
        </div>
      )}


      {demanda.status !== "encerrada" && demanda.atendimento_cliente_id && (
        <div className="shrink-0 space-y-2 border-t bg-background p-3">
          {selectedMsgIds.size > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {selectedMsgIds.size} mensagem(ns) marcada(s) como encaminhada(s) ao cliente
            </p>
          )}
          <Textarea
            value={forwardText}
            onChange={(e) => setForwardText(e.target.value)}
            placeholder="Texto a enviar ao cliente (você pode editar antes)..."
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClose} disabled={closing} className="text-xs">
              <X className="mr-1 h-3 w-3" /> Encerrar demanda
            </Button>
            <Button
              size="sm"
              className="ml-auto text-xs"
              onClick={handleForward}
              disabled={!forwardText.trim() || forwarding}
            >
              {forwarding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowRight className="mr-1 h-3 w-3" />}
              Encaminhar ao cliente
            </Button>
          </div>
        </div>
      )}
      {demanda.status === "encerrada" && (
        <div className="shrink-0 border-t bg-muted/30 p-3 text-center text-[11px] text-muted-foreground">
          Demanda encerrada — sem novas ações disponíveis.
        </div>
      )}
    </div>
  );
}
