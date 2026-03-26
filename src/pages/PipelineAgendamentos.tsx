import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAgendamentos, Agendamento } from "@/hooks/useAgendamentos";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, MapPin, User, FileText, ShoppingCart, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AgendamentoDialog } from "@/components/agendamentos/AgendamentoDialog";

const STATUS_COLUMNS = [
  { key: "agendado", label: "Agendado", color: "bg-blue-500" },
  { key: "lembrete_enviado", label: "Lembrete Enviado", color: "bg-sky-500" },
  { key: "confirmado", label: "Confirmado", color: "bg-cyan-500" },
  { key: "atendido", label: "Atendido", color: "bg-green-500" },
  { key: "orcamento", label: "Orçamento", color: "bg-indigo-500" },
  { key: "venda_fechada", label: "Venda Fechada", color: "bg-emerald-600" },
  { key: "no_show", label: "No-Show", color: "bg-red-500" },
  { key: "recuperacao", label: "Recuperação", color: "bg-amber-500" },
  { key: "reagendado", label: "Reagendado", color: "bg-purple-500" },
  { key: "abandonado", label: "Abandonado", color: "bg-muted-foreground" },
  { key: "cancelado", label: "Cancelado", color: "bg-muted-foreground" },
];

export default function PipelineAgendamentos() {
  const [filtroLoja, setFiltroLoja] = useState<string>("");
  const { data: agendamentos = [], isLoading } = useAgendamentos(filtroLoja || undefined);
  const queryClient = useQueryClient();
  const [selectedAg, setSelectedAg] = useState<Agendamento | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const agId = result.draggableId;
    const ag = agendamentos.find((a) => a.id === agId);
    if (!ag || ag.status === newStatus) return;

    const statusAnterior = ag.status;
    const colLabel = STATUS_COLUMNS.find((c) => c.key === newStatus)?.label || newStatus;

    // Optimistic update
    queryClient.setQueryData(
      ["agendamentos", filtroLoja || undefined, undefined],
      (old: any) => old?.map((a: any) => a.id === agId ? { ...a, status: newStatus } : a)
    );

    const { error } = await (supabase as any)
      .from("agendamentos")
      .update({ status: newStatus })
      .eq("id", agId);

    if (error) {
      toast.error("Erro ao mover card: " + error.message);
      queryClient.invalidateQueries({ queryKey: ["agendamentos"] });
    } else {
      toast.success(`Movido para ${colLabel}`);
      queryClient.invalidateQueries({ queryKey: ["agendamentos"] });

      // Trigger automations and show feedback
      const toastId = toast.loading(`⚡ Executando automações para "${colLabel}"...`);
      
      supabase.functions.invoke("pipeline-automations", {
        body: {
          entity_type: "agendamento",
          entity_id: agId,
          status_novo: newStatus,
          status_anterior: statusAnterior,
        },
      }).then(({ data, error: autoErr }) => {
        if (autoErr) {
          toast.error("Erro nas automações: " + autoErr.message, { id: toastId });
        } else if (data?.status === "no_rules") {
          toast.info("Nenhuma automação configurada para este estágio", { id: toastId });
        } else if (data?.status === "blocked_homologacao") {
          toast.warning("Automação bloqueada (modo homologação)", { id: toastId });
        } else {
          const executed = data?.executed || [];
          const summary = executed.map((e: string) => {
            if (e.startsWith("template:")) return `📨 Template: ${e.replace("template:", "")}`;
            if (e.startsWith("mensagem:")) return "💬 Mensagem enviada";
            if (e.startsWith("tarefa:")) return `📋 Tarefa criada`;
            if (e.startsWith("error:")) return `❌ Erro: ${e.replace("error:", "")}`;
            return e;
          }).join("\n");
          
          const hasError = executed.some((e: string) => e.startsWith("error:"));
          if (hasError) {
            toast.warning(`Automações parciais:\n${summary}`, { id: toastId, duration: 5000 });
          } else {
            toast.success(`✅ Automações executadas:\n${summary}`, { id: toastId, duration: 4000 });
          }
        }
      });
    }
  };

  const handleCardClick = (ag: Agendamento) => {
    setSelectedAg(ag);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Pipeline de Agendamentos"
        description="Arraste cards entre colunas para disparar automações. Clique para editar."
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

      <DragDropContext onDragEnd={handleDragEnd}>
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

                  <Droppable droppableId={col.key}>
                    {(provided, snapshot) => (
                      <ScrollArea className="flex-1">
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex flex-col gap-2 pr-2 min-h-[100px] rounded-lg transition-colors ${
                            snapshot.isDraggingOver ? "bg-accent/30" : ""
                          }`}
                        >
                          {items.map((ag, index) => (
                            <Draggable key={ag.id} draggableId={ag.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => !snapshot.isDragging && handleCardClick(ag)}
                                >
                                  <Card
                                    className={`border cursor-pointer hover:shadow-md transition-shadow ${isToday(ag.data_horario) ? "border-primary shadow-sm" : ""} ${ag.status === "no_show" ? "border-destructive/50" : ""} ${
                                      snapshot.isDragging ? "shadow-lg rotate-1" : ""
                                    }`}
                                  >
                                    <CardContent className="p-3 space-y-2">
                                      <div className="flex items-center gap-2">
                                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-sm font-medium truncate">
                                          {ag.contato?.nome || "Cliente"}
                                        </span>
                                        {/* Monitoring indicators */}
                                        <div className="ml-auto flex gap-0.5">
                                          {ag.lembrete_enviado && (
                                            <span title="Lembrete enviado"><CheckCircle2 className="h-3 w-3 text-sky-500" /></span>
                                          )}
                                          {ag.confirmacao_enviada && (
                                            <span title="Confirmação enviada"><CheckCircle2 className="h-3 w-3 text-cyan-500" /></span>
                                          )}
                                          {ag.noshow_enviado && (
                                            <span title="No-show enviado"><AlertCircle className="h-3 w-3 text-destructive" /></span>
                                          )}
                                        </div>
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
                                      {ag.valor_orcamento != null && (
                                        <div className="flex items-center gap-2">
                                          <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                          <span className="text-xs font-medium">
                                            Orçamento: R$ {ag.valor_orcamento.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                      )}
                                      {ag.numero_venda && (
                                        <div className="flex items-center gap-2">
                                          <ShoppingCart className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                          <span className="text-xs font-medium">
                                            Venda #{ag.numero_venda}
                                            {ag.valor_venda != null && ` — R$ ${ag.valor_venda.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                                          </span>
                                        </div>
                                      )}
                                      {ag.numeros_os && ag.numeros_os.length > 0 && (
                                        <div className="flex items-center gap-2">
                                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                          <span className="text-xs text-muted-foreground">
                                            OS: {ag.numeros_os.join(", ")}
                                          </span>
                                        </div>
                                      )}
                                      {(ag.tentativas_recuperacao || 0) > 0 && (
                                        <div className="text-[10px] text-muted-foreground">
                                          Recuperação: {ag.tentativas_recuperacao}x
                                        </div>
                                      )}
                                      {(ag.tentativas_lembrete || 0) > 1 && (
                                        <div className="text-[10px] text-amber-600">
                                          Lembrete reenviado ({ag.tentativas_lembrete}x)
                                        </div>
                                      )}
                                      {(ag.tentativas_cobranca_loja || 0) > 0 && (
                                        <div className="text-[10px] text-orange-600">
                                          Cobrança loja: {ag.tentativas_cobranca_loja}x
                                        </div>
                                      )}
                                    </CardContent>
                                  </Card>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                          {items.length === 0 && !snapshot.isDraggingOver && (
                            <div className="text-xs text-muted-foreground text-center py-8 opacity-50">Nenhum</div>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </div>
      </DragDropContext>

      <AgendamentoDialog
        agendamento={selectedAg}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
