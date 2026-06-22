import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";

interface Props {
  inscricaoId: string | null;
  nomeCliente: string;
  onClose: () => void;
  onConfirmed: () => void;
}

export function CashbackPinDialog({ inscricaoId, nomeCliente, onClose, onConfirmed }: Props) {
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expiraAt, setExpiraAt] = useState<string | null>(null);
  const [restante, setRestante] = useState<number>(0);

  // dispara PIN automaticamente ao abrir
  useEffect(() => {
    if (!inscricaoId) return;
    void enviarPin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inscricaoId]);

  // countdown
  useEffect(() => {
    if (!expiraAt) return;
    const tick = () => {
      const ms = new Date(expiraAt).getTime() - Date.now();
      setRestante(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiraAt]);

  async function enviarPin() {
    if (!inscricaoId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("cashback-loja", {
        body: { action: "gerar_pin", inscricao_id: inscricaoId },
      });
      if (error) throw error;
      if ((data as any)?.status === "ja_confirmado") {
        toast.success("PIN já confirmado anteriormente.");
        onConfirmed();
        return;
      }
      setExpiraAt((data as any)?.expira_at || null);
      setPin("");
      toast.success("PIN enviado por WhatsApp ao cliente.");
    } catch (e: any) {
      toast.error("Falha ao enviar PIN: " + (e?.message || "erro"));
    } finally {
      setSending(false);
    }
  }

  async function confirmar() {
    if (!inscricaoId || pin.length !== 4) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("cashback-loja", {
        body: { action: "confirmar_pin", inscricao_id: inscricaoId, pin },
      });
      if (error) throw error;
      const r = data as any;
      if (r?.status === "validado" || r?.status === "ja_confirmado") {
        toast.success("Telefone validado e termos aceitos.");
        onConfirmed();
        return;
      }
      const motivos: Record<string, string> = {
        pin_incorreto: `PIN incorreto. Tentativas restantes: ${r?.tentativas_restantes ?? 0}`,
        pin_expirado: "PIN expirou. Reenvie um novo.",
        pin_nao_gerado: "PIN ainda não gerado. Clique em Reenviar.",
        tentativas_excedidas: "Tentativas excedidas. Reenvie um novo PIN.",
      };
      toast.error(motivos[r?.motivo] || "Não foi possível confirmar o PIN.");
      setPin("");
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "desconhecido"));
    } finally {
      setConfirming(false);
    }
  }

  const mm = String(Math.floor(restante / 60)).padStart(2, "0");
  const ss = String(restante % 60).padStart(2, "0");

  return (
    <Dialog open={!!inscricaoId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Validar contato de {nomeCliente.split(" ")[0]}
          </DialogTitle>
          <DialogDescription>
            Um PIN de 4 dígitos foi enviado ao WhatsApp do cliente. Peça o código e digite abaixo
            para concluir o lançamento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <InputOTP maxLength={4} value={pin} onChange={setPin}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>

          {expiraAt && restante > 0 && (
            <p className="text-xs text-muted-foreground">
              Expira em <span className="font-mono">{mm}:{ss}</span>
            </p>
          )}
          {expiraAt && restante === 0 && (
            <p className="text-xs text-destructive">PIN expirado — reenvie.</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={enviarPin} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Reenviar
          </Button>
          <Button onClick={confirmar} disabled={pin.length !== 4 || confirming}>
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirmar PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
