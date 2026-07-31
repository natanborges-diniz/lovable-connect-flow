import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLojas } from "@/hooks/useLojas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Area, Line,
  XAxis, YAxis, CartesianGrid, Legend, Tooltip as RechartsTooltip,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Store, X, Calendar as CalendarIcon, Megaphone, ArrowDown,
  AlertTriangle, Info, ArrowUpDown, Filter,
} from "lucide-react";

/* ---------------------------------- Tipos --------------------------------- */

interface EtapaFunil { etapa: string; n: number; valor?: number }
interface LojaRow {
  loja: string; agendados: number; compareceram: number; no_show: number;
  vendas: number; valor_vendas: number; pct_comparecimento: number; pct_conversao_visita: number;
  // v2: separa o no-show real do "loja não informou nada" (data já passada, sem resposta)
  vencidos?: number; sem_registro?: number; no_show_total?: number; pct_falta_total?: number;
}
interface FonteRow { fonte: string; contatos: number; qualificados: number; agendaram: number; venderam: number; valor: number }
interface SerieRow { dia: string; contatos: number; agendamentos: number; vendas: number; valor: number }
interface FunilKpis {
  contatos: number; vendas: number; valor_vendas: number; ticket_medio: number;
  conv_geral_pct: number; no_show_pct: number; faturamento_validado: number;
  // v2
  no_show?: number; sem_registro?: number; falta_total_pct?: number;
}
interface FunilDashboardData {
  funil: EtapaFunil[];
  por_loja: LojaRow[];
  por_fonte: FonteRow[];
  serie: SerieRow[];
  kpis: FunilKpis;
}

/* -------------------------------- Constantes ------------------------------- */

const fmtBRL = (n: number) => Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRLCompacto = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const fmtN = (n: number) => Number(n ?? 0).toLocaleString("pt-BR");
const fmtPct = (n: number, dec = 1) => `${Number(n ?? 0).toFixed(dec).replace(".", ",")}%`;

const PRESETS = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

const FONTES = ["site", "instagram", "retorno", "organico", "desconhecido"] as const;
const FONTE_LABELS: Record<string, string> = {
  site: "Site",
  instagram: "Instagram",
  retorno: "Retorno",
  organico: "Orgânico",
  desconhecido: "Desconhecido",
};

// Etapa que é subgrupo do funil (nem todo cliente passa por atendimento humano)
const ETAPA_SUBGRUPO = "Escalado p/ humano";

// Frase do gargalo, indexada pela etapa de destino da transição principal
const FRASES_GARGALO: Record<string, string> = {
  "Qualificado (IA)": "dos contatos não chegam a ser qualificados",
  "Agendou visita": "dos interessados não agendam visita",
  "Compareceu na loja": "dos agendados não comparecem na loja",
  "Venda fechada": "dos que compareceram não fecham a venda",
};

/* --------------------------------- Hook RPC -------------------------------- */

function useFunilDashboard(de: string, ate: string, lojas: string[], fontes: string[]) {
  return useQuery<FunilDashboardData>({
    queryKey: ["funil-dashboard", de, ate, [...lojas].sort().join("|"), [...fontes].sort().join("|")],
    queryFn: async () => {
      // RPC pode não existir em types.ts gerado — cast para não quebrar o TS
      const { data, error } = await (supabase.rpc as any)("funil_dashboard", {
        _de: de,
        _ate: ate,
        _lojas: lojas.length > 0 ? lojas : null,
        _fontes: fontes.length > 0 ? fontes : null,
      });
      if (error) throw error;
      return data as FunilDashboardData;
    },
  });
}

/* ------------------------------- Componentes ------------------------------- */

function Kpi({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad" ? "text-red-600" :
    tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={`text-2xl font-semibold mt-1 ${toneCls}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function MultiSelectPopover({
  icon: Icon, labelVazio, labelSelecionado, options, selected, onToggle, onClear, renderOption,
}: {
  icon: React.ElementType;
  labelVazio: string;
  labelSelecionado: (n: number) => string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  renderOption?: (v: string) => string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Icon className="w-4 h-4" />
          {selected.length === 0 ? labelVazio : labelSelecionado(selected.length)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{labelVazio}</span>
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClear}>
              Limpar (Todas)
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-72">
          <div className="p-2 space-y-1">
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">Nenhuma opção disponível</p>
            )}
            {options.map((v) => (
              <label key={v} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                <Checkbox checked={selected.includes(v)} onCheckedChange={() => onToggle(v)} />
                <span className="truncate">{renderOption ? renderOption(v) : v}</span>
              </label>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function SortableHead({
  label, colKey, sort, onSort, className,
}: {
  label: string;
  colKey: keyof LojaRow;
  sort: { key: keyof LojaRow; dir: "asc" | "desc" };
  onSort: (k: keyof LojaRow) => void;
  className?: string;
}) {
  const active = sort.key === colKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : ""}`}
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

/* ---------------------------------- Página --------------------------------- */

export default function FunilDashboard() {
  // Período: preset em dias OU intervalo custom
  const [days, setDays] = useState<number | null>(30);
  const [range, setRange] = useState<DateRange | undefined>();
  const [calOpen, setCalOpen] = useState(false);

  const [lojasSel, setLojasSel] = useState<string[]>([]);
  const [fontesSel, setFontesSel] = useState<string[]>([]);

  const { de, ate } = useMemo(() => {
    if (days === null && range?.from) {
      return {
        de: format(range.from, "yyyy-MM-dd"),
        ate: format(range.to ?? range.from, "yyyy-MM-dd"),
      };
    }
    const d = days ?? 30;
    return {
      de: format(subDays(new Date(), d), "yyyy-MM-dd"),
      ate: format(new Date(), "yyyy-MM-dd"),
    };
  }, [days, range]);

  const { data, isLoading, error, refetch } = useFunilDashboard(de, ate, lojasSel, fontesSel);
  const { data: lojasOptions = [] } = useLojas();
  const nomesLojas = useMemo(() => lojasOptions.map((l) => l.nome_loja), [lojasOptions]);

  const toggleLoja = (nome: string) =>
    setLojasSel((prev) => (prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome]));
  const toggleFonte = (f: string) =>
    setFontesSel((prev) => (prev.includes(f) ? prev.filter((n) => n !== f) : [...prev, f]));

  /* ------------------------------ Funil derivado ----------------------------- */

  const funil = data?.funil ?? [];
  const principais = useMemo(() => funil.filter((f) => f.etapa !== ETAPA_SUBGRUPO), [funil]);
  const topoN = principais[0]?.n ?? 0;

  // Quedas entre transições principais (Contato→Qualificado→Agendou→Compareceu→Venda)
  const drops = useMemo(
    () =>
      principais.slice(1).map((cur, i) => {
        const prev = principais[i];
        const drop = prev.n > 0 ? ((prev.n - cur.n) / prev.n) * 100 : 0;
        return { de: prev.etapa, para: cur.etapa, drop };
      }),
    [principais]
  );
  const dropsOrdenados = useMemo(() => [...drops].sort((a, b) => b.drop - a.drop), [drops]);
  const maiorDrop = dropsOrdenados[0];
  const segundoDrop = dropsOrdenados[1];

  const corDrop = (drop: number, deEtapa: string, paraEtapa: string) => {
    if (maiorDrop && maiorDrop.de === deEtapa && maiorDrop.para === paraEtapa && drop > 0) return "text-red-600";
    if (segundoDrop && segundoDrop.de === deEtapa && segundoDrop.para === paraEtapa && drop > 0) return "text-amber-600";
    return "text-muted-foreground";
  };

  /* --------------------------- Por loja: ordenação --------------------------- */

  const [sort, setSort] = useState<{ key: keyof LojaRow; dir: "asc" | "desc" }>({ key: "valor_vendas", dir: "desc" });
  const onSort = (k: keyof LojaRow) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "desc" ? "asc" : "desc" } : { key: k, dir: "desc" }));

  const porLoja = data?.por_loja ?? [];
  const lojasOrdenadas = useMemo(() => {
    const arr = [...porLoja];
    arr.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const cmp = typeof va === "string" ? String(va).localeCompare(String(vb), "pt-BR") : Number(va ?? 0) - Number(vb ?? 0);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [porLoja, sort]);

  const mediaComparecimento = porLoja.length > 0 ? porLoja.reduce((s, l) => s + Number(l.pct_comparecimento ?? 0), 0) / porLoja.length : 0;
  const mediaConvVisita = porLoja.length > 0 ? porLoja.reduce((s, l) => s + Number(l.pct_conversao_visita ?? 0), 0) / porLoja.length : 0;
  const clsVsMedia = (v: number, media: number) =>
    porLoja.length < 2 ? "" : Number(v ?? 0) >= media ? "text-emerald-600 font-medium" : "text-red-600 font-medium";

  const topLojasValor = useMemo(
    () => [...porLoja].sort((a, b) => Number(b.valor_vendas ?? 0) - Number(a.valor_vendas ?? 0)).slice(0, 8),
    [porLoja]
  );

  const porFonte = data?.por_fonte ?? [];
  const serie = data?.serie ?? [];
  const k = data?.kpis;

  const semDados = !!data && (k?.contatos ?? 0) === 0 && funil.every((f) => (f.n ?? 0) === 0);

  const labelPeriodoCustom =
    days === null && range?.from
      ? `${format(range.from, "dd/MM/yy", { locale: ptBR })} – ${format(range.to ?? range.from, "dd/MM/yy", { locale: ptBR })}`
      : "Período custom";

  /* ---------------------------------- Render --------------------------------- */

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Cabeçalho + filtros */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Funil de Vendas</h1>
          <p className="text-sm text-muted-foreground">
            Da primeira mensagem à venda na loja — onde estamos perdendo clientes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectPopover
            icon={Store}
            labelVazio="Todas as lojas"
            labelSelecionado={(n) => `${n} loja(s)`}
            options={nomesLojas}
            selected={lojasSel}
            onToggle={toggleLoja}
            onClear={() => setLojasSel([])}
          />
          <MultiSelectPopover
            icon={Megaphone}
            labelVazio="Todas as fontes"
            labelSelecionado={(n) => `${n} fonte(s)`}
            options={[...FONTES]}
            selected={fontesSel}
            onToggle={toggleFonte}
            onClear={() => setFontesSel([])}
            renderOption={(v) => FONTE_LABELS[v] ?? v}
          />
          {PRESETS.map((p) => (
            <Button
              key={p.days}
              size="sm"
              variant={days === p.days ? "default" : "outline"}
              onClick={() => { setDays(p.days); setRange(undefined); }}
            >
              {p.label}
            </Button>
          ))}
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant={days === null ? "default" : "outline"} className="gap-2">
                <CalendarIcon className="w-4 h-4" />
                {labelPeriodoCustom}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                locale={ptBR}
                selected={range}
                numberOfMonths={2}
                defaultMonth={subDays(new Date(), 30)}
                onSelect={(r) => {
                  setRange(r);
                  if (r?.from && r?.to) {
                    setDays(null);
                    setCalOpen(false);
                  }
                }}
                disabled={{ after: new Date() }}
              />
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" onClick={() => refetch()}>Atualizar</Button>
        </div>
      </div>

      {/* Chips de filtros ativos + nota sobre filtro de loja */}
      {(lojasSel.length > 0 || fontesSel.length > 0) && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {lojasSel.map((nome) => (
              <Badge key={`l-${nome}`} variant="secondary" className="gap-1 pr-1">
                {nome}
                <button onClick={() => toggleLoja(nome)} className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {fontesSel.map((f) => (
              <Badge key={`f-${f}`} variant="outline" className="gap-1 pr-1">
                {FONTE_LABELS[f] ?? f}
                <button onClick={() => toggleFonte(f)} className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
          {lojasSel.length > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" />
              O filtro de loja se aplica a partir da etapa "Agendou visita" — as etapas anteriores não têm loja identificada.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">Erro ao carregar o funil: {(error as any).message}</p>}

      {/* Skeletons */}
      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-lg" />
          <div className="grid md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      )}

      {!isLoading && semDados && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Filter className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">Sem dados no período</p>
            <p className="text-xs text-muted-foreground">
              Ajuste o período ou remova filtros de loja/fonte para ver resultados.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && data && !semDados && (
        <>
          {/* 1. KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kpi title="Contatos" value={fmtN(k!.contatos)} hint="topo do funil" />
            <Kpi title="Vendas" value={fmtN(k!.vendas)} tone="ok" />
            <Kpi title="Conversão geral" value={fmtPct(k!.conv_geral_pct)} hint="contato → venda" tone={Number(k!.conv_geral_pct) >= 10 ? "ok" : "warn"} />
            <Kpi title="Valor vendido (funil)" value={fmtBRL(k!.valor_vendas)} />
            <Kpi title="Ticket médio" value={fmtBRL(k!.ticket_medio)} />
            <Kpi
              title="No-show + sem registro"
              value={fmtPct(k!.falta_total_pct ?? k!.no_show_pct)}
              hint={
                k!.sem_registro != null
                  ? `${fmtN(k!.no_show ?? 0)} no-show real · ${fmtN(k!.sem_registro)} sem resposta da loja`
                  : "agendou e não compareceu"
              }
              tone={Number(k!.falta_total_pct ?? k!.no_show_pct) > 30 ? "bad" : "warn"}
            />
            <Kpi
              title="Faturamento validado (ERP)"
              value={fmtBRL(k!.faturamento_validado)}
              hint="vendas registradas no cashback e validadas no ERP; cobertura diferente do funil"
              tone="muted"
            />
          </div>

          {/* 2. Funil */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Funil — da primeira mensagem à venda</CardTitle>
              <p className="text-xs text-muted-foreground">
                "{ETAPA_SUBGRUPO}" é um subgrupo: nem todo cliente passa por atendimento humano, por isso não entra nas transições principais.
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-2">
              {funil.map((etapa) => {
                const isSub = etapa.etapa === ETAPA_SUBGRUPO;
                const idxPrincipal = principais.findIndex((p) => p.etapa === etapa.etapa);
                const pctTopo = topoN > 0 ? (etapa.n / topoN) * 100 : 0;
                const anterior = idxPrincipal > 0 ? principais[idxPrincipal - 1] : null;
                const pctAnterior = anterior && anterior.n > 0 ? (etapa.n / anterior.n) * 100 : null;
                const dropInfo = idxPrincipal > 0 ? drops[idxPrincipal - 1] : null;

                return (
                  <div key={etapa.etapa}>
                    {/* Queda entre etapas principais */}
                    {dropInfo && (
                      <div className="flex items-center gap-3 py-0.5">
                        <div className="w-28 sm:w-44 shrink-0" />
                        <div className={`flex items-center gap-1 text-xs ${corDrop(dropInfo.drop, dropInfo.de, dropInfo.para)}`}>
                          <ArrowDown className="w-3 h-3" />
                          <span>queda de {fmtPct(dropInfo.drop, 0)}</span>
                          {maiorDrop && maiorDrop.de === dropInfo.de && maiorDrop.para === dropInfo.para && dropInfo.drop > 0 && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">maior perda</Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Barra da etapa */}
                    <div className="flex items-center gap-3">
                      <div className="w-28 sm:w-44 shrink-0 text-xs sm:text-sm text-right leading-tight">
                        {etapa.etapa}
                        {isSub && (
                          <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 align-middle text-muted-foreground">
                            subgrupo
                          </Badge>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`h-8 rounded-md flex items-center px-2 text-xs font-semibold transition-all ${
                            isSub ? "border border-dashed border-muted-foreground/40 text-muted-foreground" : "text-primary-foreground"
                          }`}
                          style={{
                            width: `${Math.max(topoN > 0 ? (etapa.n / topoN) * 100 : 0, 4)}%`,
                            background: isSub
                              ? "repeating-linear-gradient(45deg, hsl(var(--muted)) 0 6px, transparent 6px 12px)"
                              : "hsl(var(--primary))",
                          }}
                          title={`${etapa.etapa}: ${fmtN(etapa.n)}`}
                        >
                          {fmtN(etapa.n)}
                        </div>
                      </div>
                      <div className="w-28 sm:w-40 shrink-0 text-[11px] text-muted-foreground leading-tight">
                        <span className="block">{fmtPct(pctTopo, 1)} do topo</span>
                        {!isSub && pctAnterior !== null && <span className="block">{fmtPct(pctAnterior, 1)} da anterior</span>}
                        {etapa.valor != null && (
                          <span className="block font-medium text-emerald-600">{fmtBRL(etapa.valor)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* 3. Maior gargalo */}
          {maiorDrop && maiorDrop.drop > 0 && (
            <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Maior gargalo</p>
                  <p className="text-sm mt-0.5">
                    Sua maior perda está entre <strong>{maiorDrop.de}</strong> e <strong>{maiorDrop.para}</strong>:{" "}
                    <strong>{fmtPct(maiorDrop.drop, 0)}</strong>{" "}
                    {FRASES_GARGALO[maiorDrop.para] ?? "se perdem nessa transição"}.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 4. Evolução no período */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução no período</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {serie.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">Sem dados no período</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={serie}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="dia"
                      tickFormatter={(v) => format(parseISO(v), "dd/MM", { locale: ptBR })}
                      fontSize={11}
                    />
                    <YAxis yAxisId="qtd" fontSize={11} allowDecimals={false} />
                    <YAxis
                      yAxisId="valor"
                      orientation="right"
                      fontSize={11}
                      tickFormatter={(v) => fmtBRLCompacto(v)}
                    />
                    <RechartsTooltip
                      labelFormatter={(v) => format(parseISO(String(v)), "dd 'de' MMMM yyyy", { locale: ptBR })}
                      formatter={(value: number, name: string) =>
                        name === "Valor vendido" ? [fmtBRL(value), name] : [fmtN(value), name]
                      }
                    />
                    <Legend />
                    <Bar yAxisId="valor" dataKey="valor" name="Valor vendido" fill="hsl(var(--muted-foreground))" opacity={0.35} radius={[3, 3, 0, 0]} />
                    <Area yAxisId="qtd" type="monotone" dataKey="contatos" name="Contatos" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.12} strokeWidth={2} />
                    <Line yAxisId="qtd" type="monotone" dataKey="agendamentos" name="Agendamentos" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} />
                    <Line yAxisId="qtd" type="monotone" dataKey="vendas" name="Vendas" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* 5. Desempenho por loja */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Desempenho por loja</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Verde/vermelho: percentual acima/abaixo da média das lojas ({fmtPct(mediaComparecimento)} comparecimento · {fmtPct(mediaConvVisita)} conversão visita→venda).
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Loja" colKey="loja" sort={sort} onSort={onSort} />
                      <SortableHead label="Agendados" colKey="agendados" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="Compareceram" colKey="compareceram" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="% Comparec." colKey="pct_comparecimento" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="No-show" colKey="no_show" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="Sem registro" colKey="sem_registro" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="% Falta total" colKey="pct_falta_total" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="Vendas" colKey="vendas" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="% Visita→Venda" colKey="pct_conversao_visita" sort={sort} onSort={onSort} className="text-right" />
                      <SortableHead label="Valor" colKey="valor_vendas" sort={sort} onSort={onSort} className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lojasOrdenadas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-6">Sem dados no período</TableCell>
                      </TableRow>
                    )}
                    {lojasOrdenadas.map((r) => (
                      <TableRow key={r.loja}>
                        <TableCell className="text-xs font-medium">{r.loja}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(r.agendados)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(r.compareceram)}</TableCell>
                        <TableCell className={`text-right text-xs ${clsVsMedia(r.pct_comparecimento, mediaComparecimento)}`}>
                          {fmtPct(r.pct_comparecimento)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <Badge variant={Number(r.no_show) > 0 ? "destructive" : "outline"} className="text-[11px]">
                            {fmtN(r.no_show)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <Badge variant={Number(r.sem_registro ?? 0) > 0 ? "secondary" : "outline"} className="text-[11px]" title="Agendamentos com data já passada em que a loja não marcou nem comparecimento nem falta">
                            {fmtN(r.sem_registro ?? 0)}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right text-xs ${Number(r.pct_falta_total ?? 0) > 50 ? "text-red-600 font-medium" : ""}`}>
                          {r.pct_falta_total != null ? fmtPct(r.pct_falta_total) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtN(r.vendas)}</TableCell>
                        <TableCell className={`text-right text-xs ${clsVsMedia(r.pct_conversao_visita, mediaConvVisita)}`}>
                          {fmtPct(r.pct_conversao_visita)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">{fmtBRL(r.valor_vendas)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top lojas por valor vendido</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {topLojasValor.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">Sem dados no período</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topLojasValor} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis type="number" fontSize={11} tickFormatter={(v) => fmtBRLCompacto(v)} />
                      <YAxis type="category" dataKey="loja" width={130} fontSize={10} />
                      <RechartsTooltip formatter={(v: number) => [fmtBRL(v), "Valor vendido"]} />
                      <Bar dataKey="valor_vendas" name="Valor vendido" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 6. Por fonte de lead */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por fonte de lead</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fonte</TableHead>
                    <TableHead className="text-right">Contatos</TableHead>
                    <TableHead className="text-right">Qualificados</TableHead>
                    <TableHead className="text-right">Agendaram</TableHead>
                    <TableHead className="text-right">Venderam</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Conv. contato→venda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porFonte.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sem dados no período</TableCell>
                    </TableRow>
                  )}
                  {porFonte.map((f) => {
                    const conv = Number(f.contatos) > 0 ? (Number(f.venderam) / Number(f.contatos)) * 100 : 0;
                    const maxContatos = Math.max(...porFonte.map((x) => Number(x.contatos) || 0), 1);
                    return (
                      <TableRow key={f.fonte}>
                        <TableCell className="text-xs font-medium">
                          <div className="flex items-center gap-2">
                            <span className="w-20 shrink-0">{FONTE_LABELS[f.fonte] ?? f.fonte}</span>
                            <div className="hidden sm:block h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max((Number(f.contatos) / maxContatos) * 80, 2)}px` }} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtN(f.contatos)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(f.qualificados)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(f.agendaram)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(f.venderam)}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{fmtBRL(f.valor)}</TableCell>
                        <TableCell className={`text-right text-xs font-medium ${conv >= Number(k!.conv_geral_pct ?? 0) ? "text-emerald-600" : "text-muted-foreground"}`}>
                          {fmtPct(conv)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
