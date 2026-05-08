import { Check, CheckCheck, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TickStatus = "pending" | "sent" | "read";

interface MessageTicksProps {
  status: TickStatus;
  className?: string;
}

const labels: Record<TickStatus, string> = {
  pending: "Enviando",
  sent: "Enviada",
  read: "Lida",
};

export function MessageTicks({ status, className }: MessageTicksProps) {
  const label = labels[status];
  const common = "h-3 w-3 inline-block align-middle";
  if (status === "pending") {
    return <Clock3 aria-label={label} className={cn(common, "opacity-70", className)} />;
  }
  if (status === "read") {
    return <CheckCheck aria-label={label} className={cn(common, "text-sky-500", className)} />;
  }
  return <Check aria-label={label} className={cn(common, "opacity-70", className)} />;
}

export default MessageTicks;
