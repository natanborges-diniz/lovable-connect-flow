import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useMensagensInternas,
  useMensagensConversa,
  useEnviarMensagem,
  useMarcarLidas,
  type Conversa,
} from "@/hooks/useMensagensInternas";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, Plus, MessageCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/layout/PageHeader";

export default function Mensagens() {
  const { user } = useAuth();
  const uid = user?.id;
  const { conversas, makeConversaId } = useMensagensInternas();
  const [selectedConversa, setSelectedConversa] = useState<string | null>(null);
  const [selectedOutro, setSelectedOutro] = useState<{ id: string; nome: string } | null>(null);
  const { data: mensagens } = useMensagensConversa(selectedConversa);
  const enviar = useEnviarMensagem();
  const marcarLidas = useMarcarLidas();
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [novaConversaOpen, setNovaConversaOpen] = useState(false);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Active profiles for new conversation
  const { data: profiles } = useQuery({
    queryKey: ["profiles-ativos"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, nome").eq("ativo", true);
      return (data || []).filter((p) => p.id !== uid);
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
    setSelectedOutro({ id: c.outro_id, nome: c.outro_nome });
  };

  const handleNovaConversa = (profile: { id: string; nome: string }) => {
    const cid = makeConversaId(uid!, profile.id);
    setSelectedConversa(cid);
    setSelectedOutro({ id: profile.id, nome: profile.nome });
    setNovaConversaOpen(false);
    setBuscaUsuario("");
  };

  const handleEnviar = () => {
    if (!texto.trim() || !uid || !selectedOutro) return;
    enviar.mutate({
      remetenteId: uid,
      destinatarioId: selectedOutro.id,
      conteudo: texto.trim(),
    });
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
      <PageHeader title="Mensagens" subtitle="Comunicação interna entre usuários" />
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
            <Popover open={novaConversaOpen} onOpenChange={setNovaConversaOpen}>
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
                <ScrollArea className="max-h-48">
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
                </ScrollArea>
              </PopoverContent>
            </Popover>
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{c.outro_nome}</span>
                  {c.nao_lidas > 0 && (
                    <Badge className="h-5 min-w-[20px] px-1.5 text-[10px]">{c.nao_lidas}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.ultima_mensagem}</p>
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
              <div className="px-4 py-3 border-b bg-muted/30">
                <h3 className="text-sm font-semibold">{selectedOutro?.nome}</h3>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {(mensagens || []).map((m) => {
                  const isMine = m.remetente_id === uid;
                  return (
                    <div key={m.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[70%] px-3 py-2 rounded-lg text-sm",
                          isMine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
                        <p className={cn("text-[10px] mt-1", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {format(new Date(m.created_at), "HH:mm", { locale: ptBR })}
                        </p>
                      </div>
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
    </div>
  );
}
