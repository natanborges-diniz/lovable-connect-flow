import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ThumbsUp, ThumbsDown, Loader2, ShieldAlert, BookOpen } from "lucide-react";
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
  const [showDialog, setShowDialog] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [respostaCorrigida, setRespostaCorrigida] = useState("");
  const [criarRegra, setCriarRegra] = useState(false);
  const [criarExemplo, setCriarExemplo] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handlePositive = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("ia_feedbacks" as any).insert({
        mensagem_id: mensagemId,
        atendimento_id: atendimentoId,
        avaliacao: "positivo",
      } as any);
      if (error) throw error;
      setFeedbackGiven("positivo");
      toast.success("Feedback registrado!");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleNegative = () => setShowDialog(true);

  const submitNegative = async () => {
    setSaving(true);
    try {
      // Save feedback
      const { error } = await supabase.from("ia_feedbacks" as any).insert({
        mensagem_id: mensagemId,
        atendimento_id: atendimentoId,
        avaliacao: respostaCorrigida ? "corrigido" : "negativo",
        motivo: motivo || null,
        resposta_corrigida: respostaCorrigida || null,
      } as any);
      if (error) throw error;

      // Create prohibited rule if checked
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

      // Create model example if checked
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

      setFeedbackGiven("negativo");
      setShowDialog(false);
      toast.success(actions + "!");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (feedbackGiven) {
    return (
      <span className="text-[10px] opacity-50">
        {feedbackGiven === "positivo" ? "👍" : "👎"} avaliado
      </span>
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
            <DialogTitle>Avaliar resposta da IA</DialogTitle>
          </DialogHeader>
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
            {/* Create prohibited rule shortcut */}
            <div className="flex items-center gap-2 p-2 border border-destructive/20 rounded-lg bg-destructive/5">
              <Switch checked={criarRegra} onCheckedChange={setCriarRegra} />
              <div className="flex items-center gap-1.5 text-xs">
                <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                <span>Criar regra proibida (a IA nunca mais fará isso)</span>
              </div>
            </div>
            <Button onClick={submitNegative} disabled={saving || !motivo.trim()} className="w-full" size="sm">
              {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</> : "Enviar Feedback"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}