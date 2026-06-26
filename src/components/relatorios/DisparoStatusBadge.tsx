import { Check, CheckCheck, Clock3, X, AlertTriangle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  status: string | null;
  className?: string;
}

const LABELS: Record<string, string> = {
  pending: "Pendente",
  queued: "Na fila",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  error: "Erro",
  invalid_number: "Número inválido",
  invalid: "Número inválido",
  telefone_invalido: "Telefone inválido",
  expired: "Expirado",
};

export function DisparoStatusBadge({ status, className }: Props) {
  const s = (status || "").toLowerCase();
  const label = LABELS[s] || status || "—";
  const base = "inline-flex items-center gap-1 text-xs font-medium";

  if (s === "read") {
    return (
      <span className={cn(base, "text-sky-600", className)}>
        <CheckCheck className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (s === "delivered") {
    return (
      <span className={cn(base, "text-foreground/80", className)}>
        <CheckCheck className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (s === "sent") {
    return (
      <span className={cn(base, "text-muted-foreground", className)}>
        <Check className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (s === "invalid_number" || s === "invalid" || s === "telefone_invalido") {
    return (
      <span className={cn(base, "text-amber-600", className)} title={s === "telefone_invalido" ? "Telefone do cliente no ERP não é um celular BR válido — sem como disparar WhatsApp" : undefined}>
        <Ban className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (s === "failed" || s === "error") {
    return (
      <span className={cn(base, "text-destructive", className)}>
        <X className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  if (s === "pending" || s === "queued") {
    return (
      <span className={cn(base, "text-muted-foreground", className)}>
        <Clock3 className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }
  return (
    <span className={cn(base, "text-muted-foreground", className)}>
      <AlertTriangle className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

export default DisparoStatusBadge;
