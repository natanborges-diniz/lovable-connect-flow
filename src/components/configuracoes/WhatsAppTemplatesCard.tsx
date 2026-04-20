import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus, RefreshCw, Trash2, Loader2, MessageSquare, ChevronDown, Eye,
  Send, AlertCircle, CheckCircle2, Clock, XCircle, Wand2,
} from "lucide-react";

/**
 * Auto-corrige body para a regra Meta:
 * "variáveis não podem estar no início ou no fim do template"
 * - Se começa com {{N}} ou "Olá {{N}}," → injeta saudação fixa antes
 * - Se termina com {{N}} (com ou sem pontuação) → adiciona assinatura fixa
 */
function autoFixBody(body: string): { fixed: string; changed: boolean; notes: string[] } {
  let fixed = body.trim();
  const notes: string[] = [];

  // 1) INÍCIO — variável muito perto do começo
  // padrões: "{{1}} ..."  |  "Olá {{1}}, ..."  |  "Oi {{1}} ..."
  const startsWithVar = /^\{\{\d+\}\}/.test(fixed);
  const greetingThenVar = /^(Olá|Oi|Ola|Bom dia|Boa tarde|Boa noite)[,\s!]+\{\{\d+\}\}/i.test(fixed);

  if (startsWithVar) {
    fixed = `Olá! Tudo bem, ${fixed.replace(/^/, "")}`;
    notes.push("Adicionada saudação fixa antes da variável inicial.");
  } else if (greetingThenVar) {
    // "Olá {{1}}, ..." → "Olá! Aqui é das Óticas Diniz. {{1}}, ..."
    fixed = fixed.replace(
      /^(Olá|Oi|Ola|Bom dia|Boa tarde|Boa noite)[,\s!]+(\{\{\d+\}\})/i,
      "Olá! Aqui é das Óticas Diniz. $2"
    );
    notes.push("Saudação fixa inserida antes da variável de nome.");
  }

  // 2) FIM — variável no final (com ou sem pontuação)
  const endsWithVar = /\{\{\d+\}\}[\s.!?]*$/.test(fixed);
  if (endsWithVar) {
    fixed = fixed.replace(/[\s.!?]*$/, "");
    fixed += ". Estamos à disposição! Equipe Óticas Diniz.";
    notes.push("Adicionada assinatura fixa após a variável final.");
  }

  return { fixed, changed: fixed !== body, notes };
}
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CatalogoTemplate {
  id: string;
  nome: string;
  categoria: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  idioma: string;
  body: string;
  variaveis: string[];
  status: "rascunho" | "pending" | "approved" | "rejected";
  motivo_rejeicao: string | null;
  funcao_alvo: string | null;
  ultima_sincronizacao: string | null;
}

interface MetaTemplate {
  name: string;
  status: string;
  category: string;
  language: string;
  id: string;
  components?: any[];
  rejected_reason?: string;
}

const statusConfig = {
  approved: { label: "Aprovado", icon: CheckCircle2, className: "bg-success-soft text-success border-success/20" },
  pending: { label: "Em análise Meta", icon: Clock, className: "bg-warning-soft text-warning border-warning/20" },
  rejected: { label: "Reprovado", icon: XCircle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  rascunho: { label: "Rascunho", icon: AlertCircle, className: "bg-muted text-muted-foreground border-border" },
};

function StatusBadge({ status }: { status: CatalogoTemplate["status"] }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`${cfg.className} gap-1`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

function buildPreviewComponents(t: CatalogoTemplate) {
  return [{ type: "BODY", text: t.body }];
}

export function WhatsAppTemplatesCard() {
  const queryClient = useQueryClient();
  const [createDialog, setCreateDialog] = useState(false);
  const [editing, setEditing] = useState<CatalogoTemplate | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<string>("all");

  const { data: catalogo, isLoading } = useQuery({
    queryKey: ["whatsapp-templates-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .order("categoria", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data || []) as CatalogoTemplate[];
    },
  });

  const filtered = useMemo(() => {
    if (!catalogo) return [];
    if (filtroCategoria === "all") return catalogo;
    return catalogo.filter((t) => t.categoria === filtroCategoria);
  }, [catalogo, filtroCategoria]);

  const counters = useMemo(() => {
    const c = { total: 0, approved: 0, pending: 0, rejected: 0, rascunho: 0 };
    catalogo?.forEach((t) => {
      c.total++;
      c[t.status]++;
    });
    return c;
  }, [catalogo]);

  // ── Submeter à Meta ──
  const submitMutation = useMutation({
    mutationFn: async (t: CatalogoTemplate) => {
      const components = [{ type: "BODY", text: t.body }];
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: {
          action: "create",
          template_data: {
            name: t.nome,
            language: t.idioma,
            category: t.categoria,
            components,
          },
        },
      });
      if (error) throw error;
      await supabase
        .from("whatsapp_templates")
        .update({ status: "pending", ultima_sincronizacao: new Date().toISOString() })
        .eq("id", t.id);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates-catalogo"] });
      toast.success("Template enviado à Meta. Aguardando análise (1-24h).");
    },
    onError: (e: any) => toast.error("Erro ao submeter: " + e.message),
  });

  // ── Sincronizar status com Meta (upsert real via edge) ──
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-whatsapp-templates", {
        body: { action: "list", sync: true },
      });
      if (error) throw error;
      return (data?.synced as number) || 0;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates-catalogo"] });
      toast.success(`${n} template(s) sincronizado(s) com a Meta.`);
    },
    onError: (e: any) => toast.error("Erro na sincronização: " + e.message),
  });

  // ── Excluir (rascunho local apenas; aprovados também removem da Meta) ──
  const deleteMutation = useMutation({
    mutationFn: async (t: CatalogoTemplate) => {
      if (t.status !== "rascunho") {
        await supabase.functions.invoke("manage-whatsapp-templates", {
          body: { action: "delete", template_name: t.nome },
        });
      }
      const { error } = await supabase.from("whatsapp_templates").delete().eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates-catalogo"] });
      toast.success("Template removido");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  // ── Auto-corrigir template rejeitado ──
  const autoFixMutation = useMutation({
    mutationFn: async (t: CatalogoTemplate) => {
      const { fixed, changed, notes } = autoFixBody(t.body);
      if (!changed) {
        throw new Error("Não foi possível detectar problema automaticamente. Edite manualmente.");
      }
      const { error } = await supabase
        .from("whatsapp_templates")
        .update({
          body: fixed,
          status: "rascunho",
          motivo_rejeicao: null,
          ultima_sincronizacao: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (error) throw error;
      return notes;
    },
    onSuccess: (notes) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates-catalogo"] });
      toast.success("Template corrigido e salvo como rascunho", {
        description: notes.join(" "),
      });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="space-y-3">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Templates WhatsApp (Meta)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
              <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sincronizar com Meta
            </Button>
            <Dialog open={createDialog || !!editing} onOpenChange={(o) => { if (!o) { setCreateDialog(false); setEditing(null); } }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => setCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Novo Template
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editing ? "Editar Rascunho" : "Novo Template"}</DialogTitle>
                </DialogHeader>
                <TemplateForm
                  initial={editing}
                  onClose={() => {
                    setCreateDialog(false);
                    setEditing(null);
                    queryClient.invalidateQueries({ queryKey: ["whatsapp-templates-catalogo"] });
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Aviso operacional */}
        <div className="text-xs bg-warning-soft text-warning border border-warning/30 rounded-md p-2.5 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Disparos proativos só são enviados se o template estiver <strong>Aprovado pela Meta</strong>.
            Templates em rascunho ou pendentes bloqueiam o envio (registrado em Eventos do CRM).
          </span>
        </div>

        {/* Contadores + filtro */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Total: <strong>{counters.total}</strong></span>
          <span className="text-success">Aprovados: <strong>{counters.approved}</strong></span>
          <span className="text-warning">Pendentes: <strong>{counters.pending}</strong></span>
          <span className="text-destructive">Reprovados: <strong>{counters.rejected}</strong></span>
          <span className="text-muted-foreground">Rascunhos: <strong>{counters.rascunho}</strong></span>
          <div className="ml-auto">
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                <SelectItem value="UTILITY">Utility</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum template nesta categoria</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => (
              <Collapsible
                key={t.id}
                open={expanded === t.id}
                onOpenChange={(open) => setExpanded(open ? t.id : null)}
              >
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <ChevronDown className={`h-4 w-4 transition-transform ${expanded === t.id ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium truncate">{t.nome}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">{t.categoria}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{t.idioma}</span>
                        {t.funcao_alvo && (
                          <>
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-primary font-mono">{t.funcao_alvo}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={t.status} />
                    {t.status === "rascunho" && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7"
                        onClick={() => submitMutation.mutate(t)}
                        disabled={submitMutation.isPending}
                      >
                        <Send className="h-3.5 w-3.5 mr-1" /> Submeter
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        if (confirm(`Excluir template "${t.nome}"?`)) deleteMutation.mutate(t);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <CollapsibleContent className="pl-12 pr-3 pb-2 pt-1 space-y-2">
                  <div className="bg-muted/50 rounded-lg p-4 border border-border">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Eye className="h-3 w-3" /> Pré-visualização
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{t.body}</p>
                  </div>
                  {t.variaveis?.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      <strong>Variáveis:</strong>{" "}
                      {(Array.isArray(t.variaveis) ? t.variaveis : []).map((v, i) => (
                        <span key={i} className="font-mono bg-muted px-1.5 py-0.5 rounded mx-0.5">
                          {`{{${i + 1}}} ${v}`}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.status === "rejected" && (
                    <div className="space-y-2">
                      <div className="text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded p-2 space-y-1">
                        <p><strong>Motivo da reprovação:</strong> {t.motivo_rejeicao || "Não informado pela Meta"}</p>
                        {/^(Olá|Oi)[,\s!]+\{\{\d+\}\}/i.test(t.body) || /^\{\{\d+\}\}/.test(t.body) ? (
                          <p className="text-[11px] opacity-80">⚠️ Detectado: variável <code className="font-mono">{`{{1}}`}</code> muito próxima do <strong>início</strong> — Meta não permite.</p>
                        ) : null}
                        {/\{\{\d+\}\}[\s.!?]*$/.test(t.body) ? (
                          <p className="text-[11px] opacity-80">⚠️ Detectado: variável no <strong>fim</strong> do template — Meta não permite.</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => autoFixMutation.mutate(t)}
                          disabled={autoFixMutation.isPending}
                          className="gap-1.5"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                          Auto-corrigir e salvar como rascunho
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                          Editar manualmente
                        </Button>
                      </div>
                    </div>
                  )}
                  {t.status === "rascunho" && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                      Editar rascunho
                    </Button>
                  )}
                  {t.ultima_sincronizacao && (
                    <p className="text-[10px] text-muted-foreground">
                      Última sync: {new Date(t.ultima_sincronizacao).toLocaleString("pt-BR")}
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateForm({ initial, onClose }: { initial: CatalogoTemplate | null; onClose: () => void }) {
  const [nome, setNome] = useState(initial?.nome || "");
  const [categoria, setCategoria] = useState<CatalogoTemplate["categoria"]>(initial?.categoria || "UTILITY");
  const [body, setBody] = useState(initial?.body || "");
  const [variaveisStr, setVariaveisStr] = useState(
    initial?.variaveis ? (initial.variaveis as string[]).join(", ") : ""
  );
  const [funcaoAlvo, setFuncaoAlvo] = useState(initial?.funcao_alvo || "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const cleanNome = nome.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const variaveis = variaveisStr.split(",").map((s) => s.trim()).filter(Boolean);

      const payload = {
        nome: cleanNome,
        categoria,
        idioma: "pt_BR",
        body,
        variaveis,
        funcao_alvo: funcaoAlvo || null,
        status: "rascunho" as const,
      };

      if (initial) {
        const { error } = await supabase
          .from("whatsapp_templates")
          .update(payload)
          .eq("id", initial.id);
        if (error) throw error;
        toast.success("Rascunho atualizado");
      } else {
        const { error } = await supabase.from("whatsapp_templates").insert(payload);
        if (error) throw error;
        toast.success("Rascunho criado. Clique em Submeter para enviar à Meta.");
      }
      onClose();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome do Template *</Label>
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: confirmacao_agendamento"
          required
          disabled={!!initial}
        />
        <p className="text-xs text-muted-foreground">Apenas minúsculas, números e underscores. Não pode ser alterado depois.</p>
      </div>
      <div className="space-y-2">
        <Label>Categoria</Label>
        <Select value={categoria} onValueChange={(v) => setCategoria(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="UTILITY">Utility (transacional)</SelectItem>
            <SelectItem value="MARKETING">Marketing (proativo)</SelectItem>
            <SelectItem value="AUTHENTICATION">Authentication (OTP)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Corpo da Mensagem *</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          required
          placeholder="Use {{1}}, {{2}}, {{3}} para variáveis dinâmicas"
        />
      </div>
      <div className="space-y-2">
        <Label>Descrição das variáveis (separadas por vírgula)</Label>
        <Input
          value={variaveisStr}
          onChange={(e) => setVariaveisStr(e.target.value)}
          placeholder="nome_cliente, loja, data, hora"
        />
        <p className="text-xs text-muted-foreground">Documentação interna do que cada {`{{N}}`} representa.</p>
      </div>
      <div className="space-y-2">
        <Label>Função alvo (qual edge function consome)</Label>
        <Input
          value={funcaoAlvo}
          onChange={(e) => setFuncaoAlvo(e.target.value)}
          placeholder="agendamentos-cron, vendas-recuperacao-cron..."
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" /> Pré-visualização
        </Label>
        <div className="bg-muted/50 rounded-lg p-4 border border-border">
          <p className="text-sm whitespace-pre-wrap">{body || "Corpo da mensagem..."}</p>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading || !nome || !body}>
        {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Salvando...</> : (initial ? "Salvar Rascunho" : "Criar Rascunho")}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Após criar, clique em <strong>Submeter</strong> na lista para enviar à Meta para aprovação.
      </p>
    </form>
  );
}
