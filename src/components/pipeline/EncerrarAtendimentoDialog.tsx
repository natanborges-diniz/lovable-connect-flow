import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Archive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Desfecho = "ganho" | "perdido" | "encerrado" | null;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  atendimentoId: string;
  contatoId: string;
  /** ID da coluna "Perdidos" do CRM */
  perdidosColunaId?: string;
  /** ID da coluna "Encerrados" do CRM */
  encerradosColunaId?: string;
  onSuccess: () => void;
}

const MOTIVOS_PERDA = [
  { v: "sem_interesse", l: "Sem interesse no momento" },
  { v: "preco", l: "Achou caro / sem orçamento" },
  { v: "concorrente", l: "Optou por concorrente" },
  { v: "fora_regiao", l: "Fora da região de atendimento" },
  { v: "sem_resposta", l: "Não respondeu cadência" },
  { v: "outro", l: "Outro" },
];

const MOTIVOS_ENCERRAMENTO = [
  { v: "info_resolvida", l: "Tirou dúvida / informação resolvida" },
  { v: "comprovante_recebido", l: "Comprovante recebido" },
  { v: "contato_errado", l: "Contato errado / engano" },
  { v: "spam", l: "Spam / mensagem irrelevante" },
  { v: "sem_oportunidade", l: "Sem oportunidade comercial" },
  { v: "outro", l: "Outro" },
];

export function EncerrarAtendimentoDialog({
  open,
  onOpenChange,
  atendimentoId,
  contatoId,
  perdidosColunaId,
  encerradosColunaId,
  onSuccess,
}: Props) {
  const [desfecho, setDesfecho] = useState<Desfecho>(null);
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setDesfecho(null);
    setMotivo("");
    setObs("");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleConfirm = async () => {
    if (!desfecho) return;
    if ((desfecho === "perdido" || desfecho === "encerrado") && !motivo) {
      toast.error("Selecione o motivo");
      return;
    }
    setLoading(true);
    try {
      // Gera resumo (best-effort)
      supabase.functions
        .invoke("summarize-atendimento", { body: { atendimento_id: atendimentoId } })
        .catch(() => undefined);

      // Atualiza atendimento
      const { data: aData } = await supabase
        .from("atendimentos")
        .select("metadata")
        .eq("id", atendimentoId)
        .maybeSingle();
      const aMeta = ((aData?.metadata as any) || {}) as Record<string, any>;
      aMeta.desfecho = desfecho;
      if (desfecho === "perdido") aMeta.motivo_perda = motivo;
      if (desfecho === "encerrado") aMeta.encerramento_motivo = motivo;
      if (obs) aMeta.encerramento_observacao = obs;

      const { error: aErr } = await supabase
        .from("atendimentos")
        .update({
          status: "encerrado",
          fim_at: new Date().toISOString(),
          metadata: aMeta,
        } as any)
        .eq("id", atendimentoId);
      if (aErr) throw aErr;

      // Move card conforme desfecho
      let destinoColunaId: string | undefined;
      if (desfecho === "perdido") destinoColunaId = perdidosColunaId;
      else if (desfecho === "encerrado") destinoColunaId = encerradosColunaId;

      if (destinoColunaId) {
        const { data: cData } = await supabase
          .from("contatos")
          .select("pipeline_coluna_id, metadata")
          .eq("id", contatoId)
          .maybeSingle();
        const cMeta = ((cData?.metadata as any) || {}) as Record<string, any>;
        if (desfecho === "perdido") cMeta.motivo_perda = motivo;
        if (desfecho === "encerrado") cMeta.encerramento_motivo = motivo;
        if (cMeta.recuperacao_vendas) {
          cMeta.recuperacao_vendas = { ...cMeta.recuperacao_vendas, status: "encerrado_manual" };
        }
        const previousColunaId = cData?.pipeline_coluna_id;

        await supabase
          .from("contatos")
          .update({ pipeline_coluna_id: destinoColunaId, metadata: cMeta } as any)
          .eq("id", contatoId);

        // Timeline
        await supabase.from("pipeline_card_eventos").insert({
          entidade: "contato",
          entidade_id: contatoId,
          tipo: desfecho === "perdido" ? "lead_perdido" : "atendimento_encerrado",
          descricao:
            desfecho === "perdido"
              ? `Lead perdido — motivo: ${motivo}`
              : `Atendimento encerrado sem oportunidade — motivo: ${motivo}`,
          coluna_anterior_id: previousColunaId,
          coluna_nova_id: destinoColunaId,
          metadata: { motivo, observacao: obs || null },
        } as any).then(() => undefined, () => undefined);

        // Dispara automações da coluna destino (sem await crítico)
        supabase.functions
          .invoke("pipeline-automations", {
            body: {
              entity_type: "contato",
              entity_id: contatoId,
              coluna_id: destinoColunaId,
              coluna_anterior_id: previousColunaId,
            },
          })
          .catch(() => undefined);
      } else if (desfecho === "ganho") {
        // Apenas marca tag no contato
        const { data: cData } = await supabase
          .from("contatos")
          .select("metadata")
          .eq("id", contatoId)
          .maybeSingle();
        const cMeta = ((cData?.metadata as any) || {}) as Record<string, any>;
        cMeta.desfecho_ultimo = "ganho";
        if (cMeta.recuperacao_vendas) {
          cMeta.recuperacao_vendas = { ...cMeta.recuperacao_vendas, status: "ganho" };
        }
        await supabase.from("contatos").update({ metadata: cMeta } as any).eq("id", contatoId);
      }

      toast.success("Atendimento encerrado");
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast.error("Erro ao encerrar: " + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  };

  const motivos = desfecho === "perdido" ? MOTIVOS_PERDA : MOTIVOS_ENCERRAMENTO;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encerrar atendimento</DialogTitle>
          <DialogDescription>
            Escolha o desfecho — todo lead encerrado precisa ir para uma coluna terminal.
          </DialogDescription>
        </DialogHeader>

        {!desfecho ? (
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => setDesfecho("ganho")}
            >
              <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600 shrink-0" />
              <div className="text-left">
                <div className="font-medium">Ganho</div>
                <div className="text-xs text-muted-foreground">
                  Cliente agendou / comprou / pagou. Card mantém-se na coluna atual.
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => setDesfecho("perdido")}
              disabled={!perdidosColunaId}
            >
              <XCircle className="h-4 w-4 mr-2 text-destructive shrink-0" />
              <div className="text-left">
                <div className="font-medium">Perdido</div>
                <div className="text-xs text-muted-foreground">
                  Houve oportunidade comercial (orçamento/produto) mas não converteu.
                </div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="justify-start h-auto py-3"
              onClick={() => setDesfecho("encerrado")}
              disabled={!encerradosColunaId}
            >
              <Archive className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
              <div className="text-left">
                <div className="font-medium">Encerrado (sem oportunidade)</div>
                <div className="text-xs text-muted-foreground">
                  Dúvida resolvida, comprovante, contato errado etc.
                </div>
              </div>
            </Button>
          </div>
        ) : desfecho === "ganho" ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              O card permanecerá na coluna atual (Agendado, Link Pago, etc.). Confirma?
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo *</Label>
              <Select value={motivo} onValueChange={setMotivo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {motivos.map((m) => (
                    <SelectItem key={m.v} value={m.v}>
                      {m.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observação (opcional)</Label>
              <Textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                placeholder="Contexto adicional para a equipe"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {desfecho ? (
            <>
              <Button variant="outline" onClick={() => setDesfecho(null)} disabled={loading}>
                Voltar
              </Button>
              <Button onClick={handleConfirm} disabled={loading}>
                {loading ? "Encerrando..." : "Confirmar"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
