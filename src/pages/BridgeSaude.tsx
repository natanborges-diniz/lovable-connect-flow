import { useEffect, useMemo, useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, Play } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

type Fonte = "armacao_codetapa15" | "ingestao_entregas" | "ingestao_aniv" | "reconciliacao_vendas";

const FONTES: { id: Fonte; label: string; fn: string; bodyForDate: (d: string) => Record<string, unknown> }[] = [
  { id: "armacao_codetapa15",   label: "Régua armação (OS etapa 15)", fn: "regua-disparo-aguardando-armacao", bodyForDate: (d) => ({ datas: [d] }) },
  { id: "ingestao_entregas",    label: "Ingestão — entregas",          fn: "regua-ingestao",                  bodyForDate: (d) => ({ data: d }) },
  { id: "ingestao_aniv",        label: "Ingestão — aniversariantes",   fn: "regua-ingestao",                  bodyForDate: (d) => ({ data: d }) },
  { id: "reconciliacao_vendas", label: "Reconciliação cashback D+1",   fn: "regua-reconciliacao",             bodyForDate: () => ({}) },
];

type LogRow = {
  fonte: Fonte;
  data_alvo: string;
  status: "ok" | "vazio" | "bridge_down" | "parcial";
  linhas_recebidas: number;
  erro_msg: string | null;
  executado_at: string;
};

const STATUS_COLOR: Record<LogRow["status"], string> = {
  ok:           "bg-emerald-500",
  vazio:        "bg-slate-300",
  parcial:      "bg-amber-500",
  bridge_down:  "bg-red-500",
};

export default function BridgeSaude() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const days = useMemo(() => {
    const arr: string[] = [];
    for (let i = 29; i >= 0; i--) arr.push(format(subDays(new Date(), i), "yyyy-MM-dd"));
    return arr;
  }, []);

  async function load() {
    setLoading(true);
    const desde = days[0];
    const { data, error } = await supabase
      .from("bridge_sync_log")
      .select("fonte, data_alvo, status, linhas_recebidas, erro_msg, executado_at")
      .gte("data_alvo", desde)
      .order("executado_at", { ascending: false });
    if (error) toast.error(error.message);
    setLogs((data ?? []) as LogRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // mapa: fonte|data → último log
  const cells = useMemo(() => {
    const m = new Map<string, LogRow>();
    for (const r of logs) {
      const k = `${r.fonte}|${r.data_alvo}`;
      if (!m.has(k)) m.set(k, r);
    }
    return m;
  }, [logs]);

  async function reprocessar(fonte: Fonte, dataAlvo: string) {
    const f = FONTES.find((x) => x.id === fonte)!;
    const key = `${fonte}|${dataAlvo}`;
    setRunning(key);
    try {
      const { data, error } = await supabase.functions.invoke(f.fn, { body: f.bodyForDate(dataAlvo) });
      if (error) throw error;
      toast.success(`${f.label} — ${dataAlvo} reprocessado`, { description: JSON.stringify(data).slice(0, 200) });
      await load();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Saúde da bridge Firebird"
        description="Auditoria diária das integrações que dependem da firebird-bridge. Verde = sincronizado, vermelho = bridge fora, cinza = sem dados, âmbar = parcial."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        }
      />

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-2 pr-3 sticky left-0 bg-card">Fonte</th>
              {days.map((d) => (
                <th key={d} className="px-1 text-center font-normal text-muted-foreground" title={d}>
                  {format(parseISO(d), "dd/MM", { locale: ptBR })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FONTES.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="py-2 pr-3 font-medium sticky left-0 bg-card whitespace-nowrap">{f.label}</td>
                {days.map((d) => {
                  const row = cells.get(`${f.id}|${d}`);
                  const color = row ? STATUS_COLOR[row.status] : "bg-muted";
                  const key = `${f.id}|${d}`;
                  const isRunning = running === key;
                  const tip = row
                    ? `${row.status} · ${row.linhas_recebidas} linhas${row.erro_msg ? ` · ${row.erro_msg}` : ""}`
                    : "sem execução";
                  return (
                    <td key={d} className="text-center align-middle p-0.5">
                      <button
                        title={tip}
                        disabled={isRunning}
                        onClick={() => reprocessar(f.id, d)}
                        className={`size-5 rounded-sm ${color} hover:ring-2 ring-offset-1 ring-primary transition`}
                      >
                        {isRunning ? <Loader2 className="size-3 animate-spin text-white mx-auto" /> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-emerald-500" /> Sincronizado (ok)</div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-slate-300" /> Vazio (consultou, sem dados)</div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-amber-500" /> Parcial (com erros)</div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-red-500" /> Bridge fora</div>
          <div className="flex items-center gap-2"><span className="size-3 rounded-sm bg-muted" /> Sem execução</div>
          <Badge variant="secondary" className="ml-auto">
            <Play className="size-3 mr-1" /> Clique numa célula para reprocessar manualmente
          </Badge>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2 text-sm">Últimas execuções</h3>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Quando</th>
              <th className="text-left">Fonte</th>
              <th className="text-left">Data alvo</th>
              <th className="text-left">Status</th>
              <th className="text-right">Linhas</th>
              <th className="text-left">Erro</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 30).map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{format(parseISO(r.executado_at), "dd/MM HH:mm", { locale: ptBR })}</td>
                <td>{FONTES.find((f) => f.id === r.fonte)?.label ?? r.fonte}</td>
                <td>{r.data_alvo}</td>
                <td>
                  <span className={`inline-block size-2 rounded-full ${STATUS_COLOR[r.status]} mr-1`} />
                  {r.status}
                </td>
                <td className="text-right">{r.linhas_recebidas}</td>
                <td className="text-red-600">{r.erro_msg ?? ""}</td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-4">Nenhuma execução registrada nos últimos 30 dias.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
