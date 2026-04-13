import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Store, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type PipelineDestino = "lojas" | "financeiro" | "ti";

interface TransferPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destino: PipelineDestino;
  contatoId: string;
  contatoNome: string;
  colunaDestinoId: string;
  colunaDestinoNome: string;
  onSuccess: () => void;
}

export function TransferPipelineDialog({
  open,
  onOpenChange,
  destino,
  contatoId,
  contatoNome,
  colunaDestinoId,
  colunaDestinoNome,
  onSuccess,
}: TransferPipelineDialogProps) {
  const [loading, setLoading] = useState(false);

  // Lojas fields
  const [lojaNome, setLojaNome] = useState("");
  const [lojaTelefone, setLojaTelefone] = useState("");
  const [dataAgendamento, setDataAgendamento] = useState<Date>();
  const [hora, setHora] = useState("10:00");
  const [observacoes, setObservacoes] = useState("");

  // Financeiro/TI fields
  const [assunto, setAssunto] = useState("");
  const [tipo, setTipo] = useState("");
  const [descricao, setDescricao] = useState("");

  const { data: lojas } = useQuery({
    queryKey: ["telefones_lojas_select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telefones_lojas")
        .select("nome_loja, telefone")
        .eq("tipo", "loja")
        .eq("ativo", true);
      if (error) throw error;
      // Deduplicate by nome_loja
      const map = new Map<string, { nome_loja: string; telefone: string }>();
      for (const l of data ?? []) {
        if (!map.has(l.nome_loja)) map.set(l.nome_loja, l);
      }
      return Array.from(map.values());
    },
    enabled: destino === "lojas" && open,
  });

  const handleLojaSelect = (nome: string) => {
    setLojaNome(nome);
    const loja = lojas?.find((l) => l.nome_loja === nome);
    if (loja) setLojaTelefone(loja.telefone);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (destino === "lojas") {
        if (!lojaNome || !dataAgendamento) {
          toast.error("Preencha a loja e a data do agendamento");
          setLoading(false);
          return;
        }
        const [h, m] = hora.split(":").map(Number);
        const dataHorario = new Date(dataAgendamento);
        dataHorario.setHours(h, m, 0, 0);

        const { error } = await supabase.functions.invoke("agendar-cliente", {
          body: {
            contato_id: contatoId,
            loja_nome: lojaNome,
            loja_telefone: lojaTelefone,
            data_horario: dataHorario.toISOString(),
            observacoes: observacoes || null,
          },
        });
        if (error) throw error;

        // Clear pipeline_coluna_id (exit CRM)
        await supabase
          .from("contatos")
          .update({ pipeline_coluna_id: null } as any)
          .eq("id", contatoId);

        toast.success(`Agendamento criado — ${contatoNome} transferido para Lojas`);
      } else {
        // Financeiro or TI
        if (!assunto) {
          toast.error("Preencha o assunto");
          setLoading(false);
          return;
        }

        const { error } = await supabase.from("solicitacoes").insert({
          contato_id: contatoId,
          assunto,
          tipo: tipo || null,
          descricao: descricao || null,
          pipeline_coluna_id: colunaDestinoId,
          canal_origem: "sistema",
        } as any);
        if (error) throw error;

        toast.success(`Solicitação criada — ${contatoNome} transferido para ${destino === "financeiro" ? "Financeiro" : "TI"}`);
      }

      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<PipelineDestino, string> = {
    lojas: "Transferir para Lojas",
    financeiro: "Transferir para Financeiro",
    ti: "Transferir para TI",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            {titles[destino]}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Movendo <strong>{contatoNome}</strong> para <strong>{colunaDestinoNome}</strong>
        </p>

        {destino === "lojas" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Loja *</Label>
              <Select value={lojaNome} onValueChange={handleLojaSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar loja" />
                </SelectTrigger>
                <SelectContent>
                  {(lojas ?? []).map((l) => (
                    <SelectItem key={l.nome_loja} value={l.nome_loja}>
                      {l.nome_loja}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Data *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dataAgendamento && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {dataAgendamento
                        ? format(dataAgendamento, "dd/MM/yyyy")
                        : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataAgendamento}
                      onSelect={setDataAgendamento}
                      disabled={(date) => date < new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Horário *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Observações opcionais..."
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assunto *</Label>
              <Input
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                placeholder="Descreva o assunto"
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {destino === "financeiro" ? (
                    <>
                      <SelectItem value="pagamento">Pagamento</SelectItem>
                      <SelectItem value="reembolso">Reembolso</SelectItem>
                      <SelectItem value="cobranca">Cobrança</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="impressoes">Impressões</SelectItem>
                      <SelectItem value="suporte">Suporte</SelectItem>
                      <SelectItem value="equipamento">Equipamento</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descrição adicional..."
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? "Transferindo..." : "Confirmar Transferência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
