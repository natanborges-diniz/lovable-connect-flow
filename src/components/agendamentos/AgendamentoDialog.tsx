import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { Agendamento } from "@/hooks/useAgendamentos";

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

  // Sync state when agendamento changes
  const resetForm = () => {
    if (!agendamento) return;
    setLojaNome(agendamento.loja_nome);
    setDataHorario(agendamento.data_horario.slice(0, 16)); // for datetime-local
    setStatus(agendamento.status);
    setObservacoes(agendamento.observacoes || "");
    setValorOrcamento(agendamento.valor_orcamento?.toString() || "");
    setValorVenda(agendamento.valor_venda?.toString() || "");
    setNumeroVenda(agendamento.numero_venda || "");
    setConfirmDelete(false);
  };

  if (!agendamento) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (v) resetForm(); }}>
      <DialogContent className="max-w-lg" onOpenAutoFocus={() => resetForm()}>
        <DialogHeader>
          <DialogTitle>
            {agendamento.contato?.nome || "Cliente"} — {agendamento.loja_nome}
          </DialogTitle>
        </DialogHeader>

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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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

          {/* Automation log preview */}
          <div className="text-xs text-muted-foreground border-t pt-2">
            <span className="font-medium">Contato:</span> {agendamento.contato?.telefone || "—"} &nbsp;|&nbsp;
            <span className="font-medium">Lembrete:</span> {agendamento.lembrete_enviado ? "✅" : "❌"} &nbsp;|&nbsp;
            <span className="font-medium">Confirmação:</span> {agendamento.confirmacao_enviada ? "✅" : "❌"} &nbsp;|&nbsp;
            <span className="font-medium">No-show:</span> {agendamento.noshow_enviado ? "✅" : "❌"}
          </div>
        </div>

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

            // If status changed, trigger automations
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
