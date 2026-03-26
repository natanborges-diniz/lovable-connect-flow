import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ThumbsUp, ThumbsDown, Loader2, ShieldAlert, BookOpen, Undo2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface MessageFeedbackProps {
  mensagemId: string;
  atendimentoId: string;
  conteudo: string;
}

export function MessageFeedback({ mensagemId, atendimentoId, conteudo }: MessageFeedbackProps) {
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<"positivo" | "negativo">("negativo");
  const [motivo, setMotivo] = useState("");
  const [respostaCorrigida, setRespostaCorrigida] = useState("");
  const [criarRegra, setCriarRegra] = useState(false);
  const [criarExemplo, setCriarExemplo] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const resetForm = () => {
    setMotivo("");
    setRespostaCorrigida("");
    setCriarRegra(false);
    setCriarExemplo(false);
  };

  const handlePositive = () => {
    setDialogMode("positivo");
    setCriarExemplo(false);
    setShowDialog(true);
  };

  const handleNegative = () => {
    setDialogMode("negativo");
    resetForm();
    setShowDialog(true);
  };

  const submitPositive = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sessão expirada. Faça login novamente."); setSaving(false); return; }

      const { data, error } = await supabase.from("ia_feedbacks" as any).insert({
        mensagem_id: mensagemId,
        atendimento_id: atendimentoId,
        avaliacao: "positivo",
        avaliador_id: user.id,
      } as any).select("id").single();
      if (error) throw error;

      if (criarExemplo && conteudo.trim()) {
        await supabase.from("ia_exemplos" as any).insert({
          pergunta: motivo || "Resposta aprovada pelo operador",
          resposta_ideal: conteudo,
          categoria: "aprovado",
        } as any);
        queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
      }

      setFeedbackId((data as any)?.id || null);
      setFeedbackGiven("positivo");
      setShowDialog(false);

      const actions = [
        "Feedback positivo registrado",
        criarExemplo ? "exemplo modelo criado" : "",
      ].filter(Boolean).join(" + ");
      toast.success(actions + "!");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitNegative = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sessão expirada. Faça login novamente."); setSaving(false); return; }

      const { data, error } = await supabase.from("ia_feedbacks" as any).insert({
        mensagem_id: mensagemId,
        atendimento_id: atendimentoId,
        avaliacao: respostaCorrigida ? "corrigido" : "negativo",
        motivo: motivo || null,
        resposta_corrigida: respostaCorrigida || null,
        avaliador_id: user.id,
      } as any).select("id").single();
      if (error) throw error;

      if (criarRegra && motivo.trim()) {
        const regra = respostaCorrigida
          ? `${motivo}. Correto: ${respostaCorrigida}`
          : motivo;
        await supabase.from("ia_regras_proibidas" as any).insert({
          regra,
          categoria: "informacao_falsa",
        } as any);
        queryClient.invalidateQueries({ queryKey: ["ia_regras_proibidas"] });
      }

      if (criarExemplo && respostaCorrigida.trim()) {
        await supabase.from("ia_exemplos" as any).insert({
          pergunta: motivo || conteudo,
          resposta_ideal: respostaCorrigida,
          categoria: "correcao",
        } as any);
        queryClient.invalidateQueries({ queryKey: ["ia_exemplos"] });
      }

      const actions = [
        "Feedback registrado",
        criarRegra ? "regra proibida criada" : "",
        criarExemplo && respostaCorrigida.trim() ? "exemplo modelo criado" : "",
      ].filter(Boolean).join(" + ");

      setFeedbackId((data as any)?.id || null);
      setFeedbackGiven("negativo");
      setShowDialog(false);
      toast.success(actions + "!");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const undoFeedback = async () => {
    if (!feedbackId) {
      setFeedbackGiven(null);
      return;
    }
    setSaving(true);
    try {
      await supabase.from("ia_feedbacks" as any).delete().eq("id", feedbackId);
      setFeedbackGiven(null);
      setFeedbackId(null);
      resetForm();
      toast.success("Avaliação desfeita!");
    } catch (e: any) {
      toast.error("Erro ao desfazer: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (feedbackGiven) {
    return (
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] opacity-50">
          {feedbackGiven === "positivo" ? "👍" : "👎"} avaliado
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 opacity-30 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); undoFeedback(); }}
          disabled={saving}
          title="Desfazer avaliação"
        >
          <Undo2 className="h-2.5 w-2.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-0.5 mt-1">
        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-40 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); handlePositive(); }} disabled={saving}>
          <ThumbsUp className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-40 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); handleNegative(); }} disabled={saving}>
          <ThumbsDown className="h-3 w-3" />
        </Button>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "positivo" ? "👍 Avaliar positivamente" : "👎 Avaliar resposta da IA"}
            </DialogTitle>
          </DialogHeader>

          {dialogMode === "positivo" ? (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-xs max-h-24 overflow-auto">
                <p className="font-medium text-[10px] text-muted-foreground mb-1">Resposta da IA:</p>
                {conteudo}
              </div>
              <div className="flex items-center gap-2 p-2 border border-primary/20 rounded-lg bg-primary/5">
                <Switch checked={criarExemplo} onCheckedChange={setCriarExemplo} />
                <div className="flex items-center gap-1.5 text-xs">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                  <span>Criar exemplo modelo (ensinar a IA a responder assim)</span>
                </div>
              </div>
              {criarExemplo && (
                <div className="space-y-2">
                  <Label className="text-xs">Contexto / pergunta do cliente (opcional)</Label>
                  <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                    placeholder="Ex: Quando o cliente pergunta sobre..." className="text-xs" />
                </div>
              )}
              <Button onClick={submitPositive} disabled={saving} className="w-full" size="sm">
                {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</> : "Confirmar 👍"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-xs max-h-24 overflow-auto">
                <p className="font-medium text-[10px] text-muted-foreground mb-1">Resposta da IA:</p>
                {conteudo}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Por que está errada?</Label>
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                  placeholder="Ex: Inventou preço, informação incorreta sobre produto..." className="text-xs" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Resposta corrigida (opcional)</Label>
                <Textarea value={respostaCorrigida} onChange={(e) => setRespostaCorrigida(e.target.value)} rows={3}
                  placeholder="Como a IA deveria ter respondido..." className="text-xs" />
              </div>
              <div className="flex items-center gap-2 p-2 border border-destructive/20 rounded-lg bg-destructive/5">
                <Switch checked={criarRegra} onCheckedChange={setCriarRegra} />
                <div className="flex items-center gap-1.5 text-xs">
                  <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                  <span>Criar regra proibida (a IA nunca mais fará isso)</span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 border border-primary/20 rounded-lg bg-primary/5">
                <Switch checked={criarExemplo} onCheckedChange={setCriarExemplo} disabled={!respostaCorrigida.trim()} />
                <div className="flex items-center gap-1.5 text-xs">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                  <span>Criar exemplo modelo (ensinar a IA a responder assim)</span>
                </div>
              </div>
              <Button onClick={submitNegative} disabled={saving || !motivo.trim()} className="w-full" size="sm">
                {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</> : "Enviar Feedback"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
