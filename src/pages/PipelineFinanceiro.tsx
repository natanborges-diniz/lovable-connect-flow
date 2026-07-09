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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Check, X, Search, GripVertical,
  CreditCard, FileText, Clock, DollarSign, ShieldCheck, Zap, Archive, ArchiveRestore,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

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
import { CpfApprovalDialog, EntryPercentageBadge } from "@/components/financeiro/CpfApprovalDialog";
import { ConfirmarPixDialog } from "@/components/financeiro/ConfirmarPixDialog";
import { useAutomacoes } from "@/hooks/useAutomacoes";
import { CardTimeline, logCardMove } from "@/components/pipeline/CardTimeline";
import { CancelarSolicitacaoDialog, DevolverLojaDialog } from "@/components/pipeline/CardActionDialogs";
import { ConcluirSolicitacaoDialog } from "@/components/financeiro/ConcluirSolicitacaoDialog";
import { AnexarBoletoExtraDialog } from "@/components/financeiro/AnexarBoletoExtraDialog";
import { Tabs as TabsRoot, TabsContent, TabsList as TabsListUI, TabsTrigger as TabsTriggerUI } from "@/components/ui/tabs";
import { EditCardInfoDialog, type EditableField } from "@/components/pipeline/EditCardInfoDialog";
import { useAuth } from "@/hooks/useAuth";
import { useSearchParams } from "react-router-dom";
import { SolicitacaoThreadPanel } from "@/components/financeiro/SolicitacaoThreadPanel";

export default function PipelineFinanceiro() {
  const [search, setSearch] = useState("");
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [selectedSolicitacao, setSelectedSolicitacao] = useState<any | null>(null);
  const [editingCard, setEditingCard] = useState<any | null>(null);

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
  const { data: automacoes = [] } = useAutomacoes("solicitacao");

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

  // Deep-link: /financeiro?sol=<id> abre o drawer automaticamente
  const [searchParams, setSearchParams] = useSearchParams();
  const solParam = searchParams.get("sol");
  useEffect(() => {
    if (!solParam) return;
    let cancelled = false;
    const clearParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("sol");
      setSearchParams(next, { replace: true });
    };
    const found = (solicitacoes as any[] | undefined)?.find((s) => s.id === solParam);
    if (found) {
      setSelectedSolicitacao(found);
      clearParam();
      return;
    }
    // fallback: busca direta (card pode estar em coluna oculta / arquivada / outro setor)
    (async () => {
      const { data, error } = await supabase
        .from("solicitacoes")
        .select("*, contato:contatos(id, nome, telefone, tipo)")
        .eq("id", solParam)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Solicitação não encontrada");
        clearParam();
        return;
      }
      setSelectedSolicitacao(data);
      clearParam();
    })();
    return () => { cancelled = true; };
  }, [solParam, solicitacoes, searchParams, setSearchParams]);

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] }),
  });

  const [cancelDialogId, setCancelDialogId] = useState<string | null>(null);
  const [devolverDialog, setDevolverDialog] = useState<{ id: string; colunaId?: string; presets?: string[] } | null>(null);
  const [concluirDialog, setConcluirDialog] = useState<{ id: string; modo: "carta" | "comprovante_pagamento" | "boleto" | "boleto-revisao" } | null>(null);
  const [anexarExtraId, setAnexarExtraId] = useState<string | null>(null);


  const isLoading = loadingColunas || loadingSolicitacoes || !setorId;

  const filteredSolicitacoes = (solicitacoes ?? []).filter((s: any) => {
    // Esconde arquivados por padrão (toggle controla visibilidade)
    if (!mostrarArquivados && s.metadata?.arquivado_at) return false;
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
    const sourceColunaId = result.source.droppableId;

    if (destColunaId === sourceColunaId) return;

    // Se a coluna destino é "devolver_para_loja", abre dialog (não move ainda)
    const destCol: any = (colunas ?? []).find((c: any) => c.id === destColunaId);
    if (destCol?.tipo_acao === "devolver_para_loja") {
      setDevolverDialog({ id: solicitacaoId, colunaId: destColunaId });
      return;
    }

    // Guarda: nunca permitir drop manual em "Boleto Enviado" sem anexo.
    // Em vez disso, abre o dialog de conclusão de boleto para o usuário anexar.
    if (destCol?.nome === "Boleto Enviado") {
      const sol: any = (solicitacoes ?? []).find((s: any) => s.id === solicitacaoId);
      const temArquivo = Array.isArray(sol?.metadata?.boleto_arquivos) && sol.metadata.boleto_arquivos.length > 0;
      if (sol?.tipo === "boleto" && !temArquivo) {
        toast.error("Anexe o(s) boleto(s) antes de mover. Abrindo dialog…");
        setConcluirDialog({ id: solicitacaoId, modo: "boleto" });
        return;
      }
    }

    updateSolicitacaoColuna.mutate({ id: solicitacaoId, pipeline_coluna_id: destColunaId });

    supabase.functions.invoke("pipeline-automations", {
      body: {
        entity_type: "solicitacao",
        entity_id: solicitacaoId,
        coluna_id: destColunaId,
        coluna_anterior_id: sourceColunaId,
      },
    }).catch(e => console.warn("Automation call failed:", e));
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
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border bg-muted/30">
              {mostrarArquivados ? <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" /> : <Archive className="h-3.5 w-3.5 text-muted-foreground" />}
              <Switch
                id="show-archived"
                checked={mostrarArquivados}
                onCheckedChange={setMostrarArquivados}
                className="scale-75"
              />
              <Label htmlFor="show-archived" className="text-xs cursor-pointer select-none">
                Arquivados
              </Label>
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
                                              {automacoes.filter(a => a.pipeline_coluna_id === coluna.id).length} automação(ões) ativa(s) — clique para editar
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
                                              {sol.protocolo && (
                                                <p className="font-mono text-[10px] text-muted-foreground truncate leading-tight">
                                                  {sol.protocolo}
                                                </p>
                                              )}
                                              {/* Loja solicitante */}
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
                                            {/* Botão editar (admin) */}
                                            {isAdmin && (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                                                title="Editar informações (admin)"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setEditingCard(sol);
                                                }}
                                              >
                                                <Pencil className="h-3 w-3" />
                                              </Button>
                                            )}
                                            {/* Botão excluir card */}
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setCancelDialogId(sol.id);
                                              }}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                          {sol.tipo === "consulta_cpf" && sol.metadata?.valor_financiado != null && (
                                            <div className="flex items-center gap-1 text-xs font-medium text-primary pl-6 flex-wrap">
                                              <DollarSign className="h-3 w-3" />
                                              R$ {Number(sol.metadata.valor_financiado).toFixed(2)}
                                              <EntryPercentageBadge
                                                valorEntrada={sol.metadata?.valor_entrada != null ? Number(sol.metadata.valor_entrada) : null}
                                                valorCompra={sol.metadata?.valor_compra != null ? Number(sol.metadata.valor_compra) : null}
                                                size="sm"
                                              />
                                              {sol.metadata?.resultado_consulta && (
                                                <Badge variant={sol.metadata.resultado_consulta === "aprovado" ? "default" : "destructive"} className="ml-1 text-[10px] px-1 py-0">
                                                  {sol.metadata.resultado_consulta === "aprovado" ? "Aprovado" : "Reprovado"}
                                                </Badge>
                                              )}
                                              {sol.metadata?.dados_incompletos?.length > 0 && !sol.metadata?.resultado_consulta && (
                                                <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-yellow-500/50 text-yellow-700">
                                                  Incompleto
                                                </Badge>
                                              )}
                                            </div>
                                          )}
                                          {sol.descricao && sol.tipo !== "consulta_cpf" && sol.tipo !== "boleto" && (
                                            <p className="text-xs text-muted-foreground pl-6 truncate">
                                              {sol.descricao}
                                            </p>
                                          )}
                                          {sol.metadata?.payment_status === "PAGO" && sol.metadata?.nsu && (
                                            <Badge className="ml-6 bg-green-100 text-green-800 text-[10px] border-green-300">
                                              🔑 NSU: {sol.metadata.nsu}
                                            </Badge>
                                          )}
                                          {sol.tipo === "boleto" && (
                                            <div className="ml-6 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 space-y-1">
                                              <div className="flex items-center justify-between gap-2">
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Boleto</span>
                                                {sol.metadata?.boleto_status === "enviado" ? (
                                                  <Badge className="text-[10px] px-1 py-0 bg-green-100 text-green-800 border-green-300">✓ Enviado</Badge>
                                                ) : (
                                                  <Badge className="text-[10px] px-1 py-0 bg-amber-100 text-amber-900 border-amber-400">Aguardando</Badge>
                                                )}
                                              </div>
                                              <div className="flex items-baseline gap-1.5">
                                                <span className="text-sm font-bold text-amber-900">
                                                  R$ {Number(sol.metadata?.valor_total || sol.metadata?.boleto_valor_total || 0).toFixed(2)}
                                                </span>
                                                {sol.metadata?.qtd_parcelas && (
                                                  <span className="text-[11px] text-amber-800">
                                                    em {sol.metadata.qtd_parcelas}x R$ {Number(sol.metadata.valor_parcela || 0).toFixed(2)}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex flex-wrap items-center gap-1">
                                                {sol.metadata?.dia_vencimento && (
                                                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-400 text-amber-900">
                                                    📅 vence dia {sol.metadata.dia_vencimento}
                                                  </Badge>
                                                )}
                                                {sol.metadata?.boleto_impresso ? (
                                                  <Badge className="text-[10px] px-1 py-0 bg-orange-100 text-orange-800 border-orange-300">🖨️ Loja pediu impresso (malote)</Badge>
                                                ) : (
                                                  <Badge className="text-[10px] px-1 py-0 bg-blue-100 text-blue-800 border-blue-300">📱 Digital</Badge>
                                                )}
                                               </div>
                                               {sol.metadata?.boleto_revisao?.ciclo && !sol.metadata?.boleto_revisao?.atendida_em && (
                                                 <Badge className="text-[10px] px-1 py-0 bg-amber-200 text-amber-900 border-amber-500">
                                                   🔄 Revisão pedida — ciclo {sol.metadata.boleto_revisao.ciclo}
                                                 </Badge>
                                               )}
                                             </div>
                                          )}
                                          {sol.metadata?.arquivado_at && (
                                            <Badge variant="outline" className="ml-6 text-[10px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">
                                              <Archive className="h-2.5 w-2.5 mr-0.5" /> Arquivado
                                            </Badge>
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

      {/* Confirmação PIX Dialog */}
      {selectedSolicitacao?.tipo === "confirmacao_pix" && (
        <ConfirmarPixDialog
          solicitacao={selectedSolicitacao}
          open={!!selectedSolicitacao}
          onOpenChange={(open) => !open && setSelectedSolicitacao(null)}
          colunas={colunas ?? []}
        />
      )}

      {/* Generic detail dialog (non-CPF, non-PIX) */}
      <Dialog open={!!selectedSolicitacao && selectedSolicitacao?.tipo !== "consulta_cpf" && selectedSolicitacao?.tipo !== "confirmacao_pix"} onOpenChange={(open) => !open && setSelectedSolicitacao(null)}>
        <DialogContent className="max-w-lg">
          {selectedSolicitacao && selectedSolicitacao.tipo !== "consulta_cpf" && selectedSolicitacao.tipo !== "confirmacao_pix" && (
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
                {selectedSolicitacao.descricao && selectedSolicitacao.tipo !== "boleto" && (
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
                {/* Comprovante de Pagamento (Picote) */}
                {selectedSolicitacao.metadata?.payment_status === "PAGO" && (
                  <div className="pt-2 border-t">
                    <div className="border-2 border-dashed border-green-300 rounded-lg bg-green-50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-green-800">
                        📩 Comprovante de Pagamento
                        {selectedSolicitacao.metadata?.nome_cliente && (
                          <span> — {selectedSolicitacao.metadata.nome_cliente}</span>
                        )}
                      </p>
                      <div className="text-center py-2">
                        <p className="text-lg font-bold text-green-900">
                          🔑 NSU: {selectedSolicitacao.metadata?.nsu || "N/A"}
                        </p>
                        <p className="text-[10px] text-green-700">Use este número para baixa no sistema</p>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-green-900">
                        <span className="text-green-700">💰 Valor</span>
                        <span className="font-medium">
                          {selectedSolicitacao.metadata?.valor
                            ? `R$ ${Number(selectedSolicitacao.metadata.valor).toFixed(2)}`
                            : "N/A"}
                        </span>
                        <span className="text-green-700">🆔 TID</span>
                        <span className="font-medium">{selectedSolicitacao.metadata?.tid || "N/A"}</span>
                        <span className="text-green-700">🔐 Autorização</span>
                        <span className="font-medium">{selectedSolicitacao.metadata?.authorization || "N/A"}</span>
                        <span className="text-green-700">📅 Data</span>
                        <span className="font-medium">
                          {selectedSolicitacao.metadata?.payment_confirmed_at
                            ? format(new Date(selectedSolicitacao.metadata.payment_confirmed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                            : "N/A"}
                        </span>
                        <span className="text-green-700">💳 Cartão</span>
                        <span className="font-medium">**** {selectedSolicitacao.metadata?.last4 || "****"}</span>
                        <span className="text-green-700">📦 Parcelas</span>
                        <span className="font-medium">{selectedSolicitacao.metadata?.installments || 1}x</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Dados estruturados — Estorno */}
                {(selectedSolicitacao.tipo === "estorno_cartao" || selectedSolicitacao.tipo === "estorno_pix_debito") && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Dados do estorno</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {selectedSolicitacao.metadata?.numero_venda && (<><span className="text-muted-foreground">OS/Venda</span><span className="font-medium">{selectedSolicitacao.metadata.numero_venda}</span></>)}
                      {selectedSolicitacao.metadata?.data_processamento && (<><span className="text-muted-foreground">Processamento</span><span className="font-medium">{selectedSolicitacao.metadata.data_processamento}</span></>)}
                      {selectedSolicitacao.metadata?.nsu && (<><span className="text-muted-foreground">NSU</span><span className="font-medium">{selectedSolicitacao.metadata.nsu}</span></>)}
                      {selectedSolicitacao.metadata?.valor_total && (<><span className="text-muted-foreground">Valor total</span><span className="font-medium">R$ {Number(selectedSolicitacao.metadata.valor_total).toFixed(2)}</span></>)}
                      {selectedSolicitacao.metadata?.valor && (<><span className="text-muted-foreground">A cancelar</span><span className="font-medium">R$ {Number(selectedSolicitacao.metadata.valor).toFixed(2)}</span></>)}
                      {selectedSolicitacao.metadata?.estorno_status && (<><span className="text-muted-foreground">Status</span><Badge variant="outline">{String(selectedSolicitacao.metadata.estorno_status)}</Badge></>)}
                    </div>
                    {selectedSolicitacao.metadata?.carta_estorno_url && (
                      <a href={String(selectedSolicitacao.metadata.carta_estorno_url)} target="_blank" rel="noopener noreferrer"
                         className="text-primary underline text-xs mt-2 inline-block">📎 Carta de devolução</a>
                    )}
                  </div>
                )}

                {/* Dados estruturados — Pagamento / Reembolso */}
                {(selectedSolicitacao.tipo === "pagamento" || selectedSolicitacao.tipo === "reembolso") && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Dados do {selectedSolicitacao.tipo === "pagamento" ? "pagamento" : "reembolso"}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {selectedSolicitacao.metadata?.favorecido && (<><span className="text-muted-foreground">Favorecido</span><span className="font-medium">{String(selectedSolicitacao.metadata.favorecido)}</span></>)}
                      {selectedSolicitacao.metadata?.documento_favorecido && (<><span className="text-muted-foreground">CNPJ/CPF</span><span className="font-medium">{String(selectedSolicitacao.metadata.documento_favorecido)}</span></>)}
                      {selectedSolicitacao.metadata?.valor && (<><span className="text-muted-foreground">Valor</span><span className="font-medium">R$ {Number(selectedSolicitacao.metadata.valor).toFixed(2)}</span></>)}
                      {selectedSolicitacao.metadata?.vencimento && (<><span className="text-muted-foreground">Vencimento</span><span className="font-medium">{String(selectedSolicitacao.metadata.vencimento)}</span></>)}
                      {selectedSolicitacao.metadata?.forma_pagamento && (<><span className="text-muted-foreground">Forma</span><span className="font-medium">{String(selectedSolicitacao.metadata.forma_pagamento)}</span></>)}
                      {selectedSolicitacao.metadata?.forma_reembolso && (<><span className="text-muted-foreground">Forma</span><span className="font-medium">{String(selectedSolicitacao.metadata.forma_reembolso)}</span></>)}
                      {selectedSolicitacao.metadata?.chave_pix && (<><span className="text-muted-foreground">Chave PIX</span><span className="font-medium break-all">{String(selectedSolicitacao.metadata.chave_pix)}</span></>)}
                      {selectedSolicitacao.metadata?.dados_pagamento && (<><span className="text-muted-foreground">Dados</span><span className="font-medium break-all">{String(selectedSolicitacao.metadata.dados_pagamento)}</span></>)}
                      {selectedSolicitacao.metadata?.loja_ou_setor && (<><span className="text-muted-foreground">Centro custo</span><span className="font-medium">{String(selectedSolicitacao.metadata.loja_ou_setor)}</span></>)}
                    </div>
                    {selectedSolicitacao.metadata?.anexo_nota && (
                      <a href={String(selectedSolicitacao.metadata.anexo_nota)} target="_blank" rel="noopener noreferrer"
                         className="text-primary underline text-xs mt-2 inline-block">📎 Nota / boleto anexado</a>
                    )}
                    {selectedSolicitacao.metadata?.comprovante && (
                      <a href={String(selectedSolicitacao.metadata.comprovante)} target="_blank" rel="noopener noreferrer"
                         className="text-primary underline text-xs mt-2 inline-block">📎 Comprovante de gasto</a>
                    )}
                    {selectedSolicitacao.metadata?.comprovante_url && (
                      <a href={String(selectedSolicitacao.metadata.comprovante_url)} target="_blank" rel="noopener noreferrer"
                         className="text-primary underline text-xs mt-2 inline-block">📎 Comprovante de pagamento</a>
                    )}
                  </div>
                )}

                {/* Dados estruturados — Boleto (picote) */}
                {selectedSolicitacao.tipo === "boleto" && (
                  <div className="pt-2 border-t">
                    <div className="border-2 border-dashed border-amber-400 rounded-lg bg-amber-50 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                          🧾 Solicitação de Boleto
                        </p>
                        {selectedSolicitacao.metadata?.boleto_status === "enviado" ? (
                          <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">✓ Enviado à loja</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-900 border-amber-400 text-[10px]">Aguardando geração</Badge>
                        )}
                      </div>

                      {/* Valor em destaque */}
                      <div className="text-center py-2 border-y border-dashed border-amber-300">
                        <p className="text-2xl font-bold text-amber-900">
                          R$ {Number(selectedSolicitacao.metadata?.valor_total || selectedSolicitacao.metadata?.boleto_valor_total || 0).toFixed(2)}
                        </p>
                        {selectedSolicitacao.metadata?.qtd_parcelas && (
                          <p className="text-xs text-amber-800 mt-0.5">
                            {selectedSolicitacao.metadata.qtd_parcelas}x de <strong>R$ {Number(selectedSolicitacao.metadata?.valor_parcela || 0).toFixed(2)}</strong>
                          </p>
                        )}
                      </div>

                      {/* Dados do cliente */}
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-amber-900">
                        {selectedSolicitacao.metadata?.cliente && (<><span className="text-amber-700">👤 Cliente</span><span className="font-medium">{String(selectedSolicitacao.metadata.cliente)}</span></>)}
                        {selectedSolicitacao.metadata?.cpf && (<><span className="text-amber-700">🆔 CPF</span><span className="font-mono font-medium">{String(selectedSolicitacao.metadata.cpf)}</span></>)}
                        {selectedSolicitacao.metadata?.loja_nome && (<><span className="text-amber-700">🏬 Loja</span><span className="font-medium">{String(selectedSolicitacao.metadata.loja_nome)}</span></>)}
                        {selectedSolicitacao.metadata?.dia_vencimento && (<><span className="text-amber-700">📅 Vencimento</span><span className="font-medium">Todo dia {selectedSolicitacao.metadata.dia_vencimento}</span></>)}
                        <span className="text-amber-700">📦 Entrega</span>
                        <span className="font-medium">
                          {selectedSolicitacao.metadata?.boleto_impresso
                            ? "🖨️ Imprimir e enviar por malote (solicitado pela loja)"
                            : "📱 Digital — anexar PDF"}
                        </span>
                      </div>

                      {/* Projeção das parcelas */}
                      {Array.isArray(selectedSolicitacao.metadata?.boleto_parcelas_projecao) && selectedSolicitacao.metadata.boleto_parcelas_projecao.length > 0 && (
                        <div className="pt-2 border-t border-dashed border-amber-300">
                          <p className="text-[10px] font-semibold text-amber-800 uppercase mb-1.5">Parcelas a gerar</p>
                          <div className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-white/60">
                            <table className="w-full text-xs">
                              <thead className="bg-amber-100/80 sticky top-0">
                                <tr className="text-amber-900">
                                  <th className="text-left px-2 py-1 font-semibold">#</th>
                                  <th className="text-left px-2 py-1 font-semibold">Vencimento</th>
                                  <th className="text-right px-2 py-1 font-semibold">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(selectedSolicitacao.metadata.boleto_parcelas_projecao as any[]).map((p, idx) => (
                                  <tr key={idx} className="border-t border-amber-100">
                                    <td className="px-2 py-1 font-mono">{p.n ?? idx + 1}</td>
                                    <td className="px-2 py-1">
                                      {p.vencimento ? format(new Date(p.vencimento + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                                    </td>
                                    <td className="px-2 py-1 text-right font-medium">R$ {Number(p.valor || 0).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {selectedSolicitacao.metadata?.observacao && String(selectedSolicitacao.metadata.observacao).trim() && (
                        <div className="pt-2 border-t border-dashed border-amber-300">
                          <p className="text-[10px] font-semibold text-amber-800 uppercase mb-0.5">Observação da loja</p>
                          <p className="text-xs text-amber-900 whitespace-pre-wrap">{String(selectedSolicitacao.metadata.observacao)}</p>
                        </div>
                      )}
                    </div>

                    {/* Bloco de revisão pedida pela loja */}
                    {selectedSolicitacao.metadata?.boleto_revisao?.ciclo && !selectedSolicitacao.metadata?.boleto_revisao?.atendida_em && (
                      <div className="mt-3 border-2 border-amber-500 rounded-lg bg-amber-100/70 p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-amber-900 uppercase">🔄 Revisão pedida pela loja</p>
                          <Badge className="text-[10px] bg-amber-200 text-amber-900 border-amber-500">
                            ciclo {selectedSolicitacao.metadata.boleto_revisao.ciclo}
                          </Badge>
                        </div>
                        <p className="text-xs text-amber-900 whitespace-pre-wrap">
                          <span className="font-semibold">Motivo: </span>
                          {String(selectedSolicitacao.metadata.boleto_revisao.motivo || "—")}
                        </p>
                        {Array.isArray(selectedSolicitacao.metadata.boleto_revisao.campos_revisar) && selectedSolicitacao.metadata.boleto_revisao.campos_revisar.length > 0 && (
                          <p className="text-[11px] text-amber-800">
                            <span className="font-semibold">Campos: </span>
                            {selectedSolicitacao.metadata.boleto_revisao.campos_revisar.join(", ")}
                          </p>
                        )}
                        {selectedSolicitacao.metadata.boleto_revisao.solicitada_por && (
                          <p className="text-[10px] text-amber-700">
                            Solicitado por {String(selectedSolicitacao.metadata.boleto_revisao.solicitada_por)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Histórico de versões enviadas */}
                    {Array.isArray(selectedSolicitacao.metadata?.boleto_anexos_historico) && selectedSolicitacao.metadata.boleto_anexos_historico.length > 0 && (
                      <div className="mt-3 border rounded-lg p-3 bg-muted/30 space-y-2">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase">Histórico de versões</p>
                        {(selectedSolicitacao.metadata.boleto_anexos_historico as any[]).map((h, idx) => (
                          <div key={idx} className="text-[11px] border-l-2 border-muted pl-2">
                            <p className="font-medium">
                              Ciclo {h.ciclo} — {h.enviado_em ? format(new Date(h.enviado_em), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—"}
                            </p>
                            <div className="flex flex-wrap gap-2 mt-0.5">
                              {(h.urls || []).map((u: string, i: number) => (
                                <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                                  📎 boleto {i + 1}
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}


                {/* Bloco de Ações do operador */}
                {(() => {
                  const t = selectedSolicitacao.tipo;
                  const status = selectedSolicitacao.status;
                  const encerrado = status === "concluida" || status === "cancelada";
                  const isEstorno = t === "estorno_cartao" || t === "estorno_pix_debito";
                  const isPag = t === "pagamento" || t === "reembolso";
                  const isBoleto = t === "boleto";
                  if (encerrado || (!isEstorno && !isPag && !isBoleto)) return null;

                  const presetsEstorno = ["NSU incorreto", "Valor divergente", "Falta carta do cliente", "Outro"];
                  const presetsPag = t === "pagamento"
                    ? ["Falta CNPJ do favorecido", "Chave PIX inválida", "Anexo ilegível", "Valor divergente", "Outro"]
                    : ["Comprovante ilegível", "Chave PIX inválida", "Valor divergente", "Outro"];
                  const presetsBoleto = ["CPF inválido", "Valor divergente", "Faltam dados do cliente", "Outro"];
                  const presetsAtivos = isEstorno ? presetsEstorno : isBoleto ? presetsBoleto : presetsPag;


                  return (
                    <div className="pt-3 border-t space-y-2">
                      <p className="text-xs font-semibold">Ações</p>
                      <div className="flex flex-wrap gap-2">
                        {isEstorno && (
                          <>
                            {selectedSolicitacao.metadata?.estorno_status !== "solicitado" && selectedSolicitacao.metadata?.estorno_status !== "concluido" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const novoMeta = {
                                      ...(selectedSolicitacao.metadata || {}),
                                      estorno_status: "solicitado",
                                      estorno_solicitado_em: new Date().toISOString(),
                                    };
                                    await supabase.from("solicitacoes")
                                      .update({ metadata: novoMeta as any })
                                      .eq("id", selectedSolicitacao.id);
                                    // Mensagem na demanda
                                    const demandaId = (selectedSolicitacao.metadata as any)?.demanda_id;
                                    if (demandaId) {
                                      await supabase.from("demanda_mensagens").insert({
                                        demanda_id: demandaId,
                                        direcao: "operador_para_loja",
                                        autor_nome: "Financeiro",
                                        conteudo: "✅ Estorno foi solicitado à adquirente. Aguardando retorno.",
                                        metadata: { tipo: "estorno_solicitado", solicitacao_id: selectedSolicitacao.id },
                                      });
                                    }
                                    toast.success("Estorno marcado como solicitado e loja avisada.");
                                    queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
                                    setSelectedSolicitacao(null);
                                  } catch (e: any) {
                                    toast.error("Falha: " + (e?.message || "erro"));
                                  }
                                }}
                              >
                                <Clock className="h-3.5 w-3.5 mr-1" /> Estorno solicitado
                              </Button>
                            )}
                            <Button size="sm" onClick={() => setConcluirDialog({ id: selectedSolicitacao.id, modo: "carta" })}>
                              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Concluir com carta
                            </Button>
                          </>
                        )}
                        {isPag && (
                          <Button size="sm" onClick={() => setConcluirDialog({ id: selectedSolicitacao.id, modo: "comprovante_pagamento" })}>
                            <CreditCard className="h-3.5 w-3.5 mr-1" /> Concluir pagamento
                          </Button>
                        )}
                        {isBoleto && selectedSolicitacao.metadata?.boleto_status !== "enviado" && (
                          <Button size="sm" onClick={() => setConcluirDialog({ id: selectedSolicitacao.id, modo: "boleto" })}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Anexar boleto(s) e enviar
                          </Button>
                        )}
                        {isBoleto && selectedSolicitacao.metadata?.boleto_revisao?.ciclo && !selectedSolicitacao.metadata?.boleto_revisao?.atendida_em && (
                          <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => setConcluirDialog({ id: selectedSolicitacao.id, modo: "boleto-revisao" })}>
                            🔄 Reenviar boleto revisado
                          </Button>
                        )}
                        {isBoleto && selectedSolicitacao.metadata?.boleto_status === "enviado" && (
                          <Button size="sm" variant="outline" onClick={() => setAnexarExtraId(selectedSolicitacao.id)}>
                            📎 Anexar arquivo ao boleto
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDevolverDialog({
                            id: selectedSolicitacao.id,
                            presets: presetsAtivos,
                          })}

                        >
                          ↩️ Devolver à loja
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelDialogId(selectedSolicitacao.id)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* Diálogo setor ↔ loja (mensagens livres, não move card) */}
                {(selectedSolicitacao.contato?.tipo === "loja" ||
                  selectedSolicitacao.contato?.tipo === "colaborador") && (
                  <SolicitacaoThreadPanel
                    solicitacaoId={selectedSolicitacao.id}
                    perspectiva="setor"
                  />
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

      <CreateCardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        pipelineType="financeiro"
        firstColumnId={firstColumnId}
        setorId={setorId}
      />

      <CancelarSolicitacaoDialog
        solicitacaoId={cancelDialogId}
        open={!!cancelDialogId}
        onOpenChange={(o) => !o && setCancelDialogId(null)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] })}
      />

      <DevolverLojaDialog
        solicitacaoId={devolverDialog?.id ?? null}
        colunaDestinoId={devolverDialog?.colunaId ?? null}
        presets={devolverDialog?.presets}
        open={!!devolverDialog}
        onOpenChange={(o) => !o && setDevolverDialog(null)}
        onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] }); setSelectedSolicitacao(null); }}
      />

      <ConcluirSolicitacaoDialog
        solicitacaoId={concluirDialog?.id ?? null}
        modo={concluirDialog?.modo ?? "carta"}
        open={!!concluirDialog}
        onOpenChange={(o) => !o && setConcluirDialog(null)}
        onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] }); setSelectedSolicitacao(null); }}
      />

      <AnexarBoletoExtraDialog
        solicitacaoId={anexarExtraId}
        open={!!anexarExtraId}
        onOpenChange={(o) => !o && setAnexarExtraId(null)}
        onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] }); }}
      />



      {editingCard && (
        <EditCardInfoDialog
          open={!!editingCard}
          onOpenChange={(v) => { if (!v) setEditingCard(null); }}
          table="solicitacoes"
          rowId={editingCard.id}
          title={`Editar card • ${editingCard.protocolo ?? editingCard.assunto ?? ""}`}
          fields={[
            { key: "assunto", label: "Título / assunto", type: "text", value: editingCard.assunto },
            { key: "descricao", label: "Descrição", type: "textarea", value: editingCard.descricao, placeholder: "Detalhes da demanda" },
          ] as EditableField[]}
          invalidateKeys={[["solicitacoes_financeiro"]]}
        />
      )}
    </>
  );
}
