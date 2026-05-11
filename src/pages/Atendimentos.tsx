import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageFeedback } from "@/components/atendimentos/MessageFeedback";
import { TemplateMessageBubble } from "@/components/atendimentos/TemplateMessageBubble";
import { useWhatsappTemplates } from "@/hooks/useWhatsappTemplates";
import { DemandaLojaPanel } from "@/components/atendimentos/DemandaLojaPanel";
import { AcionarLojaDialog } from "@/components/atendimentos/AcionarLojaDialog";
import { ReconectarTemplateButton } from "@/components/atendimentos/ReconectarTemplateButton";
import { JanelaFechadaDialog } from "@/components/atendimentos/JanelaFechadaDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAtendimentos, useUpdateAtendimentoStatus, useMensagens, useCreateMensagem } from "@/hooks/useAtendimentos";
import { useAuth } from "@/hooks/useAuth";
import { StatusBadge, PrioridadeBadge } from "@/components/shared/StatusBadge";
import { AtendimentoStatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RevisaoHumanaBadge, traduzirMotivos } from "@/components/shared/RevisaoHumanaBadge";
import { ReceitaValidacaoPopover } from "@/components/atendimentos/ReceitaValidacaoPopover";
import { Search, MessageSquare, Send, Eye, Sparkles, Loader2, FileText, Pin, Image as ImageIcon, ExternalLink, Paperclip, X as XIcon, Ban, CheckCircle2 } from "lucide-react";
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

  const isRealStatus = statusFilter !== "todos" && statusFilter !== "revisao_pendente";
  const filters = {
    status: isRealStatus ? (statusFilter as StatusAtendimento) : undefined,
  };

  const { data: atendimentos, isLoading } = useAtendimentos(filters);
  const updateStatus = useUpdateAtendimentoStatus();
  const queryClient = useQueryClient();

  // Client-side search + revisão filter
  const filteredAtendimentos = useMemo(() => {
    let list = atendimentos;
    if (!list) return list;
    if (statusFilter === "revisao_pendente") {
      list = list.filter((a: any) => a.metadata?.revisao_humana_pendente === true);
    }
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter((a: any) =>
      (a.contato?.nome ?? "").toLowerCase().includes(s) ||
      (a.solicitacao?.assunto ?? "").toLowerCase().includes(s) ||
      (a.atendente_nome ?? "").toLowerCase().includes(s)
    );
  }, [atendimentos, search, statusFilter]);

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
                <SelectItem value="revisao_pendente">⚠ Revisão pendente</SelectItem>
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
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AtendimentoStatusBadge status={a.status} />
                        {a.metadata?.revisao_humana_pendente === true && (
                          <RevisaoHumanaBadge motivos={a.metadata?.revisao_motivos as string[] | undefined} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground capitalize">{a.canal}</span>
                        {a.canal_provedor && (
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", a.canal_provedor === "meta_official" ? "border-emerald-500/50 text-emerald-600" : "border-muted-foreground/40 text-muted-foreground")}>
                            {a.canal_provedor === "meta_official" ? "Oficial" : "Legado"}
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
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] h-[96vh] sm:h-[95vh] flex flex-col overflow-hidden p-0 gap-0">
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
  const { data: templatesCatalog } = useWhatsappTemplates();
  const atendimento = atendimentos?.find((a: any) => a.id === id) as any;
  const { profile, user } = useAuth();
  const uid = user?.id ?? null;
  const consultorNome = profile?.nome?.split(" ")[0] || "consultor das Óticas Diniz";

  const [msgText, setMsgText] = useState("");
  const [msgDirecao, setMsgDirecao] = useState<"outbound" | "internal">("outbound");
  const [resumo, setResumo] = useState<string | null>(atendimento?.metadata?.resumo_ia || null);
  const [resumoLoading, setResumoLoading] = useState(false);
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const [resumoOpen, setResumoOpen] = useState(false);
  const [demandasOpen, setDemandasOpen] = useState(false);
  const [acionarOpen, setAcionarOpen] = useState(false);
  const [janelaFechadaOpen, setJanelaFechadaOpen] = useState(false);
  const [janelaFechadaHoras, setJanelaFechadaHoras] = useState(0);
  const [reconectarOpen, setReconectarOpen] = useState(false);
  const [reconectarDefaultTemplate, setReconectarDefaultTemplate] = useState<string | undefined>(undefined);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Realtime subscription (INSERT + UPDATE para refletir edições/exclusões)
  useEffect(() => {
    const channel = supabase
      .channel(`mensagens-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensagens", filter: `atendimento_id=eq.${id}` }, () => {
        refetch();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mensagens", filter: `atendimento_id=eq.${id}` }, () => {
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, refetch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [mensagens]);

  const handlePickAttachment = (file: File | null) => {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      toast.error("Formato não suportado. Envie JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem maior que 5MB. Reduza antes de enviar.");
      return;
    }
    setAttachment(file);
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachmentPreview(URL.createObjectURL(file));
  };

  const clearAttachment = () => {
    if (attachmentPreview) URL.revokeObjectURL(attachmentPreview);
    setAttachment(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    const texto = msgText.trim();
    if (!texto && !attachment) return;

    try {
      if (msgDirecao === "outbound" && atendimento?.canal === "whatsapp") {
        setSendingOutbound(true);

        // Upload anexo (se houver) antes de chamar send-whatsapp
        let mediaUrl: string | undefined;
        let mimeType: string | undefined;
        if (attachment) {
          setUploadingAttachment(true);
          const { data: userData } = await supabase.auth.getUser();
          const uid = userData?.user?.id;
          if (!uid) throw new Error("Sessão expirada. Faça login novamente.");
          const ext = attachment.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `${uid}/atendimentos/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("mensagens-anexos")
            .upload(path, attachment, { contentType: attachment.type, upsert: false });
          setUploadingAttachment(false);
          if (upErr) throw new Error("Falha no upload: " + upErr.message);
          const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);
          mediaUrl = pub.publicUrl;
          mimeType = attachment.type;
        }

        const { data, error } = await supabase.functions.invoke("send-whatsapp", {
          body: {
            atendimento_id: id,
            ...(mediaUrl ? { media_url: mediaUrl, mime_type: mimeType, caption: texto || undefined } : { texto }),
            remetente_nome: profile?.nome || "Operador",
          },
        });

        // Intercepta 422 outside_24h_window: prepara reabertura via template
        let errPayload: any = data;
        if (error && (error as any).context && typeof (error as any).context.json === "function") {
          try {
            errPayload = await (error as any).context.clone().json();
          } catch {
            try { errPayload = await (error as any).context.clone().text(); } catch { /* noop */ }
          }
        }
        const errStr = typeof errPayload === "string" ? errPayload : JSON.stringify(errPayload || {});
        if (errStr.includes("outside_24h_window")) {
          let horas = 0;
          try {
            const parsed = typeof errPayload === "string" ? JSON.parse(errPayload) : errPayload;
            horas = parsed?.hours_since_last_inbound ?? 0;
          } catch { /* noop */ }
          setJanelaFechadaHoras(horas);
          setJanelaFechadaOpen(true);
          // Preserva rascunho e anexo para retry via template
          return;
        }

        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success(mediaUrl ? "Imagem enviada ao WhatsApp" : "Mensagem enviada ao WhatsApp com sucesso");
      } else {
        if (!texto) {
          toast.error("Notas internas não suportam anexo. Digite um texto.");
          return;
        }
        await createMensagem.mutateAsync({
          atendimento_id: id,
          conteudo: texto,
          direcao: msgDirecao,
          remetente_nome: profile?.nome || "Operador",
        });
      }

      setMsgText("");
      clearAttachment();
    } catch (e: any) {
      toast.error("Falha ao enviar mensagem: " + (e?.message || "Erro desconhecido"));
    } finally {
      setSendingOutbound(false);
      setUploadingAttachment(false);
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
            {(atendimento.metadata as any)?.revisao_humana_pendente === true && (
              <>
                <RevisaoHumanaBadge motivos={(atendimento.metadata as any)?.revisao_motivos} size="md" />
                <ReceitaValidacaoPopover
                  atendimentoId={id}
                  contatoId={atendimento.contato_id}
                  atendimentoMetadata={atendimento.metadata}
                  contatoMetadata={(atendimento.contato as any)?.metadata}
                />
              </>
            )}
            <Badge variant="outline" className="capitalize text-[10px]">{atendimento.canal}</Badge>
            {atendimento.canal_provedor && (
              <Badge variant="outline" className={cn("text-[10px]", atendimento.canal_provedor === "meta_official" ? "border-emerald-500/50 text-emerald-600" : "border-muted-foreground/40 text-muted-foreground")}>
                {atendimento.canal_provedor === "meta_official" ? "Oficial" : "Legado"}
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
                const previousModo = (atendimento as any).modo;
                const newModo = previousModo === "ia" ? "humano" : "ia";
                const { error } = await supabase.from("atendimentos").update({ modo: newModo } as any).eq("id", id);
                if (error) { toast.error("Erro: " + error.message); return; }

                // Devolução humano→IA: troca silenciosa. IA aguarda próxima msg do cliente.
                if (newModo === "ia" && (previousModo === "humano" || previousModo === "hibrido")) {
                  toast.success("IA reativada — aguardando retorno do cliente");
                } else {
                  toast.success(newModo === "ia" ? "Modo IA reativado" : "Modo humano ativado");
                }
              }}
            >
              {(atendimento as any).modo === "ia" ? "🤖 IA" : "👤 Humano"}
            </Badge>
            {atendimento.contato?.nome && <span className="text-xs text-muted-foreground truncate min-w-0">• {atendimento.contato.nome}</span>}
            <Select value={atendimento.status} onValueChange={(v) => onStatusChange(v as StatusAtendimento)}>
              <SelectTrigger className="ml-auto w-32 h-7 text-xs">
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

        {/* Toolbar compacta: Resumo IA + Demandas como popovers */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Popover open={resumoOpen} onOpenChange={setResumoOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2">
                <Sparkles className="h-3 w-3 mr-1 text-primary" />
                Resumo IA
                {resumo && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary" /> Resumo IA
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
                <div className="max-h-64 overflow-y-auto pr-1">
                  <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">{resumo}</p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">Nenhum resumo gerado ainda. Clique em "Gerar".</p>
              )}
            </PopoverContent>
          </Popover>

          <Popover open={demandasOpen} onOpenChange={setDemandasOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2">
                <Pin className="h-3 w-3 mr-1 text-primary" />
                Demandas à Loja
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-3 max-h-[60vh] overflow-y-auto">
              <DemandaLojaPanel atendimentoId={id} modo={(atendimento as any)?.modo || "ia"} />
            </PopoverContent>
          </Popover>

          {(atendimento as any)?.modo === "humano" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] px-2"
              onClick={() => setAcionarOpen(true)}
              title="Abrir demanda interna para uma ou várias lojas"
            >
              <Pin className="h-3 w-3 mr-1 text-primary" />
              Acionar loja(s)
            </Button>
          )}

          <AcionarLojaDialog
            open={acionarOpen}
            onOpenChange={setAcionarOpen}
            atendimentoId={id}
            onCreated={() => setDemandasOpen(true)}
          />

          {atendimento?.canal === "whatsapp" && atendimento?.contato_id && (
            <>
              <ReconectarTemplateButton
                atendimentoId={id}
                contatoId={atendimento.contato_id}
                contatoNome={atendimento.contato?.nome}
                ultimoInboundAt={
                  mensagens?.filter((m: any) => m.direcao === "inbound").slice(-1)[0]?.created_at ?? null
                }
                topicoPadrao={atendimento.solicitacao?.assunto || "seu atendimento"}
                consultorNome={consultorNome}
                defaultTemplate={reconectarDefaultTemplate}
                open={reconectarOpen || undefined}
                onOpenChange={(o) => {
                  setReconectarOpen(o);
                  if (!o) setReconectarDefaultTemplate(undefined);
                }}
                forceVisible={reconectarOpen}
              />
              <JanelaFechadaDialog
                open={janelaFechadaOpen}
                onOpenChange={setJanelaFechadaOpen}
                hoursSinceInbound={janelaFechadaHoras}
                rascunhoPreservado={!!msgText.trim()}
                onEnviarRetomada={() => {
                  setReconectarDefaultTemplate("retomada_consultor_v1");
                  setJanelaFechadaOpen(false);
                  setReconectarOpen(true);
                }}
                onEscolherOutro={() => {
                  setReconectarDefaultTemplate(undefined);
                  setJanelaFechadaOpen(false);
                  setReconectarOpen(true);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Conteúdo scrollável (mensagens) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-4 py-3 space-y-2 bg-app-bg">
        {!mensagens?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda</p>
        ) : (
          mensagens.map((m: any) => {
            const mediaUrl = m?.metadata?.media_url as string | undefined;
            const mimeType = (m?.metadata?.mime_type as string | undefined) || "";
            const isImage = (m?.tipo_conteudo || "text") === "image" && !!mediaUrl;
            const isDocument = !!mediaUrl && !isImage;
            const isDeleted = !!m.deletada_at;

            return (
              <div key={m.id} className={cn("group max-w-[78%] rounded-lg px-3 py-2 text-sm break-words overflow-hidden relative", isDeleted ? "bg-muted/50 text-muted-foreground italic border border-dashed" : direcaoColors[m.direcao], m.direcao === "inbound" ? "mr-auto" : "ml-auto")}>
                {m.remetente_nome && !isDeleted && <p className="text-[11px] font-medium opacity-70 mb-0.5 truncate">{m.remetente_nome} {m.direcao === "internal" && "• nota"}</p>}
                {isDeleted ? (
                  <p className="flex items-center gap-1.5">
                    <Ban className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    Mensagem apagada
                  </p>
                ) : (
                  <>
                    {isImage ? (
                      <a href={mediaUrl} target="_blank" rel="noreferrer" className="block mb-2">
                        <img
                          src={mediaUrl}
                          alt={m.conteudo && m.conteudo !== "[image]" ? m.conteudo : "Imagem enviada pelo cliente"}
                          className="max-h-72 w-full rounded-md object-contain bg-background/40"
                          loading="lazy"
                        />
                      </a>
                    ) : null}
                    {isDocument ? (
                      <a
                        href={mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs underline-offset-2 hover:underline"
                      >
                        {mimeType.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        <span className="truncate">Ver anexo</span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {m.conteudo && m.conteudo !== "[image]" && (
                      m.conteudo.startsWith("[Template:")
                        ? <TemplateMessageBubble conteudo={m.conteudo} templates={templatesCatalog} />
                        : <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-[10px] opacity-50 flex items-center gap-1">
                        <span>{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</span>
                        {m.editada_at && (
                          <span title={`editada em ${format(new Date(m.editada_at), "dd/MM HH:mm", { locale: ptBR })}`}>
                            • editada
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-1">
                        {m.direcao === "outbound" && ["Assistente IA", "Bot Lojas", "Sistema"].includes(m.remetente_nome ?? "") && (
                          <MessageFeedback mensagemId={m.id} atendimentoId={id} conteudo={m.conteudo} />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer fixo - composer */}
      <div className="border-t p-3 shrink-0 bg-background">
        {attachmentPreview && (
          <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <img src={attachmentPreview} alt="Pré-visualização do anexo" className="h-14 w-14 rounded object-cover" />
            <div className="flex-1 min-w-0 text-xs">
              <p className="truncate font-medium">{attachment?.name}</p>
              <p className="text-muted-foreground">
                {attachment ? (attachment.size / 1024).toFixed(0) : 0} KB • legenda opcional abaixo
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={clearAttachment} aria-label="Remover anexo">
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex gap-1">
              <Button variant={msgDirecao === "outbound" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("outbound")}>Resposta</Button>
              <Button variant={msgDirecao === "internal" ? "default" : "outline"} size="sm" className="text-xs h-6" onClick={() => setMsgDirecao("internal")}>Nota Interna</Button>
            </div>
            <Textarea
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder={
                msgDirecao === "internal"
                  ? "Nota interna (não visível ao contato)..."
                  : attachment
                    ? "Legenda da imagem (opcional)..."
                    : "Digite sua mensagem..."
              }
              rows={2}
              className="resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
          </div>
          {msgDirecao === "outbound" && atendimento?.canal === "whatsapp" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handlePickAttachment(e.target.files?.[0] || null)}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendingOutbound || uploadingAttachment}
                aria-label="Anexar imagem"
                title="Anexar imagem"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            onClick={handleSend}
            disabled={(!msgText.trim() && !attachment) || createMensagem.isPending || sendingOutbound || uploadingAttachment}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {sendingOutbound || uploadingAttachment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
  );
}

