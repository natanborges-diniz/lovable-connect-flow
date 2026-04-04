import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useContatos, useUpdateContato } from "@/hooks/useContatos";
import {
  usePipelineColunas,
  useCreatePipelineColuna,
  useUpdatePipelineColuna,
  useDeletePipelineColuna,
} from "@/hooks/usePipelineColunas";
import { TipoContatoBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Phone, Clock, Plus, Pencil, Trash2, Check, X, Search, GripVertical, Bot, User, Sparkles, Store,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DragDropContext, Droppable, Draggable, type DropResult,
} from "@hello-pangea/dnd";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export default function PipelineAtendimentoGael() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  // Get Atendimento Gael setor id
  const { data: setorGael } = useQuery({
    queryKey: ["setor_atendimento_gael"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setores")
        .select("id, nome")
        .eq("nome", "Atendimento Gael")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const setorId = setorGael?.id;
  const { data: colunas, isLoading: loadingColunas } = usePipelineColunas(setorId);

  // Load contatos that are in this pipeline's columns
  const { data: contatos, isLoading: loadingContatos } = useQuery({
    queryKey: ["contatos_atendimento_gael", setorId],
    enabled: !!setorId,
    queryFn: async () => {
      const { data: cols } = await supabase
        .from("pipeline_colunas")
        .select("id")
        .eq("setor_id", setorId!)
        .eq("ativo", true);

      const colIds = (cols || []).map((c: any) => c.id);
      if (colIds.length === 0) return [];

      const { data, error } = await supabase
        .from("contatos")
        .select("*")
        .in("pipeline_coluna_id", colIds)
        .eq("ativo", true)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch active atendimentos for mode badges
  const { data: atendimentosAtivos } = useQuery({
    queryKey: ["atendimentos_modos_gael"],
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

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("gael-pipeline-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "contatos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["contatos_atendimento_gael"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateContato = useUpdateContato();
  const updateColuna = useUpdatePipelineColuna();
  const createColuna = useCreatePipelineColuna();
  const deleteColuna = useDeletePipelineColuna();

  const [editingColuna, setEditingColuna] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [addingColuna, setAddingColuna] = useState(false);
  const [newColunaNome, setNewColunaNome] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isLoading = loadingColunas || loadingContatos || !setorId;

  const filteredContatos = (contatos ?? []).filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.nome?.toLowerCase().includes(s) ||
      c.telefone?.toLowerCase().includes(s) ||
      c.tags?.some((t: string) => t.toLowerCase().includes(s))
    );
  });

  const contatosByColuna = (colunas ?? []).map((col) => ({
    ...col,
    contatos: filteredContatos.filter((c) => c.pipeline_coluna_id === col.id),
  }));

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    if (result.type === "COLUMN") {
      const sorted = [...contatosByColuna];
      const [moved] = sorted.splice(result.source.index, 1);
      sorted.splice(result.destination.index, 0, moved);
      sorted.forEach((col, idx) => {
        if (col.ordem !== idx) updateColuna.mutate({ id: col.id, ordem: idx });
      });
      return;
    }

    const contatoId = result.draggableId;
    const destColunaId = result.destination.droppableId;
    const sourceColunaId = result.source.droppableId;
    if (destColunaId === sourceColunaId) return;

    updateContato.mutate({ id: contatoId, pipeline_coluna_id: destColunaId } as any);
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
    if (!newColunaNome.trim() || !setorId) return;
    const maxOrdem = Math.max(0, ...(colunas ?? []).map((c) => c.ordem));
    createColuna.mutate({ nome: newColunaNome.trim(), ordem: maxOrdem + 1, setor_id: setorId });
    setNewColunaNome("");
    setAddingColuna(false);
  };

  const confirmDelete = (id: string) => {
    deleteColuna.mutate(id);
    setDeleteConfirm(null);
  };

  return (
    <>
      <PageHeader
        title="Atendimento Interno (Lojas)"
        description="Pipeline de atendimento para contatos tipo loja e colaborador"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contatos..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-60"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setAddingColuna(true)}>
              <Plus className="h-4 w-4 mr-1" /> Coluna
            </Button>
          </div>
        }
      />

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
                {contatosByColuna.map((coluna, colIndex) => (
                  <Draggable key={coluna.id} draggableId={`col-${coluna.id}`} index={colIndex}>
                    {(colDragProvided, colDragSnapshot) => (
                      <div
                        ref={colDragProvided.innerRef}
                        {...colDragProvided.draggableProps}
                        className={cn("flex-shrink-0 w-72", colDragSnapshot.isDragging && "opacity-80")}
                      >
                        <Card className="border-t-4 border-t-accent">
                          <CardHeader className="pb-2 pt-3 px-3 cursor-grab active:cursor-grabbing" {...colDragProvided.dragHandleProps}>
                            <div className="flex items-center justify-between gap-1">
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
                                  <CardTitle className="text-sm font-semibold truncate">
                                    {coluna.nome}
                                  </CardTitle>
                                  <div className="flex items-center gap-0.5">
                                    <span className="text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full mr-1 text-muted-foreground">
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
                                  return (
                                    <Draggable key={contato.id} draggableId={contato.id} index={index}>
                                      {(provided, snapshot) => (
                                        <Card
                                          ref={provided.innerRef}
                                          {...provided.draggableProps}
                                          className={cn(
                                            "shadow-sm transition-all hover:shadow-md hover:ring-1 hover:ring-primary/30",
                                            snapshot.isDragging && "shadow-lg ring-2 ring-primary/20"
                                          )}
                                        >
                                          <CardContent className="p-3 space-y-1.5">
                                            <div className="flex items-start gap-2">
                                              <div
                                                {...provided.dragHandleProps}
                                                className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground"
                                              >
                                                <GripVertical className="h-4 w-4" />
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <Store className="h-3.5 w-3.5 text-primary shrink-0" />
                                                  <p className="font-medium text-sm truncate">{contato.nome}</p>
                                                  {atInfo && (
                                                    atInfo.modo === "ia" ? (
                                                      <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-primary/50 text-primary">
                                                        <Bot className="h-2.5 w-2.5" /> IA
                                                      </Badge>
                                                    ) : atInfo.modo === "hibrido" ? (
                                                      <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                                                        <Sparkles className="h-2.5 w-2.5" /> Híbrido
                                                      </Badge>
                                                    ) : (
                                                      <Badge variant="outline" className="text-[10px] px-1 py-0 gap-0.5 border-warning/50 text-warning">
                                                        <User className="h-2.5 w-2.5" /> Humano
                                                      </Badge>
                                                    )
                                                  )}
                                                </div>
                                                <TipoContatoBadge tipo={contato.tipo} />
                                              </div>
                                            </div>

                                            {contato.telefone && (
                                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-6">
                                                <Phone className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{contato.telefone}</span>
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
                ))}
                {colsProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* Add column dialog */}
      {addingColuna && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAddingColuna(false)}>
          <Card className="w-80" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base">Nova Coluna</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Nome da coluna"
                value={newColunaNome}
                onChange={(e) => setNewColunaNome(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleAddColuna(); }}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setAddingColuna(false)}>Cancelar</Button>
                <Button size="sm" onClick={handleAddColuna}>Criar</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete column confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              Os contatos desta coluna ficarão sem coluna atribuída.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
