import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type JobSaude = {
  jobname: string;
  fn: string;
  schedule: string;
  agendado: boolean;
  chave_literal: boolean;
  ultima_execucao: string | null;
  ultimo_status: string | null;
  ultimo_conserto: string | null;
};

export function CronsSaudeCard() {
  const [jobs, setJobs] = useState<JobSaude[]>([]);
  const [consertos, setConsertos] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.rpc("crons_saude" as never);
    if (error) toast.error(error.message);
    const payload = (data ?? {}) as { jobs?: JobSaude[]; consertos_24h?: number };
    setJobs(payload.jobs ?? []);
    setConsertos(payload.consertos_24h ?? 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="size-4 text-emerald-600" />
        <h3 className="font-semibold text-sm">Tarefas automáticas (autocorreção ativa)</h3>
        <Badge variant="secondary" className="ml-2">{consertos} conserto(s) em 24h</Badge>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left py-1">Tarefa</th>
            <th className="text-left">Frequência</th>
            <th className="text-left">Última execução</th>
            <th className="text-left">Status</th>
            <th className="text-left">Último conserto</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const saudavel = j.agendado && !j.chave_literal && j.ultimo_status !== "failed";
            return (
              <tr key={j.jobname} className="border-t">
                <td className="py-1 font-medium whitespace-nowrap">{j.jobname}</td>
                <td className="font-mono text-muted-foreground">{j.schedule}</td>
                <td>{j.ultima_execucao ? format(parseISO(j.ultima_execucao), "dd/MM HH:mm", { locale: ptBR }) : "—"}</td>
                <td>
                  <span className={`inline-block size-2 rounded-full mr-1 ${saudavel ? "bg-emerald-500" : "bg-red-500"}`} />
                  {!j.agendado ? "não agendado" : j.chave_literal ? "chave antiga" : (j.ultimo_status ?? "—")}
                </td>
                <td className="text-muted-foreground">
                  {j.ultimo_conserto ? format(parseISO(j.ultimo_conserto), "dd/MM HH:mm", { locale: ptBR }) : "—"}
                </td>
              </tr>
            );
          })}
          {jobs.length === 0 && !loading && (
            <tr><td colSpan={5} className="text-center text-muted-foreground py-4">Nenhuma tarefa registrada.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
