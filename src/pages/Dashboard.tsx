import { useContatos } from "@/hooks/useContatos";
import { useSolicitacoes } from "@/hooks/useSolicitacoes";
import { useAtendimentos } from "@/hooks/useAtendimentos";
import { useTarefas } from "@/hooks/useTarefas";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, AlertCircle, CheckCircle2, MessageSquare, ListTodo, Clock, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

export default function Dashboard() {
  const { data: contatos } = useContatos();
  const { data: solicitacoes } = useSolicitacoes();
  const { data: atendimentos } = useAtendimentos();
  const { data: tarefas } = useTarefas();

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

  // Chart data: Solicitações por status
  const statusCounts = [
    { name: "Aberta", value: solicitacoes?.filter((s: any) => s.status === "aberta").length ?? 0 },
    { name: "Classificada", value: solicitacoes?.filter((s: any) => s.status === "classificada").length ?? 0 },
    { name: "Atendimento", value: solicitacoes?.filter((s: any) => s.status === "em_atendimento").length ?? 0 },
    { name: "Execução", value: solicitacoes?.filter((s: any) => s.status === "aguardando_execucao").length ?? 0 },
    { name: "Concluída", value: solicitacoes?.filter((s: any) => s.status === "concluida").length ?? 0 },
    { name: "Cancelada", value: solicitacoes?.filter((s: any) => s.status === "cancelada").length ?? 0 },
  ].filter(d => d.value > 0);

  // Chart data: Solicitações por canal
  const canalCounts = [
    { name: "Sistema", value: solicitacoes?.filter((s: any) => s.canal_origem === "sistema").length ?? 0 },
    { name: "WhatsApp", value: solicitacoes?.filter((s: any) => s.canal_origem === "whatsapp").length ?? 0 },
    { name: "E-mail", value: solicitacoes?.filter((s: any) => s.canal_origem === "email").length ?? 0 },
    { name: "Telefone", value: solicitacoes?.filter((s: any) => s.canal_origem === "telefone").length ?? 0 },
  ].filter(d => d.value > 0);

  // Chart data: Tarefas por status
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Solicitações por Status */}
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

        {/* Volume por Canal */}
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

        {/* Tarefas por Status */}
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
