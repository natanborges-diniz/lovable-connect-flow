import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Bot, RefreshCw, Send, UserCog, Wand2, Users, Building2, Globe, Save, Check } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAtendimentosOrfaos, useRecuperarAtendimentos, type OrfaoRow, type PublicoFiltro } from "@/hooks/useAtendimentosOrfaos";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const MENSAGEM_PADRAO = "Olá! Desculpe a demora em responder, estamos retomando seu atendimento agora. Em instantes nossa equipe vai te atender. 🙏";
const CHAVE_MSG = "recuperacao_mensagem_desculpas";

interface PublicoOpt {
  key: PublicoFiltro;
  icon: typeof Users;
  label: string;
  desc: string;
  tooltip: string;
}

const PUBLICOS: PublicoOpt[] = [
  {
    key: "clientes",
    icon: Users,
    label: "Apenas Clientes",
    desc: "Consumidores finais via WhatsApp (CRM Vendas)",
    tooltip: "Pessoas físicas em atendimento comercial. Use após downtime para ligar a IA novamente para clientes pendentes.",
  },
  {
    key: "internos",
    icon: Building2,
    label: "Lojas / Internos",
    desc: "Lojas, colaboradores, Financeiro, TI",
    tooltip: "Comunicação corporativa interna. Geralmente atendida por humano — útil para escalar pendências internas.",
  },
  {
    key: "todos",
    icon: Globe,
    label: "Todos",
    desc: "Sem filtro — mostra tudo",
    tooltip: "Lista todos os atendimentos pendentes, independente do tipo.",
  },
];

const IDADE_MARCAS = [15, 30, 60, 180, 360, 720, 1440];
const formatIdade = (m: number) => {
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(m / 1440)}d`;
};

export function RecuperacaoCard() {
  const qc = useQueryClient();
  const [publico, setPublico] = useState<PublicoFiltro>("clientes");
  const [idadeIdx, setIdadeIdx] = useState<number>(0); // index em IDADE_MARCAS
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [mensagem, setMensagem] = useState<string>(MENSAGEM_PADRAO);
  const [mensagemOriginal, setMensagemOriginal] = useState<string>(MENSAGEM_PADRAO);

  // Carrega mensagem salva
  useQuery({
    queryKey: ["config", CHAVE_MSG],
    queryFn: async () => {
      const { data } = await supabase
        .from("configuracoes_ia")
        .select("valor")
        .eq("chave", CHAVE_MSG)
        .maybeSingle();
      const valor = data?.valor || MENSAGEM_PADRAO;
      setMensagem(valor);
      setMensagemOriginal(valor);
      return valor;
    },
  });

  const salvarMensagem = useMutation({
    mutationFn: async (novoTexto: string) => {
      const { error } = await supabase
        .from("configuracoes_ia")
        .upsert({ chave: CHAVE_MSG, valor: novoTexto }, { onConflict: "chave" });
      if (error) throw error;
    },
    onSuccess: () => {
      setMensagemOriginal(mensagem);
      toast.success("Mensagem padrão salva");
      qc.invalidateQueries({ queryKey: ["config", CHAVE_MSG] });
    },
    onError: (e: any) => toast.error("Erro ao salvar: " + e.message),
  });

  const idadeMin = IDADE_MARCAS[idadeIdx];

  const { data, isLoading, refetch, isFetching } = useAtendimentosOrfaos({
    idade_min: idadeMin,
    publico,
  });
  const recuperar = useRecuperarAtendimentos();

  const orfaos = data?.orfaos ?? [];
  const counts = data?.por_publico ?? { clientes: 0, internos: 0 };
  const totalGeral = counts.clientes + counts.internos;

  const todosSelecionados = orfaos.length > 0 && orfaos.every((o) => selecionados.has(o.atendimento_id));

  const toggleAll = () => {
    if (todosSelecionados) setSelecionados(new Set());
    else setSelecionados(new Set(orfaos.map((o) => o.atendimento_id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelecionados(next);
  };

  const idsAlvo = useMemo(() => Array.from(selecionados), [selecionados]);

  const executar = (acao: "acionar_ia" | "escalar_humano" | "mensagem_desculpas" | "lote_inteligente", ids?: string[]) => {
    const atendimento_ids = ids ?? idsAlvo;
    if (!atendimento_ids.length) return;
    recuperar.mutate(
      { acao, atendimento_ids, mensagem },
      { onSuccess: () => setSelecionados(new Set()) },
    );
  };

  const preview = useMemo(() => {
    const ia = orfaos.filter((o) => o.minutos_pendente < 60).length;
    const iaDesculpa = orfaos.filter((o) => o.minutos_pendente >= 60 && o.minutos_pendente < 360).length;
    const escala = orfaos.filter((o) => o.minutos_pendente >= 360).length;
    return { ia, iaDesculpa, escala };
  }, [orfaos]);

  const ageBadge = (min: number) => {
    if (min < 60) return <Badge variant="outline" className="bg-info-soft text-info">{min}min</Badge>;
    if (min < 360) return <Badge variant="outline" className="bg-warning-soft text-warning">{Math.floor(min / 60)}h{min % 60 ? ` ${min % 60}m` : ""}</Badge>;
    return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{Math.floor(min / 60)}h+</Badge>;
  };

  const countFor = (key: PublicoFiltro): number => {
    if (key === "clientes") return counts.clientes;
    if (key === "internos") return counts.internos;
    return totalGeral;
  };

  const mensagemAlterada = mensagem !== mensagemOriginal;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Recuperação de Atendimentos Órfãos
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Detecta conversas onde a última mensagem foi do contato e ficou sem resposta. Use após downtime, falha de webhook ou IA desligada.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Seletor de Público */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">1. Quem você quer recuperar?</Label>
          <TooltipProvider delayDuration={200}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {PUBLICOS.map((p) => {
                const Icon = p.icon;
                const ativo = publico === p.key;
                const count = countFor(p.key);
                return (
                  <Tooltip key={p.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => { setPublico(p.key); setSelecionados(new Set()); }}
                        className={cn(
                          "text-left rounded-lg border-2 p-3 transition-all hover:border-primary/50",
                          ativo
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Icon className={cn("h-5 w-5", ativo ? "text-primary" : "text-muted-foreground")} />
                            <span className="font-semibold text-sm">{p.label}</span>
                          </div>
                          <Badge variant={ativo ? "default" : "secondary"} className="text-xs">
                            {count}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{p.desc}</p>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">{p.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>

        {/* Slider de idade */}
        <div className="space-y-2 p-3 rounded-md border bg-muted/30">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">2. Pendentes há mais de:</Label>
            <Badge variant="outline" className="font-mono">{formatIdade(idadeMin)}</Badge>
          </div>
          <Slider
            value={[idadeIdx]}
            onValueChange={(v) => setIdadeIdx(v[0])}
            min={0}
            max={IDADE_MARCAS.length - 1}
            step={1}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground px-1">
            {IDADE_MARCAS.map((m) => (
              <span key={m}>{formatIdade(m)}</span>
            ))}
          </div>
        </div>

        {/* Mensagem de desculpas com persistência */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">3. Mensagem de desculpas (usada em escalonamento e envio em lote)</Label>
            <Button
              size="sm"
              variant={mensagemAlterada ? "default" : "ghost"}
              className="h-7 text-xs"
              disabled={!mensagemAlterada || salvarMensagem.isPending}
              onClick={() => salvarMensagem.mutate(mensagem)}
            >
              {mensagemAlterada ? <Save className="h-3 w-3 mr-1" /> : <Check className="h-3 w-3 mr-1" />}
              {mensagemAlterada ? "Salvar como padrão" : "Salvo"}
            </Button>
          </div>
          <Textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={2}
            className="text-sm"
          />
          {mensagemAlterada && (
            <p className="text-[10px] text-warning">
              Alterações não salvas — clique em "Salvar como padrão" para persistir, ou use "Restaurar" para descartar.
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setMensagem(mensagemOriginal)}
              >
                Restaurar
              </button>
            </p>
          )}
        </div>

        {/* Ações em lote */}
        <div className="flex flex-wrap gap-2 p-3 rounded-md border bg-muted/40">
          <span className="text-xs text-muted-foreground self-center mr-2">
            {selecionados.size} selecionado(s):
          </span>
          <Button size="sm" variant="outline" disabled={!selecionados.size || recuperar.isPending} onClick={() => executar("acionar_ia")}>
            <Bot className="h-4 w-4 mr-1" /> Acionar IA
          </Button>
          <Button size="sm" variant="outline" disabled={!selecionados.size || recuperar.isPending} onClick={() => executar("mensagem_desculpas")}>
            <Send className="h-4 w-4 mr-1" /> Enviar desculpas
          </Button>
          <Button size="sm" variant="outline" disabled={!selecionados.size || recuperar.isPending} onClick={() => executar("escalar_humano")}>
            <UserCog className="h-4 w-4 mr-1" /> Escalar humano
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={!orfaos.length || recuperar.isPending}>
                <Wand2 className="h-4 w-4 mr-1" /> Recuperação inteligente em lote ({orfaos.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Recuperação inteligente em lote</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3 text-sm">
                    <p>
                      Vai processar <strong>{orfaos.length}</strong> atendimento(s) do grupo{" "}
                      <strong>
                        {publico === "clientes" ? "Clientes" : publico === "internos" ? "Lojas/Internos" : "Todos"}
                      </strong>
                      :
                    </p>
                    <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-info" /> &lt; 1h — IA reage normal</span>
                        <Badge variant="secondary">{preview.ia}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-warning" /> 1h–6h — IA com desculpa</span>
                        <Badge variant="secondary">{preview.iaDesculpa}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><UserCog className="h-4 w-4 text-destructive" /> &gt; 6h — escala humano + desculpa</span>
                        <Badge variant="secondary">{preview.escala}</Badge>
                      </div>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => executar("lote_inteligente", orfaos.map((o) => o.atendimento_id))}>
                  Confirmar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Tabela */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando...</p>
        ) : !orfaos.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            ✅ Nenhum atendimento órfão neste grupo
          </p>
        ) : (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={todosSelecionados} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Última mensagem</TableHead>
                  <TableHead>Pendente há</TableHead>
                  <TableHead>Modo</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orfaos.map((o: OrfaoRow) => (
                  <TableRow key={o.atendimento_id}>
                    <TableCell>
                      <Checkbox
                        checked={selecionados.has(o.atendimento_id)}
                        onCheckedChange={() => toggleOne(o.atendimento_id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{o.contato_nome || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{o.contato_telefone || "—"}</div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="text-xs text-muted-foreground line-clamp-2">{o.ultima_mensagem_conteudo}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(o.ultima_mensagem_at), { addSuffix: true, locale: ptBR })}
                      </div>
                    </TableCell>
                    <TableCell>{ageBadge(o.minutos_pendente)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{o.modo}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.setor_nome || "Cliente"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" disabled={recuperar.isPending}
                              onClick={() => executar("acionar_ia", [o.atendimento_id])}>
                              <Bot className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Acionar IA</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" disabled={recuperar.isPending}
                              onClick={() => executar("mensagem_desculpas", [o.atendimento_id])}>
                              <Send className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Enviar desculpas</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" disabled={recuperar.isPending}
                              onClick={() => executar("escalar_humano", [o.atendimento_id])}>
                              <UserCog className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Escalar humano</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
