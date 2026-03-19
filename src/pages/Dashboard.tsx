import { useContatos } from "@/hooks/useContatos";
import { useSolicitacoes } from "@/hooks/useSolicitacoes";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Dashboard() {
  const { data: contatos } = useContatos();
  const { data: solicitacoes } = useSolicitacoes();

  const totalContatos = contatos?.length ?? 0;
  const totalSolicitacoes = solicitacoes?.length ?? 0;
  const abertas = solicitacoes?.filter((s) => ["aberta", "classificada", "em_atendimento", "reaberta"].includes(s.status)).length ?? 0;
  const concluidas = solicitacoes?.filter((s) => s.status === "concluida").length ?? 0;

  const stats = [
    { label: "Contatos", value: totalContatos, icon: Users, color: "text-primary" },
    { label: "Solicitações", value: totalSolicitacoes, icon: FileText, color: "text-info" },
    { label: "Em Aberto", value: abertas, icon: AlertCircle, color: "text-warning" },
    { label: "Concluídas", value: concluidas, icon: CheckCircle2, color: "text-success" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral do sistema de operações" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
    </>
  );
}
