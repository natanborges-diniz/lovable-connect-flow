import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateCardDialog } from "@/components/pipeline/CreateCardDialog";
import { useContatos, useUpdateContato } from "@/hooks/useContatos";
import {
  usePipelineColunas,
  usePipelineColunasAll,
  useCreatePipelineColuna,
  useUpdatePipelineColuna,
  useDeletePipelineColuna,
  
} from "@/hooks/usePipelineColunas";
import { TransferPipelineDialog } from "@/components/pipeline/TransferPipelineDialog";
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
  MessageSquare, Send, Loader2, Sparkles, FileText, AlertTriangle, RefreshCw, Image as ImageIcon, ExternalLink,
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
  // CRM exibe apenas vendas (setor_id IS NULL). Atendimento Corporativo agora vive em /interno.
  const colunas = colunasVendas ?? [];
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
        queryClient.invalidateQueries({ queryKey: ["pipeline_latest_messages"] });
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
  const activeAtendimentoIds = useMemo(() => (atendimentosAtivos ?? []).map((a) => a.id), [atendimentosAtivos]);

  const { data: latestMessagesByAtendimento = {} } = useQuery({
    queryKey: ["pipeline_latest_messages", activeAtendimentoIds.join(",")],
    enabled: activeAtendimentoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens")
        .select("id, atendimento_id, direcao, created_at, remetente_nome, tipo_conteudo")
        .in("atendimento_id", activeAtendimentoIds)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).reduce((acc, msg) => {
        if (msg.direcao === "internal") return acc;
        if (!acc[msg.atendimento_id]) acc[msg.atendimento_id] = msg;
        return acc;
      }, {} as Record<string, { id: string; atendimento_id: string; direcao: string; created_at: string; remetente_nome: string | null; tipo_conteudo: string }>);
    },
    initialData: {},
  });

  const hasPendingCustomerReply = (contatoId: string) => {
    const atendimento = atendimentoByContato.get(contatoId);
    if (!atendimento) return false;
    return latestMessagesByAtendimento[atendimento.id]?.direcao === "inbound";
  };

  const updateContato = useUpdateContato();
  const createColuna = useCreatePipelineColuna();
  const updateColuna = useUpdatePipelineColuna();
  const deleteColuna = useDeletePipelineColuna();

  const [editingColuna, setEditingColuna] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [addingColuna, setAddingColuna] = useState(false);
  const [newColunaNome, setNewColunaNome] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isLoading = loadingContatos || loadingColunasVendas;

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

  // Filter columns by active segment
  const filteredColunas = activeSegment === "todos"
    ? colunas
    : colunas.filter(c => (c.grupo_funil || "Outros") === activeSegment);

  const contatosByColuna = (filteredColunas ?? []).map((col) => ({
    ...col,
    isInternal: false,
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
      onSuccess: async () => {
        // Auto-reset modo from humano to ia on column move
        const at = atendimentoByContato.get(contatoId);
        if (at?.modo === "humano") {
          const { error: modoErr } = await supabase
            .from("atendimentos")
            .update({ modo: "ia" } as any)
            .eq("id", at.id);
          if (modoErr) {
            console.error("[MODO] Error resetting to IA:", modoErr);
          } else {
            toast.info("Modo IA reativado automaticamente");
            queryClient.invalidateQueries({ queryKey: ["atendimentos_modos"] });
          }
        }

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
        const waitingReplyCount = humanCards.filter((c) => hasPendingCustomerReply(c.id)).length;
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
                {waitingReplyCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {waitingReplyCount} com resposta nova
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex gap-2 overflow-x-auto">
                {humanCards
                  .sort((a, b) => new Date(a.ultimo_contato_at || a.created_at).getTime() - new Date(b.ultimo_contato_at || b.created_at).getTime())
                  .map((c) => {
                    const coluna = colunas.find((col) => col.id === c.pipeline_coluna_id);
                    const hasNewReply = hasPendingCustomerReply(c.id);
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
                            {hasNewReply && <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />}
                          </div>
                          {coluna && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{coluna.nome}</Badge>
                          )}
                          {hasNewReply && (
                            <p className="text-[10px] font-medium text-destructive">Cliente respondeu</p>
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
                        coluna.isInternal
                          ? "border-t-accent-foreground bg-accent/10"
                          : `border-t-${coluna.cor}`
                      )}
                    >
                      <CardHeader className="pb-2 pt-3 px-3 cursor-grab active:cursor-grabbing" {...colDragProvided.dragHandleProps}>
                        <div className="flex items-center justify-between gap-1">
                          {coluna.isInternal && (
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
                              <CardTitle className="text-sm font-semibold truncate">
                                {coluna.nome}
                              </CardTitle>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full mr-1 bg-muted text-muted-foreground">
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
                            const cardIsHumano = atInfo?.modo === "humano";
                            const hasNewReply = hasPendingCustomerReply(contato.id);
                            return (
                              <Draggable key={contato.id} draggableId={contato.id} index={index}>
                                {(provided, snapshot) => (
                                  <Card
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className={cn(
                                      "shadow-sm transition-all cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30",
                                      snapshot.isDragging && "shadow-lg ring-2 ring-primary/20",
                                      cardIsHumano && "border-destructive/50 ring-1 ring-destructive/30 animate-pulse"
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
                                            {hasNewReply && <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />}
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
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
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
  const { data: allColunas } = usePipelineColunasAll();
  const updateContato = useUpdateContato();
  const queryClient = useQueryClient();

  // Transfer dialog state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDestino, setTransferDestino] = useState<"lojas" | "financeiro" | "ti">("lojas");
  const [transferColunaId, setTransferColunaId] = useState("");
  const [transferColunaNome, setTransferColunaNome] = useState("");

  // Known setor name mappings
  const SETOR_MAP: Record<string, "lojas" | "financeiro" | "ti"> = {
    "Loja": "lojas",
    "Lojas": "lojas",
    "Financeiro": "financeiro",
    "TI": "ti",
  };

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

  // Group columns by setor_nome for selector
  const colunasGrouped = useMemo(() => {
    if (!allColunas) return {};
    const groups: Record<string, typeof allColunas> = {};
    for (const col of allColunas) {
      const g = col.setor_nome || "CRM";
      if (!groups[g]) groups[g] = [];
      groups[g].push(col);
    }
    return groups;
  }, [allColunas]);

  const handleMoveToColumn = async (colunaId: string) => {
    if (!contato) return;

    // Find the selected column to determine its setor
    const selectedCol = allColunas?.find((c) => c.id === colunaId);
    if (!selectedCol) return;

    const setorNome = selectedCol.setor_nome || "CRM";
    const destinoKey = SETOR_MAP[setorNome];

    // If moving to another pipeline, open transfer dialog
    if (destinoKey) {
      setTransferDestino(destinoKey);
      setTransferColunaId(colunaId);
      setTransferColunaNome(selectedCol.nome);
      setTransferOpen(true);
      return;
    }

    // Same pipeline (CRM) — move directly
    const previousColunaId = contato.pipeline_coluna_id;
    updateContato.mutate({ id: contatoId, pipeline_coluna_id: colunaId } as any, {
      onSuccess: () => {
        toast.success("Contato movido com sucesso");
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

  const handleTransferSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["contatos"] });
    queryClient.invalidateQueries({ queryKey: ["pipeline_colunas_all"] });
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
        <div className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base pr-8">
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="truncate">{contato?.nome ?? "Contato"}</span>
            </DialogTitle>
          </DialogHeader>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12 px-4">
          Nenhum atendimento ativo para este contato.
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header fixo: título + ações */}
      <div className="px-4 pt-4 pb-3 border-b shrink-0 space-y-2">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base pr-8">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">{contato?.nome ?? "Contato"}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-xs text-muted-foreground shrink-0">Etapa:</span>
            <Select
              value={contato?.pipeline_coluna_id || ""}
              onValueChange={handleMoveToColumn}
            >
              <SelectTrigger className="h-7 text-xs w-52">
                <SelectValue placeholder="Selecionar coluna" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(colunasGrouped).map(([setor, cols]) => (
                  <div key={setor}>
                    <p className="text-[10px] font-bold text-muted-foreground px-2 pt-2 pb-0.5 uppercase tracking-wider border-t first:border-t-0">
                      ── {setor} ──
                    </p>
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
            <X className="h-3 w-3 mr-1" /> Encerrar
          </Button>
        </div>
      </div>

      <ChatView atendimentoId={atendimentoId} contatoNome={contato?.nome ?? "Contato"} />

      <TransferPipelineDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        destino={transferDestino}
        contatoId={contatoId}
        contatoNome={contato?.nome ?? "Contato"}
        colunaDestinoId={transferColunaId}
        colunaDestinoNome={transferColunaNome}
        onSuccess={handleTransferSuccess}
      />
    </>
  );
}

function ChatView({ atendimentoId, contatoNome: _contatoNome }: { atendimentoId: string; contatoNome: string }) {
  const { data: mensagens, refetch } = useMensagens(atendimentoId);
  const createMensagem = useCreateMensagem();
  const queryClient = useQueryClient();
  const [msgText, setMsgText] = useState("");
  const [msgDirecao, setMsgDirecao] = useState<"outbound" | "internal">("outbound");
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const [modoLoading, setModoLoading] = useState<"ia" | "humano" | null>(null);
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

  const latestExternalMessage = useMemo(() => {
    const externalMessages = (mensagens ?? []).filter((m: any) => m.direcao !== "internal");
    return externalMessages[externalMessages.length - 1] ?? null;
  }, [mensagens]);

  const hasPendingCustomerReply = latestExternalMessage?.direcao === "inbound";

  const handleSetModo = async (targetMode: "ia" | "humano") => {
    if (!atendimento || atendimento.modo === targetMode) return;

    try {
      setModoLoading(targetMode);

      const { error } = await supabase
        .from("atendimentos")
        .update({ modo: targetMode } as any)
        .eq("id", atendimentoId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["atendimento_detail", atendimentoId] });
      queryClient.invalidateQueries({ queryKey: ["atendimentos_modos"] });
      queryClient.invalidateQueries({ queryKey: ["atendimento_contato"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_latest_messages"] });

      if (targetMode === "ia" && hasPendingCustomerReply) {
        const mensagemTexto = latestExternalMessage?.conteudo?.trim() || `[${(latestExternalMessage as any)?.tipo_conteudo || "mensagem"}]`;
        const { data, error: invokeError } = await supabase.functions.invoke("ai-triage", {
          body: {
            atendimento_id: atendimentoId,
            mensagem_texto: mensagemTexto,
            forcar_processamento: true,
          },
        });

        if (invokeError) throw invokeError;
        if (data?.error) throw new Error(data.error);

        toast.success("IA reativada e lendo a última resposta do cliente");
      } else {
        toast.success(targetMode === "humano" ? "Conversa assumida pelo humano" : "IA reativada");
      }
    } catch (e: any) {
      toast.error(`Falha ao ${targetMode === "humano" ? "assumir a conversa" : "devolver para IA"}: ` + (e?.message || "Erro desconhecido"));
    } finally {
      setModoLoading(null);
    }
  };

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
      {/* Status strip (parte do header geral) */}
      {atendimento && (
        <div className="px-4 py-2 border-b shrink-0 flex items-center gap-2 flex-wrap bg-background">
          <AtendimentoStatusBadge status={atendimento.status as any} />
          <Badge variant="outline" className="capitalize text-[10px]">{atendimento.canal}</Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] select-none",
              atendimento.modo === "ia"
                ? "border-primary/50 text-primary"
                : atendimento.modo === "humano"
                  ? "border-warning/50 text-warning"
                  : "border-muted-foreground/50 text-muted-foreground"
            )}
          >
            {atendimento.modo === "ia" ? "🤖 IA" : atendimento.modo === "humano" ? "👤 Humano" : "🔄 Híbrido"}
          </Badge>
          {atendimento.modo === "humano" && hasPendingCustomerReply && (
            <Badge variant="destructive" className="text-[10px] animate-pulse">
              Cliente respondeu
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {atendimento.modo !== "humano" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!!modoLoading}
                onClick={() => handleSetModo("humano")}
              >
                {modoLoading === "humano" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <User className="h-3 w-3 mr-1" />}
                Assumir humano
              </Button>
            )}
            {atendimento.modo !== "ia" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!!modoLoading}
                onClick={() => handleSetModo("ia")}
              >
                {modoLoading === "ia" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Bot className="h-3 w-3 mr-1" />}
                Devolver para IA
              </Button>
            )}
          </div>
        </div>
      )}

      {/* AI Summary card */}
      {atendimento && (atendimento as any).metadata?.resumo_ia && (
        <div className="mx-4 mt-2 rounded-lg border border-warning-muted bg-warning-soft px-3 py-2 flex gap-2 items-start shrink-0">
          <FileText className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div className="text-sm text-warning">
            <p className="font-medium text-xs mb-1">Resumo IA</p>
            <p className="whitespace-pre-wrap text-xs">{(atendimento as any).metadata.resumo_ia}</p>
          </div>
        </div>
      )}

      {/* Mensagens scrolláveis */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 py-3 space-y-2 bg-app-bg">
        {!mensagens?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda</p>
        ) : (
          mensagens.map((m: any) => {
            const mediaUrl = m?.metadata?.media_url as string | undefined;
            const mimeType = (m?.metadata?.mime_type as string | undefined) || "";
            const isImage = (m?.tipo_conteudo || "text") === "image" && !!mediaUrl;
            const isDocument = !!mediaUrl && !isImage;

            return (
              <div key={m.id} className={cn("max-w-[78%] rounded-lg px-3 py-2 text-sm break-words overflow-hidden", direcaoColors[m.direcao], m.direcao === "inbound" ? "mr-auto" : "ml-auto")}>
                {m.remetente_nome && <p className="text-[11px] font-medium opacity-70 mb-0.5 truncate">{m.remetente_nome} {m.direcao === "internal" && "• nota interna"}</p>}
                {isImage ? (
                  <a href={mediaUrl} target="_blank" rel="noreferrer" className="block mb-2">
                    <img
                      src={mediaUrl}
                      alt={m.conteudo && m.conteudo !== "[image]" ? m.conteudo : "Imagem enviada pelo cliente"}
                      className="max-h-72 w-full rounded-md object-contain bg-background/40"
                      loading="lazy"
                    />
                  </a>
                ) : null}
                {isDocument ? (
                  <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs underline-offset-2 hover:underline"
                  >
                    {mimeType.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    <span className="truncate">Ver anexo</span>
                    <ExternalLink className="ml-auto h-3.5 w-3.5" />
                  </a>
                ) : null}
                {m.conteudo && m.conteudo !== "[image]" && <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>}
                <p className="text-[10px] opacity-50 mt-1">{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</p>
              </div>
            );
          })
        )}
      </div>

      {/* Composer fixo no rodapé */}
      <div className="border-t p-3 shrink-0 bg-background">
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 space-y-1">
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
          <Button onClick={handleSend} disabled={!msgText.trim() || createMensagem.isPending || sendingOutbound} size="icon" className="h-10 w-10 shrink-0">
            {sendingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
  );
}
