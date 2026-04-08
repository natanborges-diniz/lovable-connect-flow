import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, GitBranch, Trash2, Loader2, ChevronDown, ChevronUp, GripVertical, Pencil } from "lucide-react";
import { toast } from "sonner";
import { FluxoResponsaveisSection } from "./FluxoResponsaveisSection";

interface Etapa {
  campo: string;
  mensagem: string;
  tipo_input: string;
  validacao: Record<string, any>;
  obrigatorio: boolean;
}

interface AcaoFinal {
  tipo: string;
  tipo_solicitacao?: string;
  coluna_destino?: string;
  endpoint?: string;
  template_confirmacao?: string;
  fluxo_especial?: string;
}

interface Fluxo {
  id: string;
  chave: string;
  nome: string;
  tipo_bot: string;
  descricao: string | null;
  etapas: Etapa[];
  acao_final: AcaoFinal;
  ativo: boolean;
}

const TIPOS_BOT = [
  { value: "loja", label: "Loja" },
  { value: "colaborador", label: "Colaborador" },
  { value: "cliente_lab", label: "Cliente Lab" },
];

const TIPOS_INPUT = [
  { value: "texto", label: "Texto" },
  { value: "decimal", label: "Decimal (R$)" },
  { value: "inteiro", label: "Inteiro" },
  { value: "cpf", label: "CPF" },
  { value: "documento", label: "CPF/CNPJ" },
];

const TIPOS_ACAO = [
  { value: "criar_solicitacao", label: "Criar Solicitação" },
  { value: "chamar_endpoint", label: "Chamar Endpoint" },
  { value: "apenas_mensagem", label: "Apenas Mensagem" },
  { value: "fluxo_especial", label: "Fluxo Especial" },
];

function useFluxos() {
  return useQuery({
    queryKey: ["bot_fluxos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bot_fluxos")
        .select("*")
        .order("tipo_bot, nome");
      if (error) throw error;
      return (data || []) as Fluxo[];
    },
  });
}

export function BotFluxosCard() {
  const { data: fluxos, isLoading } = useFluxos();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFluxo, setEditingFluxo] = useState<Fluxo | null>(null);
  const [filterTipoBot, setFilterTipoBot] = useState<string>("all");
  const queryClient = useQueryClient();

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any).from("bot_fluxos").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot_fluxos"] }),
  });

  const deleteFluxo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("bot_fluxos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot_fluxos"] });
      toast.success("Fluxo removido");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const filtered = fluxos?.filter(f => filterTipoBot === "all" || f.tipo_bot === filterTipoBot) || [];

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <GitBranch className="h-5 w-5" /> Fluxos do Bot
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={filterTipoBot} onValueChange={setFilterTipoBot}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditingFluxo(null); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo Fluxo</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingFluxo ? "Editar Fluxo" : "Novo Fluxo"}</DialogTitle></DialogHeader>
              <FluxoForm
                initial={editingFluxo}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ["bot_fluxos"] });
                  setDialogOpen(false);
                  setEditingFluxo(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Configure os fluxos conversacionais do bot. Cada fluxo define as etapas que o bot percorre para coletar dados e executar uma ação.
        </p>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum fluxo cadastrado</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Chave</TableHead>
                <TableHead>Tipo Bot</TableHead>
                <TableHead>Etapas</TableHead>
                <TableHead>Ação Final</TableHead>
                <TableHead className="w-20">Ativo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-[10px]">{f.chave}</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{f.tipo_bot}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{f.etapas?.length || 0}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{f.acao_final?.tipo || "—"}</Badge></TableCell>
                  <TableCell>
                    <Switch checked={f.ativo} onCheckedChange={(v) => toggleAtivo.mutate({ id: f.id, ativo: v })} />
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingFluxo(f); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteFluxo.mutate(f.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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

// ─── Fluxo Form (Create/Edit) ───

function FluxoForm({ initial, onSuccess }: { initial: Fluxo | null; onSuccess: () => void }) {
  const [nome, setNome] = useState(initial?.nome || "");
  const [tipoBot, setTipoBot] = useState(initial?.tipo_bot || "loja");
  const [descricao, setDescricao] = useState(initial?.descricao || "");
  const [etapas, setEtapas] = useState<Etapa[]>(initial?.etapas || []);
  const [acaoFinal, setAcaoFinal] = useState<AcaoFinal>(initial?.acao_final || { tipo: "criar_solicitacao" });
  const [loading, setLoading] = useState(false);

  const chave = initial?.chave || nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const addEtapa = () => {
    setEtapas([...etapas, { campo: "", mensagem: "", tipo_input: "texto", validacao: {}, obrigatorio: true }]);
  };

  const updateEtapa = (index: number, patch: Partial<Etapa>) => {
    setEtapas(etapas.map((e, i) => i === index ? { ...e, ...patch } : e));
  };

  const removeEtapa = (index: number) => {
    setEtapas(etapas.filter((_, i) => i !== index));
  };

  const moveEtapa = (index: number, dir: -1 | 1) => {
    const newIdx = index + dir;
    if (newIdx < 0 || newIdx >= etapas.length) return;
    const newEtapas = [...etapas];
    [newEtapas[index], newEtapas[newIdx]] = [newEtapas[newIdx], newEtapas[index]];
    setEtapas(newEtapas);
  };

  const handleSubmit = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setLoading(true);
    try {
      const payload = { chave, nome, tipo_bot: tipoBot, descricao: descricao || null, etapas, acao_final: acaoFinal };
      if (initial) {
        const { error } = await (supabase as any).from("bot_fluxos").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast.success("Fluxo atualizado");
      } else {
        const { error } = await (supabase as any).from("bot_fluxos").insert(payload);
        if (error) throw error;
        toast.success("Fluxo criado");
      }
      onSuccess();
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Gerar Link de Pagamento" />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de Bot</Label>
          <Select value={tipoBot} onValueChange={setTipoBot}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS_BOT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {chave && !initial && (
        <p className="text-xs text-muted-foreground">Chave: <code className="bg-muted px-1 rounded">{chave}</code></p>
      )}

      <div className="space-y-1.5">
        <Label>Descrição</Label>
        <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Breve descrição do fluxo" />
      </div>

      {/* Steps builder */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Etapas ({etapas.length})</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEtapa}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Etapa
          </Button>
        </div>

        {etapas.map((et, i) => (
          <div key={i} className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                <GripVertical className="h-3 w-3" /> Etapa {i + 1}
              </span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveEtapa(i, -1)} disabled={i === 0}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveEtapa(i, 1)} disabled={i === etapas.length - 1}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeEtapa(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Campo</Label>
                <Input value={et.campo} onChange={(e) => updateEtapa(i, { campo: e.target.value })} placeholder="valor" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo Input</Label>
                <Select value={et.tipo_input} onValueChange={(v) => updateEtapa(i, { tipo_input: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_INPUT.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex items-end gap-2">
                <div className="flex items-center gap-1.5">
                  <Switch checked={et.obrigatorio} onCheckedChange={(v) => updateEtapa(i, { obrigatorio: v })} />
                  <Label className="text-xs">Obrigatório</Label>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mensagem do Bot</Label>
              <Textarea value={et.mensagem} onChange={(e) => updateEtapa(i, { mensagem: e.target.value })} rows={2} className="text-xs" placeholder="💳 Qual o *valor*? (ex: 150.00)" />
            </div>
          </div>
        ))}
      </div>

      {/* Final action */}
      <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
        <Label className="text-sm font-semibold">Ação Final</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={acaoFinal.tipo} onValueChange={(v) => setAcaoFinal({ ...acaoFinal, tipo: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_ACAO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {acaoFinal.tipo === "criar_solicitacao" && (
            <div className="space-y-1">
              <Label className="text-xs">Tipo Solicitação</Label>
              <Input value={acaoFinal.tipo_solicitacao || ""} onChange={(e) => setAcaoFinal({ ...acaoFinal, tipo_solicitacao: e.target.value })} className="h-8 text-xs" placeholder="link_pagamento" />
            </div>
          )}
        </div>
        {acaoFinal.tipo === "criar_solicitacao" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Coluna Destino</Label>
              <Input value={acaoFinal.coluna_destino || ""} onChange={(e) => setAcaoFinal({ ...acaoFinal, coluna_destino: e.target.value })} className="h-8 text-xs" placeholder="Link Enviado" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Endpoint (opcional)</Label>
              <Input value={acaoFinal.endpoint || ""} onChange={(e) => setAcaoFinal({ ...acaoFinal, endpoint: e.target.value })} className="h-8 text-xs" placeholder="payment-links" />
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Template de Confirmação</Label>
          <Textarea
            value={acaoFinal.template_confirmacao || ""}
            onChange={(e) => setAcaoFinal({ ...acaoFinal, template_confirmacao: e.target.value })}
            rows={3}
            className="text-xs font-mono"
            placeholder="✅ *Operação concluída!*&#10;Use {{campo}} para variáveis"
          />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={loading || !nome.trim()} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
        {initial ? "Salvar Alterações" : "Criar Fluxo"}
      </Button>
    </div>
  );
}
