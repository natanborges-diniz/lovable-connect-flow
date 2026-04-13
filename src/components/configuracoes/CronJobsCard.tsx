import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Timer, Plus, Pencil, Trash2, Play, Loader2, Clock } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const CRON_PRESETS = [
  { label: "A cada 1 minuto", value: "* * * * *" },
  { label: "A cada 5 minutos", value: "*/5 * * * *" },
  { label: "A cada 15 minutos", value: "*/15 * * * *" },
  { label: "A cada 30 minutos", value: "*/30 * * * *" },
  { label: "A cada 1 hora", value: "0 * * * *" },
  { label: "A cada 6 horas", value: "0 */6 * * *" },
  { label: "Diariamente às 8h", value: "0 8 * * *" },
  { label: "Diariamente à meia-noite", value: "0 0 * * *" },
  { label: "Personalizado", value: "custom" },
];

function useCronJobs() {
  return useQuery({
    queryKey: ["cron_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_jobs" as any)
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function CronJobsCard() {
  const { data: cronJobs, isLoading } = useCronJobs();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { data, error } = await supabase.functions.invoke("manage-cron-jobs", {
        body: { action: "toggle", id, ativo },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron_jobs"] });
      toast.success("Status atualizado");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("manage-cron-jobs", {
        body: { action: "delete", id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron_jobs"] });
      toast.success("Cron job removido");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const triggerNow = useMutation({
    mutationFn: async (funcao_alvo: string) => {
      const { data, error } = await supabase.functions.invoke(funcao_alvo, {
        body: { manual: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Função disparada manualmente");
      console.log("[CRON MANUAL]", data);
    },
    onError: (e) => toast.error("Erro ao disparar: " + e.message),
  });

  const openEdit = (job: any) => {
    setEditingJob(job);
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditingJob(null);
    setDialogOpen(true);
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Timer className="h-5 w-5" /> Agendamentos Automáticos (Crons)
        </CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Novo Cron
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando...</p>
        ) : !cronJobs?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum cron job configurado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Frequência</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Último Disparo</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cronJobs.map((job: any) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{job.nome}</p>
                      {job.descricao && (
                        <p className="text-xs text-muted-foreground">{job.descricao}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">
                      {job.expressao_cron}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {job.funcao_alvo}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {job.ultimo_disparo ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(job.ultimo_disparo), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={job.ativo}
                      onCheckedChange={(v) => toggleAtivo.mutate({ id: job.id, ativo: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Disparar agora"
                        onClick={() => triggerNow.mutate(job.funcao_alvo)}
                        disabled={triggerNow.isPending}
                      >
                        {triggerNow.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(job)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteJob.mutate(job.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CronJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingJob={editingJob}
      />
    </Card>
  );
}

function CronJobDialog({
  open,
  onOpenChange,
  editingJob,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingJob: any;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [expressaoCron, setExpressaoCron] = useState("*/5 * * * *");
  const [funcaoAlvo, setFuncaoAlvo] = useState("");
  const [payload, setPayload] = useState("{}");
  const [presetValue, setPresetValue] = useState("*/5 * * * *");
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens
  useState(() => {
    if (editingJob) {
      setNome(editingJob.nome || "");
      setDescricao(editingJob.descricao || "");
      setExpressaoCron(editingJob.expressao_cron || "*/5 * * * *");
      setFuncaoAlvo(editingJob.funcao_alvo || "");
      setPayload(JSON.stringify(editingJob.payload || {}, null, 2));
      const matchingPreset = CRON_PRESETS.find((p) => p.value === editingJob.expressao_cron);
      setPresetValue(matchingPreset ? matchingPreset.value : "custom");
    } else {
      setNome("");
      setDescricao("");
      setExpressaoCron("*/5 * * * *");
      setFuncaoAlvo("");
      setPayload("{}");
      setPresetValue("*/5 * * * *");
    }
  });

  const handlePresetChange = (value: string) => {
    setPresetValue(value);
    if (value !== "custom") {
      setExpressaoCron(value);
    }
  };

  const handleSave = async () => {
    if (!nome.trim() || !funcaoAlvo.trim()) {
      toast.error("Nome e função alvo são obrigatórios");
      return;
    }

    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      toast.error("Payload JSON inválido");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-cron-jobs", {
        body: {
          action: editingJob ? "update" : "create",
          id: editingJob?.id,
          nome: nome.trim(),
          descricao: descricao.trim() || null,
          expressao_cron: expressaoCron,
          funcao_alvo: funcaoAlvo.trim(),
          payload: parsedPayload,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      queryClient.invalidateQueries({ queryKey: ["cron_jobs"] });
      toast.success(editingJob ? "Cron atualizado" : "Cron criado");
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingJob ? "Editar Cron Job" : "Novo Cron Job"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Recuperação de Leads" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição opcional" />
          </div>
          <div className="space-y-1.5">
            <Label>Frequência</Label>
            <Select value={presetValue} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label} {p.value !== "custom" && <span className="text-muted-foreground ml-2 font-mono text-xs">({p.value})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {presetValue === "custom" && (
              <Input
                value={expressaoCron}
                onChange={(e) => setExpressaoCron(e.target.value)}
                placeholder="*/5 * * * *"
                className="font-mono mt-1.5"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Função Alvo (Edge Function)</Label>
            <Input value={funcaoAlvo} onChange={(e) => setFuncaoAlvo(e.target.value)} placeholder="ex: vendas-recuperacao-cron" />
          </div>
          <div className="space-y-1.5">
            <Label>Payload (JSON)</Label>
            <Textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              className="font-mono text-xs"
              rows={3}
              placeholder='{"key": "value"}'
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Salvando...</> : editingJob ? "Atualizar" : "Criar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
