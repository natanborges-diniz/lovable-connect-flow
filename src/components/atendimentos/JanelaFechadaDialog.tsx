import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hoursSinceInbound: number;
  rascunhoPreservado: boolean;
  onEnviarRetomada: () => void;
  onEscolherOutro: () => void;
}

export function JanelaFechadaDialog({
  open,
  onOpenChange,
  hoursSinceInbound,
  rascunhoPreservado,
  onEnviarRetomada,
  onEscolherOutro,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Janela de 24h fechada
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-sm leading-relaxed">
            <span className="block">
              Faz <strong>{hoursSinceInbound}h</strong> que o cliente não responde. A Meta exige um template aprovado para reabrir a conversa.
            </span>
            <span className="block">
              Envie o template <strong>retomada_consultor</strong> — pedido cordial de desculpas e convite pro cliente responder. Assim que ele mandar um "oi", a janela reabre e você envia seu texto livremente.
            </span>
            {rascunhoPreservado && (
              <span className="block text-xs text-muted-foreground italic">
                Seu texto foi guardado no campo de mensagem.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel className="mt-0">Cancelar</AlertDialogCancel>
          <Button variant="outline" onClick={onEscolherOutro}>
            Escolher outro template
          </Button>
          <AlertDialogAction onClick={onEnviarRetomada}>
            Enviar retomada
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
