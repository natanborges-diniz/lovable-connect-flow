import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateCardDialog } from "@/components/pipeline/CreateCardDialog";
import { useContatos, useUpdateContato } from "@/hooks/useContatos";
import {
  usePipelineColunas,
  useCreatePipelineColuna,
  useUpdatePipelineColuna,
  useDeletePipelineColuna,
} from "@/hooks/usePipelineColunas";
import { TipoContatoBadge, AtendimentoStatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone, Mail, Clock, Plus, Pencil, Trash2, Check, X, Search, GripVertical, Bot, User,
  MessageSquare, Send, Loader2, Sparkles, FileText, AlertTriangle, RefreshCw, LogOut,
  ChevronDown, ChevronUp, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMensagens, useCreateMensagem } from "@/hooks/useAtendimentos";

import { useRef } from "react";

export default function Pipeline() {
  const [search, setSearch] = useState("");
  const [cicloFilter, setCicloFilter] = useState<"todos" | "novos" | "retornos">("todos");
  const [selectedContatoId, setSelectedContatoId] = useState<string | null>(null);
  const [activeSegment, setActiveSegment] = useState<string>("todos");
  const { data: contatos, isLoading: loadingContatos } = useContatos();
  const { data: colunasVendas, isLoading: loadingColunasVendas } = usePipelineColunas();
  const ATENDIMENTO_GAEL_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";
  const { data: colunasInternas, isLoading: loadingColunasInternas } = usePipelineColunas(ATENDIMENTO_GAEL_SETOR_ID);
  const colunas = [...(colunasVendas ?? []), ...(colunasInternas ?? [])];
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("pipeline-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contatos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["contatos"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["atendimentos_modos"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, () => {
        queryClient.invalidateQueries({ queryKey: ["contatos"] });
        queryClient.invalidateQueries({ queryKey: ["atendimentos_modos"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Fetch active atendimentos
  const { data: atendimentosAtivos } = useQuery({
    queryKey: ["atendimentos_modos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("id, contato_id, modo, status")
        .neq("status", "encerrado");
      if (error) throw error;
      return data as { id: string; contato_id: string; modo: string; status: string }[];
    },
  });
  const atendimentoByContato = new Map((atendimentosAtivos || []).map((a) => [a.contato_id, a]));

  const updateContato = useUpdateContato();
  const createColuna = useCreatePipelineColuna();
  const updateColuna = useUpdatePipelineColuna();
  const deleteColuna = useDeletePipelineColuna();

  const [editingColuna, setEditingColuna] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [addingColuna, setAddingColuna] = useState(false);
  const [newColunaNome, setNewColunaNome] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isLoading = loadingContatos || loadingColunasVendas || loadingColunasInternas;

  const filteredContatos = (contatos ?? []).filter((c) => {
    // Cycle filter
    if (cicloFilter === "novos" && c.ciclo_funil !== 1) return false;
    if (cicloFilter === "retornos" && c.ciclo_funil < 2) return false;
    
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.nome?.toLowerCase().includes(s) ||
      c.email?.toLowerCase().includes(s) ||
      c.telefone?.toLowerCase().includes(s) ||
      c.documento?.toLowerCase().includes(s) ||
      c.tags?.some((t: string) => t.toLowerCase().includes(s))
    );
  });

  // Build segment groups from grupo_funil
  const grupoFunilSet = new Set<string>();
  for (const col of colunas) {
    grupoFunilSet.add(col.grupo_funil || "Outros");
  }
  const segmentOrder = ["Triagem", "Comercial", "Pós-Venda", "SAC", "Outros", "Terminal"];
  const segments = Array.from(grupoFunilSet).sort((a, b) => {
    const ia = segmentOrder.indexOf(a);
    const ib = segmentOrder.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const colunasInternasIds = new Set((colunasInternas ?? []).map(c => c.id));

  // Filter columns by active segment
  const filteredColunas = activeSegment === "todos"
    ? colunas
    : colunas.filter(c => (c.grupo_funil || "Outros") === activeSegment);

  const contatosByColuna = (filteredColunas ?? []).map((col) => ({
    ...col,
    isInternal: colunasInternasIds.has(col.id),
    contatos: filteredContatos.filter((c) => c.pipeline_coluna_id === col.id),
  }));

  // Count contacts per segment for badges
  const segmentCounts: Record<string, number> = {};
  for (const seg of segments) {
    const segCols = colunas.filter(c => (c.grupo_funil || "Outros") === seg);
    const segColIds = new Set(segCols.map(c => c.id));
    segmentCounts[seg] = filteredContatos.filter(c => c.pipeline_coluna_id && segColIds.has(c.pipeline_coluna_id)).length;
  }

  const semColuna = filteredContatos.filter(
    (c) => !c.pipeline_coluna_id || !(colunas ?? []).some((col) => col.id === c.pipeline_coluna_id)
  );

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    // Column reorder
    if (result.type === "COLUMN") {
      const sortedColunas = [...contatosByColuna];
      const [moved] = sortedColunas.splice(result.source.index, 1);
      sortedColunas.splice(result.destination.index, 0, moved);
      // Update ordem for each column
      sortedColunas.forEach((col, idx) => {
        if (col.ordem !== idx) {
          updateColuna.mutate({ id: col.id, ordem: idx });
        }
      });
      return;
    }

    // Card move between columns
    const contatoId = result.draggableId;
    const destColunaId = result.destination.droppableId;
    const sourceColunaId = result.source.droppableId;
    if (destColunaId === "sem-coluna") return;
    if (destColunaId === sourceColunaId) return;

    updateContato.mutate({ id: contatoId, pipeline_coluna_id: destColunaId } as any, {
      onSuccess: () => {
        // Trigger automations explicitly
        supabase.functions.invoke("pipeline-automations", {
          body: {
            entity_type: "contato",
            entity_id: contatoId,
            coluna_id: destColunaId,
            coluna_anterior_id: sourceColunaId === "sem-coluna" ? null : sourceColunaId,
          },
        }).then(({ error: autoErr }) => {
          if (autoErr) console.error("[AUTOMATIONS] Error:", autoErr);
          else console.log("[AUTOMATIONS] Triggered for contato", contatoId);
        });
      },
    });
  };

  const startEditColuna = (id: string, nome: string) => {
    setEditingColuna(id);
    setEditNome(nome);
  };

  const saveEditColuna = () => {
    if (editingColuna && editNome.trim()) {
      updateColuna.mutate({ id: editingColuna, nome: editNome.trim() });
    }
    setEditingColuna(null);
  };

  const handleAddColuna = () => {
    if (!newColunaNome.trim()) return;
    const maxOrdem = Math.max(0, ...(colunas ?? []).map((c) => c.ordem));
    createColuna.mutate({ nome: newColunaNome.trim(), ordem: maxOrdem + 1 });
    setNewColunaNome("");
    setAddingColuna(false);
  };

  const confirmDelete = (id: string) => {
    deleteColuna.mutate(id);
    setDeleteConfirm(null);
  };

  const isAtendimentoHumano = (colNome: string) =>
    colNome.toLowerCase().includes("atendimento humano");

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const firstColumnId = (colunas ?? []).sort((a, b) => a.ordem - b.ordem)[0]?.id;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Clique em um card para abrir a conversa • Arraste para mover entre colunas"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted rounded-md p-0.5">
              {([
                { key: "todos", label: "Todos" },
                { key: "novos", label: "Novos" },
                { key: "retornos", label: "Retornos" },
              ] as const).map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={cicloFilter === key ? "default" : "ghost"}
                  className={cn("h-7 text-xs px-3", cicloFilter === key && "shadow-sm")}
                  onClick={() => setCicloFilter(key)}
                >
                  {key === "retornos" && <RefreshCw className="h-3 w-3 mr-1" />}
                  {label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contatos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-60"
              />
            </div>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova Demanda
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddingColuna(true)}>
              <Plus className="h-4 w-4 mr-1" /> Coluna
            </Button>
          </div>
        }
      />

      {/* Segment Tabs */}
      {!isLoading && segments.length > 1 && (
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={activeSegment === "todos" ? "default" : "outline"}
            className="h-7 text-xs px-3"
            onClick={() => setActiveSegment("todos")}
          >
            Todos
            <Badge variant="secondary" className="ml-1.5 h-4 min-w-[16px] px-1 text-[10px]">
              {filteredContatos.length}
            </Badge>
          </Button>
          {segments.map((seg) => {
            const isHumanoSeg = seg.toLowerCase().includes("terminal");
            return (
              <Button
                key={seg}
                size="sm"
                variant={activeSegment === seg ? "default" : "outline"}
                className={cn(
                  "h-7 text-xs px-3",
                  isHumanoSeg && segmentCounts[seg] > 0 && activeSegment !== seg && "border-destructive text-destructive"
                )}
                onClick={() => setActiveSegment(seg)}
              >
                {seg}
                <Badge
                  variant={isHumanoSeg && segmentCounts[seg] > 0 ? "destructive" : "secondary"}
                  className="ml-1.5 h-4 min-w-[16px] px-1 text-[10px]"
                >
                  {segmentCounts[seg] || 0}
                </Badge>
              </Button>
            );
          })}
        </div>
      )}

      {/* Human Queue Panel */}
      {!isLoading && (() => {
        const humanCards = (contatos ?? []).filter((c) => {
          const at = atendimentoByContato.get(c.id);
          return at?.modo === "humano";
        });
        if (humanCards.length === 0) return null;
        return (
          <Card className="mb-4 border-destructive/30 bg-destructive/5">
            <CardHeader className="py-2 px-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
                <CardTitle className="text-sm text-destructive">
                  Fila de Atendimento Humano
                </CardTitle>
                <Badge variant="destructive" className="text-xs">
                  {humanCards.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex gap-2 overflow-x-auto">
                {humanCards
                  .sort((a, b) => new Date(a.ultimo_contato_at || a.created_at).getTime() - new Date(b.ultimo_contato_at || b.created_at).getTime())
                  .map((c) => {
                    const coluna = colunas.find((col) => col.id === c.pipeline_coluna_id);
                    return (
                      <Card
                        key={c.id}
                        className="flex-shrink-0 w-56 cursor-pointer hover:ring-1 hover:ring-destructive/50 border-destructive/20"
                        onClick={() => setSelectedContatoId(c.id)}
                      >
                        <CardContent className="p-2.5 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-destructive" />
                            <p className="font-medium text-xs truncate">{c.nome}</p>
                          </div>
                          {coluna && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{coluna.nome}</Badge>
                          )}
                          {c.ultimo_contato_at && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              Esperando {formatDistanceToNow(new Date(c.ultimo_contato_at), { locale: ptBR })}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="columns" direction="horizontal" type="COLUMN">
            {(colsProvided) => (
              <div
                ref={colsProvided.innerRef}
                {...colsProvided.droppableProps}
                className="flex gap-4 overflow-x-auto pb-4"
                style={{ minHeight: "60vh" }}
              >
            {contatosByColuna.map((coluna, colIndex) => {
              const isHumano = isAtendimentoHumano(coluna.nome);
              return (
                <Draggable key={coluna.id} draggableId={`col-${coluna.id}`} index={colIndex}>
                  {(colDragProvided, colDragSnapshot) => (
                <div
                  ref={colDragProvided.innerRef}
                  {...colDragProvided.draggableProps}
                  className={cn("flex-shrink-0 w-72", colDragSnapshot.isDragging && "opacity-80")}
                >
                    <Card
                      className={cn(
                        "border-t-4",
                        isHumano
                          ? "border-t-destructive bg-destructive/5 ring-2 ring-destructive/20"
                          : coluna.isInternal
                            ? "border-t-accent-foreground bg-accent/10"
                            : `border-t-${coluna.cor}`
                      )}
                    >
                      <CardHeader className="pb-2 pt-3 px-3 cursor-grab active:cursor-grabbing" {...colDragProvided.dragHandleProps}>
                        <div className="flex items-center justify-between gap-1">
                          {coluna.isInternal && !isHumano && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 mr-1 border-accent-foreground/30 text-accent-foreground">Interno</Badge>
                          )}
                        {editingColuna === coluna.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <Input
                              value={editNome}
                              onChange={(e) => setEditNome(e.target.value)}
                              className="h-7 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditColuna();
                                if (e.key === "Escape") setEditingColuna(null);
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEditColuna}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingColuna(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isHumano && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                              <CardTitle className={cn("text-sm font-semibold truncate", isHumano && "text-destructive")}>
                                {coluna.nome}
                              </CardTitle>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <span className={cn(
                                "text-xs font-medium px-1.5 py-0.5 rounded-full mr-1",
                                isHumano
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-muted text-muted-foreground"
                              )}>
                                {coluna.contatos.length}
                              </span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditColuna(coluna.id, coluna.nome)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteConfirm(coluna.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                      {isHumano && coluna.contatos.length > 0 && (
                        <p className="text-[10px] text-destructive font-medium mt-1 animate-pulse">
                          ⚠ {coluna.contatos.length} aguardando atendimento humano
                        </p>
                      )}
                    </CardHeader>
                    <Droppable droppableId={coluna.id}>
                      {(provided, snapshot) => (
                        <CardContent
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={cn(
                            "px-2 pb-2 space-y-2 min-h-[100px] transition-colors",
                            snapshot.isDraggingOver && "bg-accent/30 rounded-b-lg"
                          )}
                        >
                          {coluna.contatos.map((contato, index) => {
                            const atInfo = atendimentoByContato.get(contato.id);
                            return (
                              <Draggable key={contato.id} draggableId={contato.id} index={index}>
                                {(provided, snapshot) => (
                                  <Card
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className={cn(
                                      "shadow-sm transition-all cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30",
                                      snapshot.isDragging && "shadow-lg ring-2 ring-primary/20",
                                      isHumano && "border-destructive/30"
                                    )}
                                    onClick={() => setSelectedContatoId(contato.id)}
                                  >
                                    <CardContent className="p-3 space-y-1.5">
                                      <div className="flex items-start gap-2">
                                        <div
                                          {...provided.dragHandleProps}
                                          className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <GripVertical className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <p className="font-medium text-sm truncate">{contato.nome}</p>
                                            {atInfo && (
                                              atInfo.modo === "ia" ? (
                                                <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-primary/50 text-primary">
                                                  <Bot className="h-2.5 w-2.5" /> IA
                                                </Badge>
                                              ) : atInfo.modo === "hibrido" ? (
                                                <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                                                  <Sparkles className="h-2.5 w-2.5" /> IA Monitorando
                                                </Badge>
                                              ) : (
                                                <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-warning/50 text-warning">
                                                  <User className="h-2.5 w-2.5" /> Humano
                                                </Badge>
                                              )
                                            )}
                                            {contato.ciclo_funil >= 2 && (
                                              <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-accent-foreground/50 text-accent-foreground bg-accent/20">
                                                <RefreshCw className="h-2.5 w-2.5" />
                                                {contato.ciclo_funil === 2 ? "Retorno" : `Ciclo ${contato.ciclo_funil}`}
                                              </Badge>
                                            )}
                                          </div>
                                          <TipoContatoBadge tipo={contato.tipo} />
                                        </div>
                                      </div>

                                      {(contato.telefone || contato.email) && (
                                        <div className="space-y-0.5 pl-6">
                                          {contato.telefone && (
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                              <Phone className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{contato.telefone}</span>
                                            </div>
                                          )}
                                          {contato.email && (
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                              <Mail className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{contato.email}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {contato.ultimo_contato_at && (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-6">
                                          <Clock className="h-3 w-3 shrink-0" />
                                          <span>
                                            {formatDistanceToNow(new Date(contato.ultimo_contato_at), {
                                              addSuffix: true,
                                              locale: ptBR,
                                            })}
                                          </span>
                                        </div>
                                      )}

                                      {atInfo && (
                                        <div className="pl-6 pt-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 text-[10px] px-2 text-muted-foreground hover:text-primary"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigate(`/crm/conversas?open=${atInfo.id}`);
                                            }}
                                          >
                                            <MessageSquare className="h-3 w-3 mr-1" />
                                            Abrir em Atendimentos
                                          </Button>
                                        </div>
                                      )}
                                    </CardContent>
                                  </Card>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </CardContent>
                      )}
                    </Droppable>
                  </Card>
                </div>
                  )}
                </Draggable>
              );
            })}

            {addingColuna ? (
              <div className="flex-shrink-0 w-72">
                <Card className="border-dashed">
                  <CardContent className="p-3 space-y-2">
                    <Input
                      placeholder="Nome da coluna..."
                      value={newColunaNome}
                      onChange={(e) => setNewColunaNome(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddColuna();
                        if (e.key === "Escape") setAddingColuna(false);
                      }}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAddColuna} disabled={createColuna.isPending}>Criar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAddingColuna(false)}>Cancelar</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {semColuna.length > 0 && (
              <div className="flex-shrink-0 w-72">
                <Card className="border-dashed border-t-4 border-t-muted">
                  <CardHeader className="pb-2 pt-3 px-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-muted-foreground">Sem coluna</CardTitle>
                      <span className="text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                        {semColuna.length}
                      </span>
                    </div>
                  </CardHeader>
                  <Droppable droppableId="sem-coluna">
                    {(provided) => (
                      <CardContent ref={provided.innerRef} {...provided.droppableProps} className="px-2 pb-2 space-y-2 min-h-[100px]">
                        {semColuna.map((contato, index) => (
                          <Draggable key={contato.id} draggableId={contato.id} index={index}>
                            {(provided, snapshot) => (
                              <Card
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={cn("shadow-sm cursor-pointer hover:shadow-md", snapshot.isDragging && "shadow-lg ring-2 ring-primary/20")}
                                onClick={() => setSelectedContatoId(contato.id)}
                              >
                                <CardContent className="p-3">
                                  <p className="font-medium text-sm truncate">{contato.nome}</p>
                                  <TipoContatoBadge tipo={contato.tipo} />
                                </CardContent>
                              </Card>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </CardContent>
                    )}
                  </Droppable>
                </Card>
              </div>
            )}
            {colsProvided.placeholder}
          </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* Conversation Dialog */}
      <Dialog open={!!selectedContatoId} onOpenChange={(open) => !open && setSelectedContatoId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          {selectedContatoId && (
            <ConversationPanel
              contatoId={selectedContatoId}
              atendimentoInfo={atendimentoByContato.get(selectedContatoId)}
            />
          )}
        </DialogContent>
      </Dialog>

      <CreateCardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        pipelineType="crm"
        firstColumnId={firstColumnId}
      />

      {/* Confirm delete dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              Os contatos desta coluna ficarão sem estágio definido. Esta ação pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Conversation Panel (opened from pipeline card) ───
function ConversationPanel({
  contatoId,
  atendimentoInfo,
}: {
  contatoId: string;
  atendimentoInfo?: { id: string; modo: string; status: string };
}) {
  const { data: contatos } = useContatos();
  const contato = contatos?.find((c) => c.id === contatoId);
  const { data: allColunas } = usePipelineColunas();
  const updateContato = useUpdateContato();
  const queryClient = useQueryClient();

  // Find the latest open atendimento for this contato
  const { data: atendimentoData } = useQuery({
    queryKey: ["atendimento_contato", contatoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("id, modo, status, canal, canal_provedor, solicitacao_id")
        .eq("contato_id", contatoId)
        .neq("status", "encerrado")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
  });

  const atendimentoId = atendimentoData?.id || atendimentoInfo?.id;

  // Group columns by grupo_funil for selector
  const colunasGrouped = useMemo(() => {
    if (!allColunas) return {};
    const groups: Record<string, typeof allColunas> = {};
    for (const col of allColunas) {
      const g = col.grupo_funil || "Outros";
      if (!groups[g]) groups[g] = [];
      groups[g].push(col);
    }
    return groups;
  }, [allColunas]);

  const handleMoveToColumn = async (colunaId: string) => {
    if (!contato) return;
    const previousColunaId = contato.pipeline_coluna_id;
    updateContato.mutate({ id: contatoId, pipeline_coluna_id: colunaId } as any, {
      onSuccess: () => {
        toast.success("Contato movido com sucesso");
        // Trigger automations
        supabase.functions.invoke("pipeline-automations", {
          body: {
            entity_type: "contato",
            entity_id: contatoId,
            coluna_id: colunaId,
            coluna_anterior_id: previousColunaId,
          },
        });
      },
    });
  };

  const handleEncerrarAtendimento = async () => {
    if (!atendimentoId) return;
    try {
      // Generate summary
      await supabase.functions.invoke("summarize-atendimento", {
        body: { atendimento_id: atendimentoId },
      });

      // Close atendimento
      const { error } = await supabase
        .from("atendimentos")
        .update({ status: "encerrado", fim_at: new Date().toISOString() } as any)
        .eq("id", atendimentoId);
      if (error) throw error;

      // Cancel recovery cadence
      if (contato) {
        const meta = (contato.metadata as any) || {};
        if (meta.recuperacao_vendas) {
          await supabase.from("contatos").update({
            metadata: { ...meta, recuperacao_vendas: { ...meta.recuperacao_vendas, status: "encerrado_manual" } },
          } as any).eq("id", contatoId);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["atendimento_contato", contatoId] });
      queryClient.invalidateQueries({ queryKey: ["atendimentos_modos"] });
      toast.success("Atendimento encerrado com sucesso");
    } catch (e: any) {
      toast.error("Erro ao encerrar: " + e.message);
    }
  };

  if (!atendimentoId) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {contato?.nome ?? "Contato"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
          Nenhum atendimento ativo para este contato.
        </div>
      </>
    );
  }

  const currentColuna = allColunas?.find((c) => c.id === contato?.pipeline_coluna_id);

  return (
    <>
      {/* Column selector + close controls */}
      <div className="flex items-center gap-2 flex-wrap border-b pb-2 mb-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground shrink-0">Etapa:</span>
          <Select
            value={contato?.pipeline_coluna_id || ""}
            onValueChange={handleMoveToColumn}
          >
            <SelectTrigger className="h-7 text-xs w-48">
              <SelectValue placeholder="Selecionar coluna" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(colunasGrouped).map(([grupo, cols]) => (
                <div key={grupo}>
                  <p className="text-[10px] font-semibold text-muted-foreground px-2 pt-1.5 pb-0.5 uppercase">{grupo}</p>
                  {(cols as any[]).sort((a, b) => a.ordem - b.ordem).map((col) => (
                    <SelectItem key={col.id} value={col.id} className="text-xs">
                      {col.nome}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="h-7 text-xs"
          onClick={handleEncerrarAtendimento}
        >
          <X className="h-3 w-3 mr-1" /> Encerrar Atendimento
        </Button>
      </div>

      <ChatView atendimentoId={atendimentoId} contatoNome={contato?.nome ?? "Contato"} />
    </>
  );
}

function ChatView({ atendimentoId, contatoNome }: { atendimentoId: string; contatoNome: string }) {
  const { data: mensagens, refetch } = useMensagens(atendimentoId);
  const createMensagem = useCreateMensagem();
  const [msgText, setMsgText] = useState("");
  const [msgDirecao, setMsgDirecao] = useState<"outbound" | "internal">("outbound");
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch atendimento details
  const { data: atendimento } = useQuery({
    queryKey: ["atendimento_detail", atendimentoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atendimentos")
        .select("id, modo, status, canal, canal_provedor, metadata")
        .eq("id", atendimentoId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Realtime for messages
  useEffect(() => {
    const channel = supabase
      .channel(`msgs-pipeline-${atendimentoId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens", filter: `atendimento_id=eq.${atendimentoId}` }, () => {
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [atendimentoId, refetch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  const handleSend = async () => {
    const texto = msgText.trim();
    if (!texto) return;

    try {
      if (msgDirecao === "outbound" && atendimento?.canal === "whatsapp") {
        setSendingOutbound(true);
        const { data, error } = await supabase.functions.invoke("send-whatsapp", {
          body: { atendimento_id: atendimentoId, texto, remetente_nome: "Operador" },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Mensagem enviada ao WhatsApp");
      } else {
        await createMensagem.mutateAsync({
          atendimento_id: atendimentoId,
          conteudo: texto,
          direcao: msgDirecao,
          remetente_nome: "Operador",
        });
      }
      setMsgText("");
    } catch (e: any) {
      toast.error("Falha ao enviar: " + (e?.message || "Erro desconhecido"));
    } finally {
      setSendingOutbound(false);
    }
  };

  const direcaoColors: Record<string, string> = {
    inbound: "bg-muted text-foreground",
    outbound: "bg-primary text-primary-foreground",
    internal: "bg-warning-soft text-warning border border-warning-muted",
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {contatoNome}
        </DialogTitle>
      </DialogHeader>

      {atendimento && (
        <div className="flex items-center gap-2 flex-wrap">
          <AtendimentoStatusBadge status={atendimento.status as any} />
          <Badge variant="outline" className="capitalize">{atendimento.canal}</Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] cursor-pointer select-none",
              atendimento.modo === "ia"
                ? "border-primary/50 text-primary hover:bg-primary/10"
                : "border-warning/50 text-warning hover:bg-warning/10"
            )}
            onClick={async () => {
              const newModo = atendimento.modo === "ia" ? "humano" : "ia";
              const { error } = await supabase.from("atendimentos").update({ modo: newModo } as any).eq("id", atendimentoId);
              if (error) { toast.error("Erro: " + error.message); return; }
              toast.success(newModo === "ia" ? "Modo IA reativado" : "Modo humano ativado");
            }}
          >
            {atendimento.modo === "ia" ? "🤖 IA" : "👤 Humano"} (clique p/ alternar)
          </Badge>
        </div>
      )}

      {/* AI Summary card */}
      {atendimento && (atendimento as any).metadata?.resumo_ia && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 px-3 py-2 flex gap-2 items-start">
          <FileText className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-medium text-xs mb-1">Resumo IA</p>
            <p className="whitespace-pre-wrap text-xs">{(atendimento as any).metadata.resumo_ia}</p>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto min-h-[200px] max-h-[400px] space-y-2 p-3 bg-app-bg rounded-lg border">
        {!mensagens?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda</p>
        ) : (
          mensagens.map((m: any) => (
            <div key={m.id} className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", direcaoColors[m.direcao], m.direcao === "inbound" ? "mr-auto" : "ml-auto")}>
              {m.remetente_nome && <p className="text-xs font-medium opacity-70 mb-0.5">{m.remetente_nome} {m.direcao === "internal" && "• nota interna"}</p>}
              <p className="whitespace-pre-wrap">{m.conteudo}</p>
              <p className="text-[10px] opacity-50 mt-1">{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</p>
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex gap-1">
            <Button variant={msgDirecao === "outbound" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("outbound")}>Resposta</Button>
            <Button variant={msgDirecao === "internal" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("internal")}>Nota Interna</Button>
          </div>
          <Textarea
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder={msgDirecao === "internal" ? "Nota interna..." : "Digite sua mensagem..."}
            rows={2}
            className="resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
        </div>
        <Button onClick={handleSend} disabled={!msgText.trim() || createMensagem.isPending || sendingOutbound} size="icon" className="h-10 w-10">
          {sendingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
