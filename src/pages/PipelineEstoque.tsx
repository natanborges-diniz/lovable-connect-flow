import { useState, useMemo } from "react";
import { Plus, Package, Search, ExternalLink, Clock, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { usePipelineColunas } from "@/hooks/usePipelineColunas";
import { useConfirmacoesEstoque, useUpdateConfirmacaoColuna } from "@/hooks/useConfirmacoesEstoque";
import { NovaConfirmacaoEstoqueDialog } from "@/components/estoque/NovaConfirmacaoEstoqueDialog";
import { EditCardInfoDialog, type EditableField } from "@/components/pipeline/EditCardInfoDialog";
import { useAuth } from "@/hooks/useAuth";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const SETOR_ID = "0e7b7572-4581-4e74-88eb-afca41ab71cf";

const STATUS_BY_TIPO: Record<string, "aguardando" | "confirmada" | "sem_estoque" | "faturada" | "cancelada"> = {
  confirmacao_estoque_pendente: "aguardando",
  confirmacao_estoque_ok: "confirmada",
  confirmacao_estoque_sem: "sem_estoque",
  confirmacao_estoque_faturada: "faturada",
  confirmacao_estoque_cancelada: "cancelada",
};

export default function PipelineEstoque() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingCard, setEditingCard] = useState<any | null>(null);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { data: colunas = [] } = usePipelineColunas(SETOR_ID);
  const { data: cards = [], isLoading } = useConfirmacoesEstoque();
  const moveCol = useUpdateConfirmacaoColuna();

  const filtered = useMemo(() => {
    if (!search.trim()) return cards;
    const s = search.toLowerCase();
    return cards.filter(c =>
      c.protocolo.toLowerCase().includes(s) ||
      c.referencia.toLowerCase().includes(s) ||
      c.codigo_produto.toLowerCase().includes(s) ||
      c.loja_nome.toLowerCase().includes(s)
    );
  }, [cards, search]);

  const cardsPorColuna = useMemo(() => {
    const m = new Map<string, typeof cards>();
    for (const col of colunas) m.set(col.id, []);
    for (const c of filtered) {
      if (c.pipeline_coluna_id && m.has(c.pipeline_coluna_id)) {
        m.get(c.pipeline_coluna_id)!.push(c);
      }
    }
    return m;
  }, [colunas, filtered]);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const colunaId = r.destination.droppableId;
    const card = cards.find(c => c.id === r.draggableId);
    if (!card || card.pipeline_coluna_id === colunaId) return;
    const col = colunas.find(c => c.id === colunaId);
    const newStatus = col?.tipo_acao ? STATUS_BY_TIPO[col.tipo_acao] : undefined;
    moveCol.mutate({ id: card.id, coluna_id: colunaId, status: newStatus });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estoque de Armações"
        description="Confirmação de peça em estoque"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="h-8 w-56 pl-7 text-sm" />
            </div>
            <Button size="sm" onClick={() => setOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Nova solicitação
            </Button>
          </div>
        }
      />

      <NovaConfirmacaoEstoqueDialog open={open} onOpenChange={setOpen} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {colunas.filter(c => c.ativo).map(col => {
              const items = cardsPorColuna.get(col.id) ?? [];
              return (
                <Droppable key={col.id} droppableId={col.id}>
                  {(prov) => (
                    <div className="w-72 shrink-0">
                      <div className="flex items-center justify-between px-2 py-1 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide">{col.nome}</span>
                        <Badge variant="outline" className="h-4 text-[10px] px-1">{items.length}</Badge>
                      </div>
                      <div ref={prov.innerRef} {...prov.droppableProps}
                        className="flex flex-col gap-2 min-h-[200px] p-1 rounded bg-muted/30">
                        {items.map((c, i) => (
                          <Draggable key={c.id} draggableId={c.id} index={i}>
                            {(p) => (
                              <Card
                                ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}
                                className={cn("p-2 cursor-grab active:cursor-grabbing")}>
                                <div className="flex items-start justify-between gap-1">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-mono text-muted-foreground">{c.protocolo}</p>
                                    <p className="text-sm font-medium truncate">{c.loja_nome}</p>
                                  </div>
                                  {c.foto_url && (
                                    <img src={c.foto_url} alt="peça" className="h-10 w-10 rounded object-cover border" />
                                  )}
                                  {isAdmin && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                                      title="Editar informações (admin)"
                                      onClick={(e) => { e.stopPropagation(); setEditingCard(c); }}
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                                <p className="text-xs mt-1">
                                  <span className="text-muted-foreground">REF</span> {c.referencia} •{" "}
                                  <span className="text-muted-foreground">COD</span> {c.codigo_produto}
                                </p>
                                {c.resposta_observacao && (
                                  <p className="text-[11px] mt-1 text-muted-foreground italic line-clamp-2">
                                    "{c.resposta_observacao}"
                                  </p>
                                )}
                                <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}
                                  </span>
                                  {c.status === "aguardando" && c.tentativas_lembrete > 0 && (
                                    <span className="inline-flex items-center gap-1 text-amber-600">
                                      <AlertTriangle className="h-3 w-3" /> {c.tentativas_lembrete}× lembrete
                                    </span>
                                  )}
                                </div>
                                {c.demanda_id && (
                                  <Button size="sm" variant="ghost" className="h-6 w-full mt-1 text-[11px]"
                                    onClick={() => navigate(`/demandas?demanda=${c.demanda_id}`)}>
                                    <ExternalLink className="h-3 w-3 mr-1" /> Abrir demanda
                                  </Button>
                                )}
                              </Card>
                            )}
                          </Draggable>
                        ))}
                        {prov.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
