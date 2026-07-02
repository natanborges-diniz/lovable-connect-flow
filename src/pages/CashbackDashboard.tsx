import { useMemo, useState } from "react";
import { useCashbackDashboard } from "@/hooks/useCashbackDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { format, subDays } from "date-fns";

const fmtBRL = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtN = (n: number) => (n ?? 0).toLocaleString("pt-BR");

const PRESETS = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

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

export default function CashbackDashboard() {
  const [days, setDays] = useState(30);
  const { de, ate } = useMemo(() => ({
    de: format(subDays(new Date(), days), "yyyy-MM-dd"),
    ate: format(new Date(), "yyyy-MM-dd"),
  }), [days]);

  const { data, isLoading, error, refetch } = useCashbackDashboard(de, ate);
  const k = data?.kpis;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cashback — Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Eficiência do programa: geração, ativação, resgate e conversão.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PRESETS.map((p) => (
            <Button key={p.days} size="sm" variant={days === p.days ? "default" : "outline"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => refetch()}>Atualizar</Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Erro: {(error as any).message}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {k && (
        <>
          {/* Linha 1 — Funil de inscrição */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Inscrições no período</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi title="Vendas inscritas" value={fmtN(k.vendas_inscritas)} hint={fmtBRL(k.valor_lancado) + " lançados"} />
              <Kpi title="PIN confirmado" value={fmtN(k.pin_confirmados)} hint={`${k.taxa_confirmacao_pin}% de confirmação`} tone="ok" />
              <Kpi title="PIN expirado" value={fmtN(k.pin_expirados)} tone="warn" />
              <Kpi title="Match com sistema" value={fmtN(k.match)} hint={`${k.divergente} divergentes · ${k.sem_venda} sem venda`} tone="ok" />
            </div>
          </div>

          {/* Linha 2 — Créditos */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Créditos</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi title="Gerado no período" value={fmtBRL(k.creditos_gerados_valor)} />
              <Kpi title="Saldo ativo (hoje)" value={fmtBRL(k.creditos_ativos_saldo)} hint={`${fmtN(k.creditos_ativos_qtd)} clientes`} tone="ok" />
              <Kpi title="A vencer em 30 dias" value={fmtBRL(k.a_vencer_30d_valor)} hint={`${fmtN(k.a_vencer_30d_qtd)} créditos`} tone="warn" />
              <Kpi title="Vencidos no período" value={fmtBRL(k.creditos_vencidos_valor)} tone="bad" />
            </div>
          </div>

          {/* Linha 3 — Resgate e conversão */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Resgate e conversão</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi title="Resgates" value={fmtN(k.resgates_qtd)} hint={fmtBRL(k.resgates_valor) + " utilizados"} tone="ok" />
              <Kpi title="Ticket médio de resgate" value={fmtBRL(k.ticket_medio_resgate)} />
              <Kpi title="Taxa de conversão" value={`${k.conversao_pct}%`} hint="clientes que resgataram / com crédito" tone="ok" />
              <Kpi title="Retorno do programa" value={k.creditos_gerados_valor > 0
                ? `${((k.resgates_valor / k.creditos_gerados_valor) * 100).toFixed(1)}%`
                : "—"} hint="resgatado / gerado" tone="muted" />
            </div>
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cashback gerado x resgatado (semanal)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.serie_semanal}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="semana" tickFormatter={(v) => format(new Date(v), "dd/MM")} fontSize={11} />
                  <YAxis tickFormatter={(v) => `R$ ${v}`} fontSize={11} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} labelFormatter={(v) => format(new Date(v), "dd/MM/yyyy")} />
                  <Legend />
                  <Line type="monotone" dataKey="gerado" name="Gerado" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <Line type="monotone" dataKey="resgatado" name="Resgatado" stroke="hsl(142 71% 45%)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Por loja */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Desempenho por loja</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loja</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Valor lançado</TableHead>
                    <TableHead className="text-center">Match</TableHead>
                    <TableHead className="text-center">Divergente</TableHead>
                    <TableHead className="text-center">Sem venda</TableHead>
                    <TableHead className="text-right">Gerado</TableHead>
                    <TableHead className="text-right">Resgatado</TableHead>
                    <TableHead className="text-right">Conversão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.por_loja.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Sem dados no período</TableCell></TableRow>
                  )}
                  {data.por_loja.map((r) => {
                    const conv = r.cashback_gerado > 0 ? (r.cashback_resgatado / r.cashback_gerado) * 100 : 0;
                    return (
                      <TableRow key={r.cod_empresa ?? "sem-loja"}>
                        <TableCell className="font-mono text-xs">{r.cod_empresa ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{fmtN(r.vendas)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(Number(r.valor_lancado))}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="text-emerald-600">{r.match}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant={r.divergente > 0 ? "destructive" : "outline"}>{r.divergente}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline">{r.sem_venda}</Badge></TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(Number(r.cashback_gerado))}</TableCell>
                        <TableCell className="text-right text-xs">{fmtBRL(Number(r.cashback_resgatado))}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{conv.toFixed(1)}%</TableCell>
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
