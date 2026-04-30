import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Shield, ShieldCheck, Search } from "lucide-react";

interface Autorizador {
  id: string;
  nome: string;
  role: string; // 'supervisao' | 'diretoria' | 'admin'
}

interface SolicitarAutorizacaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processoChave: string;
  processoNome?: string;
  referenciaTipo: string;
  referenciaId: string;
  contexto?: Record<string, any>;
  motivoPadrao?: string;
  onSent?: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  diretoria: "Diretoria",
  supervisao: "Supervisão",
  admin: "Admin",
};

export function SolicitarAutorizacaoDialog({
  open,
  onOpenChange,
  processoChave,
  processoNome,
  referenciaTipo,
  referenciaId,
  contexto,
  motivoPadrao,
  onSent,
}: SolicitarAutorizacaoDialogProps) {
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<Autorizador | null>(null);
  const [motivo, setMotivo] = useState(motivoPadrao || "");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (open) {
      setBusca("");
      setEscolhido(null);
      setMotivo(motivoPadrao || "");
    }
  }, [open, motivoPadrao]);

  // Carrega niveis aceitos pelo processo
  const { data: processo } = useQuery({
    queryKey: ["processo_excecao", processoChave],
    queryFn: async () => {
      const { data } = await supabase
        .from("processos_excecao")
        .select("chave, nome, niveis_autorizadores")
        .eq("chave", processoChave)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  // Carrega autorizadores elegíveis
  const { data: autorizadores, isLoading } = useQuery({
    queryKey: ["autorizadores_elegiveis", processo?.niveis_autorizadores],
    queryFn: async (): Promise<Autorizador[]> => {
      const niveis = processo?.niveis_autorizadores || ["supervisao", "diretoria"];
      const rolesElegiveis = [...niveis, "admin"]; // admin sempre cobre

      // Roles via user_roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", rolesElegiveis as any);

      const roleByUser = new Map<string, string>();
      (roles || []).forEach((r: any) => {
        // Prioriza diretoria > supervisao > admin para exibir
        const cur = roleByUser.get(r.user_id);
        const ranking: Record<string, number> = { diretoria: 3, supervisao: 2, admin: 1 };
        if (!cur || (ranking[r.role] || 0) > (ranking[cur] || 0)) {
          roleByUser.set(r.user_id, r.role);
        }
      });

      // Tag is_supervisor em profiles.metadata
      const { data: profilesAll } = await supabase
        .from("profiles")
        .select("id, nome, metadata")
        .eq("ativo", true);

      const list: Autorizador[] = [];
      (profilesAll || []).forEach((p: any) => {
        const role = roleByUser.get(p.id);
        const isSupervisorTag = p?.metadata?.is_supervisor === true && niveis.includes("supervisao");
        if (role) {
          list.push({ id: p.id, nome: p.nome, role });
        } else if (isSupervisorTag) {
          list.push({ id: p.id, nome: p.nome, role: "supervisao" });
        }
      });

      // Remove o próprio usuário e ordena
      return list
        .filter((a) => a.id !== user?.id)
        .sort((a, b) => {
          const ranking: Record<string, number> = { diretoria: 3, supervisao: 2, admin: 1 };
          return (ranking[b.role] || 0) - (ranking[a.role] || 0) || a.nome.localeCompare(b.nome);
        });
    },
    enabled: open && !!processo,
  });

  const filtrados = (autorizadores || []).filter((a) =>
    a.nome.toLowerCase().includes(busca.toLowerCase())
  );

  const handleEnviar = async () => {
    if (!user || !escolhido) {
      toast.error("Selecione um autorizador.");
      return;
    }
    if (!motivo.trim()) {
      toast.error("Descreva o motivo da exceção.");
      return;
    }
    setEnviando(true);
    try {
      // Pega nome do solicitante
      const { data: meProfile } = await supabase
        .from("profiles")
        .select("nome")
        .eq("id", user.id)
        .maybeSingle();
      const solicitanteNome = meProfile?.nome || user.email || "Solicitante";

      // 1. Cria autorização
      const { data: autz, error: errAutz } = await supabase
        .from("autorizacoes_excecao")
        .insert({
          processo_chave: processoChave,
          referencia_tipo: referenciaTipo,
          referencia_id: referenciaId,
          solicitante_id: user.id,
          solicitante_nome: solicitanteNome,
          autorizador_id: escolhido.id,
          autorizador_nome: escolhido.nome,
          autorizador_role: escolhido.role,
          contexto: contexto || {},
          motivo_solicitacao: motivo.trim(),
          status: "pendente",
        })
        .select()
        .single();

      if (errAutz) throw errAutz;

      // 2. Envia mensagem 1-a-1 com card interativo
      const conversaId = [user.id, escolhido.id].sort().join("__");
      const tituloProcesso = processo?.nome || processoNome || processoChave;
      await supabase.from("mensagens_internas").insert({
        remetente_id: user.id,
        destinatario_id: escolhido.id,
        conversa_id: conversaId,
        conteudo: `🛡️ Pedido de autorização — ${tituloProcesso}\n\nMotivo: ${motivo.trim()}`,
        metadata: {
          kind: "autorizacao_excecao",
          autorizacao_id: autz.id,
          processo_chave: processoChave,
          processo_nome: tituloProcesso,
          referencia_tipo: referenciaTipo,
          referencia_id: referenciaId,
          contexto: contexto || {},
          motivo: motivo.trim(),
        },
      });

      // 3. Notificação push
      await supabase.from("notificacoes").insert({
        usuario_id: escolhido.id,
        tipo: "autorizacao_excecao",
        titulo: `Autorização — ${tituloProcesso}`,
        mensagem: `${solicitanteNome}: ${motivo.trim().slice(0, 100)}`,
        referencia_id: autz.id,
      });

      toast.success(`Pedido enviado a ${escolhido.nome}.`);
      onSent?.();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error("Erro: " + (e.message || "falha ao enviar"));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Solicitar autorização de exceção
          </DialogTitle>
          <DialogDescription>
            {processo?.nome || processoNome || processoChave}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">
              Autorizador <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground mb-2">
              Escolha quem deve aprovar. Apenas {(processo?.niveis_autorizadores || ["supervisao", "diretoria"]).map((n: string) => ROLE_LABEL[n] || n).join(" ou ")} podem ser designados.
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="h-48 mt-2 border rounded-md">
              {isLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">Carregando...</p>
              )}
              {!isLoading && filtrados.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Nenhum autorizador disponível.
                </p>
              )}
              {filtrados.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setEscolhido(a)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                    escolhido?.id === a.id ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {escolhido?.id === a.id && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                    {a.nome}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {ROLE_LABEL[a.role] || a.role}
                  </Badge>
                </button>
              ))}
            </ScrollArea>
          </div>

          <div>
            <Label className="text-sm font-medium">
              Motivo da exceção <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Explique por que este caso precisa de autorização especial..."
              rows={4}
              className="mt-1"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleEnviar}
            disabled={enviando || !escolhido || !motivo.trim()}
          >
            {enviando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Shield className="h-4 w-4 mr-1" />}
            Enviar pedido a {escolhido?.nome || "autorizador"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
