import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useMensagensInternas,
  useMensagensConversa,
  useEnviarMensagem,
  useMarcarLidas,
  useEditMensagemInterna,
  useDeleteMensagemInterna,
  type Conversa,
} from "@/hooks/useMensagensInternas";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, Plus, MessageCircle, Search, Ban, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/layout/PageHeader";
import { AutorizacaoExcecaoCard } from "@/components/mensagens/AutorizacaoExcecaoCard";
import { NovoGrupoDialog } from "@/components/mensagens/NovoGrupoDialog";
import { MessageActionsMenu } from "@/components/shared/MessageActionsMenu";
import { MessageTicks } from "@/components/shared/MessageTicks";
import { EditableMessageBubble } from "@/components/shared/EditableMessageBubble";
import { toast } from "sonner";

export default function Mensagens() {
  const { user, isAdmin } = useAuth();
  const uid = user?.id;
  const { conversas, makeConversaId, makeGroupConversaId } = useMensagensInternas();
  const [selectedConversa, setSelectedConversa] = useState<string | null>(null);
  const [selectedOutro, setSelectedOutro] = useState<{ id: string; nome: string; isGrupo?: boolean; participantes?: string[]; grupoId?: string } | null>(null);
  const [novoGrupoOpen, setNovoGrupoOpen] = useState(false);
  const { data: mensagens } = useMensagensConversa(selectedConversa);
  const enviar = useEnviarMensagem();
  const marcarLidas = useMarcarLidas();
  const editMsg = useEditMensagemInterna();
  const deleteMsg = useDeleteMensagemInterna();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [novaConversaOpen, setNovaConversaOpen] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Active profiles for new conversation
  const { data: profiles, refetch: refetchProfiles } = useQuery({
    queryKey: ["profiles-ativos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      return (data || []).filter((p) => p.id !== uid);
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Nomes dos participantes do grupo selecionado (para rótulo de remetente nos balões)
  const { data: participantesNomes } = useQuery({
    queryKey: ["grupo-participantes-nomes", selectedOutro?.grupoId],
    enabled: !!selectedOutro?.isGrupo && !!selectedOutro?.participantes?.length,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, nome")
        .in("id", selectedOutro!.participantes!);
      const map: Record<string, string> = {};
      (data || []).forEach((p) => { map[p.id] = p.nome; });
      return map;
    },
  });

  // Mark as read when opening a conversation
  useEffect(() => {
    if (selectedConversa && uid) {
      marcarLidas.mutate({ conversaId: selectedConversa, userId: uid });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversa, uid]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensagens]);

  const handleSelectConversa = (c: Conversa) => {
    setSelectedConversa(c.conversa_id);
    setSelectedOutro({
      id: c.outro_id,
      nome: c.outro_nome,
      isGrupo: c.is_grupo,
      participantes: c.participantes,
      grupoId: c.grupo_id,
    });
  };

  const handleNovaConversa = (profile: { id: string; nome: string }) => {
    const cid = makeConversaId(uid!, profile.id);
    setSelectedConversa(cid);
    setSelectedOutro({ id: profile.id, nome: profile.nome });
    setNovaConversaOpen(false);
    setBuscaUsuario("");
  };

  const handleGrupoCreated = async (grupoId: string) => {
    // recarrega lista e abre o grupo recém-criado
    await conversas.refetch();
    const { data: g } = await supabase
      .from("conversas_grupo")
      .select("id, nome, participantes")
      .eq("id", grupoId)
      .maybeSingle();
    if (g) {
      setSelectedConversa(makeGroupConversaId(g.id));
      setSelectedOutro({ id: g.id, nome: g.nome, isGrupo: true, participantes: g.participantes, grupoId: g.id });
    }
  };

  const handleEnviar = () => {
    if (!texto.trim() || !uid || !selectedOutro) return;
    if (selectedOutro.isGrupo && selectedOutro.grupoId && selectedOutro.participantes) {
      enviar.mutate({
        remetenteId: uid,
        grupoId: selectedOutro.grupoId,
        participantes: selectedOutro.participantes,
        conteudo: texto.trim(),
      });
    } else {
      enviar.mutate({
        remetenteId: uid,
        destinatarioId: selectedOutro.id,
        conteudo: texto.trim(),
      });
    }
    setTexto("");
  };

  const listaFiltrada = (conversas.data || []).filter((c) =>
    c.outro_nome.toLowerCase().includes(busca.toLowerCase())
  );

  const filteredProfiles = (profiles || []).filter((p) =>
    p.nome.toLowerCase().includes(buscaUsuario.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="Mensagens" description="Comunicação interna entre usuários" />
      <div className="flex border rounded-lg bg-card h-[calc(100vh-12rem)] overflow-hidden">
        {/* Left: Conversation list */}
        <div className="w-80 border-r flex flex-col flex-shrink-0">
          <div className="p-3 border-b flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar conversa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Popover open={novaConversaOpen} onOpenChange={(o) => { setNovaConversaOpen(o); if (o) refetchProfiles(); }}>
              <PopoverTrigger asChild>
                <Button size="icon" variant="outline" className="h-9 w-9" title="Nova conversa">
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <Input
                  placeholder="Buscar usuário..."
                  value={buscaUsuario}
                  onChange={(e) => setBuscaUsuario(e.target.value)}
                  className="mb-2 h-8 text-sm"
                />
                <div className="max-h-72 overflow-y-auto pr-1">
                  {filteredProfiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleNovaConversa(p)}
                      className="w-full text-left px-3 py-2 text-sm rounded hover:bg-muted transition-colors"
                    >
                      {p.nome}
                    </button>
                  ))}
                  {filteredProfiles.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">Nenhum usuário encontrado</p>
                  )}
                  {filteredProfiles.length > 0 && (
                    <p className="text-[10px] text-muted-foreground text-center pt-2 pb-1">
                      {filteredProfiles.length} usuário{filteredProfiles.length > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {isAdmin && (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9"
                title="Novo grupo"
                onClick={() => setNovoGrupoOpen(true)}
              >
                <Users className="h-4 w-4" />
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1">
            {conversas.isLoading && (
              <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
            )}
            {listaFiltrada.length === 0 && !conversas.isLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageCircle className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma conversa</p>
              </div>
            )}
            {listaFiltrada.map((c) => (
              <button
                key={c.conversa_id}
                onClick={() => handleSelectConversa(c)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors",
                  selectedConversa === c.conversa_id && "bg-muted"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate flex items-center gap-1.5">
                    {c.is_grupo && <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    {c.outro_nome}
                  </span>
                  {c.nao_lidas > 0 && (
                    <Badge className="h-5 min-w-[20px] px-1.5 text-[10px]">{c.nao_lidas}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                  {c.ultima_remetente_id === uid && (
                    <MessageTicks status={c.ultima_lida ? "read" : "sent"} />
                  )}
                  <span className="truncate">{c.ultima_mensagem}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(c.ultima_data), "dd/MM HH:mm", { locale: ptBR })}
                </p>
              </button>
            ))}
          </ScrollArea>
        </div>

        {/* Right: Messages thread */}
        <div className="flex-1 flex flex-col">
          {!selectedConversa ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Selecione uma conversa ou inicie uma nova</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
                {selectedOutro?.isGrupo && <Users className="h-4 w-4 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold truncate">{selectedOutro?.nome}</h3>
                  {selectedOutro?.isGrupo && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-[11px] text-muted-foreground hover:text-foreground hover:underline transition-colors text-left">
                          {selectedOutro.participantes?.length ?? 0} participantes — ver lista
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-2" align="start">
                        <p className="text-xs font-medium px-2 py-1 text-muted-foreground">
                          Participantes ({selectedOutro.participantes?.length ?? 0})
                        </p>
                        <div className="max-h-72 overflow-y-auto pr-1">
                          {(selectedOutro.participantes || []).map((pid) => (
                            <div
                              key={pid}
                              className="px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2"
                            >
                              <span className="truncate">
                                {participantesNomes?.[pid] || "Carregando..."}
                              </span>
                              {pid === uid && (
                                <span className="text-[10px] text-muted-foreground">(você)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {(mensagens || []).map((m: any) => {
                  const isMine = m.remetente_id === uid;
                  const meta = m.metadata || {};
                  const isAutorizacao = meta?.kind === "autorizacao_excecao";
                  const isDeleted = !!m.deletada_at;
                  const isEditing = editingId === m.id;
                  const showSenderName = !!selectedOutro?.isGrupo && !isMine && !isAutorizacao;
                  const senderName = participantesNomes?.[m.remetente_id] || "Usuário";
                  return (
                    <div key={m.id} className={cn("flex group", isMine ? "justify-end" : "justify-start")}>
                      {isAutorizacao ? (
                        <div className="max-w-[85%]">
                          <AutorizacaoExcecaoCard metadata={meta} isMine={isMine} />
                          <p className="text-[10px] mt-1 text-muted-foreground">
                            {format(new Date(m.created_at), "HH:mm", { locale: ptBR })}
                          </p>
                        </div>
                      ) : (
                        <div className="max-w-[70%]">
                          {showSenderName && (
                            <p className="text-[11px] font-medium text-primary mb-0.5 ml-1">{senderName}</p>
                          )}
                          <div
                            className={cn(
                              "px-3 py-2 rounded-lg text-sm relative",
                              isDeleted
                                ? "bg-muted/50 text-muted-foreground italic border border-dashed"
                                : isMine
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground"
                            )}
                          >
                          {isEditing ? (
                            <EditableMessageBubble
                              initialValue={m.conteudo}
                              onCancel={() => setEditingId(null)}
                              saving={editMsg.isPending}
                              onSave={async (v) => {
                                try {
                                  await editMsg.mutateAsync({
                                    id: m.id,
                                    novoConteudo: v,
                                    conteudoAnterior: m.conteudo,
                                    metadata: m.metadata,
                                  });
                                  setEditingId(null);
                                  toast.success("Mensagem editada");
                                } catch (e: any) {
                                  toast.error("Erro ao editar: " + (e?.message || ""));
                                }
                              }}
                            />
                          ) : isDeleted ? (
                            <p className="flex items-center gap-1.5 whitespace-pre-wrap break-words">
                              <Ban className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              Mensagem apagada
                            </p>
                          ) : (
                            <>
                              <div className="flex items-start gap-1.5">
                                <p className="whitespace-pre-wrap break-words flex-1">{m.conteudo}</p>
                                <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                                  <MessageActionsMenu
                                    autorId={m.remetente_id}
                                    currentUserId={uid}
                                    createdAt={m.created_at}
                                    deletadaAt={m.deletada_at}
                                    enforceEditWindow={false}
                                    onEdit={() => setEditingId(m.id)}
                                    onDelete={async () => {
                                      try {
                                        await deleteMsg.mutateAsync({ id: m.id, userId: uid! });
                                        toast.success("Mensagem excluída");
                                      } catch (e: any) {
                                        toast.error("Erro ao excluir: " + (e?.message || ""));
                                      }
                                    }}
                                    tone={isMine ? "dark" : "light"}
                                  />
                                </div>
                              </div>
                              <p className={cn("text-[10px] mt-1 flex items-center gap-1", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                <span>{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</span>
                                {m.editada_at && (
                                  <span title={`editada em ${format(new Date(m.editada_at), "dd/MM HH:mm", { locale: ptBR })}`}>
                                    • editada
                                  </span>
                                )}
                                {isMine && !isDeleted && (
                                  selectedOutro?.isGrupo ? (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button
                                          type="button"
                                          className={cn(
                                            "ml-0.5 inline-flex items-center gap-1 rounded-sm hover:underline",
                                            isMine ? "text-primary-foreground/80" : "text-muted-foreground"
                                          )}
                                          aria-label="Ver quem leu"
                                        >
                                          <MessageTicks status={m.lida_por_todos ? "read" : "sent"} />
                                          <span className="text-[10px]">{m.lidas_count ?? 0}/{m.total_copias ?? Math.max((selectedOutro.participantes?.length ?? 1) - 1, 0)}</span>
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent align="end" className="w-56 p-2">
                                        <p className="text-xs font-medium mb-2 px-1">Visualizações</p>
                                        <div className="space-y-1 max-h-64 overflow-y-auto">
                                          {(m.destinatarios_ids || []).map((pid: string) => {
                                            const leu = (m.leitores_ids || []).includes(pid);
                                            return (
                                              <div key={pid} className="flex items-center justify-between text-xs px-1 py-0.5">
                                                <span className="truncate">{participantesNomes?.[pid] || "Usuário"}</span>
                                                {leu ? (
                                                  <span className="text-sky-500" aria-label="Lida">✓✓</span>
                                                ) : (
                                                  <span className="text-muted-foreground" aria-label="Pendente">○</span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <MessageTicks
                                      status={m.lida ? "read" : "sent"}
                                      className="ml-0.5"
                                    />
                                  )
                                )}
                              </p>
                            </>
                          )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t flex gap-2">
                <Input
                  placeholder="Digite sua mensagem..."
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleEnviar()}
                  className="flex-1"
                />
                <Button onClick={handleEnviar} disabled={!texto.trim() || enviar.isPending} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      <NovoGrupoDialog
        open={novoGrupoOpen}
        onOpenChange={setNovoGrupoOpen}
        onCreated={handleGrupoCreated}
      />
    </div>
  );
}
