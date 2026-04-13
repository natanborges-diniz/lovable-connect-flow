import { useState, useEffect } from "react";
import { CreateCardDialog } from "@/components/pipeline/CreateCardDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  usePipelineColunas,
  useCreatePipelineColuna,
  useUpdatePipelineColuna,
  useDeletePipelineColuna,
} from "@/hooks/usePipelineColunas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Check, X, Search, GripVertical, Monitor, FileText, Clock, Zap,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAutomacoes } from "@/hooks/useAutomacoes";

export default function PipelineTI() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const [selectedSolicitacao, setSelectedSolicitacao] = useState<any | null>(null);

  const { data: tiSetor } = useQuery({
    queryKey: ["setor_ti"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setores")
        .select("id, nome")
        .eq("nome", "TI")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const setorId = tiSetor?.id;
  const { data: colunas, isLoading: loadingColunas } = usePipelineColunas(setorId);
  const { data: automacoes = [] } = useAutomacoes("solicitacao");

  const { data: solicitacoes, isLoading: loadingSolicitacoes } = useQuery({
    queryKey: ["solicitacoes_ti", setorId],
    enabled: !!setorId,
    queryFn: async () => {
      const { data: cols } = await supabase
        .from("pipeline_colunas")
        .select("id")
        .eq("setor_id", setorId!)
        .eq("ativo", true);

      const colIds = (cols || []).map((c: any) => c.id);
      if (colIds.length === 0) return [];

      const { data, error } = await (supabase
        .from("solicitacoes")
        .select("*, contato:contatos(id, nome, telefone, tipo)") as any)
        .in("pipeline_coluna_id", colIds)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as any[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("ti-pipeline-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "solicitacoes" }, () => {
        queryClient.invalidateQueries({ queryKey: ["solicitacoes_ti"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const updateColuna = useUpdatePipelineColuna();
  const createColuna = useCreatePipelineColuna();
  const deleteColuna = useDeletePipelineColuna();

  const [editingColuna, setEditingColuna] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  const [addingColuna, setAddingColuna] = useState(false);
  const [newColunaNome, setNewColunaNome] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const firstColumnId = (colunas ?? []).sort((a, b) => a.ordem - b.ordem)[0]?.id;

  const updateSolicitacaoColuna = useMutation({
    mutationFn: async ({ id, pipeline_coluna_id }: { id: string; pipeline_coluna_id: string }) => {
      const { error } = await supabase
        .from("solicitacoes")
        .update({ pipeline_coluna_id } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["solicitacoes_ti"] }),
  });

  const isLoading = loadingColunas || loadingSolicitacoes || !setorId;

  const filteredSolicitacoes = (solicitacoes ?? []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.assunto?.toLowerCase().includes(q) ||
      s.descricao?.toLowerCase().includes(q) ||
      s.contato?.nome?.toLowerCase().includes(q) ||
      s.tipo?.toLowerCase().includes(q)
    );
  });

  const solicitacoesByColuna = (colunas ?? []).map((col) => ({
    ...col,
    solicitacoes: filteredSolicitacoes.filter((s: any) => s.pipeline_coluna_id === col.id),
  }));

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    if (result.type === "COLUMN") {
      const sorted = [...solicitacoesByColuna];
      const [moved] = sorted.splice(result.source.index, 1);
      sorted.splice(result.destination.index, 0, moved);
      sorted.forEach((col, idx) => {
        if (col.ordem !== idx) {
          updateColuna.mutate({ id: col.id, ordem: idx });
        }
      });
      return;
    }

    const solicitacaoId = result.draggableId;
    const destColunaId = result.destination.droppableId;
    const sourceColunaId = result.source.droppableId;
    updateSolicitacaoColuna.mutate({ id: solicitacaoId, pipeline_coluna_id: destColunaId });

    if (destColunaId !== sourceColunaId) {
      supabase.functions.invoke("pipeline-automations", {
        body: {
          entity_type: "solicitacao",
          entity_id: solicitacaoId,
          coluna_id: destColunaId,
          coluna_anterior_id: sourceColunaId,
        },
      }).catch(e => console.warn("Automation call failed:", e));
    }
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

  const tipoIcon = (tipo: string | null) => {
    switch (tipo) {
      case "impressao": return <FileText className="h-3.5 w-3.5 text-primary" />;
      case "suporte": return <Monitor className="h-3.5 w-3.5 text-info" />;
      default: return <Monitor className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <>
      <PageHeader
        title="Pipeline TI"
        description="Gerencie solicitações de tecnologia • Arraste cards entre colunas"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar solicitações..."
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
                {solicitacoesByColuna.map((coluna, colIndex) => (
                  <Draggable key={coluna.id} draggableId={`col-${coluna.id}`} index={colIndex}>
                    {(colDragProvided, colDragSnapshot) => (
                      <div
                        ref={colDragProvided.innerRef}
                        {...colDragProvided.draggableProps}
                        className={cn("flex-shrink-0 w-72", colDragSnapshot.isDragging && "opacity-80")}
                      >
                        <Card className="border-t-4 border-t-primary/60">
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
                                  <CardTitle className="text-sm font-semibold truncate flex items-center gap-1">
                                    {coluna.nome}
                                    {automacoes.some(a => a.pipeline_coluna_id === coluna.id) && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary/10 cursor-pointer"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                window.location.href = "/configuracoes?tab=automacoes";
                                              }}
                                            >
                                              <Zap className="h-2.5 w-2.5 text-primary" />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p className="text-xs">
                                              {automacoes.filter(a => a.pipeline_coluna_id === coluna.id).length} automação(ões) ativa(s)
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </CardTitle>
                                  <div className="flex items-center gap-0.5">
                                    <span className="text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full mr-1 text-muted-foreground">
                                      {coluna.solicitacoes.length}
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
                                {coluna.solicitacoes.map((sol: any, index: number) => (
                                  <Draggable key={sol.id} draggableId={sol.id} index={index}>
                                    {(provided, snapshot) => (
                                      <Card
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        className={cn(
                                          "shadow-sm transition-all cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30",
                                          snapshot.isDragging && "shadow-lg ring-2 ring-primary/20"
                                        )}
                                        onClick={() => setSelectedSolicitacao(sol)}
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
                                              {sol.metadata?.loja_nome && (
                                                <p className="text-xs font-semibold text-primary truncate mb-0.5">
                                                  🏪 {sol.metadata.loja_nome}
                                                </p>
                                              )}
                                              <div className="flex items-center gap-1.5">
                                                {tipoIcon(sol.tipo)}
                                                <p className="font-medium text-sm truncate">{sol.assunto}</p>
                                              </div>
                                              {sol.contato && (
                                                <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                  {sol.contato.nome}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            {formatDistanceToNow(new Date(sol.created_at), { addSuffix: true, locale: ptBR })}
                                          </div>
                                          {sol.prioridade && sol.prioridade !== "normal" && (
                                            <Badge variant={sol.prioridade === "critica" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                                              {sol.prioridade}
                                            </Badge>
                                          )}
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
                  </Draggable>
                ))}
                {colsProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {addingColuna && (
        <div className="fixed bottom-6 right-6 z-50 bg-card border rounded-lg shadow-lg p-4 flex items-center gap-2">
          <Input
            value={newColunaNome}
            onChange={(e) => setNewColunaNome(e.target.value)}
            placeholder="Nome da coluna"
            className="w-48"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddColuna();
              if (e.key === "Escape") setAddingColuna(false);
            }}
          />
          <Button size="sm" onClick={handleAddColuna}>Criar</Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingColuna(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              Os cards desta coluna ficarão sem coluna atribuída.
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

      {selectedSolicitacao && (
        <Dialog open={!!selectedSolicitacao} onOpenChange={() => setSelectedSolicitacao(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {tipoIcon(selectedSolicitacao.tipo)}
                {selectedSolicitacao.assunto}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {selectedSolicitacao.contato && (
                <div>
                  <p className="text-xs text-muted-foreground">Solicitante</p>
                  <p className="text-sm font-medium">{selectedSolicitacao.contato.nome}</p>
                </div>
              )}
              {selectedSolicitacao.descricao && (
                <div>
                  <p className="text-xs text-muted-foreground">Descrição</p>
                  <p className="text-sm">{selectedSolicitacao.descricao}</p>
                </div>
              )}
              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Prioridade</p>
                  <Badge variant={selectedSolicitacao.prioridade === "critica" ? "destructive" : "secondary"}>
                    {selectedSolicitacao.prioridade}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Criado em</p>
                  <p className="text-sm">{format(new Date(selectedSolicitacao.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <CreateCardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        pipelineType="financeiro"
        setorId={setorId}
        firstColumnId={firstColumnId}
      />
    </>
  );
}
