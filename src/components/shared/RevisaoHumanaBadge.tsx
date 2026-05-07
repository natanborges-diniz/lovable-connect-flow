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

interface RxEye {
  esf?: number | string | null;
  cyl?: number | string | null;
  axis?: number | string | null;
  add?: number | string | null;
}

function fmtNum(v: any, withSign = true): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(2).replace(".", ",");
  if (!withSign) return abs;
  if (n === 0) return "0,00";
  return (n > 0 ? "+" : "-") + abs;
}

export function formatRx(eye?: RxEye | null): string {
  if (!eye) return "—";
  const parts: string[] = [];
  parts.push(`ESF ${fmtNum(eye.esf)}`);
  parts.push(`CIL ${fmtNum(eye.cyl)}`);
  if (eye.axis !== null && eye.axis !== undefined && eye.axis !== "") {
    parts.push(`EIXO ${fmtNum(eye.axis, false).replace(",00", "")}°`);
  }
  if (eye.add !== null && eye.add !== undefined && eye.add !== "" && Number(eye.add) !== 0) {
    parts.push(`ADD ${fmtNum(eye.add)}`);
  }
  return parts.join(" ");
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
