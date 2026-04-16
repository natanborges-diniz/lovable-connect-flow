import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageFeedback } from "@/components/atendimentos/MessageFeedback";
import { DemandaLojaPanel } from "@/components/atendimentos/DemandaLojaPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAtendimentos, useUpdateAtendimentoStatus, useMensagens, useCreateMensagem } from "@/hooks/useAtendimentos";
import { StatusBadge, PrioridadeBadge } from "@/components/shared/StatusBadge";
import { AtendimentoStatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Search, MessageSquare, Send, Eye, Sparkles, Loader2, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { StatusAtendimento } from "@/types/database";

export default function Atendimentos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("contato") || "");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [detailId, setDetailId] = useState<string | null>(searchParams.get("open") || null);

  const filters = {
    status: statusFilter !== "todos" ? (statusFilter as StatusAtendimento) : undefined,
  };

  const { data: atendimentos, isLoading } = useAtendimentos(filters);
  const updateStatus = useUpdateAtendimentoStatus();
  const queryClient = useQueryClient();

  // Client-side search across contato, assunto, atendente
  const filteredAtendimentos = useMemo(() => {
    if (!atendimentos || !search.trim()) return atendimentos;
    const s = search.toLowerCase();
    return atendimentos.filter((a: any) =>
      (a.contato?.nome ?? "").toLowerCase().includes(s) ||
      (a.solicitacao?.assunto ?? "").toLowerCase().includes(s) ||
      (a.atendente_nome ?? "").toLowerCase().includes(s)
    );
  }, [atendimentos, search]);

  // Realtime: auto-refresh list when atendimentos or mensagens change
  useEffect(() => {
    const channel = supabase
      .channel("atendimentos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimentos" }, () => {
        queryClient.invalidateQueries({ queryKey: ["atendimentos"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens" }, () => {
        queryClient.invalidateQueries({ queryKey: ["atendimentos"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return (
    <>
      <PageHeader title="Atendimentos" description="Sessões de comunicação vinculadas às solicitações" />

      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por contato, assunto ou atendente..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aguardando">Aguardando</SelectItem>
                <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
          ) : !filteredAtendimentos?.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum atendimento encontrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solicitação</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Atendente</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAtendimentos.map((a: any) => (
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailId(a.id)}>
                    <TableCell className="font-medium">{a.solicitacao?.assunto ?? "—"}</TableCell>
                    <TableCell>{a.contato?.nome ?? "—"}</TableCell>
                    <TableCell><AtendimentoStatusBadge status={a.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground capitalize">{a.canal}</span>
                        {a.canal_provedor && (
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", a.canal_provedor === "meta_official" ? "border-emerald-500/50 text-emerald-600" : "border-amber-500/50 text-amber-600")}>
                            {a.canal_provedor === "meta_official" ? "Oficial" : a.canal_provedor === "evolution_api" ? "Evolution" : a.canal_provedor === "z_api" ? "Z-API" : a.canal_provedor}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.atendente_nome ?? "Não atribuído"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(a.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setDetailId(a.id); }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden p-0 gap-0">
          {detailId && <AtendimentoDetail id={detailId} onStatusChange={(status) => updateStatus.mutate({ id: detailId, status })} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AtendimentoDetail({ id, onStatusChange }: { id: string; onStatusChange: (s: StatusAtendimento) => void }) {
  const { data: mensagens, refetch } = useMensagens(id);
  const createMensagem = useCreateMensagem();
  const { data: atendimentos } = useAtendimentos();
  const atendimento = atendimentos?.find((a: any) => a.id === id) as any;

  const [msgText, setMsgText] = useState("");
  const [msgDirecao, setMsgDirecao] = useState<"outbound" | "internal">("outbound");
  const [resumo, setResumo] = useState<string | null>(atendimento?.metadata?.resumo_ia || null);
  const [resumoLoading, setResumoLoading] = useState(false);
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`mensagens-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens", filter: `atendimento_id=eq.${id}` }, () => {
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, refetch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  const handleSend = async () => {
    const texto = msgText.trim();
    if (!texto) return;

    try {
      if (msgDirecao === "outbound" && atendimento?.canal === "whatsapp") {
        setSendingOutbound(true);
        const { data, error } = await supabase.functions.invoke("send-whatsapp", {
          body: {
            atendimento_id: id,
            texto,
            remetente_nome: "Operador",
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success("Mensagem enviada ao WhatsApp com sucesso");
      } else {
        await createMensagem.mutateAsync({
          atendimento_id: id,
          conteudo: texto,
          direcao: msgDirecao,
          remetente_nome: "Operador",
        });
      }

      setMsgText("");
    } catch (e: any) {
      toast.error("Falha ao enviar mensagem: " + (e?.message || "Erro desconhecido"));
    } finally {
      setSendingOutbound(false);
    }
  };

  const direcaoColors: Record<string, string> = {
    inbound: "bg-muted text-foreground",
    outbound: "bg-primary text-primary-foreground",
    internal: "bg-warning-soft text-warning border border-warning-muted",
  };

  return (
    <>
      {/* Header fixo */}
      <div className="px-4 pt-4 pb-3 border-b shrink-0 space-y-2">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base pr-8">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">{atendimento?.solicitacao?.assunto ?? "Atendimento"}</span>
          </DialogTitle>
        </DialogHeader>

        {atendimento && (
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <AtendimentoStatusBadge status={atendimento.status} />
            <Badge variant="outline" className="capitalize text-[10px]">{atendimento.canal}</Badge>
            {atendimento.canal_provedor && (
              <Badge variant="outline" className={cn("text-[10px]", atendimento.canal_provedor === "meta_official" ? "border-emerald-500/50 text-emerald-600" : "border-amber-500/50 text-amber-600")}>
                {atendimento.canal_provedor === "meta_official" ? "Oficial" : atendimento.canal_provedor === "evolution_api" ? "Evolution" : "Z-API"}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] cursor-pointer select-none",
                (atendimento as any).modo === "ia"
                  ? "border-primary/50 text-primary hover:bg-primary/10"
                  : "border-warning/50 text-warning hover:bg-warning/10"
              )}
              onClick={async () => {
                const newModo = (atendimento as any).modo === "ia" ? "humano" : "ia";
                const { error } = await supabase.from("atendimentos").update({ modo: newModo } as any).eq("id", id);
                if (error) { toast.error("Erro: " + error.message); return; }
                toast.success(newModo === "ia" ? "Modo IA reativado" : "Modo humano ativado");
              }}
            >
              {(atendimento as any).modo === "ia" ? "🤖 IA" : "👤 Humano"}
            </Badge>
            {atendimento.contato?.nome && <span className="text-xs text-muted-foreground truncate min-w-0">• {atendimento.contato.nome}</span>}
            <Select value={atendimento.status} onValueChange={(v) => onStatusChange(v as StatusAtendimento)}>
              <SelectTrigger className="ml-auto w-36 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aguardando">Aguardando</SelectItem>
                <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Conteúdo scrollável (mensagens + resumo) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 py-3 space-y-3 bg-app-bg">
        {/* Resumo IA - compacto */}
        <div className="rounded-md border bg-card p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-primary" />
              Resumo IA
            </h4>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2"
              disabled={resumoLoading || !mensagens?.length}
              onClick={async () => {
                setResumoLoading(true);
                try {
                  const { data, error } = await supabase.functions.invoke("summarize-atendimento", {
                    body: { atendimento_id: id },
                  });
                  if (error) throw error;
                  if (data.error) throw new Error(data.error);
                  setResumo(data.resumo);
                  toast.success("Resumo gerado");
                } catch (e: any) {
                  toast.error("Erro ao gerar resumo: " + e.message);
                } finally {
                  setResumoLoading(false);
                }
              }}
            >
              {resumoLoading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Gerando</> : <><FileText className="h-3 w-3 mr-1" /> {resumo ? "Atualizar" : "Gerar"}</>}
            </Button>
          </div>
          {resumo ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">{resumo}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70 italic">Nenhum resumo gerado ainda.</p>
          )}
        </div>

        {/* Demandas à Loja - canal privado operador↔loja */}
        <div className="rounded-md border bg-card p-2.5">
          <DemandaLojaPanel atendimentoId={id} modo={(atendimento as any)?.modo || "ia"} />
        </div>

        {/* Mensagens */}
        <div className="space-y-2">
          {!mensagens?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda</p>
          ) : (
            mensagens.map((m: any) => (
              <div key={m.id} className={cn("max-w-[78%] rounded-lg px-3 py-2 text-sm break-words overflow-hidden", direcaoColors[m.direcao], m.direcao === "inbound" ? "mr-auto" : "ml-auto")}>
                {m.remetente_nome && <p className="text-[11px] font-medium opacity-70 mb-0.5 truncate">{m.remetente_nome} {m.direcao === "internal" && "• nota"}</p>}
                <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-[10px] opacity-50">{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</p>
                  {m.direcao === "outbound" && ["Assistente IA", "Bot Lojas", "Sistema"].includes(m.remetente_nome ?? "") && (
                    <MessageFeedback mensagemId={m.id} atendimentoId={id} conteudo={m.conteudo} />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer fixo - composer */}
      <div className="border-t p-3 shrink-0 bg-background">
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex gap-1">
              <Button variant={msgDirecao === "outbound" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("outbound")}>Resposta</Button>
              <Button variant={msgDirecao === "internal" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("internal")}>Nota Interna</Button>
            </div>
            <Textarea
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder={msgDirecao === "internal" ? "Nota interna (não visível ao contato)..." : "Digite sua mensagem..."}
              rows={2}
              className="resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
          </div>
          <Button onClick={handleSend} disabled={!msgText.trim() || createMensagem.isPending || sendingOutbound} size="icon" className="h-10 w-10 shrink-0">
            {sendingOutbound ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
  );
}
