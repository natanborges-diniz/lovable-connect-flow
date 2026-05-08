import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Trash2, MessageSquare, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Agendamento } from "@/hooks/useAgendamentos";
import { Link } from "react-router-dom";

const STATUS_OPTIONS = [
  "agendado", "lembrete_enviado", "confirmado", "atendido",
  "orcamento", "venda_fechada", "no_show", "recuperacao",
  "reagendado", "abandonado", "cancelado",
];

interface Props {
  agendamento: Agendamento | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgendamentoDialog({ agendamento, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [lojaNome, setLojaNome] = useState("");
  const [dataHorario, setDataHorario] = useState("");
  const [status, setStatus] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [valorOrcamento, setValorOrcamento] = useState("");
  const [valorVenda, setValorVenda] = useState("");
  const [numeroVenda, setNumeroVenda] = useState("");

  const origemCrm = (agendamento?.metadata as any)?.origem_crm as
    | { atendimento_id: string | null; coluna_origem_nome: string | null; transferido_at: string }
    | undefined;
  const atendimentoId = origemCrm?.atendimento_id || agendamento?.atendimento_id || null;

  const { data: mensagens } = useQuery({
    queryKey: ["agendamento-mensagens", atendimentoId],
    enabled: !!atendimentoId && open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("mensagens")
        .select("id, conteudo, direcao, remetente_nome, created_at, tipo_conteudo")
        .eq("atendimento_id", atendimentoId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (!agendamento) return;
    setLojaNome(agendamento.loja_nome);
    setDataHorario(agendamento.data_horario.slice(0, 16));
    setStatus(agendamento.status);
    setObservacoes(agendamento.observacoes || "");
    setValorOrcamento(agendamento.valor_orcamento?.toString() || "");
    setValorVenda(agendamento.valor_venda?.toString() || "");
    setNumeroVenda(agendamento.numero_venda || "");
    setConfirmDelete(false);
  }, [agendamento?.id, open]);

  if (!agendamento) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{agendamento.contato?.nome || "Cliente"} — {agendamento.loja_nome}</span>
            {origemCrm && (
              <Badge variant="secondary" className="text-[10px]">
                Veio do CRM{origemCrm.coluna_origem_nome ? ` · ${origemCrm.coluna_origem_nome}` : ""}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="dados" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="conversa" disabled={!atendimentoId}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Conversa
              {mensagens && mensagens.length > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">({mensagens.length})</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dados">
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Loja</Label>
                  <Input value={lojaNome} onChange={(e) => setLojaNome(e.target.value)} />
                </div>
                <div>
                  <Label>Data / Hora</Label>
                  <Input type="datetime-local" value={dataHorario} onChange={(e) => setDataHorario(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Observações</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Orçamento (R$)</Label>
                  <Input type="number" step="0.01" value={valorOrcamento} onChange={(e) => setValorOrcamento(e.target.value)} />
                </div>
                <div>
                  <Label>Venda (R$)</Label>
                  <Input type="number" step="0.01" value={valorVenda} onChange={(e) => setValorVenda(e.target.value)} />
                </div>
                <div>
                  <Label>Nº Venda</Label>
                  <Input value={numeroVenda} onChange={(e) => setNumeroVenda(e.target.value)} />
                </div>
              </div>

              <div className="text-xs text-muted-foreground border-t pt-2">
                <span className="font-medium">Contato:</span> {agendamento.contato?.telefone || "—"} &nbsp;|&nbsp;
                <span className="font-medium">Lembrete:</span> {agendamento.lembrete_enviado ? "✅" : "❌"} &nbsp;|&nbsp;
                <span className="font-medium">Confirmação:</span> {agendamento.confirmacao_enviada ? "✅" : "❌"} &nbsp;|&nbsp;
                <span className="font-medium">No-show:</span> {agendamento.noshow_enviado ? "✅" : "❌"}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="conversa">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Histórico do atendimento de origem
              </span>
              {atendimentoId && (
                <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                  <Link to={`/atendimentos?id=${atendimentoId}`}>
                    Abrir conversa completa <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              )}
            </div>
            <ScrollArea className="h-[400px] border rounded-md p-3 bg-muted/20">
              {!mensagens || mensagens.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">
                  Nenhuma mensagem encontrada.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {mensagens.map((m: any) => (
                    <div
                      key={m.id}
                      className={`flex flex-col gap-0.5 ${m.direcao === "inbound" ? "items-start" : "items-end"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          m.direcao === "inbound"
                            ? "bg-background border"
                            : "bg-primary text-primary-foreground"
                        }`}
                      >
                        {m.tipo_conteudo === "image" ? (
                          <span className="italic opacity-70">[imagem]</span>
                        ) : (
                          <span className="whitespace-pre-wrap break-words">{m.conteudo}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {m.remetente_nome ? `${m.remetente_nome} · ` : ""}
                        {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {!confirmDelete ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" disabled={deleting} onClick={async () => {
                  setDeleting(true);
                  const { error } = await (supabase as any).from("agendamentos").delete().eq("id", agendamento.id);
                  setDeleting(false);
                  if (error) { toast.error("Erro ao excluir"); return; }
                  toast.success("Agendamento excluído");
                  queryClient.invalidateQueries({ queryKey: ["agendamentos"] });
                  onOpenChange(false);
                }}>
                  Confirmar exclusão
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
              </div>
            )}
          </div>

          <Button disabled={saving} onClick={async () => {
            setSaving(true);
            const updates: any = {
              loja_nome: lojaNome,
              data_horario: new Date(dataHorario).toISOString(),
              status,
              observacoes: observacoes || null,
              valor_orcamento: valorOrcamento ? parseFloat(valorOrcamento) : null,
              valor_venda: valorVenda ? parseFloat(valorVenda) : null,
              numero_venda: numeroVenda || null,
            };

            const statusAnterior = agendamento.status;
            const { error } = await (supabase as any).from("agendamentos").update(updates).eq("id", agendamento.id);
            setSaving(false);

            if (error) { toast.error("Erro ao salvar"); return; }
            toast.success("Agendamento atualizado");
            queryClient.invalidateQueries({ queryKey: ["agendamentos"] });

            if (status !== statusAnterior) {
              supabase.functions.invoke("pipeline-automations", {
                body: {
                  entity_type: "agendamento",
                  entity_id: agendamento.id,
                  status_novo: status,
                  status_anterior: statusAnterior,
                },
              });
            }

            onOpenChange(false);
          }}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
