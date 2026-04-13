import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";

type PipelineType = "crm" | "financeiro" | "agendamento";

interface CreateCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineType: PipelineType;
  firstColumnId?: string;
  setorId?: string;
}

export function CreateCardDialog({ open, onOpenChange, pipelineType, firstColumnId, setorId }: CreateCardDialogProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  // CRM fields
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipoContato, setTipoContato] = useState<string>("cliente");
  const [observacoes, setObservacoes] = useState("");

  // Financeiro fields
  const [assunto, setAssunto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipoSolicitacao, setTipoSolicitacao] = useState<string>("link_pagamento");
  const [prioridade, setPrioridade] = useState<string>("normal");
  const [contatoNome, setContatoNome] = useState("");
  const [contatoTelefone, setContatoTelefone] = useState("");

  // Agendamento fields
  const [lojaNome, setLojaNome] = useState("");
  const [dataHorario, setDataHorario] = useState("");

  const resetForm = () => {
    setNome(""); setTelefone(""); setTipoContato("cliente"); setObservacoes("");
    setAssunto(""); setDescricao(""); setTipoSolicitacao("link_pagamento"); setPrioridade("normal");
    setContatoNome(""); setContatoTelefone(""); setLojaNome(""); setDataHorario("");
  };

  const createNotification = async (titulo: string, mensagem: string, refId: string) => {
    await supabase.from("notificacoes").insert({
      titulo,
      mensagem,
      tipo: "solicitacao",
      referencia_id: refId,
      setor_id: setorId || null,
    });
  };

  const handleSubmitCRM = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.from("contatos").insert({
        nome: nome.trim(),
        telefone: telefone.trim() || null,
        tipo: tipoContato as any,
        pipeline_coluna_id: firstColumnId || null,
        metadata: observacoes ? { observacoes } : {},
      }).select().single();
      if (error) throw error;
      await createNotification(`Nova demanda manual: ${nome.trim()}`, observacoes || "Contato criado manualmente no pipeline", data.id);
      queryClient.invalidateQueries({ queryKey: ["contatos"] });
      toast.success("Contato criado no pipeline!");
      resetForm();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFinanceiro = async () => {
    if (!assunto.trim()) { toast.error("Assunto é obrigatório"); return; }
    if (!contatoNome.trim()) { toast.error("Nome do contato é obrigatório"); return; }
    setLoading(true);
    try {
      // Find or create contato
      let contatoId: string;
      if (contatoTelefone.trim()) {
        const { data: existing } = await supabase.from("contatos").select("id").eq("telefone", contatoTelefone.trim()).maybeSingle();
        if (existing) {
          contatoId = existing.id;
        } else {
          const { data: newC, error: cErr } = await supabase.from("contatos").insert({
            nome: contatoNome.trim(),
            telefone: contatoTelefone.trim(),
            tipo: "cliente",
          }).select().single();
          if (cErr) throw cErr;
          contatoId = newC.id;
        }
      } else {
        const { data: newC, error: cErr } = await supabase.from("contatos").insert({
          nome: contatoNome.trim(),
          tipo: "cliente",
        }).select().single();
        if (cErr) throw cErr;
        contatoId = newC.id;
      }

      const { data: sol, error } = await supabase.from("solicitacoes").insert({
        contato_id: contatoId,
        assunto: assunto.trim(),
        descricao: descricao.trim() || null,
        tipo: tipoSolicitacao,
        prioridade: prioridade as any,
        canal_origem: "sistema" as any,
        status: "aberta" as any,
        pipeline_coluna_id: firstColumnId || null,
      }).select().single();
      if (error) throw error;

      await createNotification(`Nova demanda financeira: ${assunto.trim()}`, descricao || "Solicitação criada manualmente", sol.id);
      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      queryClient.invalidateQueries({ queryKey: ["solicitacoes"] });
      toast.success("Solicitação criada no pipeline financeiro!");
      resetForm();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAgendamento = async () => {
    if (!contatoNome.trim()) { toast.error("Nome do contato é obrigatório"); return; }
    if (!lojaNome.trim()) { toast.error("Loja é obrigatória"); return; }
    if (!dataHorario) { toast.error("Data/Horário é obrigatório"); return; }
    setLoading(true);
    try {
      // Find or create contato
      let contatoId: string;
      if (contatoTelefone.trim()) {
        const { data: existing } = await supabase.from("contatos").select("id").eq("telefone", contatoTelefone.trim()).maybeSingle();
        if (existing) {
          contatoId = existing.id;
        } else {
          const { data: newC, error: cErr } = await supabase.from("contatos").insert({
            nome: contatoNome.trim(),
            telefone: contatoTelefone.trim(),
            tipo: "cliente",
          }).select().single();
          if (cErr) throw cErr;
          contatoId = newC.id;
        }
      } else {
        const { data: newC, error: cErr } = await supabase.from("contatos").insert({
          nome: contatoNome.trim(),
          tipo: "cliente",
        }).select().single();
        if (cErr) throw cErr;
        contatoId = newC.id;
      }

      const { data: ag, error } = await (supabase as any).from("agendamentos").insert({
        contato_id: contatoId,
        loja_nome: lojaNome.trim(),
        data_horario: new Date(dataHorario).toISOString(),
        status: "agendado",
        observacoes: observacoes.trim() || null,
      }).select().single();
      if (error) throw error;

      await createNotification(`Novo agendamento manual: ${contatoNome.trim()}`, `Loja: ${lojaNome} — ${new Date(dataHorario).toLocaleString("pt-BR")}`, ag.id);
      queryClient.invalidateQueries({ queryKey: ["agendamentos"] });
      toast.success("Agendamento criado!");
      resetForm();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (pipelineType === "crm") handleSubmitCRM();
    else if (pipelineType === "financeiro") handleSubmitFinanceiro();
    else handleSubmitAgendamento();
  };

  const titles: Record<PipelineType, string> = {
    crm: "Novo Contato no Pipeline",
    financeiro: "Nova Solicitação Financeira",
    agendamento: "Novo Agendamento",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {titles[pipelineType]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {pipelineType === "crm" && (
            <>
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do contato" />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(11) 99999-9999" />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={tipoContato} onValueChange={setTipoContato}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cliente">Cliente</SelectItem>
                    <SelectItem value="loja">Loja</SelectItem>
                    <SelectItem value="colaborador">Colaborador</SelectItem>
                    <SelectItem value="fornecedor">Fornecedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações opcionais..." rows={2} />
              </div>
            </>
          )}

          {pipelineType === "financeiro" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Nome do contato *</Label>
                  <Input value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} placeholder="Nome" />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={contatoTelefone} onChange={(e) => setContatoTelefone(e.target.value)} placeholder="Telefone" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Assunto *</Label>
                <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto da solicitação" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={tipoSolicitacao} onValueChange={setTipoSolicitacao}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link_pagamento">Link de Pagamento</SelectItem>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="consulta_cpf">Consulta CPF</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={prioridade} onValueChange={setPrioridade}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baixa">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="critica">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição opcional..." rows={2} />
              </div>
            </>
          )}

          {pipelineType === "agendamento" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Nome do contato *</Label>
                  <Input value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} placeholder="Nome" />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={contatoTelefone} onChange={(e) => setContatoTelefone(e.target.value)} placeholder="Telefone" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Loja *</Label>
                <Input value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} placeholder="Nome da loja" />
              </div>
              <div className="space-y-2">
                <Label>Data e Horário *</Label>
                <Input type="datetime-local" value={dataHorario} onChange={(e) => setDataHorario(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações opcionais..." rows={2} />
              </div>
            </>
          )}

          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Criar Demanda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
