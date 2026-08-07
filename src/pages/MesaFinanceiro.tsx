import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { usePipelineColunas, type PipelineColuna } from "@/hooks/usePipelineColunas";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Plus, Search, Clock, CreditCard, FileText, DollarSign, ShieldCheck,
  Archive, ArchiveRestore, Pencil, ChevronDown, Inbox, Store, CheckCircle2,
  XCircle, AlertTriangle, Hourglass, ArrowRightLeft, KanbanSquare, Phone, X,
} from "lucide-react";

// Componentes compartilhados (reuso integral — mesmos do PipelineFinanceiro)
import { CpfApprovalDialog, EntryPercentageBadge } from "@/components/financeiro/CpfApprovalDialog";
import { ConfirmarPixDialog } from "@/components/financeiro/ConfirmarPixDialog";
import { ConcluirSolicitacaoDialog } from "@/components/financeiro/ConcluirSolicitacaoDialog";
import { AnexarBoletoExtraDialog } from "@/components/financeiro/AnexarBoletoExtraDialog";
import { SolicitacaoThreadPanel } from "@/components/financeiro/SolicitacaoThreadPanel";
import { CancelarSolicitacaoDialog, DevolverLojaDialog } from "@/components/pipeline/CardActionDialogs";
import { CardTimeline } from "@/components/pipeline/CardTimeline";
import { EditCardInfoDialog, type EditableField } from "@/components/pipeline/EditCardInfoDialog";
import { CreateCardDialog } from "@/components/pipeline/CreateCardDialog";
import { useAuth } from "@/hooks/useAuth";
import { BoletoConsultaOrigem } from "@/components/financeiro/BoletoConsultaOrigem";
import { ResponsavelSolicitacao } from "@/components/financeiro/ResponsavelSolicitacao";

/* ------------------------------------------------------------------ */
/* Mapeamento coluna → estágio                                         */
/* ------------------------------------------------------------------ */

type Stage = "REQUER_ACAO" | "AGUARDANDO_LOJA" | "AGUARDANDO_PAGAMENTO" | "CONCLUIDO" | "CANCELADO";

// "Boleto Enviado" conta como CONCLUÍDO: sem confirmação automática de boleto,
// a tarefa do setor é criar e enviar — enviado, está cumprida (não fica
// pendurada em "Aguardando pagamento" para sempre).
const NOMES_CONCLUIDO = ["Pago", "Link Pago", "Pix Pago", "PIX Confirmado", "Consulta CPF Aprovado", "Concluído", "Boleto Enviado"];
const NOMES_CANCELADO = ["Cancelado", "PIX Não Confirmado", "Consulta CPF Reprovada", "Estorno Solicitado"];
const NOMES_AGUARDANDO_PAGAMENTO = ["Link Enviado", "Aguardando Pagamento", "Pix Enviado"];
const NOMES_AGUARDANDO_LOJA = ["Dados Incompletos"];

const norm = (s: string) => s.trim().toLowerCase();

function stageOfColuna(col?: Pick<PipelineColuna, "nome" | "tipo_acao"> | null): Stage {
  if (!col) return "REQUER_ACAO";
  const nome = norm(col.nome || "");
  if (NOMES_CONCLUIDO.some((n) => norm(n) === nome)) return "CONCLUIDO";
  if (NOMES_CANCELADO.some((n) => norm(n) === nome)) return "CANCELADO";
  if (NOMES_AGUARDANDO_PAGAMENTO.some((n) => norm(n) === nome)) return "AGUARDANDO_PAGAMENTO";
  if (col.tipo_acao === "devolver_para_loja" || NOMES_AGUARDANDO_LOJA.some((n) => norm(n) === nome)) return "AGUARDANDO_LOJA";
  // "Novo", "Consulta CPF", "Solicitação de Boleto", "Confirmação PIX", "Boleto em Revisão" e o resto
  return "REQUER_ACAO";
}

const STAGE_META: Record<Stage, { label: string; icon: any; accent: string }> = {
  REQUER_ACAO: { label: "Requer ação", icon: AlertTriangle, accent: "text-amber-600 dark:text-amber-400" },
  AGUARDANDO_LOJA: { label: "Aguardando loja", icon: Store, accent: "text-blue-600 dark:text-blue-400" },
  AGUARDANDO_PAGAMENTO: { label: "Aguardando pagamento", icon: Hourglass, accent: "text-indigo-600 dark:text-indigo-400" },
  CONCLUIDO: { label: "Concluídos", icon: CheckCircle2, accent: "text-emerald-600 dark:text-emerald-400" },
  CANCELADO: { label: "Cancelados", icon: XCircle, accent: "text-zinc-500" },
};

const STAGE_ORDER: Stage[] = ["REQUER_ACAO", "AGUARDANDO_LOJA", "AGUARDANDO_PAGAMENTO", "CONCLUIDO", "CANCELADO"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TIPO_LABELS: Record<string, string> = {
  link_pagamento: "Link de pagamento",
  boleto: "Boleto",
  consulta_cpf: "Consulta CPF",
  confirmacao_pix: "Confirmação PIX",
  estorno_cartao: "Estorno cartão",
  estorno_pix_debito: "Estorno PIX/débito",
  pagamento: "Pagamento",
  reembolso: "Reembolso",
};

function tipoLabel(tipo: string | null | undefined) {
  if (!tipo) return "Solicitação";
  return TIPO_LABELS[tipo] ?? tipo;
}

function tipoIcon(tipo: string | null | undefined, className = "h-3.5 w-3.5") {
  switch (tipo) {
    case "link_pagamento": return <CreditCard className={cn(className, "text-primary")} />;
    case "boleto": return <FileText className={cn(className, "text-info")} />;
    case "consulta_cpf": return <ShieldCheck className={cn(className, "text-warning")} />;
    default: return <DollarSign className={cn(className, "text-muted-foreground")} />;
  }
}

function brl(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valor "principal" do card, tolerante às variações de metadata por tipo. */
function valorDe(sol: any): number | null {
  const m = sol?.metadata || {};
  const v = m.valor ?? m.valor_total ?? m.boleto_valor_total ?? m.valor_financiado;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Data de referência para "concluído hoje": updated_at → payment_confirmed_at → created_at. */
function refDate(sol: any): Date {
  const raw = sol?.updated_at || sol?.metadata?.payment_confirmed_at || sol?.created_at;
  return new Date(raw);
}

function horasParado(sol: any): number {
  return (Date.now() - new Date(sol.created_at).getTime()) / 3_600_000;
}

/** Cor da coluna (token do design system) como dot. */
function colunaDotStyle(cor?: string | null) {
  return { backgroundColor: `hsl(var(--${cor || "muted-foreground"}))` };
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function MesaFinanceiro() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  // --------------- filtros / UI state ---------------
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("todos");
  const [lojaFilter, setLojaFilter] = useState("todas");
  const [mostrarArquivados, setMostrarArquivados] = useState(false);
  const [mostrarEncerrados, setMostrarEncerrados] = useState(false);
  const [openSections, setOpenSections] = useState<Record<Stage, boolean>>({
    REQUER_ACAO: true,
    AGUARDANDO_LOJA: true,
    AGUARDANDO_PAGAMENTO: true,
    CONCLUIDO: false,
    CANCELADO: false,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [externalSol, setExternalSol] = useState<any | null>(null); // deep-link fora da lista
  const [openedViaDeeplink, setOpenedViaDeeplink] = useState(false);

  // --------------- dialogs ---------------
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [cpfDialogOpen, setCpfDialogOpen] = useState(false);
  const [pixDialogOpen, setPixDialogOpen] = useState(false);
  const [cancelDialogId, setCancelDialogId] = useState<string | null>(null);
  const [devolverDialog, setDevolverDialog] = useState<{ id: string; colunaId?: string; presets?: string[] } | null>(null);
  const [concluirDialog, setConcluirDialog] = useState<{ id: string; modo: "carta" | "comprovante_pagamento" | "boleto" | "boleto-revisao" } | null>(null);
  const [anexarExtraId, setAnexarExtraId] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<any | null>(null);

  const detailRef = useRef<HTMLDivElement | null>(null);
  const dialogoLojaRef = useRef<HTMLDivElement | null>(null);

  /* --------------- dados (mesmas queries do PipelineFinanceiro) --------------- */

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

  // Realtime — igual ao kanban
  useEffect(() => {
    const channel = supabase
      .channel("financeiro-mesa-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "solicitacoes" }, () => {
        queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  /* --------------- deep-link /financeiro?sol=<id> --------------- */

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
      setSelectedId(found.id);
      setOpenedViaDeeplink(true);
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
      setExternalSol(data);
      setSelectedId((data as any).id);
      setOpenedViaDeeplink(true);
      clearParam();
    })();
    return () => { cancelled = true; };
  }, [solParam, solicitacoes, searchParams, setSearchParams]);

  // Auto-scroll até o painel de diálogo quando aberto via notificação (?sol=)
  useEffect(() => {
    if (!openedViaDeeplink || !selectedId) return;
    const t = setTimeout(() => {
      dialogoLojaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => clearTimeout(t);
  }, [openedViaDeeplink, selectedId]);

  useEffect(() => {
    if (!selectedId) setOpenedViaDeeplink(false);
  }, [selectedId]);

  /* --------------- derivações --------------- */

  const colunaById = useMemo(() => {
    const map = new Map<string, PipelineColuna>();
    (colunas ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [colunas]);

  const stageOf = (sol: any): Stage => {
    const porColuna = stageOfColuna(colunaById.get(sol.pipeline_coluna_id) ?? null);
    // Fluxos 100% automáticos (link cartão e Pix) nunca "requerem ação" do
    // operador: se a coluna não mapear para um estágio conhecido (ex.: card
    // antigo em "Novo"), eles ficam em Aguardando pagamento — ou encerrados,
    // conforme o status da solicitação.
    const TIPOS_AUTOMATICOS = ["link_pagamento", "pix_pagamento"];
    if (porColuna === "REQUER_ACAO" && TIPOS_AUTOMATICOS.includes(sol.tipo)) {
      if (sol.status === "concluida") return "CONCLUIDO";
      if (sol.status === "cancelada") return "CANCELADO";
      return "AGUARDANDO_PAGAMENTO";
    }
    return porColuna;
  };

  // Base (respeita só o toggle de arquivados) — usada nos KPIs
  const baseSolicitacoes = useMemo(
    () => (solicitacoes ?? []).filter((s: any) => mostrarArquivados || !s.metadata?.arquivado_at),
    [solicitacoes, mostrarArquivados],
  );

  const lojas = useMemo(
    () => Array.from(new Set(
      (solicitacoes ?? []).map((s: any) => s.metadata?.loja_nome).filter(Boolean) as string[],
    )).sort(),
    [solicitacoes],
  );

  const kpis = useMemo(() => {
    const requerAcao = baseSolicitacoes.filter((s: any) => stageOf(s) === "REQUER_ACAO");
    const aguardandoPag = baseSolicitacoes.filter((s: any) => stageOf(s) === "AGUARDANDO_PAGAMENTO");
    const aguardandoLoja = baseSolicitacoes.filter((s: any) => stageOf(s) === "AGUARDANDO_LOJA");
    const concluidosHoje = baseSolicitacoes.filter(
      (s: any) => stageOf(s) === "CONCLUIDO" && isToday(refDate(s)),
    );
    const soma = (arr: any[]) => arr.reduce((acc, s) => acc + (valorDe(s) ?? 0), 0);
    return {
      requerAcao: requerAcao.length,
      aguardandoPag: aguardandoPag.length,
      aguardandoPagValor: soma(aguardandoPag),
      aguardandoLoja: aguardandoLoja.length,
      concluidosHoje: concluidosHoje.length,
      concluidosHojeValor: soma(concluidosHoje),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSolicitacoes, colunaById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseSolicitacoes.filter((s: any) => {
      if (tipoFilter !== "todos" && s.tipo !== tipoFilter) return false;
      if (lojaFilter !== "todas" && s.metadata?.loja_nome !== lojaFilter) return false;
      if (!q) return true;
      const valor = valorDe(s);
      return [
        s.protocolo, s.assunto, s.contato?.nome, s.metadata?.loja_nome, s.metadata?.cliente,
        valor != null ? String(valor) : null, valor != null ? valor.toFixed(2) : null,
      ].some((v) => v && String(v).toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSolicitacoes, search, tipoFilter, lojaFilter]);

  const grouped = useMemo(() => {
    const g: Record<Stage, any[]> = {
      REQUER_ACAO: [], AGUARDANDO_LOJA: [], AGUARDANDO_PAGAMENTO: [], CONCLUIDO: [], CANCELADO: [],
    };
    filtered.forEach((s: any) => g[stageOf(s)].push(s));

    const oldestFirst = (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const newestFirst = (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

    g.REQUER_ACAO.sort(oldestFirst);
    g.AGUARDANDO_LOJA.sort(oldestFirst);
    g.AGUARDANDO_PAGAMENTO.sort(newestFirst);
    g.CONCLUIDO.sort(newestFirst);
    g.CANCELADO.sort(newestFirst);

    // Encerrados: por padrão só os de hoje; com o switch ligado mostra tudo.
    // Exceção: quando há busca/filtro ativo, o usuário está PROCURANDO algo —
    // mostramos tudo que casa, inclusive encerrados antigos (senão "Consulta
    // CPF" aprovada ontem, por exemplo, some do resultado e parece bug).
    const filtroAtivo = search.trim() !== "" || tipoFilter !== "todos" || lojaFilter !== "todas";
    if (!mostrarEncerrados && !filtroAtivo) {
      g.CONCLUIDO = g.CONCLUIDO.filter((s: any) => isToday(refDate(s)));
      g.CANCELADO = g.CANCELADO.filter((s: any) => isToday(refDate(s)));
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, mostrarEncerrados, search, tipoFilter, lojaFilter, colunaById]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return (
      (solicitacoes as any[] | undefined)?.find((s) => s.id === selectedId) ??
      (externalSol?.id === selectedId ? externalSol : null)
    );
  }, [selectedId, solicitacoes, externalSol]);

  const selectedColuna = selected ? colunaById.get(selected.pipeline_coluna_id) ?? null : null;
  const firstColumnId = (colunas ?? []).slice().sort((a, b) => a.ordem - b.ordem)[0]?.id;
  const isLoading = loadingColunas || loadingSolicitacoes || !setorId;

  /* --------------- mover card (mesmo contrato do kanban) --------------- */

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

  const handleMoveToColuna = (destColunaId: string) => {
    if (!selected || !destColunaId || destColunaId === selected.pipeline_coluna_id) return;

    const destCol = colunaById.get(destColunaId);

    // Coluna destino "devolver_para_loja" → abre dialog (não move ainda)
    if (destCol?.tipo_acao === "devolver_para_loja") {
      setDevolverDialog({ id: selected.id, colunaId: destColunaId });
      return;
    }

    // Guarda: nunca mover boleto para "Boleto Enviado" sem anexo
    if (destCol?.nome === "Boleto Enviado" && selected.tipo === "boleto") {
      const temArquivo = Array.isArray(selected.metadata?.boleto_arquivos) && selected.metadata.boleto_arquivos.length > 0;
      if (!temArquivo) {
        toast.error("Anexe o(s) boleto(s) antes de mover. Abrindo dialog…");
        setConcluirDialog({ id: selected.id, modo: "boleto" });
        return;
      }
    }

    const colunaAnteriorId = selected.pipeline_coluna_id;
    updateSolicitacaoColuna.mutate({ id: selected.id, pipeline_coluna_id: destColunaId });

    supabase.functions.invoke("pipeline-automations", {
      body: {
        entity_type: "solicitacao",
        entity_id: selected.id,
        coluna_id: destColunaId,
        coluna_anterior_id: colunaAnteriorId,
      },
    }).catch((e) => console.warn("Automation call failed:", e));
  };

  const handleSelect = (sol: any) => {
    setSelectedId(sol.id);
    // Em telas < lg o detalhe é a seção abaixo da fila — leva o usuário até ela
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });

  /* ------------------------------------------------------------------ */

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mesa do Financeiro"
        description="Fila de operações por urgência • o estado real continua sendo a coluna do pipeline"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" asChild title="Abrir visão kanban clássica">
              <Link to="/financeiro/kanban">
                <KanbanSquare className="h-4 w-4 mr-1" /> Kanban
              </Link>
            </Button>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova solicitação
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Requer ação"
            value={String(kpis.requerAcao)}
            tone={kpis.requerAcao > 0 ? "danger" : undefined}
          />
          <KpiCard
            label="Aguardando pagamento"
            value={String(kpis.aguardandoPag)}
            sub={brl(kpis.aguardandoPagValor)}
          />
          <KpiCard label="Aguardando loja" value={String(kpis.aguardandoLoja)} />
          <KpiCard
            label="Concluídos hoje"
            value={String(kpis.concluidosHoje)}
            sub={brl(kpis.concluidosHojeValor)}
            tone="success"
          />
        </div>
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="py-3 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Protocolo, loja, cliente, assunto, valor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={tipoFilter} onValueChange={setTipoFilter}>
            <SelectTrigger className="w-full lg:w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(TIPO_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={lojaFilter} onValueChange={setLojaFilter}>
            <SelectTrigger className="w-full lg:w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as lojas</SelectItem>
              {lojas.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {mostrarArquivados
                ? <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                : <Archive className="h-3.5 w-3.5 text-muted-foreground" />}
              <Switch id="mesa-arquivados" checked={mostrarArquivados} onCheckedChange={setMostrarArquivados} className="scale-75" />
              <Label htmlFor="mesa-arquivados" className="text-xs cursor-pointer select-none">Arquivados</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Switch id="mesa-encerrados" checked={mostrarEncerrados} onCheckedChange={setMostrarEncerrados} className="scale-75" />
              <Label htmlFor="mesa-encerrados" className="text-xs cursor-pointer select-none">Encerrados</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Corpo: fila | detalhe */}
      <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] gap-4 items-start">
        {/* ---------------- Fila ---------------- */}
        <div className="space-y-3 min-w-0">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : (
            STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage];
              const items = grouped[stage];
              const Icon = meta.icon;
              const showStaleBadge = stage === "REQUER_ACAO" || stage === "AGUARDANDO_LOJA";
              return (
                <Collapsible
                  key={stage}
                  open={openSections[stage]}
                  onOpenChange={(o) => setOpenSections((prev) => ({ ...prev, [stage]: o }))}
                >
                  <Card>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/40 rounded-t-lg transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <Icon className={cn("h-4 w-4", meta.accent)} />
                          {meta.label}
                          {(stage === "CONCLUIDO" || stage === "CANCELADO") && !mostrarEncerrados && (
                            <span className="text-[10px] font-normal text-muted-foreground">(hoje)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-medium bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                            {items.length}
                          </span>
                          <ChevronDown className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            openSections[stage] && "rotate-180",
                          )} />
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t">
                        {items.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-4 text-center flex items-center justify-center gap-1.5">
                            <Inbox className="h-3.5 w-3.5" /> Nada aqui
                          </p>
                        ) : (
                          <ul className="divide-y">
                            {items.map((sol: any) => (
                              <FilaItem
                                key={sol.id}
                                sol={sol}
                                coluna={colunaById.get(sol.pipeline_coluna_id) ?? null}
                                selected={sol.id === selectedId}
                                showStaleBadge={showStaleBadge}
                                onSelect={() => handleSelect(sol)}
                                onCancelar={
                                  sol.status !== "concluida" && sol.status !== "cancelada"
                                    ? () => setCancelDialogId(sol.id)
                                    : undefined
                                }
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })
          )}
        </div>

        {/* ---------------- Detalhe ---------------- */}
        <div ref={detailRef} className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {!selected ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                <Inbox className="h-8 w-8 mx-auto mb-3 opacity-50" />
                Selecione uma solicitação na fila para ver os detalhes e agir.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 space-y-4">
                {/* Header do detalhe */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {tipoIcon(selected.tipo, "h-4 w-4")}
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {tipoLabel(selected.tipo)}
                      </span>
                      {selected.protocolo && (
                        <span className="font-mono text-xs text-muted-foreground">{selected.protocolo}</span>
                      )}
                      {selectedColuna && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium border rounded-full px-2 py-0.5">
                          <span className="h-1.5 w-1.5 rounded-full" style={colunaDotStyle(selectedColuna.cor)} />
                          {selectedColuna.nome}
                        </span>
                      )}
                      {selected.metadata?.arquivado_at && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          <Archive className="h-2.5 w-2.5 mr-0.5" /> Arquivada
                        </Badge>
                      )}
                    </div>
                    <h2 className="font-semibold text-base mt-1 break-words">{selected.assunto}</h2>
                    {selected.metadata?.loja_nome && (
                      <p className="text-sm font-medium text-primary flex items-center gap-1 mt-0.5">
                        <Store className="h-3.5 w-3.5" /> {selected.metadata.loja_nome}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      criada {formatDistanceToNow(new Date(selected.created_at), { addSuffix: true, locale: ptBR })}
                      {" • "}{format(new Date(selected.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                      title="Editar informações (admin)"
                      onClick={() => setEditingCard(selected)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <ResponsavelSolicitacao solicitacao={selected} onChanged={invalidate} />



                {/* Campos base */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {selected.contato && (
                    <>
                      <span className="text-muted-foreground text-xs">Contato</span>
                      <span className="font-medium text-right truncate">
                        {selected.contato.nome}
                        {selected.contato.telefone && (
                          <span className="text-xs text-muted-foreground font-normal ml-1 inline-flex items-center gap-0.5">
                            <Phone className="h-2.5 w-2.5" />{selected.contato.telefone}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {valorDe(selected) != null && (
                    <>
                      <span className="text-muted-foreground text-xs">Valor</span>
                      <span className="font-semibold text-right">{brl(valorDe(selected))}</span>
                    </>
                  )}
                  <span className="text-muted-foreground text-xs">Status</span>
                  <span className="text-right"><Badge variant="outline" className="text-[10px]">{selected.status}</Badge></span>
                </div>

                {selected.descricao && selected.tipo !== "boleto" && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Descrição</p>
                    <p className="text-sm whitespace-pre-wrap">{selected.descricao}</p>
                  </div>
                )}

                {/* Blocos estruturados por tipo */}
                <DetalheBlocos sol={selected} />

                {/* Ações contextuais */}
                <AcoesPanel
                  sol={selected}
                  colunas={colunas ?? []}
                  onAbrirCpf={() => setCpfDialogOpen(true)}
                  onAbrirPix={() => setPixDialogOpen(true)}
                  onConcluir={(modo) => setConcluirDialog({ id: selected.id, modo })}
                  onAnexarExtra={() => setAnexarExtraId(selected.id)}
                  onDevolver={(presets) => setDevolverDialog({ id: selected.id, presets })}
                  onCancelar={() => setCancelDialogId(selected.id)}
                  onEstornoSolicitado={async () => {
                    try {
                      const novoMeta = {
                        ...(selected.metadata || {}),
                        estorno_status: "solicitado",
                        estorno_solicitado_em: new Date().toISOString(),
                      };
                      await supabase.from("solicitacoes")
                        .update({ metadata: novoMeta as any })
                        .eq("id", selected.id);
                      const demandaId = (selected.metadata as any)?.demanda_id;
                      if (demandaId) {
                        await supabase.from("demanda_mensagens").insert({
                          demanda_id: demandaId,
                          direcao: "operador_para_loja",
                          autor_nome: "Financeiro",
                          conteudo: "✅ Estorno foi solicitado à adquirente. Aguardando retorno.",
                          metadata: { tipo: "estorno_solicitado", solicitacao_id: selected.id },
                        });
                      }
                      toast.success("Estorno marcado como solicitado e loja avisada.");
                      invalidate();
                    } catch (e: any) {
                      toast.error("Falha: " + (e?.message || "erro"));
                    }
                  }}
                  onMoverColuna={handleMoveToColuna}
                />

                <Separator />

                {/* Timeline */}
                <div>
                  <p className="text-xs font-semibold mb-2">Linha do tempo</p>
                  <CardTimeline entidade="solicitacao" entidadeId={selected.id} />
                </div>

                <Separator />

                {/* Thread setor ↔ loja (âncora para deep-link) */}
                <div id="dialogo-loja-panel" ref={dialogoLojaRef}>
                  <SolicitacaoThreadPanel solicitacaoId={selected.id} perspectiva="setor" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ---------------- Dialogs (componentes compartilhados) ---------------- */}

      {selected?.tipo === "consulta_cpf" && (
        <CpfApprovalDialog
          solicitacao={selected}
          open={cpfDialogOpen}
          onOpenChange={setCpfDialogOpen}
          colunas={colunas ?? []}
        />
      )}

      {selected?.tipo === "confirmacao_pix" && (
        <ConfirmarPixDialog
          solicitacao={selected}
          open={pixDialogOpen}
          onOpenChange={setPixDialogOpen}
          colunas={colunas ?? []}
        />
      )}

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
        onSuccess={invalidate}
      />

      <DevolverLojaDialog
        solicitacaoId={devolverDialog?.id ?? null}
        colunaDestinoId={devolverDialog?.colunaId ?? null}
        presets={devolverDialog?.presets}
        open={!!devolverDialog}
        onOpenChange={(o) => !o && setDevolverDialog(null)}
        onSuccess={invalidate}
      />

      <ConcluirSolicitacaoDialog
        solicitacaoId={concluirDialog?.id ?? null}
        modo={concluirDialog?.modo ?? "carta"}
        open={!!concluirDialog}
        onOpenChange={(o) => !o && setConcluirDialog(null)}
        onSuccess={invalidate}
      />

      <AnexarBoletoExtraDialog
        solicitacaoId={anexarExtraId}
        open={!!anexarExtraId}
        onOpenChange={(o) => !o && setAnexarExtraId(null)}
        onSuccess={invalidate}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI Card (padrão PagamentosLink)                                    */
/* ------------------------------------------------------------------ */

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "success" }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn(
          "text-xl font-semibold mt-1",
          tone === "danger" && "text-red-600 dark:text-red-400",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
        )}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Item da fila (linha compacta)                                       */
/* ------------------------------------------------------------------ */

function FilaItem({
  sol, coluna, selected, showStaleBadge, onSelect, onCancelar,
}: {
  sol: any;
  coluna: PipelineColuna | null;
  selected: boolean;
  showStaleBadge: boolean;
  onSelect: () => void;
  onCancelar?: () => void;
}) {
  const horas = horasParado(sol);
  const staleCls = horas > 24
    ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
    : horas > 4
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
      : "text-muted-foreground border-transparent";
  const valor = valorDe(sol);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full text-left px-3 py-2 transition-colors hover:bg-accent/40",
          selected && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
      >
        <div className="flex items-center gap-2">
          {tipoIcon(sol.tipo)}
          {sol.protocolo && (
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{sol.protocolo}</span>
          )}
          {sol.metadata?.loja_nome && (
            <span className="text-xs font-semibold text-primary truncate">{sol.metadata.loja_nome}</span>
          )}
          <span className="flex-1" />
          {valor != null && (
            <span className="text-xs font-semibold shrink-0">{brl(valor)}</span>
          )}
          {onCancelar && (
            <span
              role="button"
              tabIndex={0}
              title="Cancelar solicitação"
              aria-label="Cancelar solicitação"
              onClick={(e) => { e.stopPropagation(); onCancelar(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onCancelar(); } }}
              className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-red-600 hover:bg-red-500/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate flex-1">
            {sol.metadata?.cliente || sol.contato?.nome || sol.assunto}
            {sol.assunto && (sol.metadata?.cliente || sol.contato?.nome) ? ` — ${sol.assunto}` : ""}
          </span>
          {sol.metadata?.arquivado_at && (
            <Archive className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          {coluna && (
            <span className="inline-flex items-center gap-1 text-[10px] border rounded-full px-1.5 py-0 text-muted-foreground shrink-0 max-w-[130px]">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={colunaDotStyle(coluna.cor)} />
              <span className="truncate">{coluna.nome}</span>
            </span>
          )}
          <span className={cn(
            "inline-flex items-center gap-0.5 text-[10px] rounded-full border px-1.5 py-0 shrink-0",
            showStaleBadge ? staleCls : "text-muted-foreground border-transparent",
          )}>
            <Clock className="h-2.5 w-2.5" />
            {formatDistanceToNow(new Date(sol.created_at), { locale: ptBR })}
          </span>
        </div>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos estruturados por tipo (adaptados do drawer do kanban)        */
/* ------------------------------------------------------------------ */

function DetalheBlocos({ sol }: { sol: any }) {
  const m = sol.metadata || {};
  return (
    <>
      {m.url && (
        <div className="pt-2 border-t">
          <p className="text-muted-foreground text-xs mb-1">Link de Pagamento</p>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all text-xs">
            {m.url}
          </a>
        </div>
      )}

      {/* Comprovante de Pagamento (Picote) */}
      {m.payment_status === "PAGO" && (
        <div className="pt-2 border-t">
          <div className="border-2 border-dashed border-green-300 rounded-lg bg-green-50 p-4 space-y-3">
            <p className="text-xs font-semibold text-green-800">
              📩 Comprovante de Pagamento
              {m.nome_cliente && <span> — {m.nome_cliente}</span>}
            </p>
            <div className="text-center py-2">
              <p className="text-lg font-bold text-green-900">🔑 NSU: {m.nsu || "N/A"}</p>
              <p className="text-[10px] text-green-700">Use este número para baixa no sistema</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-green-900">
              <span className="text-green-700">💰 Valor</span>
              <span className="font-medium">{m.valor ? `R$ ${Number(m.valor).toFixed(2)}` : "N/A"}</span>
              <span className="text-green-700">🆔 TID</span>
              <span className="font-medium">{m.tid || "N/A"}</span>
              <span className="text-green-700">🔐 Autorização</span>
              <span className="font-medium">{m.authorization || "N/A"}</span>
              <span className="text-green-700">📅 Data</span>
              <span className="font-medium">
                {m.payment_confirmed_at
                  ? format(new Date(m.payment_confirmed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                  : "N/A"}
              </span>
              <span className="text-green-700">💳 Cartão</span>
              <span className="font-medium">
                {m.brand ? `${m.brand} ` : ""}**** {m.last4 || "****"}
              </span>
              <span className="text-green-700">📦 Parcelas</span>
              <span className="font-medium">{m.installments || 1}x</span>
              {m.txid && (<><span className="text-green-700">🧾 TXID</span><span className="font-medium break-all">{String(m.txid)}</span></>)}
            </div>
          </div>
        </div>
      )}

      {/* Consulta CPF */}
      {sol.tipo === "consulta_cpf" && (
        <div className="pt-2 border-t">
          <p className="text-muted-foreground text-xs mb-1">Consulta CPF</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {m.nome_cliente && (<><span className="text-muted-foreground">Cliente</span><span className="font-medium">{String(m.nome_cliente)}</span></>)}
            {m.cpf && (<><span className="text-muted-foreground">CPF</span><span className="font-mono font-medium">{String(m.cpf)}</span></>)}
            {m.valor_compra != null && (<><span className="text-muted-foreground">Valor compra</span><span className="font-medium">R$ {Number(m.valor_compra).toFixed(2)}</span></>)}
            {m.valor_entrada != null && (<><span className="text-muted-foreground">Entrada</span><span className="font-medium">R$ {Number(m.valor_entrada).toFixed(2)}</span></>)}
          </div>
          {m.valor_financiado != null && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary mt-1.5 flex-wrap">
              <DollarSign className="h-3 w-3" />
              Financiado: R$ {Number(m.valor_financiado).toFixed(2)}
              <EntryPercentageBadge
                valorEntrada={m.valor_entrada != null ? Number(m.valor_entrada) : null}
                valorCompra={m.valor_compra != null ? Number(m.valor_compra) : null}
                size="sm"
              />
              {m.resultado_consulta && (
                <Badge variant={m.resultado_consulta === "aprovado" ? "default" : "destructive"} className="ml-1 text-[10px] px-1 py-0">
                  {m.resultado_consulta === "aprovado" ? "Aprovado" : "Reprovado"}
                </Badge>
              )}
              {m.dados_incompletos?.length > 0 && !m.resultado_consulta && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-yellow-500/50 text-yellow-700">
                  Incompleto
                </Badge>
              )}
            </div>
          )}
        </div>
      )}

      {/* Estorno */}
      {(sol.tipo === "estorno_cartao" || sol.tipo === "estorno_pix_debito") && (
        <div className="pt-2 border-t">
          <p className="text-muted-foreground text-xs mb-1">Dados do estorno</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {m.numero_venda && (<><span className="text-muted-foreground">OS/Venda</span><span className="font-medium">{m.numero_venda}</span></>)}
            {m.data_processamento && (<><span className="text-muted-foreground">Processamento</span><span className="font-medium">{m.data_processamento}</span></>)}
            {m.nsu && (<><span className="text-muted-foreground">NSU</span><span className="font-medium">{m.nsu}</span></>)}
            {m.valor_total && (<><span className="text-muted-foreground">Valor total</span><span className="font-medium">R$ {Number(m.valor_total).toFixed(2)}</span></>)}
            {m.valor && (<><span className="text-muted-foreground">A cancelar</span><span className="font-medium">R$ {Number(m.valor).toFixed(2)}</span></>)}
            {m.chave_pix && (<><span className="text-muted-foreground">Chave PIX</span><span className="font-medium break-all">{String(m.chave_pix)}</span></>)}
            {m.banco && (<><span className="text-muted-foreground">Banco</span><span className="font-medium">{String(m.banco)}</span></>)}
            {m.estorno_status && (<><span className="text-muted-foreground">Status</span><Badge variant="outline">{String(m.estorno_status)}</Badge></>)}
          </div>
          {m.carta_estorno_url && (
            <a href={String(m.carta_estorno_url)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline text-xs mt-2 inline-block">📎 Carta de devolução</a>
          )}
        </div>
      )}

      {/* Pagamento / Reembolso */}
      {(sol.tipo === "pagamento" || sol.tipo === "reembolso") && (
        <div className="pt-2 border-t">
          <p className="text-muted-foreground text-xs mb-1">Dados do {sol.tipo === "pagamento" ? "pagamento" : "reembolso"}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {m.favorecido && (<><span className="text-muted-foreground">Favorecido</span><span className="font-medium">{String(m.favorecido)}</span></>)}
            {m.documento_favorecido && (<><span className="text-muted-foreground">CNPJ/CPF</span><span className="font-medium">{String(m.documento_favorecido)}</span></>)}
            {m.valor && (<><span className="text-muted-foreground">Valor</span><span className="font-medium">R$ {Number(m.valor).toFixed(2)}</span></>)}
            {m.vencimento && (<><span className="text-muted-foreground">Vencimento</span><span className="font-medium">{String(m.vencimento)}</span></>)}
            {m.forma_pagamento && (<><span className="text-muted-foreground">Forma</span><span className="font-medium">{String(m.forma_pagamento)}</span></>)}
            {m.forma_reembolso && (<><span className="text-muted-foreground">Forma</span><span className="font-medium">{String(m.forma_reembolso)}</span></>)}
            {m.chave_pix && (<><span className="text-muted-foreground">Chave PIX</span><span className="font-medium break-all">{String(m.chave_pix)}</span></>)}
            {m.dados_pagamento && (<><span className="text-muted-foreground">Dados</span><span className="font-medium break-all">{String(m.dados_pagamento)}</span></>)}
            {m.loja_ou_setor && (<><span className="text-muted-foreground">Centro custo</span><span className="font-medium">{String(m.loja_ou_setor)}</span></>)}
          </div>
          {m.anexo_nota && (
            <a href={String(m.anexo_nota)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline text-xs mt-2 inline-block">📎 Nota / boleto anexado</a>
          )}
          {m.comprovante && (
            <a href={String(m.comprovante)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline text-xs mt-2 inline-block">📎 Comprovante de gasto</a>
          )}
          {m.comprovante_url && (
            <a href={String(m.comprovante_url)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline text-xs mt-2 inline-block">📎 Comprovante de pagamento</a>
          )}
        </div>
      )}

      {/* Boleto (picote) */}
      {sol.tipo === "boleto" && (
        <div className="pt-2 border-t">
          <div className="border-2 border-dashed border-amber-400 rounded-lg bg-amber-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">🧾 Solicitação de Boleto</p>
              {m.boleto_status === "enviado" ? (
                <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">✓ Enviado à loja</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-900 border-amber-400 text-[10px]">Aguardando geração</Badge>
              )}
            </div>

            <div className="text-center py-2 border-y border-dashed border-amber-300">
              <p className="text-2xl font-bold text-amber-900">
                R$ {Number(m.valor_total || m.boleto_valor_total || 0).toFixed(2)}
              </p>
              {m.qtd_parcelas && (
                <p className="text-xs text-amber-800 mt-0.5">
                  {m.qtd_parcelas}x de <strong>R$ {Number(m.valor_parcela || 0).toFixed(2)}</strong>
                </p>
              )}
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-amber-900">
              {m.cliente && (<><span className="text-amber-700">👤 Cliente</span><span className="font-medium">{String(m.cliente)}</span></>)}
              {m.cpf && (<><span className="text-amber-700">🆔 CPF</span><span className="font-mono font-medium">{String(m.cpf)}</span></>)}
              {m.loja_nome && (<><span className="text-amber-700">🏬 Loja</span><span className="font-medium">{String(m.loja_nome)}</span></>)}
              {m.dia_vencimento && (<><span className="text-amber-700">📅 Vencimento</span><span className="font-medium">Todo dia {m.dia_vencimento}</span></>)}
              <span className="text-amber-700">📦 Entrega</span>
              <span className="font-medium">
                {m.boleto_impresso
                  ? "🖨️ Imprimir e enviar por malote (solicitado pela loja)"
                  : "📱 Digital — anexar PDF"}
              </span>
            </div>

            <BoletoConsultaOrigem consultaCpfId={m.consulta_cpf_id as string | undefined} />

            {Array.isArray(m.boleto_parcelas_projecao) && m.boleto_parcelas_projecao.length > 0 && (
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
                      {(m.boleto_parcelas_projecao as any[]).map((p, idx) => (
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

            {m.observacao && String(m.observacao).trim() && (
              <div className="pt-2 border-t border-dashed border-amber-300">
                <p className="text-[10px] font-semibold text-amber-800 uppercase mb-0.5">Observação da loja</p>
                <p className="text-xs text-amber-900 whitespace-pre-wrap">{String(m.observacao)}</p>
              </div>
            )}
          </div>

          {/* Revisão pedida pela loja */}
          {m.boleto_revisao?.ciclo && !m.boleto_revisao?.atendida_em && (
            <div className="mt-3 border-2 border-amber-500 rounded-lg bg-amber-100/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-900 uppercase">🔄 Revisão pedida pela loja</p>
                <Badge className="text-[10px] bg-amber-200 text-amber-900 border-amber-500">
                  ciclo {m.boleto_revisao.ciclo}
                </Badge>
              </div>
              <p className="text-xs text-amber-900 whitespace-pre-wrap">
                <span className="font-semibold">Motivo: </span>
                {String(m.boleto_revisao.motivo || "—")}
              </p>
              {Array.isArray(m.boleto_revisao.campos_revisar) && m.boleto_revisao.campos_revisar.length > 0 && (
                <p className="text-[11px] text-amber-800">
                  <span className="font-semibold">Campos: </span>
                  {m.boleto_revisao.campos_revisar.join(", ")}
                </p>
              )}
              {m.boleto_revisao.solicitada_por && (
                <p className="text-[10px] text-amber-700">
                  Solicitado por {String(m.boleto_revisao.solicitada_por)}
                </p>
              )}
            </div>
          )}

          {/* Histórico de versões enviadas */}
          {Array.isArray(m.boleto_anexos_historico) && m.boleto_anexos_historico.length > 0 && (
            <div className="mt-3 border rounded-lg p-3 bg-muted/30 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Histórico de versões</p>
              {(m.boleto_anexos_historico as any[]).map((h, idx) => (
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ações contextuais (mesma lógica do kanban)                          */
/* ------------------------------------------------------------------ */

function AcoesPanel({
  sol, colunas,
  onAbrirCpf, onAbrirPix, onConcluir, onAnexarExtra, onDevolver, onCancelar,
  onEstornoSolicitado, onMoverColuna,
}: {
  sol: any;
  colunas: PipelineColuna[];
  onAbrirCpf: () => void;
  onAbrirPix: () => void;
  onConcluir: (modo: "carta" | "comprovante_pagamento" | "boleto" | "boleto-revisao") => void;
  onAnexarExtra: () => void;
  onDevolver: (presets?: string[]) => void;
  onCancelar: () => void;
  onEstornoSolicitado: () => void;
  onMoverColuna: (colunaId: string) => void;
}) {
  const t = sol.tipo;
  const m = sol.metadata || {};
  const encerrado = sol.status === "concluida" || sol.status === "cancelada";
  const isEstorno = t === "estorno_cartao" || t === "estorno_pix_debito";
  const isPag = t === "pagamento" || t === "reembolso";
  const isBoleto = t === "boleto";

  const presetsEstorno = ["NSU incorreto", "Valor divergente", "Falta carta do cliente", "Outro"];
  const presetsPag = t === "pagamento"
    ? ["Falta CNPJ do favorecido", "Chave PIX inválida", "Anexo ilegível", "Valor divergente", "Outro"]
    : ["Comprovante ilegível", "Chave PIX inválida", "Valor divergente", "Outro"];
  const presetsBoleto = ["CPF inválido", "Valor divergente", "Faltam dados do cliente", "Outro"];
  const presetsAtivos = isEstorno ? presetsEstorno : isBoleto ? presetsBoleto : isPag ? presetsPag : undefined;

  return (
    <div className="pt-3 border-t space-y-2">
      <p className="text-xs font-semibold">Ações</p>
      <div className="flex flex-wrap gap-2">
        {t === "consulta_cpf" && !encerrado && (
          <Button size="sm" onClick={onAbrirCpf}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Analisar consulta CPF
          </Button>
        )}
        {t === "confirmacao_pix" && !encerrado && (
          <Button size="sm" onClick={onAbrirPix}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirmar PIX
          </Button>
        )}
        {!encerrado && isEstorno && (
          <>
            {m.estorno_status !== "solicitado" && m.estorno_status !== "concluido" && (
              <Button size="sm" variant="outline" onClick={onEstornoSolicitado}>
                <Clock className="h-3.5 w-3.5 mr-1" /> Estorno solicitado
              </Button>
            )}
            <Button size="sm" onClick={() => onConcluir("carta")}>
              <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Concluir com carta
            </Button>
          </>
        )}
        {!encerrado && isPag && (
          <Button size="sm" onClick={() => onConcluir("comprovante_pagamento")}>
            <CreditCard className="h-3.5 w-3.5 mr-1" /> Concluir pagamento
          </Button>
        )}
        {!encerrado && isBoleto && m.boleto_status !== "enviado" && (
          <Button size="sm" onClick={() => onConcluir("boleto")}>
            <FileText className="h-3.5 w-3.5 mr-1" /> Anexar boleto(s) e enviar
          </Button>
        )}
        {!encerrado && isBoleto && m.boleto_revisao?.ciclo && !m.boleto_revisao?.atendida_em && (
          <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => onConcluir("boleto-revisao")}>
            🔄 Reenviar boleto revisado
          </Button>
        )}
        {isBoleto && m.boleto_status === "enviado" && (
          <Button size="sm" variant="outline" onClick={onAnexarExtra}>
            📎 Anexar arquivo ao boleto
          </Button>
        )}
        {!encerrado && (
          <>
            <Button size="sm" variant="outline" onClick={() => onDevolver(presetsAtivos)}>
              ↩️ Devolver à loja
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onCancelar}>
              Cancelar
            </Button>
          </>
        )}
      </div>

      {/* Mover para coluna (estado real do card = pipeline_coluna_id) */}
      <div className="flex items-center gap-2 pt-1">
        <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Select value="" onValueChange={onMoverColuna}>
          <SelectTrigger className="h-8 text-xs w-[240px]">
            <SelectValue placeholder="Mover para coluna…" />
          </SelectTrigger>
          <SelectContent>
            {colunas
              .filter((c) => c.id !== sol.pipeline_coluna_id)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full inline-block" style={colunaDotStyle(c.cor)} />
                    {c.nome}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
