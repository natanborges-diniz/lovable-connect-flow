import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Undo2, Ban } from "lucide-react";

interface BaseProps {
  solicitacaoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DevolverLojaDialog({
  solicitacaoId, open, onOpenChange, onSuccess,
  colunaDestinoId,
}: BaseProps & { colunaDestinoId?: string | null }) {
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!solicitacaoId || motivo.trim().length < 3) {
      toast.error("Descreva o que está faltando (mín. 3 caracteres).");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("devolver-solicitacao-loja", {
        body: {
          solicitacao_id: solicitacaoId,
          motivo: motivo.trim(),
          coluna_destino_id: colunaDestinoId || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Devolvido à loja com pendência registrada.");
      setMotivo("");
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error("Falha ao devolver: " + (e?.message || "erro"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setMotivo(""); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-amber-600" />
            Devolver à loja
          </DialogTitle>
          <DialogDescription>
            Descreva exatamente o que falta para que a loja consiga corrigir e reenviar. A loja recebe esta mensagem direto no app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-devolucao" className="text-xs">O que está faltando? *</Label>
          <Textarea
            id="motivo-devolucao"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: comprovante de renda ilegível, falta CPF do cliente, dados do cônjuge..."
            rows={4}
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground">{motivo.trim().length} / mín. 3 caracteres</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handle} disabled={loading || motivo.trim().length < 3}>
            {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelarSolicitacaoDialog({
  solicitacaoId, open, onOpenChange, onSuccess,
}: BaseProps) {
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!solicitacaoId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancelar-solicitacao-loja", {
        body: { solicitacao_id: solicitacaoId, motivo: motivo.trim() || null },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Solicitação cancelada e loja avisada.");
      setMotivo("");
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error("Falha: " + (e?.message || "erro"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setMotivo(""); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            Cancelar solicitação?
          </DialogTitle>
          <DialogDescription>
            O card sai do pipeline, o link/pagamento vincula como cancelado e a loja recebe um aviso na demanda.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-cancel" className="text-xs">Motivo (opcional)</Label>
          <Textarea
            id="motivo-cancel"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: cliente desistiu, link expirado, valor incorreto..."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={handle} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
