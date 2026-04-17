import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Bot, RefreshCw, Send, UserCog, Wand2, Clock } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAtendimentosOrfaos, useRecuperarAtendimentos, type OrfaoRow } from "@/hooks/useAtendimentosOrfaos";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const MENSAGEM_PADRAO = "Olá! Desculpe a demora em responder, estamos retomando seu atendimento agora. Em instantes nossa equipe vai te atender. 🙏";

export function RecuperacaoCard() {
  const [idadeMin, setIdadeMin] = useState<number>(15);
  const [setorId, setSetorId] = useState<string>("all");
  const [modoFiltro, setModoFiltro] = useState<string>("all");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [mensagem, setMensagem] = useState<string>(MENSAGEM_PADRAO);

  const { data: setores } = useQuery({
    queryKey: ["setores"],
    queryFn: async () => {
      const { data } = await supabase.from("setores").select("id, nome").order("nome");
      return data || [];
    },
  });

  const { data, isLoading, refetch, isFetching } = useAtendimentosOrfaos({
    idade_min: idadeMin,
    setor_id: setorId === "all" ? undefined : setorId,
    modo: modoFiltro === "all" ? undefined : modoFiltro,
  });
  const recuperar = useRecuperarAtendimentos();

  const orfaos = data?.orfaos ?? [];
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

  const ageBadge = (min: number) => {
    if (min < 60) return <Badge variant="outline" className="bg-info-soft text-info">{min}min</Badge>;
    if (min < 360) return <Badge variant="outline" className="bg-warning-soft text-warning">{Math.floor(min / 60)}h{min % 60 ? ` ${min % 60}m` : ""}</Badge>;
    return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{Math.floor(min / 60)}h+</Badge>;
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Recuperação de Atendimentos Órfãos
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Detecta conversas onde a última mensagem foi do cliente e ficou sem resposta. Use após downtime, falha de webhook ou IA desligada.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Idade mínima</Label>
            <Select value={String(idadeMin)} onValueChange={(v) => setIdadeMin(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="15">&gt; 15 minutos</SelectItem>
                <SelectItem value="60">&gt; 1 hora</SelectItem>
                <SelectItem value="360">&gt; 6 horas</SelectItem>
                <SelectItem value="1440">&gt; 24 horas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Setor</Label>
            <Select value={setorId} onValueChange={setSetorId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(setores || []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modo</Label>
            <Select value={modoFiltro} onValueChange={setModoFiltro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ia">IA</SelectItem>
                <SelectItem value="hibrido">Híbrido</SelectItem>
                <SelectItem value="humano">Humano</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">{data?.total ?? 0}</span>
              <span className="text-muted-foreground">pendente(s)</span>
            </div>
          </div>
        </div>

        {/* Mensagem de desculpas */}
        <div className="space-y-1">
          <Label className="text-xs">Mensagem de desculpas (usada em escalonamento e envio em lote)</Label>
          <Textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={2}
            className="text-sm"
          />
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
                <Wand2 className="h-4 w-4 mr-1" /> Recuperação em massa (todos)
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Recuperação em massa</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>Vai processar <strong>{orfaos.length}</strong> atendimento(s) com a regra inteligente:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>&lt; 1h → aciona IA normalmente</li>
                      <li>1h–6h → aciona IA com prefixo de desculpa</li>
                      <li>&gt; 6h → escala humano + envia mensagem de desculpas</li>
                    </ul>
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
            ✅ Nenhum atendimento órfão dentro do filtro
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
                    <TableCell className="text-xs text-muted-foreground">{o.setor_nome || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Acionar IA" disabled={recuperar.isPending}
                          onClick={() => executar("acionar_ia", [o.atendimento_id])}>
                          <Bot className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Escalar humano" disabled={recuperar.isPending}
                          onClick={() => executar("escalar_humano", [o.atendimento_id])}>
                          <UserCog className="h-4 w-4" />
                        </Button>
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
