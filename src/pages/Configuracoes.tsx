import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Building2, GitBranch, Trash2, Bot, ShieldCheck, Loader2, MessageSquare, Store, Brain, Zap, Users, Timer } from "lucide-react";
import { KnowledgeBaseCard } from "@/components/configuracoes/KnowledgeBaseCard";
import { LearningCard } from "@/components/configuracoes/LearningCard";
import { TelefonesLojasCard } from "@/components/configuracoes/TelefonesLojasCard";
import { BotMenuCard } from "@/components/configuracoes/BotMenuCard";
import { BotFluxosCard } from "@/components/configuracoes/BotFluxosCard";
import { WhatsAppTemplatesCard } from "@/components/configuracoes/WhatsAppTemplatesCard";
import { AutomacoesCard } from "@/components/configuracoes/AutomacoesCard";
import { GestaoUsuariosCard } from "@/components/configuracoes/GestaoUsuariosCard";
import { CronJobsCard } from "@/components/configuracoes/CronJobsCard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Hooks ───

function useSetores() {
  return useQuery({
    queryKey: ["setores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("setores").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });
}

function useFilas(setorId?: string) {
  return useQuery({
    queryKey: ["filas", setorId],
    queryFn: async () => {
      let query = supabase.from("filas").select("*, setor:setores(id, nome)").order("nome");
      if (setorId) query = query.eq("setor_id", setorId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

function useConfigIA(chave: string) {
  return useQuery({
    queryKey: ["configuracoes_ia", chave],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes_ia" as any)
        .select("*")
        .eq("chave", chave)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
}

function useContatosHomologacao() {
  return useQuery({
    queryKey: ["contatos_homologacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contatos_homologacao" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

// ─── Main Component ───

export default function Configuracoes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "ia";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <>
      <PageHeader title="Configurações" description="Gerencie setores, filas, IA e integrações" />

      <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full grid grid-cols-7 mb-6">
          <TabsTrigger value="ia" className="flex items-center gap-1.5">
            <Brain className="h-4 w-4" /> IA
          </TabsTrigger>
          <TabsTrigger value="estrutura" className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> Estrutura
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="flex items-center gap-1.5">
            <Users className="h-4 w-4" /> Usuários
          </TabsTrigger>
          <TabsTrigger value="lojas" className="flex items-center gap-1.5">
            <Store className="h-4 w-4" /> Lojas
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4" /> WhatsApp
          </TabsTrigger>
          <TabsTrigger value="automacoes" className="flex items-center gap-1.5">
            <Zap className="h-4 w-4" /> Automações
          </TabsTrigger>
          <TabsTrigger value="crons" className="flex items-center gap-1.5">
            <Timer className="h-4 w-4" /> Crons
          </TabsTrigger>
        </TabsList>

        {/* ─── IA ─── */}
        <TabsContent value="ia">
          <div className="grid gap-6">
            <PromptIACard />
            <KnowledgeBaseCard />
            <LearningCard />
          </div>
        </TabsContent>

        {/* ─── Estrutura ─── */}
        <TabsContent value="estrutura">
          <div className="grid gap-6">
            <SetoresCard />
            <FilasCard />
          </div>
        </TabsContent>

        {/* ─── Usuários ─── */}
        <TabsContent value="usuarios">
          <div className="grid gap-6">
            <GestaoUsuariosCard />
          </div>
        </TabsContent>

        {/* ─── Lojas ─── */}
        <TabsContent value="lojas">
          <div className="grid gap-6">
            <TelefonesLojasCard />
            <BotFluxosCard />
            <BotMenuCard />
          </div>
        </TabsContent>

        {/* ─── WhatsApp ─── */}
        <TabsContent value="whatsapp">
          <div className="grid gap-6">
            <WhatsAppTemplatesCard />
            <HomologacaoCard />
            <WhatsAppIntegrationCard />
          </div>
        </TabsContent>

        {/* ─── Automações ─── */}
        <TabsContent value="automacoes">
          <div className="grid gap-6">
            <AutomacoesCard />
          </div>
        </TabsContent>

        {/* ─── Crons ─── */}
        <TabsContent value="crons">
          <div className="grid gap-6">
            <CronJobsCard />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

// ─── Prompt IA Card ───

function PromptIACard() {
  const { data: config, isLoading } = useConfigIA("prompt_atendimento");
  const [valor, setValor] = useState("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (config?.valor) setValor(config.valor);
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("configuracoes_ia" as any)
        .update({ valor } as any)
        .eq("chave", "prompt_atendimento");
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["configuracoes_ia", "prompt_atendimento"] });
      toast.success("Prompt salvo com sucesso");
    } catch (e: any) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Bot className="h-5 w-5" /> Prompt do Assistente IA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <>
            <Textarea
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="Cole aqui o prompt do assistente IA..."
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{valor.length} caracteres</span>
              <Button onClick={handleSave} disabled={saving || valor === config?.valor} size="sm">
                {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Salvando...</> : "Salvar Prompt"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Setores Card ───

function SetoresCard() {
  const [setorDialog, setSetorDialog] = useState(false);
  const queryClient = useQueryClient();
  const { data: setores } = useSetores();

  const createSetor = useMutation({
    mutationFn: async (setor: { nome: string; descricao?: string }) => {
      const { error } = await supabase.from("setores").insert(setor);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores"] });
      toast.success("Setor criado");
      setSetorDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSetorAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("setores").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setores"] }),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2"><Building2 className="h-5 w-5" /> Setores</CardTitle>
        <Dialog open={setorDialog} onOpenChange={setSetorDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Setor</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Setor</DialogTitle></DialogHeader>
            <CreateSetorForm onSubmit={(data) => createSetor.mutate(data)} loading={createSetor.isPending} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!setores?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum setor cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {setores.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{s.descricao || "—"}</TableCell>
                  <TableCell>
                    <Switch checked={s.ativo} onCheckedChange={(v) => toggleSetorAtivo.mutate({ id: s.id, ativo: v })} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Filas Card ───

function FilasCard() {
  const [filaDialog, setFilaDialog] = useState(false);
  const queryClient = useQueryClient();
  const { data: setores } = useSetores();
  const { data: filas } = useFilas();

  const createFila = useMutation({
    mutationFn: async (fila: { setor_id: string; nome: string; tipo: "atendimento" | "execucao"; descricao?: string; sla_minutos?: number }) => {
      const { error } = await supabase.from("filas").insert([fila]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filas"] });
      toast.success("Fila criada");
      setFilaDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleFilaAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("filas").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["filas"] }),
  });

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2"><GitBranch className="h-5 w-5" /> Filas</CardTitle>
        <Dialog open={filaDialog} onOpenChange={setFilaDialog}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Fila</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Fila</DialogTitle></DialogHeader>
            <CreateFilaForm setores={setores || []} onSubmit={(data) => createFila.mutate(data)} loading={createFila.isPending} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {!filas?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma fila cadastrada</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Ativo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((f: any) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{f.setor?.nome || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={f.tipo === "atendimento" ? "bg-info-soft text-info" : "bg-success-soft text-success"}>
                      {f.tipo === "atendimento" ? "Atendimento" : "Execução"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{f.sla_minutos ? `${f.sla_minutos} min` : "—"}</TableCell>
                  <TableCell>
                    <Switch checked={f.ativo} onCheckedChange={(v) => toggleFilaAtivo.mutate({ id: f.id, ativo: v })} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Modo Homologação Card ───

function HomologacaoCard() {
  const { data: config, isLoading: loadingConfig } = useConfigIA("modo_homologacao");
  const { data: telefones, isLoading: loadingTel } = useContatosHomologacao();
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const queryClient = useQueryClient();

  const isAtivo = config?.valor === "true";

  const toggleModo = async (ativo: boolean) => {
    const { error } = await supabase
      .from("configuracoes_ia" as any)
      .update({ valor: ativo ? "true" : "false" } as any)
      .eq("chave", "modo_homologacao");
    if (error) {
      toast.error("Erro ao atualizar: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["configuracoes_ia", "modo_homologacao"] });
    toast.success(ativo ? "Modo homologação ativado" : "Modo produção ativado — IA responde para todos");
  };

  const addTelefone = async () => {
    if (!novoTelefone.trim()) return;
    const { error } = await supabase
      .from("contatos_homologacao" as any)
      .insert({ telefone: novoTelefone.trim(), descricao: novaDescricao.trim() || null } as any);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["contatos_homologacao"] });
    setNovoTelefone("");
    setNovaDescricao("");
    toast.success("Telefone de teste adicionado");
  };

  const removeTelefone = async (id: string) => {
    const { error } = await supabase
      .from("contatos_homologacao" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["contatos_homologacao"] });
  };

  if (loadingConfig) return null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Modo Homologação
          </CardTitle>
          <div className="flex items-center gap-3">
            {isAtivo && (
              <Badge variant="outline" className="bg-warning-soft text-warning border-warning-muted">
                HOMOLOGAÇÃO ATIVA
              </Badge>
            )}
            {!isAtivo && (
              <Badge variant="outline" className="bg-success-soft text-success border-success">
                PRODUÇÃO
              </Badge>
            )}
            <Switch checked={isAtivo} onCheckedChange={toggleModo} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {isAtivo
            ? "A IA só responde automaticamente para os telefones listados abaixo. Demais contatos recebem mensagens normalmente mas sem resposta automática."
            : "A IA responde automaticamente para todos os contatos. Ative o modo homologação para testar com números específicos."}
        </p>

        {isAtivo && (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                  placeholder="5511999999999"
                  className="font-mono"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={novaDescricao}
                  onChange={(e) => setNovaDescricao(e.target.value)}
                  placeholder="Ex: Celular do Natan"
                />
              </div>
              <Button size="sm" onClick={addTelefone} disabled={!novoTelefone.trim()}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>

            {loadingTel ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : !telefones?.length ? (
              <p className="text-sm text-muted-foreground text-center py-2">Nenhum telefone de teste cadastrado</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {telefones.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-sm">{t.telefone}</TableCell>
                      <TableCell className="text-muted-foreground">{t.descricao || "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTelefone(t.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── WhatsApp Integration Card ───

function WhatsAppIntegrationCard() {
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">📱 Integração WhatsApp</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm font-medium">URL do Webhook</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input value={webhookUrl} readOnly className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); }}>
              Copiar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Forms ───

function CreateSetorForm({ onSubmit, loading }: { onSubmit: (data: { nome: string; descricao?: string }) => void; loading: boolean }) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ nome, descricao: descricao || undefined }); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome *</Label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex: Atendimento, Logística, Financeiro" />
      </div>
      <div className="space-y-2">
        <Label>Descrição</Label>
        <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !nome}>{loading ? "Criando..." : "Criar Setor"}</Button>
    </form>
  );
}

function CreateFilaForm({ setores, onSubmit, loading }: { setores: any[]; onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({ setor_id: "", nome: "", tipo: "atendimento", descricao: "", sla_minutos: "" });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, sla_minutos: form.sla_minutos ? parseInt(form.sla_minutos) : undefined, descricao: form.descricao || undefined }); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Setor *</Label>
        <Select value={form.setor_id} onValueChange={(v) => setForm({ ...form, setor_id: v })}>
          <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
          <SelectContent>
            {setores.map((s: any) => (
              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Nome *</Label>
        <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required placeholder="Ex: Fila Geral, Trocas" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="atendimento">Atendimento</SelectItem>
              <SelectItem value="execucao">Execução</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>SLA (minutos)</Label>
          <Input type="number" value={form.sla_minutos} onChange={(e) => setForm({ ...form, sla_minutos: e.target.value })} placeholder="Ex: 60" />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !form.setor_id || !form.nome}>{loading ? "Criando..." : "Criar Fila"}</Button>
    </form>
  );
}
