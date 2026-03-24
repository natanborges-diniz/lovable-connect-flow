import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAgendamentos } from "@/hooks/useAgendamentos";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, MapPin, User, Clock, Phone } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";

const STATUS_COLUMNS = [
  { key: "agendado", label: "Agendado", color: "bg-blue-500" },
  { key: "confirmado", label: "Confirmado", color: "bg-cyan-500" },
  { key: "atendido", label: "Atendido", color: "bg-green-500" },
  { key: "no_show", label: "No-Show", color: "bg-red-500" },
  { key: "recuperacao", label: "Recuperação", color: "bg-amber-500" },
  { key: "reagendado", label: "Reagendado", color: "bg-purple-500" },
  { key: "abandonado", label: "Abandonado", color: "bg-muted-foreground" },
  { key: "cancelado", label: "Cancelado", color: "bg-muted-foreground" },
];

export default function PipelineAgendamentos() {
  const [filtroLoja, setFiltroLoja] = useState<string>("");
  const { data: agendamentos = [], isLoading } = useAgendamentos(filtroLoja || undefined);

  const lojas = useMemo(() => {
    const set = new Set(agendamentos.map((a) => a.loja_nome));
    return Array.from(set).sort();
  }, [agendamentos]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof agendamentos> = {};
    for (const col of STATUS_COLUMNS) map[col.key] = [];
    for (const ag of agendamentos) {
      if (map[ag.status]) map[ag.status].push(ag);
      else map[ag.status] = [ag];
    }
    return map;
  }, [agendamentos]);

  const isToday = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Pipeline de Agendamentos"
        description="Acompanhe agendamentos por status"
        actions={
          <Select value={filtroLoja} onValueChange={(v) => setFiltroLoja(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todas as lojas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as lojas</SelectItem>
              {lojas.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="flex-1 overflow-x-auto px-4 pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {STATUS_COLUMNS.map((col) => {
            const items = grouped[col.key] || [];
            return (
              <div key={col.key} className="flex flex-col w-[280px] shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={`w-3 h-3 rounded-full ${col.color}`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{items.length}</Badge>
                </div>

                <ScrollArea className="flex-1">
                  <div className="flex flex-col gap-2 pr-2">
                    {items.map((ag) => (
                      <Card
                        key={ag.id}
                        className={`border ${isToday(ag.data_horario) ? "border-primary shadow-sm" : ""} ${ag.status === "no_show" ? "border-destructive/50" : ""}`}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {ag.contato?.nome || "Cliente"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">{ag.loja_nome}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(ag.data_horario), "dd/MM · HH:mm", { locale: ptBR })}
                            </span>
                            {isToday(ag.data_horario) && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">Hoje</Badge>
                            )}
                          </div>
                          {ag.loja_confirmou_presenca !== null && (
                            <div className="flex items-center gap-1">
                              <span className={`text-[10px] ${ag.loja_confirmou_presenca ? "text-green-600" : "text-red-600"}`}>
                                Loja: {ag.loja_confirmou_presenca ? "✅ Confirmou" : "❌ Não compareceu"}
                              </span>
                            </div>
                          )}
                          {ag.tentativas_recuperacao > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              Tentativas: {ag.tentativas_recuperacao}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    {items.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-8 opacity-50">Nenhum</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
