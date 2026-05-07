import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

const MOTIVO_LABELS: Record<string, string> = {
  cilindrico_alto: "Cilíndrico alto (>4)",
  adicao_alta: "Adição alta (>3,5)",
  esferico_faixa_cinza: "Esférico 8–10",
};

export function traduzirMotivos(motivos?: string[] | null): string {
  if (!motivos?.length) return "Receita complexa — confirmar prazo e disponibilidade";
  return motivos.map((m) => MOTIVO_LABELS[m] ?? m).join(" • ");
}

interface Props {
  motivos?: string[] | null;
  size?: "sm" | "md";
  className?: string;
}

export function RevisaoHumanaBadge({ motivos, size = "sm", className }: Props) {
  const tooltip = traduzirMotivos(motivos);
  return (
    <Badge
      variant="outline"
      title={tooltip}
      className={cn(
        "gap-1 border-amber-500/60 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
        size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs",
        className,
      )}
    >
      <AlertTriangle className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      Revisar orçamento
    </Badge>
  );
}
