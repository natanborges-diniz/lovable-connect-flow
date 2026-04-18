import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pin, Send, Loader2, Check, ArrowRight, X, Store } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Demanda {
  id: string;
  numero_curto: number;
  protocolo: string;
  loja_nome: string;
  loja_telefone: string;
  pergunta: string;
  status: string;
  vista_pelo_operador: boolean;
  ultima_mensagem_loja_at: string | null;
  created_at: string;
}

interface DemandaMsg {
  id: string;
  demanda_id: string;
  direcao: string;
  autor_nome: string | null;
  conteudo: string;
  anexo_url: string | null;
  anexo_mime: string | null;
  encaminhada_ao_cliente: boolean;
  created_at: string;
}

export function DemandaLojaPanel({ atendimentoId, modo }: { atendimentoId: string; modo: string }) {
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [openNew, setOpenNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isHumano = modo === "humano";

  const load = async () => {
    const { data } = await supabase
      .from("demandas_loja" as any)
      .select("*")
      .eq("atendimento_cliente_id", atendimentoId)
      .order("created_at", { ascending: false });
    setDemandas((data as any) || []);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`demandas-${atendimentoId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "demandas_loja", filter: `atendimento_cliente_id=eq.${atendimentoId}` }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "demanda_mensagens" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [atendimentoId]);

  const naoVistas = demandas.filter((d) => !d.vista_pelo_operador).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-medium">Demandas à Loja</h4>
          {naoVistas > 0 && <Badge variant="default" className="h-5 text-[10px]">{naoVistas} nova{naoVistas > 1 ? "s" : ""}</Badge>}
        </div>
        {isHumano ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpenNew(true)}>
            <Store className="h-3 w-3 mr-1" /> Solicitar à loja
          </Button>
        ) : (
          <span className="text-[10px] text-muted-foreground italic">Disponível em modo humano</span>
        )}
      </div>

      {demandas.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70 italic">Nenhuma demanda aberta para este atendimento.</p>
      ) : (
        <div className="space-y-1.5">
          {demandas.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className={cn(
                "w-full text-left rounded-md border p-2 text-xs hover:bg-muted/50 transition-colors",
                !d.vista_pelo_operador && "border-primary/50 bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">#{d.numero_curto} • {d.loja_nome}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 text-[9px] px-1 shrink-0",
                    d.status === "aberta" && "border-amber-500/50 text-amber-600",
                    d.status === "respondida" && "border-emerald-500/50 text-emerald-600",
                    d.status === "encerrada" && "border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {d.status}
                </Badge>
              </div>
              <p className="text-muted-foreground truncate mt-0.5">{d.pergunta}</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                {format(new Date(d.created_at), "dd/MM HH:mm", { locale: ptBR })}
                {d.ultima_mensagem_loja_at && ` • resp ${format(new Date(d.ultima_mensagem_loja_at), "dd/MM HH:mm", { locale: ptBR })}`}
              </p>
            </button>
          ))}
        </div>
      )}

      {openNew && (
        <NovaDemandaDialog
          atendimentoId={atendimentoId}
          onClose={() => setOpenNew(false)}
          onCreated={() => { setOpenNew(false); load(); }}
        />
      )}

      {selectedId && (
        <DemandaThreadDialog
          demanda={demandas.find((d) => d.id === selectedId)!}
          onClose={() => { setSelectedId(null); load(); }}
        />
      )}
    </div>
  );
}

function NovaDemandaDialog({ atendimentoId, onClose, onCreated }: { atendimentoId: string; onClose: () => void; onCreated: () => void }) {
  const [lojas, setLojas] = useState<Array<{ nome_loja: string; telefone: string }>>([]);
  const [lojaTelefone, setLojaTelefone] = useState("");
  const [pergunta, setPergunta] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase
      .from("telefones_lojas")
      .select("nome_loja, telefone")
      .eq("tipo", "loja")
      .eq("ativo", true)
      .order("nome_loja")
      .then(({ data }) => {
        const seen = new Set<string>();
        const uniq = (data || []).filter((l: any) => {
          if (seen.has(l.nome_loja)) return false;
          seen.add(l.nome_loja);
          return true;
        });
        setLojas(uniq as any);
      });
  }, []);

  const handleSend = async () => {
    if (!lojaTelefone || !pergunta.trim()) return;
    const loja = lojas.find((l) => l.telefone === lojaTelefone);
    if (!loja) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("criar-demanda-loja", {
        body: {
          atendimento_id: atendimentoId,
          loja_telefone: loja.telefone,
          loja_nome: loja.nome_loja,
          pergunta: pergunta.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Demanda ${data.protocolo} enviada à ${loja.nome_loja}`);
      onCreated();
    } catch (e: any) {
      toast.error("Falha ao criar demanda: " + (e?.message || "erro"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pin className="h-4 w-4 text-primary" /> Nova demanda à loja
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Loja</label>
            <Select value={lojaTelefone} onValueChange={setLojaTelefone}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
              <SelectContent>
                {lojas.map((l) => (
                  <SelectItem key={l.telefone} value={l.telefone}>{l.nome_loja}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Pergunta / pedido</label>
            <Textarea
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Ex.: Tem foto da armação Ray-Ban RB4171? Disponibilidade?"
              rows={4}
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1">A loja receberá um WhatsApp identificado e poderá responder usando #código.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSend} disabled={!lojaTelefone || !pergunta.trim() || sending}>
            {sending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Enviando</> : <><Send className="h-3 w-3 mr-1" /> Enviar à loja</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DemandaThreadDialog({ demanda, onClose }: { demanda: Demanda; onClose: () => void }) {
  const [msgs, setMsgs] = useState<DemandaMsg[]>([]);
  const [forwardText, setForwardText] = useState("");
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadMsgs = async () => {
    const { data } = await supabase
      .from("demanda_mensagens" as any)
      .select("*")
      .eq("demanda_id", demanda.id)
      .order("created_at", { ascending: true });
    setMsgs((data as any) || []);
  };

  useEffect(() => {
    loadMsgs();
    // mark as seen
    supabase.from("demandas_loja" as any).update({ vista_pelo_operador: true } as any).eq("id", demanda.id).then();

    const channel = supabase
      .channel(`demanda-msgs-${demanda.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "demanda_mensagens", filter: `demanda_id=eq.${demanda.id}` }, () => loadMsgs())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [demanda.id]);

  const handleForward = async () => {
    if (!forwardText.trim()) return;
    setForwarding(true);
    try {
      const { data, error } = await supabase.functions.invoke("encaminhar-demanda-cliente", {
        body: {
          demanda_id: demanda.id,
          texto: forwardText.trim(),
          mensagem_ids: Array.from(selectedMsgIds),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Encaminhado ao cliente");
      setForwardText("");
      setSelectedMsgIds(new Set());
      loadMsgs();
    } catch (e: any) {
      toast.error("Falha: " + (e?.message || "erro"));
    } finally {
      setForwarding(false);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      const { data, error } = await supabase.functions.invoke("encerrar-demanda-loja", {
        body: { demanda_id: demanda.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Demanda encerrada — loja notificada");
      onClose();
    } catch (e: any) {
      toast.error("Falha ao encerrar: " + (e?.message || "erro"));
    } finally {
      setClosing(false);
    }
  };

  const toggleSelect = (m: DemandaMsg) => {
    if (m.direcao !== "loja_para_operador") return;
    const next = new Set(selectedMsgIds);
    if (next.has(m.id)) next.delete(m.id);
    else {
      next.add(m.id);
      // pre-fill forward text with the message content
      if (!forwardText.trim()) setForwardText(m.conteudo);
    }
    setSelectedMsgIds(next);
  };

  const dirColors: Record<string, string> = {
    operador_para_loja: "bg-primary text-primary-foreground ml-auto",
    loja_para_operador: "bg-muted text-foreground mr-auto",
    sistema: "bg-amber-500/10 text-amber-700 dark:text-amber-300 mx-auto text-center text-[11px] italic",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl w-[calc(100vw-2rem)] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base pr-8">
              <Pin className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">#{demanda.numero_curto} • {demanda.loja_nome}</span>
              <Badge variant="outline" className="text-[10px] capitalize">{demanda.status}</Badge>
            </DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">{demanda.protocolo}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-app-bg min-h-0">
          {msgs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sem mensagens ainda.</p>
          ) : (
            msgs.map((m) => {
              const isSelectable = m.direcao === "loja_para_operador";
              const isSelected = selectedMsgIds.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggleSelect(m)}
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                    dirColors[m.direcao] || "bg-muted",
                    isSelectable && "cursor-pointer",
                    isSelected && "ring-2 ring-primary ring-offset-1"
                  )}
                >
                  {m.autor_nome && m.direcao !== "sistema" && (
                    <p className="text-[10px] font-medium opacity-70 mb-0.5">{m.autor_nome}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                  {m.anexo_url && (
                    <a href={m.anexo_url} target="_blank" rel="noreferrer" className="block mt-1 text-[11px] underline opacity-80">
                      📎 Ver anexo
                    </a>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[10px] opacity-60">{format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}</p>
                    {m.encaminhada_ao_cliente && <Check className="h-3 w-3 opacity-70" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t p-3 shrink-0 bg-background space-y-2">
          {selectedMsgIds.size > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {selectedMsgIds.size} mensagem(ns) marcada(s) como encaminhada(s) ao cliente
            </p>
          )}
          <Textarea
            value={forwardText}
            onChange={(e) => setForwardText(e.target.value)}
            placeholder="Texto a enviar ao cliente (você pode editar antes)..."
            rows={2}
            className="text-sm resize-none"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClose} disabled={closing} className="text-xs">
              <X className="h-3 w-3 mr-1" /> Encerrar demanda
            </Button>
            <Button
              size="sm"
              className="ml-auto text-xs"
              onClick={handleForward}
              disabled={!forwardText.trim() || forwarding}
            >
              {forwarding ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowRight className="h-3 w-3 mr-1" />}
              Encaminhar ao cliente
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
