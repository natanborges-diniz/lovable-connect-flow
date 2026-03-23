import { useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const COR_OPTIONS = [
  { value: "muted-foreground", label: "Cinza" },
  { value: "info", label: "Azul" },
  { value: "warning", label: "Amarelo" },
  { value: "success", label: "Verde" },
  { value: "danger", label: "Vermelho" },
  { value: "brand", label: "Roxo" },
];

export default function Pipeline() {
  const [search, setSearch] = useState("");
  const { data: contatos, isLoading: loadingContatos } = useContatos();
  const { data: colunas, isLoading: loadingColunas } = usePipelineColunas();
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

  const filteredContatos = (contatos ?? []).filter((c) => {
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

  // Contatos sem coluna (orphans)
  const semColuna = filteredContatos.filter(
    (c) => !c.pipeline_coluna_id || !(colunas ?? []).some((col) => col.id === c.pipeline_coluna_id)
  );

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const contatoId = result.draggableId;
    const destColunaId = result.destination.droppableId;
    if (destColunaId === "sem-coluna") return;
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

  return (
    <>
      <PageHeader
        title="Pipeline de Vendas"
        description="Arraste os cards entre colunas para atualizar o estágio"
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddingColuna(true)}
            >
              <Plus className="h-4 w-4 mr-1" /> Coluna
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "60vh" }}>
            {contatosByColuna.map((coluna) => (
              <div key={coluna.id} className="flex-shrink-0 w-72">
                <Card className={cn("border-t-4", `border-t-${coluna.cor}`)}>
                  <CardHeader className="pb-2 pt-3 px-3">
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
                            <span className="text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground mr-1">
                              {coluna.contatos.length}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => startEditColuna(coluna.id, coluna.nome)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => setDeleteConfirm(coluna.id)}
                            >
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
                        {coluna.contatos.map((contato, index) => (
                          <Draggable key={contato.id} draggableId={contato.id} index={index}>
                            {(provided, snapshot) => (
                              <Card
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={cn(
                                  "shadow-sm transition-shadow",
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
                                      <p className="font-medium text-sm truncate">{contato.nome}</p>
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
            ))}

            {/* Coluna de adicionar */}
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
                      <Button size="sm" onClick={handleAddColuna} disabled={createColuna.isPending}>
                        Criar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAddingColuna(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {/* Contatos sem coluna */}
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
                      <CardContent
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="px-2 pb-2 space-y-2 min-h-[100px]"
                      >
                        {semColuna.map((contato, index) => (
                          <Draggable key={contato.id} draggableId={contato.id} index={index}>
                            {(provided, snapshot) => (
                              <Card
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={cn(
                                  "shadow-sm",
                                  snapshot.isDragging && "shadow-lg ring-2 ring-primary/20"
                                )}
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
          </div>
        </DragDropContext>
      )}

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
