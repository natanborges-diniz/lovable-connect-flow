import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageSquare, Calendar, Wallet, Send, CreditCard, Package,
  Building2, ShieldCheck, Phone, Activity, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "@/hooks/useContato360";

const FONTE_META: Record<string, { icon: any; color: string; label: string }> = {
  atendimento: { icon: MessageSquare, color: "text-blue-600 bg-blue-50", label: "Atendimento" },
  agendamento: { icon: Calendar, color: "text-purple-600 bg-purple-50", label: "Agendamento" },
  cashback: { icon: Wallet, color: "text-emerald-600 bg-emerald-50", label: "Cashback" },
  regua: { icon: Send, color: "text-indigo-600 bg-indigo-50", label: "Régua" },
  pagamento: { icon: CreditCard, color: "text-amber-600 bg-amber-50", label: "Pagamento" },
  os: { icon: Package, color: "text-orange-600 bg-orange-50", label: "OS" },
  demanda: { icon: Building2, color: "text-cyan-600 bg-cyan-50", label: "Demanda Loja" },
  lgpd: { icon: ShieldCheck, color: "text-green-700 bg-green-50", label: "LGPD" },
  evento_crm: { icon: Phone, color: "text-slate-600 bg-slate-100", label: "Canal" },
};

function groupByDay(items: TimelineItem[]) {
  const groups = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const day = format(new Date(it.ocorrido_at), "yyyy-MM-dd");
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(it);
  }
  return Array.from(groups.entries());
}

interface Props {
  items: TimelineItem[];
  loading?: boolean;
  compact?: boolean;
}

export function TimelineFeed({ items, loading, compact }: Props) {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Carregando histórico…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Activity className="h-10 w-10 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhum evento registrado para este cliente.</p>
      </div>
    );
  }

  const groups = groupByDay(items);

  return (
    <div className="space-y-6">
      {groups.map(([day, dayItems]) => (
        <div key={day}>
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background py-1 z-10">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {format(new Date(day), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </span>
            <div className="flex-1 border-b border-dashed" />
            <span className="text-[10px] text-muted-foreground">{dayItems.length} evento(s)</span>
          </div>
          <ol className={cn("relative space-y-2 border-l border-border pl-5 ml-2")}>
            {dayItems.map((it, idx) => {
              const meta = FONTE_META[it.fonte] || FONTE_META.evento_crm;
              const Icon = meta.icon;
              return (
                <li key={`${day}-${idx}`} className="relative">
                  <span className={cn(
                    "absolute -left-[28px] flex h-6 w-6 items-center justify-center rounded-full border border-border",
                    meta.color,
                  )}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className={cn(
                    "rounded-md border bg-card px-3 py-2 hover:border-primary/40 transition-colors",
                    compact && "py-1.5",
                  )}>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                          {meta.label}
                        </span>
                        <span className="text-sm font-medium">{it.titulo}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {format(new Date(it.ocorrido_at), "HH:mm")}
                      </span>
                    </div>
                    {it.descricao && (
                      <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{it.descricao}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export const FONTES_DISPONIVEIS = Object.entries(FONTE_META).map(([key, m]) => ({ key, label: m.label }));
