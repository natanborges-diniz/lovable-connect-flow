import { useState, useEffect } from "react";
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
  Plus, Pencil, Trash2, Check, X, Search, GripVertical,
  CreditCard, FileText, Clock, DollarSign, ShieldCheck, Zap,
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
import { CpfApprovalDialog } from "@/components/financeiro/CpfApprovalDialog";

export default function PipelineFinanceiro() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const [selectedSolicitacao, setSelectedSolicitacao] = useState<any | null>(null);

  // Get Financeiro setor id
  const { data: financeiroSetor } = useQuery({
    queryKey: ["setor_financeiro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("setores")
        .select("id, nome")
        .eq("nome", "Financeiro")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const setorId = financeiroSetor?.id;
  const { data: colunas, isLoading: loadingColunas } = usePipelineColunas(setorId);

  // Load solicitações with pipeline_coluna_id in this pipeline
  const { data: solicitacoes, isLoading: loadingSolicitacoes } = useQuery({
    queryKey: ["solicitacoes_financeiro", setorId],
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

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("financeiro-pipeline-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "solicitacoes" }, () => {
        queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
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

  const updateSolicitacaoColuna = useMutation({
    mutationFn: async ({ id, pipeline_coluna_id }: { id: string; pipeline_coluna_id: string }) => {
      const { error } = await supabase
        .from("solicitacoes")
        .update({ pipeline_coluna_id } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] }),
  });

  const [deleteCardConfirm, setDeleteCardConfirm] = useState<string | null>(null);

  const deleteSolicitacao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("solicitacoes")
        .update({ pipeline_coluna_id: null, status: "cancelada" as any } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      toast.success("Card removido do pipeline.");
    },
  });

  const isLoading = loadingColunas || loadingSolicitacoes || !setorId;

  const filteredSolicitacoes = (solicitacoes ?? []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.assunto?.toLowerCase().includes(q) ||
      s.descricao?.toLowerCase().includes(q) ||
      s.contato?.nome?.toLowerCase().includes(q) ||
      s.contato?.telefone?.toLowerCase().includes(q) ||
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
    updateSolicitacaoColuna.mutate({ id: solicitacaoId, pipeline_coluna_id: destColunaId });
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
      case "link_pagamento": return <CreditCard className="h-3.5 w-3.5 text-primary" />;
      case "boleto": return <FileText className="h-3.5 w-3.5 text-info" />;
      case "consulta_cpf": return <ShieldCheck className="h-3.5 w-3.5 text-warning" />;
      default: return <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <>
      <PageHeader
        title="Pipeline Financeiro"
        description="Gerencie solicitações financeiras • Arraste cards entre colunas"
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
                                  <CardTitle className="text-sm font-semibold truncate">
                                    {coluna.nome}
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
                                              {/* Loja solicitante - primeiro campo */}
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
                                            {/* Botão excluir card */}
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteCardConfirm(sol.id);
                                              }}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                          {sol.tipo === "consulta_cpf" && sol.metadata?.valor_financiado != null && (
                                            <div className="flex items-center gap-1 text-xs font-medium text-primary pl-6">
                                              <DollarSign className="h-3 w-3" />
                                              R$ {Number(sol.metadata.valor_financiado).toFixed(2)}
                                              {sol.metadata?.resultado_consulta && (
                                                <Badge variant={sol.metadata.resultado_consulta === "aprovado" ? "default" : "destructive"} className="ml-1 text-[10px] px-1 py-0">
                                                  {sol.metadata.resultado_consulta === "aprovado" ? "Aprovado" : "Reprovado"}
                                                </Badge>
                                              )}
                                            </div>
                                          )}
                                          {sol.descricao && sol.tipo !== "consulta_cpf" && (
                                            <p className="text-xs text-muted-foreground pl-6 truncate">
                                              {sol.descricao}
                                            </p>
                                          )}
                                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-6">
                                            <Clock className="h-3 w-3 shrink-0" />
                                            <span>
                                              {formatDistanceToNow(new Date(sol.created_at), {
                                                addSuffix: true,
                                                locale: ptBR,
                                              })}
                                            </span>
                                          </div>
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

                {colsProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* CPF Approval Dialog */}
      {selectedSolicitacao?.tipo === "consulta_cpf" && (
        <CpfApprovalDialog
          solicitacao={selectedSolicitacao}
          open={!!selectedSolicitacao}
          onOpenChange={(open) => !open && setSelectedSolicitacao(null)}
          colunas={colunas ?? []}
        />
      )}

      {/* Generic detail dialog (non-CPF) */}
      <Dialog open={!!selectedSolicitacao && selectedSolicitacao?.tipo !== "consulta_cpf"} onOpenChange={(open) => !open && setSelectedSolicitacao(null)}>
        <DialogContent className="max-w-lg">
          {selectedSolicitacao && selectedSolicitacao.tipo !== "consulta_cpf" && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {tipoIcon(selectedSolicitacao.tipo)}
                  {selectedSolicitacao.assunto}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                {selectedSolicitacao.contato && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contato</span>
                    <span className="font-medium">{selectedSolicitacao.contato.nome}</span>
                  </div>
                )}
                {selectedSolicitacao.tipo && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tipo</span>
                    <Badge variant="outline">{selectedSolicitacao.tipo}</Badge>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline">{selectedSolicitacao.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Criado</span>
                  <span>{format(new Date(selectedSolicitacao.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                </div>
                {selectedSolicitacao.descricao && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Descrição</p>
                    <p className="whitespace-pre-wrap">{selectedSolicitacao.descricao}</p>
                  </div>
                )}
                {selectedSolicitacao.metadata?.url && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Link de Pagamento</p>
                    <a
                      href={selectedSolicitacao.metadata.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline break-all text-xs"
                    >
                      {selectedSolicitacao.metadata.url}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm delete column dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              As solicitações desta coluna ficarão sem estágio definido.
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

      {/* Confirm delete card dialog */}
      <AlertDialog open={!!deleteCardConfirm} onOpenChange={() => setDeleteCardConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir card?</AlertDialogTitle>
            <AlertDialogDescription>
              O card será removido do pipeline e marcado como cancelado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteCardConfirm) {
                  deleteSolicitacao.mutate(deleteCardConfirm);
                  setDeleteCardConfirm(null);
                }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
