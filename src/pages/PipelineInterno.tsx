import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  Phone, Mail, Clock, Plus, Pencil, Trash2, Check, X, Search, GripVertical, Bot, User,
  MessageSquare, Sparkles, Headset,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
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
import { useAuth } from "@/hooks/useAuth";

const ATENDIMENTO_CORPORATIVO_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";

export default function PipelineInterno() {
  const [search, setSearch] = useState("");
  const [selectedContatoId, setSelectedContatoId] = useState<string | null>(null);
  const { isAdmin, isOperador, getEffectiveSetorIds } = useAuth();

  // Setor users veem o pipeline do PRÓPRIO setor; admin/operador veem o Atendimento Corporativo
  const userSetorIds = getEffectiveSetorIds();
  const activeSetorId = (isAdmin || isOperador)
    ? ATENDIMENTO_CORPORATIVO_SETOR_ID
    : (userSetorIds[0] ?? ATENDIMENTO_CORPORATIVO_SETOR_ID);

  const { data: contatos, isLoading: loadingContatos } = useContatos();
  const { data: colunas, isLoading: loadingColunas } = usePipelineColunas(activeSetorId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const channel = supabase
      .channel("pipeline-interno-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contatos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["contatos"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["atendimentos_modos_interno"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: atendimentosAtivos } = useQuery({
    queryKey: ["atendimentos_modos_interno"],
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

  const isLoading = loadingContatos || loadingColunas;

  // Apenas contatos corporativos: loja, fornecedor, colaborador (ou qualquer com setor_destino corporativo / cor já em coluna interna)
  const colunasIds = new Set((colunas ?? []).map(c => c.id));
  const contatosFiltradosBase = (contatos ?? []).filter((c) =>
    (c.pipeline_coluna_id && colunasIds.has(c.pipeline_coluna_id)) ||
    c.setor_destino === activeSetorId
  );

  const filteredContatos = contatosFiltradosBase.filter((c) => {
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

  const contatosByColuna = (colunas ?? []).map((col) => ({
    ...col,
    contatos: filteredContatos.filter((c) => c.pipeline_coluna_id === col.id),
  }));

  const semColuna = filteredContatos.filter(
    (c) => !c.pipeline_coluna_id || !(colunas ?? []).some((col) => col.id === c.pipeline_coluna_id)
  );

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.type === "COLUMN") {
      const sortedColunas = [...contatosByColuna];
      const [moved] = sortedColunas.splice(result.source.index, 1);
      sortedColunas.splice(result.destination.index, 0, moved);
      sortedColunas.forEach((col, idx) => {
        if (col.ordem !== idx) updateColuna.mutate({ id: col.id, ordem: idx });
      });
      return;
    }

    const contatoId = result.draggableId;
    const destColunaId = result.destination.droppableId;
    const sourceColunaId = result.source.droppableId;
    if (destColunaId === "sem-coluna") return;
    if (destColunaId === sourceColunaId) return;

    updateContato.mutate({ id: contatoId, pipeline_coluna_id: destColunaId } as any, {
      onSuccess: () => {
        supabase.functions.invoke("pipeline-automations", {
          body: {
            entity_type: "contato",
            entity_id: contatoId,
            coluna_id: destColunaId,
            coluna_anterior_id: sourceColunaId === "sem-coluna" ? null : sourceColunaId,
          },
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
    createColuna.mutate({
      nome: newColunaNome.trim(),
      ordem: maxOrdem + 1,
      setor_id: activeSetorId,
    });
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
        title="Atendimento Interno"
        description="Conversas corporativas com lojas e colaboradores • Pipeline isolado do CRM comercial"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
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
      ) : (colunas ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Headset className="h-10 w-10 mx-auto opacity-40" />
            <p className="text-sm">Nenhuma coluna configurada para Atendimento Corporativo.</p>
            <Button size="sm" onClick={() => setAddingColuna(true)}>
              <Plus className="h-4 w-4 mr-1" /> Criar primeira coluna
            </Button>
          </CardContent>
        </Card>
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
                        <Card className="border-t-4 border-t-accent-foreground bg-accent/10">
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
                                  <CardTitle className="text-sm font-semibold truncate">{coluna.nome}</CardTitle>
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
                                  return (
                                    <Draggable key={contato.id} draggableId={contato.id} index={index}>
                                      {(provided, snapshot) => (
                                        <Card
                                          ref={provided.innerRef}
                                          {...provided.draggableProps}
                                          className={cn(
                                            "shadow-sm transition-all cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30",
                                            snapshot.isDragging && "shadow-lg ring-2 ring-primary/20"
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
                                                        <Sparkles className="h-2.5 w-2.5" /> IA Monitor
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
                                                  Abrir conversa
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
                ))}

                {addingColuna && (
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
                )}

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
