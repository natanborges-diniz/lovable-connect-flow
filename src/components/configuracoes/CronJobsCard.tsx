import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Timer, Plus, Pencil, Trash2, Play, Loader2, Clock,
  ChevronDown, ListOrdered, Settings2, Save, Info,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ═══════════════════════════════════════════
// Dicionário de detalhes por função-alvo
// ═══════════════════════════════════════════

interface CronParam {
  key: string;
  label: string;
  type: "number" | "text";
  defaultValue: number | string;
  unit?: string;
  min?: number;
  max?: number;
}

interface CronDetail {
  resumo: string;
  fluxo: { icon: string; descricao: string }[];
  parametros: CronParam[];
}

const CRON_DETAILS: Record<string, CronDetail> = {
  "agendamentos-cron": {
    resumo: "Gerencia o ciclo de vida dos agendamentos nas lojas — envia lembretes, cobra confirmação e detecta no-shows automaticamente.",
    fluxo: [
      { icon: "📅", descricao: "Detecta agendamentos para hoje/amanhã e envia o 1º lembrete ao cliente" },
      { icon: "🔁", descricao: "Se o cliente não respondeu após X horas, envia 2ª tentativa de lembrete" },
      { icon: "🏪", descricao: "Após o horário do agendamento, cobra a loja perguntando se o cliente compareceu" },
      { icon: "⏰", descricao: "Se a loja não respondeu após X horas, envia 2ª cobrança" },
      { icon: "⚠️", descricao: "Se a loja não respondeu após X horas da 2ª cobrança, marca como no-show e cria tarefa manual" },
      { icon: "🌅", descricao: "Cobranças fora do horário comercial são reagendadas para a manhã seguinte" },
      { icon: "❌", descricao: "Leads sem resposta após X horas em recuperação são marcados como abandonados" },
    ],
    parametros: [
      { key: "horas_reenvio_lembrete", label: "Horas para 2ª tentativa de lembrete", type: "number", defaultValue: 4, unit: "h", min: 1, max: 24 },
      { key: "horas_segunda_cobranca_loja", label: "Horas para 2ª cobrança à loja", type: "number", defaultValue: 3, unit: "h", min: 1, max: 12 },
      { key: "horas_timeout_loja", label: "Timeout da loja (assume no-show)", type: "number", defaultValue: 6, unit: "h", min: 2, max: 24 },
      { key: "horas_abandono", label: "Horas para marcar como abandonado", type: "number", defaultValue: 48, unit: "h", min: 12, max: 168 },
      { key: "max_tentativas_recuperacao", label: "Máx. tentativas de recuperação", type: "number", defaultValue: 2, unit: "x", min: 1, max: 5 },
      { key: "horas_segunda_recuperacao", label: "Horas para 2ª recuperação", type: "number", defaultValue: 24, unit: "h", min: 6, max: 72 },
    ],
  },
  "vendas-recuperacao-cron": {
    resumo: "Recupera leads inativos no pipeline de vendas — a IA envia mensagens contextuais e, após tentativas esgotadas, move para Perdidos.",
    fluxo: [
      { icon: "🔍", descricao: "Detecta contatos em colunas elegíveis sem resposta há tempo suficiente" },
      { icon: "💬", descricao: "1ª tentativa: IA gera mensagem contextual baseada no histórico do atendimento" },
      { icon: "🔄", descricao: "2ª tentativa: nova mensagem de recuperação após intervalo configurável" },
      { icon: "👋", descricao: "3ª tentativa: mensagem de despedida oferecendo última chance" },
      { icon: "📉", descricao: "Após espera final sem resposta, move o contato para Perdidos e encerra atendimento" },
    ],
    parametros: [
      { key: "delay_primeira_tentativa", label: "Delay para 1ª tentativa", type: "number", defaultValue: 48, unit: "h", min: 12, max: 168 },
      { key: "delay_segunda_tentativa", label: "Delay para 2ª tentativa", type: "number", defaultValue: 72, unit: "h", min: 12, max: 168 },
      { key: "delay_terceira_tentativa", label: "Delay para 3ª tentativa", type: "number", defaultValue: 72, unit: "h", min: 12, max: 168 },
      { key: "espera_final", label: "Espera final antes de mover para Perdidos", type: "number", defaultValue: 72, unit: "h", min: 12, max: 168 },
      { key: "max_tentativas", label: "Máx. tentativas de recuperação", type: "number", defaultValue: 3, unit: "x", min: 1, max: 5 },
      { key: "colunas_elegiveis", label: "Colunas elegíveis (separadas por vírgula)", type: "text", defaultValue: "Novo Contato,Lead,Orçamento,Qualificado,Retorno" },
      { key: "inatividade_default", label: "Threshold inatividade padrão", type: "number", defaultValue: 48, unit: "h", min: 12, max: 168 },
    ],
  },
};

// ═══════════════════════════════════════════
// Presets de cron
// ═══════════════════════════════════════════

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

// ═══════════════════════════════════════════
// Card principal
// ═══════════════════════════════════════════

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

  const knownJobs = cronJobs?.filter((j: any) => CRON_DETAILS[j.funcao_alvo]) || [];
  const unknownJobs = cronJobs?.filter((j: any) => !CRON_DETAILS[j.funcao_alvo]) || [];

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Timer className="h-5 w-5" /> Agendamentos Automáticos (Crons)
        </CardTitle>
        <Button size="sm" onClick={() => { setEditingJob(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Cron
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando...</p>
        ) : !cronJobs?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum cron job configurado</p>
        ) : (
          <>
            {knownJobs.map((job: any) => (
              <CronJobDetailCard
                key={job.id}
                job={job}
                detail={CRON_DETAILS[job.funcao_alvo]}
                onToggle={(ativo) => toggleAtivo.mutate({ id: job.id, ativo })}
                onTrigger={() => triggerNow.mutate(job.funcao_alvo)}
                onEdit={() => { setEditingJob(job); setDialogOpen(true); }}
                onDelete={() => deleteJob.mutate(job.id)}
                triggerPending={triggerNow.isPending}
              />
            ))}
            {unknownJobs.map((job: any) => (
              <CronJobSimpleCard
                key={job.id}
                job={job}
                onToggle={(ativo) => toggleAtivo.mutate({ id: job.id, ativo })}
                onTrigger={() => triggerNow.mutate(job.funcao_alvo)}
                onEdit={() => { setEditingJob(job); setDialogOpen(true); }}
                onDelete={() => deleteJob.mutate(job.id)}
                triggerPending={triggerNow.isPending}
              />
            ))}
          </>
        )}
      </CardContent>

      <CronJobDialog open={dialogOpen} onOpenChange={setDialogOpen} editingJob={editingJob} />
    </Card>
  );
}

// ═══════════════════════════════════════════
// Card detalhado (com fluxo + parâmetros)
// ═══════════════════════════════════════════

function CronJobDetailCard({
  job, detail, onToggle, onTrigger, onEdit, onDelete, triggerPending,
}: {
  job: any;
  detail: CronDetail;
  onToggle: (v: boolean) => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDelete: () => void;
  triggerPending: boolean;
}) {
  const queryClient = useQueryClient();
  const [params, setParams] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial: Record<string, any> = {};
    for (const p of detail.parametros) {
      initial[p.key] = job.payload?.[p.key] ?? p.defaultValue;
    }
    setParams(initial);
  }, [job.payload, detail.parametros]);

  const handleParamChange = (key: string, value: string, type: string) => {
    setParams((prev) => ({
      ...prev,
      [key]: type === "number" ? (value === "" ? "" : Number(value)) : value,
    }));
  };

  const handleSaveParams = async () => {
    setSaving(true);
    try {
      const mergedPayload = { ...job.payload, ...params };
      const { data, error } = await supabase.functions.invoke("manage-cron-jobs", {
        body: { action: "update", id: job.id, payload: mergedPayload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ["cron_jobs"] });
      toast.success("Parâmetros salvos");
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const presetLabel = CRON_PRESETS.find((p) => p.value === job.expressao_cron)?.label;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm">{job.nome}</h4>
            <Badge variant={job.ativo ? "default" : "secondary"} className="text-xs">
              {job.ativo ? "Ativo" : "Inativo"}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">
              {presetLabel || job.expressao_cron}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{detail.resumo}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch checked={job.ativo} onCheckedChange={onToggle} />
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Disparar agora" onClick={onTrigger} disabled={triggerPending}>
            {triggerPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Último disparo */}
      {job.ultimo_disparo && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Último disparo: {formatDistanceToNow(new Date(job.ultimo_disparo), { addSuffix: true, locale: ptBR })}
        </p>
      )}

      {/* Fluxo expandível */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-8">
            <span className="flex items-center gap-1.5"><ListOrdered className="h-3.5 w-3.5" /> Ver fluxo completo</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-muted ml-2">
            {detail.fluxo.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-5 text-center">{step.icon}</span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">Passo {i + 1}:</span> {step.descricao}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Parâmetros configuráveis */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-8">
            <span className="flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" /> Configurar parâmetros</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-3 bg-muted/30 rounded-md p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> Alterações serão usadas na próxima execução do cron.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {detail.parametros.map((p) => (
                <div key={p.key} className="space-y-1">
                  <Label className="text-xs">{p.label} {p.unit && <span className="text-muted-foreground">({p.unit})</span>}</Label>
                  <Input
                    type={p.type === "number" ? "number" : "text"}
                    value={params[p.key] ?? ""}
                    onChange={(e) => handleParamChange(p.key, e.target.value, p.type)}
                    min={p.min}
                    max={p.max}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
            <Button size="sm" onClick={handleSaveParams} disabled={saving} className="w-full sm:w-auto">
              {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Salvando...</> : <><Save className="h-3.5 w-3.5 mr-1" /> Salvar parâmetros</>}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ═══════════════════════════════════════════
// Card simples (crons desconhecidos)
// ═══════════════════════════════════════════

function CronJobSimpleCard({
  job, onToggle, onTrigger, onEdit, onDelete, triggerPending,
}: {
  job: any;
  onToggle: (v: boolean) => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDelete: () => void;
  triggerPending: boolean;
}) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm">{job.nome}</h4>
            <Badge variant={job.ativo ? "default" : "secondary"} className="text-xs">
              {job.ativo ? "Ativo" : "Inativo"}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">{job.expressao_cron}</Badge>
            <Badge variant="secondary" className="text-xs">{job.funcao_alvo}</Badge>
          </div>
          {job.descricao && <p className="text-xs text-muted-foreground mt-1">{job.descricao}</p>}
          {job.ultimo_disparo && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(job.ultimo_disparo), { addSuffix: true, locale: ptBR })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch checked={job.ativo} onCheckedChange={onToggle} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onTrigger} disabled={triggerPending}>
            {triggerPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Dialog criar/editar
// ═══════════════════════════════════════════

function CronJobDialog({ open, onOpenChange, editingJob }: { open: boolean; onOpenChange: (open: boolean) => void; editingJob: any }) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [expressaoCron, setExpressaoCron] = useState("*/5 * * * *");
  const [funcaoAlvo, setFuncaoAlvo] = useState("");
  const [payload, setPayload] = useState("{}");
  const [presetValue, setPresetValue] = useState("*/5 * * * *");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingJob) {
        setNome(editingJob.nome || "");
        setDescricao(editingJob.descricao || "");
        setExpressaoCron(editingJob.expressao_cron || "*/5 * * * *");
        setFuncaoAlvo(editingJob.funcao_alvo || "");
        setPayload(JSON.stringify(editingJob.payload || {}, null, 2));
        const match = CRON_PRESETS.find((p) => p.value === editingJob.expressao_cron);
        setPresetValue(match ? match.value : "custom");
      } else {
        setNome(""); setDescricao(""); setExpressaoCron("*/5 * * * *");
        setFuncaoAlvo(""); setPayload("{}"); setPresetValue("*/5 * * * *");
      }
    }
  }, [open, editingJob]);

  const handlePresetChange = (value: string) => {
    setPresetValue(value);
    if (value !== "custom") setExpressaoCron(value);
  };

  const handleSave = async () => {
    if (!nome.trim() || !funcaoAlvo.trim()) { toast.error("Nome e função alvo são obrigatórios"); return; }
    let parsedPayload = {};
    try { parsedPayload = JSON.parse(payload); } catch { toast.error("Payload JSON inválido"); return; }

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
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label} {p.value !== "custom" && <span className="text-muted-foreground ml-2 font-mono text-xs">({p.value})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {presetValue === "custom" && (
              <Input value={expressaoCron} onChange={(e) => setExpressaoCron(e.target.value)} placeholder="*/5 * * * *" className="font-mono mt-1.5" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Função Alvo (Edge Function)</Label>
            <Input value={funcaoAlvo} onChange={(e) => setFuncaoAlvo(e.target.value)} placeholder="ex: vendas-recuperacao-cron" />
          </div>
          <div className="space-y-1.5">
            <Label>Payload (JSON)</Label>
            <Textarea value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono text-xs" rows={3} placeholder='{"key": "value"}' />
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
