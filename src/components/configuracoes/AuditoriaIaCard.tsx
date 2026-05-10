import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Play, AlertTriangle, CheckCircle2, XCircle, Undo2, ShieldAlert, FileText, Wrench, Lightbulb, Layers, Sparkles, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Janela = "6h" | "24h" | "3d" | "7d";
const JANELA_HORAS: Record<Janela, number> = { "6h": 6, "24h": 24, "3d": 72, "7d": 168 };

const SEV_COLOR: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  warn: "bg-orange-500 text-white",
  info: "bg-blue-500 text-white",
  ok: "bg-emerald-500 text-white",
};

const SEV_LABEL: Record<string, string> = {
  critical: "Crítico", warn: "Atenção", info: "Aviso", ok: "Saudável",
};

const ACAO_ICON: Record<string, any> = {
  regra_proibida: ShieldAlert,
  exemplo: Lightbulb,
  ajuste_prompt: FileText,
  tarefa_ti: Wrench,
};

const ACAO_LABEL: Record<string, string> = {
  regra_proibida: "Regra proibida",
  exemplo: "Exemplo aprendido",
  ajuste_prompt: "Diretriz no prompt",
  tarefa_ti: "Tarefa para TI",
};

// Normaliza ações que vêm em formatos variados do LLM:
//   { tipo, texto/instrucao/... }              ← formato esperado
//   { ajuste_prompt: { categoria, descricao } }
//   { regra_proibida: "..." }
//   { exemplo: { pergunta, resposta_ideal } }
//   { tarefa_ti: { titulo, descricao } }
function normalizeAcao(ac: any): { tipo: string; texto: string; raw: any } {
  if (!ac || typeof ac !== "object") return { tipo: "ajuste_prompt", texto: String(ac ?? ""), raw: ac };
  if (ac.tipo) {
    return {
      tipo: ac.tipo,
      texto: ac.texto || ac.instrucao || ac.pergunta || ac.titulo || ac.descricao || "",
      raw: ac,
    };
  }
  for (const tipo of ["regra_proibida", "exemplo", "ajuste_prompt", "tarefa_ti"]) {
    if (ac[tipo] !== undefined) {
      const v = ac[tipo];
      let texto = "";
      if (typeof v === "string") texto = v;
      else if (v && typeof v === "object") {
        texto = v.descricao || v.instrucao || v.texto || v.titulo || v.pergunta || v.resposta_ideal || JSON.stringify(v);
      }
      return { tipo, texto, raw: ac };
    }
  }
  return { tipo: "ajuste_prompt", texto: ac.descricao || JSON.stringify(ac), raw: ac };
}

export function AuditoriaIaCard() {
  const [janela, setJanela] = useState<Janela>("24h");
  const [severidade, setSeveridade] = useState<string>("warn");
  const [amostra, setAmostra] = useState<number>(10);
  const [rodando, setRodando] = useState(false);
  const [runSelecionada, setRunSelecionada] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: runs } = useQuery({
    queryKey: ["ia_auditorias_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_auditorias_runs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    // Polling enquanto houver run rodando, para refletir progresso e conclusão sem F5
    refetchInterval: (q) => {
      const list = (q.state.data as any[] | undefined) || [];
      return list.some((r) => r.status === "rodando") ? 4000 : false;
    },
  });

  async function rodar() {
    setRodando(true);
    try {
      const fim = new Date();
      const inicio = new Date(fim.getTime() - JANELA_HORAS[janela] * 3600 * 1000);
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("audit-ia-rodar", {
        body: {
          janela_inicio: inicio.toISOString(),
          janela_fim: fim.toISOString(),
          severidade_minima: severidade,
          amostra_limpos_pct: amostra,
          iniciado_por: user?.id,
        },
      });
      if (error) throw error;
      toast.success("Auditoria iniciada — processando em segundo plano. Você verá os achados aparecerem na lista abaixo.");
      qc.invalidateQueries({ queryKey: ["ia_auditorias_runs"] });
      if (data?.run_id) setRunSelecionada(data.run_id);
    } catch (e: any) {
      toast.error(`Falhou: ${e.message}`);
    } finally {
      setRodando(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Auditoria IA Sob Demanda</CardTitle>
          <CardDescription>
            Revise conversas das últimas horas/dias. A IA detecta inconsistências, e quando você concorda, ela escolhe a melhor forma de corrigir (regra proibida, exemplo, ajuste de prompt ou tarefa para TI).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Janela</Label>
              <Select value={janela} onValueChange={(v) => setJanela(v as Janela)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="6h">Últimas 6 horas</SelectItem>
                  <SelectItem value="24h">Últimas 24 horas</SelectItem>
                  <SelectItem value="3d">Últimos 3 dias</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Severidade mínima</Label>
              <Select value={severidade} onValueChange={setSeveridade}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Aviso e acima</SelectItem>
                  <SelectItem value="warn">Atenção e acima</SelectItem>
                  <SelectItem value="critical">Apenas crítico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amostra de "limpos" via LLM: {amostra}%</Label>
              <Slider value={[amostra]} onValueChange={([v]) => setAmostra(v)} min={0} max={50} step={5} />
            </div>
          </div>

          <Button onClick={rodar} disabled={rodando} className="w-full md:w-auto">
            {rodando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            {rodando ? "Auditando..." : "Rodar auditoria"}
          </Button>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Últimas auditorias</h3>
            {runs?.length ? (
              <div className="space-y-2">
                {runs.map((r: any) => (
                  <button
                    key={r.id}
                    onClick={() => setRunSelecionada(r.id)}
                    className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">{new Date(r.janela_inicio).toLocaleString("pt-BR")}</span>
                        {" → "}
                        <span>{new Date(r.janela_fim).toLocaleString("pt-BR")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{r.total_atendimentos} conversas</Badge>
                        {r.total_flagged > 0 && (
                          <Badge className={SEV_COLOR.warn}>{r.total_flagged} achados</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })} · {r.status}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma auditoria executada ainda.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {runSelecionada && (
        <RunDetailSheet runId={runSelecionada} onClose={() => setRunSelecionada(null)} />
      )}
    </>
  );
}

// ─── Run Detail (drawer com lista de achados) ───
function RunDetailSheet({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [auditoriaSelecionada, setAuditoriaSelecionada] = useState<string | null>(null);
  const { data: auditorias, refetch } = useQuery({
    queryKey: ["ia_auditorias", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_auditorias" as any)
        .select("*")
        .eq("run_id", runId)
        .order("severidade", { ascending: false })
        .order("score_global", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Achados da auditoria</SheetTitle>
          <SheetDescription>
            Veja problemas consolidados (recomendado) ou drill-down por conversa.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="grupos" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="grupos"><Layers className="h-4 w-4 mr-2" />Problemas consolidados</TabsTrigger>
            <TabsTrigger value="conversas">Por conversa</TabsTrigger>
          </TabsList>

          <TabsContent value="grupos" className="mt-4">
            <GruposTab runId={runId} />
          </TabsContent>

          <TabsContent value="conversas" className="mt-4 space-y-2">
            {auditorias?.length ? auditorias.map((a: any) => (
              <button
                key={a.id}
                onClick={() => setAuditoriaSelecionada(a.id)}
                className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm truncate">
                    {a.contato_nome || a.contato_telefone || "Sem nome"}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={SEV_COLOR[a.severidade] || ""}>{SEV_LABEL[a.severidade] || a.severidade}</Badge>
                    {a.score_global !== null && (
                      <Badge variant="outline">{Number(a.score_global).toFixed(1)}/10</Badge>
                    )}
                    {a.status === "aplicado" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {a.status === "ignorado" && <XCircle className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {a.diagnostico && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.diagnostico}</p>
                )}
              </button>
            )) : (
              <p className="text-sm text-muted-foreground">Sem conversas avaliadas nesta auditoria.</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
      {auditoriaSelecionada && (
        <ConversaDialog
          auditoriaId={auditoriaSelecionada}
          onClose={() => { setAuditoriaSelecionada(null); refetch(); }}
        />
      )}
    </Sheet>
  );
}

// ─── Aba "Problemas consolidados" ───
function GruposTab({ runId }: { runId: string }) {
  const [consolidando, setConsolidando] = useState(false);
  const qc = useQueryClient();

  const { data: grupos, refetch } = useQuery({
    queryKey: ["ia_auditorias_grupos", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_auditorias_grupos" as any)
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  async function consolidar() {
    setConsolidando(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-ia-consolidar", {
        body: { run_id: runId },
      });
      if (error) throw error;
      const total = data?.total ?? 0;
      const motivo = data?.motivo;
      if (total === 0) {
        toast.warning(`Nenhum grupo gerado${motivo ? ` (${motivo})` : ""}. Tente novamente.`);
      } else {
        toast.success(`${total} problema(s) consolidado(s)`);
      }
      await qc.invalidateQueries({ queryKey: ["ia_auditorias_grupos", runId] });
      await refetch();
    } catch (e: any) {
      toast.error(`Falhou: ${e.message}`);
    } finally {
      setConsolidando(false);
    }
  }

  const pendentes = (grupos || []).filter((g) => g.status === "pendente");
  const finalizados = (grupos || []).filter((g) => g.status !== "pendente");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Achados agrupados por causa-raiz. Aplique a correção uma vez por problema (evita duplicidade).
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await qc.invalidateQueries({ queryKey: ["ia_auditorias_grupos", runId] });
              const r = await refetch();
              toast.success(`Atualizado: ${r.data?.length ?? 0} grupo(s)`);
            }}
            title="Forçar refetch dos grupos"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Atualizar grupos
          </Button>
          <Button size="sm" variant="outline" onClick={consolidar} disabled={consolidando}>
            {consolidando ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            {grupos?.length ? "Reconsolidar" : "Consolidar achados"}
          </Button>
        </div>
      </div>

      {!grupos?.length && !consolidando && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhum grupo ainda. Clique em "Consolidar achados" para a IA agrupar os problemas.
        </p>
      )}

      {pendentes.map((g) => (
        <GrupoCard key={g.id} grupo={g} onChanged={() => { refetch(); qc.invalidateQueries({ queryKey: ["ia_auditorias", runId] }); }} />
      ))}

      {finalizados.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer">
            {finalizados.length} grupo(s) já tratado(s)
          </summary>
          <div className="space-y-2 mt-2">
            {finalizados.map((g) => (
              <GrupoCard key={g.id} grupo={g} onChanged={refetch} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function GrupoCard({ grupo, onChanged }: { grupo: any; onChanged: () => void }) {
  const [aplicando, setAplicando] = useState(false);
  const [ignorarOpen, setIgnorarOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function aplicar() {
    setAplicando(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-ia-aplicar-grupo", {
        body: { grupo_id: grupo.id },
      });
      if (error) throw error;
      toast.success(`${data?.aplicadas?.length || 0} correção(ões) aplicada(s) — afeta ${data?.total_conversas || 0} conversa(s)`);
      onChanged();
    } catch (e: any) {
      toast.error(`Falhou: ${e.message}`);
    } finally {
      setAplicando(false);
    }
  }

  async function ignorar() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.functions.invoke("audit-ia-ignorar-grupo", {
        body: { grupo_id: grupo.id, motivo, user_id: user?.id },
      });
      if (error) throw error;
      toast.success("Grupo ignorado");
      setIgnorarOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const acoes = Array.isArray(grupo.acoes_propostas) ? grupo.acoes_propostas : [];

  return (
    <div className="p-3 rounded-md border space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={SEV_COLOR[grupo.severidade] || ""}>{SEV_LABEL[grupo.severidade] || grupo.severidade}</Badge>
            <Badge variant="outline">{(grupo.auditoria_ids || []).length} conversa(s)</Badge>
            {grupo.status === "aplicado" && <Badge className="bg-emerald-500 text-white">Aplicado</Badge>}
            {grupo.status === "ignorado" && <Badge variant="outline">Ignorado</Badge>}
          </div>
          <h4 className="font-medium text-sm mt-1">{grupo.titulo}</h4>
          {grupo.descricao && <p className="text-xs text-muted-foreground mt-1">{grupo.descricao}</p>}
        </div>
      </div>

      {acoes.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold text-muted-foreground">CORREÇÕES PROPOSTAS</p>
          {acoes.map((ac: any, i: number) => {
            const Icon = ACAO_ICON[ac.tipo] || FileText;
            return (
              <div key={i} className="flex items-start gap-2 text-xs bg-muted/40 rounded p-2">
                <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{ACAO_LABEL[ac.tipo] || ac.tipo}</div>
                  <div className="text-muted-foreground line-clamp-2">
                    {ac.texto || ac.instrucao || ac.pergunta || ac.titulo || ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {grupo.status === "pendente" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setIgnorarOpen(true)}>
            <XCircle className="h-3.5 w-3.5 mr-1" />Ignorar
          </Button>
          <Button size="sm" onClick={aplicar} disabled={aplicando}>
            {aplicando ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Aplicar correção
          </Button>
        </div>
      )}

      <Dialog open={ignorarOpen} onOpenChange={setIgnorarOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ignorar grupo</DialogTitle></DialogHeader>
          <Label>Motivo (opcional)</Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: comportamento intencional, contexto especial..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnorarOpen(false)}>Cancelar</Button>
            <Button onClick={ignorar}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Drill-down: 1 conversa, 2 botões ───
function ConversaDialog({ auditoriaId, onClose }: { auditoriaId: string; onClose: () => void }) {
  const [aplicando, setAplicando] = useState(false);
  const [ignorarDialog, setIgnorarDialog] = useState(false);
  const [motivo, setMotivo] = useState("");

  const { data: auditoria, refetch } = useQuery({
    queryKey: ["ia_auditoria", auditoriaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_auditorias" as any).select("*").eq("id", auditoriaId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: acoes, refetch: refetchAcoes } = useQuery({
    queryKey: ["ia_auditoria_acoes", auditoriaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ia_auditorias_acoes" as any).select("*").eq("auditoria_id", auditoriaId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  async function concordar() {
    setAplicando(true);
    try {
      const { data, error } = await supabase.functions.invoke("audit-ia-aplicar-correcao", {
        body: { auditoria_id: auditoriaId },
      });
      if (error) throw error;
      toast.success(`${data.aplicadas?.length || 0} correção(ões) aplicada(s)`);
      await refetch();
      await refetchAcoes();
    } catch (e: any) {
      toast.error(`Falhou: ${e.message}`);
    } finally {
      setAplicando(false);
    }
  }

  async function ignorar() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.functions.invoke("audit-ia-ignorar", {
        body: { auditoria_id: auditoriaId, motivo, user_id: user?.id },
      });
      if (error) throw error;
      toast.success("Marcado como não-problema");
      setIgnorarDialog(false);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function desfazer(acaoId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.functions.invoke("audit-ia-desfazer-acao", {
        body: { acao_id: acaoId, user_id: user?.id },
      });
      if (error) throw error;
      toast.success("Ação desfeita");
      refetchAcoes();
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!auditoria) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge className={SEV_COLOR[auditoria.severidade]}>{SEV_LABEL[auditoria.severidade]}</Badge>
            {auditoria.contato_nome || auditoria.contato_telefone}
          </DialogTitle>
        </DialogHeader>

        {auditoria.diagnostico && (
          <div className="bg-muted p-3 rounded-md">
            <p className="text-xs font-semibold text-muted-foreground mb-1">DIAGNÓSTICO</p>
            <p className="text-sm">{auditoria.diagnostico}</p>
          </div>
        )}

        {Array.isArray(auditoria.problemas) && auditoria.problemas.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">PROBLEMAS DETECTADOS</p>
            <ul className="space-y-1">
              {auditoria.problemas.map((p: any, i: number) => (
                <li key={i} className="text-sm flex gap-2">
                  <Badge variant="outline" className="shrink-0">{p.severidade || "-"}</Badge>
                  <span><strong>{p.tipo}:</strong> {p.motivo || p.trecho}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {auditoria.transcricao_resumo && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">Ver transcrição</summary>
            <pre className="mt-2 p-3 bg-muted rounded text-xs whitespace-pre-wrap max-h-80 overflow-y-auto">
              {auditoria.transcricao_resumo}
            </pre>
          </details>
        )}

        {acoes && acoes.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">CORREÇÕES APLICADAS</p>
            <div className="space-y-2">
              {acoes.map((ac: any) => {
                const Icon = ACAO_ICON[ac.tipo] || FileText;
                return (
                  <div key={ac.id} className={cn("p-3 rounded-md border flex items-start gap-2", ac.desfeita && "opacity-50")}>
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{ACAO_LABEL[ac.tipo] || ac.tipo}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {ac.payload?.texto || ac.payload?.instrucao || ac.payload?.pergunta || ac.payload?.titulo || ""}
                      </div>
                    </div>
                    {!ac.desfeita ? (
                      <Button size="sm" variant="ghost" onClick={() => desfazer(ac.id)}>
                        <Undo2 className="h-3 w-3 mr-1" />Desfazer
                      </Button>
                    ) : (
                      <Badge variant="outline" className="shrink-0">Desfeita</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {auditoria.status !== "aplicado" && auditoria.status !== "ignorado" && (
            <>
              <Button variant="outline" onClick={() => setIgnorarDialog(true)}>
                <XCircle className="h-4 w-4 mr-2" />Não é problema
              </Button>
              <Button onClick={concordar} disabled={aplicando}>
                {aplicando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Concordo, corrigir
              </Button>
            </>
          )}
          {auditoria.status === "aplicado" && (
            <Badge className="bg-emerald-500 text-white">Correção aplicada</Badge>
          )}
          {auditoria.status === "ignorado" && (
            <Badge variant="outline">Ignorado: {auditoria.ignorado_motivo || "sem motivo"}</Badge>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={ignorarDialog} onOpenChange={setIgnorarDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Marcar como não-problema</DialogTitle></DialogHeader>
          <Label>Motivo (opcional)</Label>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: cliente claramente entendeu, contexto especial..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnorarDialog(false)}>Cancelar</Button>
            <Button onClick={ignorar}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
