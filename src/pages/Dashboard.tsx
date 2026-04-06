import { useContatos } from "@/hooks/useContatos";
import { useSolicitacoes } from "@/hooks/useSolicitacoes";
import { useAtendimentos } from "@/hooks/useAtendimentos";
import { useTarefas } from "@/hooks/useTarefas";
import { usePipelineColunas } from "@/hooks/usePipelineColunas";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, AlertCircle, CheckCircle2, MessageSquare, ListTodo, TrendingUp, Filter } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const GRUPO_LABELS: Record<string, string> = {
  triagem: "Triagem",
  comercial: "Comercial",
  pos_venda: "Pós-Venda",
  sac: "SAC",
  outros: "Outros",
  terminal: "Terminal",
};

const GRUPO_ORDER = ["triagem", "comercial", "pos_venda", "sac", "outros", "terminal"];

const FUNNEL_COLORS: Record<string, string> = {
  triagem: "hsl(220, 70%, 50%)",
  comercial: "hsl(160, 60%, 45%)",
  pos_venda: "hsl(35, 90%, 55%)",
  sac: "hsl(0, 70%, 55%)",
  outros: "hsl(280, 60%, 55%)",
  terminal: "hsl(0, 0%, 50%)",
};

export default function Dashboard() {
  const { data: contatos } = useContatos();
  const { data: solicitacoes } = useSolicitacoes();
  const { data: atendimentos } = useAtendimentos();
  const { data: tarefas } = useTarefas();
  const { data: colunas } = usePipelineColunas();

  const [cicloFilter, setCicloFilter] = useState<"all" | 1 | 2>("all");

  const totalContatos = contatos?.length ?? 0;
  const totalSolicitacoes = solicitacoes?.length ?? 0;
  const abertas = solicitacoes?.filter((s: any) => ["aberta", "classificada", "em_atendimento", "reaberta"].includes(s.status)).length ?? 0;
  const concluidas = solicitacoes?.filter((s: any) => s.status === "concluida").length ?? 0;
  const atendimentosAtivos = atendimentos?.filter((a: any) => a.status !== "encerrado").length ?? 0;
  const tarefasPendentes = tarefas?.filter((t: any) => ["pendente", "em_andamento"].includes(t.status)).length ?? 0;

  const stats = [
    { label: "Contatos", value: totalContatos, icon: Users, color: "text-primary" },
    { label: "Solicitações", value: totalSolicitacoes, icon: FileText, color: "text-info" },
    { label: "Em Aberto", value: abertas, icon: AlertCircle, color: "text-warning" },
    { label: "Concluídas", value: concluidas, icon: CheckCircle2, color: "text-success" },
    { label: "Atendimentos Ativos", value: atendimentosAtivos, icon: MessageSquare, color: "text-info" },
    { label: "Tarefas Pendentes", value: tarefasPendentes, icon: ListTodo, color: "text-warning" },
  ];

  // Build funnel data from contatos + colunas
  const colunasMap = new Map<string, { grupo_funil: string | null; ordem: number; nome: string }>();
  colunas?.forEach((c: any) => colunasMap.set(c.id, { grupo_funil: c.grupo_funil, ordem: c.ordem, nome: c.nome }));

  const filteredContatos = contatos?.filter((c: any) => {
    if (cicloFilter === "all") return true;
    if (cicloFilter === 1) return (c.ciclo_funil || 1) === 1;
    return (c.ciclo_funil || 1) >= 2;
  }) ?? [];

  const funnelData = GRUPO_ORDER.map((grupo) => {
    const count = filteredContatos.filter((c: any) => {
      const col = colunasMap.get(c.pipeline_coluna_id);
      return col?.grupo_funil === grupo;
    }).length;
    return { grupo, label: GRUPO_LABELS[grupo] || grupo, value: count, fill: FUNNEL_COLORS[grupo] };
  }).filter(d => d.grupo !== "terminal" || d.value > 0);

  // Calculate conversion rates
  const conversionPairs = funnelData
    .filter(d => d.grupo !== "terminal")
    .map((d, i, arr) => {
      if (i === 0) return { ...d, conversion: null };
      const prev = arr[i - 1];
      const rate = prev.value > 0 ? ((d.value / prev.value) * 100).toFixed(1) : "0";
      return { ...d, conversion: `${rate}%` };
    });

  // Chart data: Solicitações por status
  const statusCounts = [
    { name: "Aberta", value: solicitacoes?.filter((s: any) => s.status === "aberta").length ?? 0 },
    { name: "Classificada", value: solicitacoes?.filter((s: any) => s.status === "classificada").length ?? 0 },
    { name: "Atendimento", value: solicitacoes?.filter((s: any) => s.status === "em_atendimento").length ?? 0 },
    { name: "Execução", value: solicitacoes?.filter((s: any) => s.status === "aguardando_execucao").length ?? 0 },
    { name: "Concluída", value: solicitacoes?.filter((s: any) => s.status === "concluida").length ?? 0 },
    { name: "Cancelada", value: solicitacoes?.filter((s: any) => s.status === "cancelada").length ?? 0 },
  ].filter(d => d.value > 0);

  const canalCounts = [
    { name: "Sistema", value: solicitacoes?.filter((s: any) => s.canal_origem === "sistema").length ?? 0 },
    { name: "WhatsApp", value: solicitacoes?.filter((s: any) => s.canal_origem === "whatsapp").length ?? 0 },
    { name: "E-mail", value: solicitacoes?.filter((s: any) => s.canal_origem === "email").length ?? 0 },
    { name: "Telefone", value: solicitacoes?.filter((s: any) => s.canal_origem === "telefone").length ?? 0 },
  ].filter(d => d.value > 0);

  const tarefaStatusCounts = [
    { name: "Pendente", value: tarefas?.filter((t: any) => t.status === "pendente").length ?? 0 },
    { name: "Em Andamento", value: tarefas?.filter((t: any) => t.status === "em_andamento").length ?? 0 },
    { name: "Concluída", value: tarefas?.filter((t: any) => t.status === "concluida").length ?? 0 },
    { name: "Cancelada", value: tarefas?.filter((t: any) => t.status === "cancelada").length ?? 0 },
  ].filter(d => d.value > 0);

  const CHART_COLORS = [
    "hsl(220, 70%, 50%)", "hsl(160, 60%, 45%)", "hsl(35, 90%, 55%)",
    "hsl(0, 70%, 55%)", "hsl(200, 70%, 50%)", "hsl(280, 60%, 55%)",
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral do sistema de operações" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel Chart */}
      <Card className="shadow-card mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Funil de Vendas
            </CardTitle>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={cicloFilter === "all" ? "default" : "outline"}
                onClick={() => setCicloFilter("all")}
                className="text-xs h-7"
              >
                Todos
              </Button>
              <Button
                size="sm"
                variant={cicloFilter === 1 ? "default" : "outline"}
                onClick={() => setCicloFilter(1)}
                className="text-xs h-7"
              >
                <Filter className="h-3 w-3 mr-1" /> Novos (Ciclo 1)
              </Button>
              <Button
                size="sm"
                variant={cicloFilter === 2 ? "default" : "outline"}
                onClick={() => setCicloFilter(2)}
                className="text-xs h-7"
              >
                <Filter className="h-3 w-3 mr-1" /> Retornos (Ciclo 2+)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {conversionPairs.map((d, i) => {
              const maxValue = Math.max(...conversionPairs.map(x => x.value), 1);
              const widthPct = Math.max((d.value / maxValue) * 100, 8);
              return (
                <div key={d.grupo} className="flex items-center gap-3">
                  <div className="w-24 text-xs font-medium text-muted-foreground text-right shrink-0">
                    {d.label}
                  </div>
                  <div className="flex-1 relative">
                    <div
                      className="h-8 rounded-md flex items-center px-3 text-xs font-bold text-white transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: d.fill, minWidth: "40px" }}
                    >
                      {d.value}
                    </div>
                  </div>
                  {d.conversion && (
                    <div className="w-14 text-xs text-muted-foreground shrink-0">
                      → {d.conversion}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {filteredContatos.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum contato neste filtro</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {statusCounts.length > 0 && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Solicitações por Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={statusCounts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="value" name="Qtd" fill="hsl(220, 70%, 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {canalCounts.length > 0 && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Volume por Canal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={canalCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {canalCounts.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {tarefaStatusCounts.length > 0 && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ListTodo className="h-4 w-4" /> Tarefas por Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={tarefaStatusCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {tarefaStatusCounts.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
