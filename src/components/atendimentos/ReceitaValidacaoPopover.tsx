import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle2, RefreshCw, Clock, Check, AlertTriangle } from "lucide-react";
import { formatRx, traduzirMotivos } from "@/components/shared/RevisaoHumanaBadge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Props {
  atendimentoId: string;
  contatoId: string;
  atendimentoMetadata: any;
  contatoMetadata: any;
}

const TIPO_LABELS: Record<string, string> = {
  single_vision: "Visão simples",
  progressive: "Multifocal/Progressiva",
  bifocal: "Bifocal",
  unknown: "Tipo não identificado",
};

export function ReceitaValidacaoPopover({
  atendimentoId,
  contatoId,
  atendimentoMetadata,
  contatoMetadata,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const revisaoPendente = atendimentoMetadata?.revisao_humana_pendente === true;
  const motivos: string[] = atendimentoMetadata?.revisao_motivos ?? [];

  const receitas: any[] = useMemo(() => {
    const arr = contatoMetadata?.receitas;
    return Array.isArray(arr) ? arr : [];
  }, [contatoMetadata]);

  const [activeIdx, setActiveIdx] = useState(receitas.length > 0 ? receitas.length - 1 : 0);
  const receita = receitas[activeIdx];
  const confirmacao = contatoMetadata?.receita_confirmacao;

  if (!revisaoPendente) return null;

  async function validar() {
    setBusy(true);
    try {
      const meta = { ...(atendimentoMetadata || {}) };
      const motivosSnap = meta.revisao_motivos;
      delete meta.revisao_humana_pendente;
      delete meta.revisao_motivos;
      const { error } = await supabase
        .from("atendimentos")
        .update({ metadata: meta })
        .eq("id", atendimentoId);
      if (error) throw error;

      const userId = (await supabase.auth.getUser()).data.user?.id;
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "orcamento_revisao_validada",
        descricao: "Receita validada pelo consultor — orçamento liberado",
        referencia_tipo: "atendimento",
        referencia_id: atendimentoId,
        metadata: {
          motivos: motivosSnap,
          validado_por: userId,
          receita_snapshot: receita || null,
        },
      });
      toast.success("Receita validada");
      setOpen(false);
    } catch (e: any) {
      toast.error("Erro ao validar: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pedirNovaLeitura() {
    setBusy(true);
    try {
      const meta = { ...(contatoMetadata || {}) };
      const conf = { ...(meta.receita_confirmacao || {}) };
      conf.pending = true;
      conf.correction_count = Number(conf.correction_count || 0) + 1;
      conf.requested_at = new Date().toISOString();
      meta.receita_confirmacao = conf;
      const { error } = await supabase
        .from("contatos")
        .update({ metadata: meta })
        .eq("id", contatoId);
      if (error) throw error;

      const userId = (await supabase.auth.getUser()).data.user?.id;
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "orcamento_revisao_rejeitada",
        descricao: "Consultor pediu nova leitura da receita",
        referencia_tipo: "atendimento",
        referencia_id: atendimentoId,
        metadata: { por: userId, motivos },
      });
      toast.success("Sinalizado: nova leitura necessária");
      setOpen(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const confianca = Math.round(Number(receita?.confidence || 0) * 100);
  const dataLeitura = receita?.data_leitura ? new Date(receita.data_leitura) : null;
  const confirmedAt = receita?.confirmed_by_client_at
    ? new Date(receita.confirmed_by_client_at)
    : confirmacao?.confirmed_at
    ? new Date(confirmacao.confirmed_at)
    : null;
  const tipoLabel = TIPO_LABELS[receita?.rx_type] || TIPO_LABELS.unknown;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] gap-1 border-amber-500/60 text-amber-700 hover:bg-amber-50 relative"
          title="Validar receita lida pelo Gael"
        >
          <FileText className="h-3 w-3" /> Receita lida
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-70" />
            <span className="relative rounded-full h-2 w-2 bg-amber-500" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="p-3 border-b">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-xs font-semibold">Receita lida pelo Gael</h4>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Confira os valores e libere o orçamento. Validação obrigatória apenas em faixas altas.
          </p>
        </div>

        {receitas.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma receita registrada no contato.
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {receitas.length > 1 && (
              <Tabs value={String(activeIdx)} onValueChange={(v) => setActiveIdx(Number(v))}>
                <TabsList className="h-7">
                  {receitas.map((r: any, i: number) => (
                    <TabsTrigger key={i} value={String(i)} className="text-[10px] px-2">
                      {r.label || `Receita ${i + 1}`}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                {tipoLabel}
              </Badge>
              {dataLeitura && (
                <span>Leitura: {format(dataLeitura, "dd/MM HH:mm", { locale: ptBR })}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="border rounded-md p-2">
                <div className="text-[10px] font-semibold text-muted-foreground mb-1">👁️ OD</div>
                <div className="text-xs font-mono leading-relaxed break-words">
                  {formatRx(receita?.eyes?.od)}
                </div>
              </div>
              <div className="border rounded-md p-2">
                <div className="text-[10px] font-semibold text-muted-foreground mb-1">👁️ OE</div>
                <div className="text-xs font-mono leading-relaxed break-words">
                  {formatRx(receita?.eyes?.oe)}
                </div>
              </div>
            </div>

            {motivos.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">
                  <AlertTriangle className="h-3 w-3" /> Motivos da revisão
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300">
                  {traduzirMotivos(motivos)}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px]">
              {confirmedAt ? (
                <span className="flex items-center gap-1 text-emerald-600">
                  <Check className="h-3 w-3" />
                  Confirmada pelo cliente em {format(confirmedAt, "dd/MM HH:mm", { locale: ptBR })}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" /> Aguardando confirmação do cliente
                </span>
              )}
            </div>

            {confianca > 0 && (
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>Confiança da extração</span>
                  <span>{confianca}%</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full",
                      confianca >= 80 ? "bg-emerald-500" : confianca >= 50 ? "bg-amber-500" : "bg-red-500",
                    )}
                    style={{ width: `${confianca}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-3 border-t flex gap-2">
          <Button
            size="sm"
            className="flex-1 h-8 text-[11px] gap-1"
            disabled={busy}
            onClick={validar}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Validar e liberar orçamento
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[11px] gap-1"
            disabled={busy}
            onClick={pedirNovaLeitura}
            title="Pedir ao Gael uma nova leitura da receita"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Nova leitura
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
