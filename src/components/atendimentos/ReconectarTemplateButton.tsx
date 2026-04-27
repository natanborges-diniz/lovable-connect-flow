import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Template {
  nome: string;
  body: string;
  variaveis: string[];
  categoria: string;
  idioma: string;
}

interface Props {
  atendimentoId: string;
  contatoId: string;
  contatoNome?: string | null;
  ultimoInboundAt?: string | null;
  /** Tópico padrão para preencher {{2}} (ex: "seu orçamento de óculos") */
  topicoPadrao?: string;
}

const PRIORIDADE = ["retomada_contexto_1", "retomada_contexto_2", "noshow_reagendamento", "retomada_despedida"];

export function ReconectarTemplateButton({
  atendimentoId,
  contatoId,
  contatoNome,
  ultimoInboundAt,
  topicoPadrao = "seu atendimento",
}: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedNome, setSelectedNome] = useState<string>("");
  const [param1, setParam1] = useState(contatoNome?.split(" ")[0] || "");
  const [param2, setParam2] = useState(topicoPadrao);

  const horasDesdeInbound = useMemo(() => {
    if (!ultimoInboundAt) return Infinity;
    return (Date.now() - new Date(ultimoInboundAt).getTime()) / 3_600_000;
  }, [ultimoInboundAt]);

  const foraJanela = horasDesdeInbound > 24;

  // Carrega templates aprovados ao abrir
  useEffect(() => {
    if (!open || templates.length > 0) return;
    setLoading(true);
    supabase
      .from("whatsapp_templates")
      .select("nome, body, variaveis, categoria, idioma")
      .eq("status", "approved")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Erro ao carregar templates: " + error.message);
        } else if (data) {
          const lista = (data as any[]).map((t) => ({
            ...t,
            variaveis: Array.isArray(t.variaveis) ? t.variaveis : [],
          })) as Template[];
          // Ordena: prioritários primeiro, depois alfabético
          lista.sort((a, b) => {
            const ia = PRIORIDADE.indexOf(a.nome);
            const ib = PRIORIDADE.indexOf(b.nome);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.nome.localeCompare(b.nome);
          });
          setTemplates(lista);
          if (lista.length > 0 && !selectedNome) {
            // Pré-seleciona o primeiro prioritário disponível
            const padrao = lista.find((t) => PRIORIDADE.includes(t.nome)) || lista[0];
            setSelectedNome(padrao.nome);
          }
        }
        setLoading(false);
      });
  }, [open]);

  const selected = templates.find((t) => t.nome === selectedNome);

  // Atualiza nome quando contato muda
  useEffect(() => {
    if (contatoNome && !param1) setParam1(contatoNome.split(" ")[0]);
  }, [contatoNome]);

  const preview = useMemo(() => {
    if (!selected) return "";
    return selected.body
      .replace(/\{\{1\}\}/g, param1 || "[nome]")
      .replace(/\{\{2\}\}/g, param2 || "[contexto]");
  }, [selected, param1, param2]);

  const handleSend = async () => {
    if (!selected) return;
    if (!param1.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    setSending(true);
    try {
      const params: string[] = [];
      const numVars = selected.variaveis.length;
      if (numVars >= 1) params.push(param1.trim());
      if (numVars >= 2) params.push(param2.trim() || topicoPadrao);

      const { data, error } = await supabase.functions.invoke("send-whatsapp-template", {
        body: {
          contato_id: contatoId,
          template_name: selected.nome,
          template_params: params,
          language: selected.idioma || "pt_BR",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.status === "blocked_template_not_approved") {
        throw new Error(`Template não aprovado (status: ${data.template_status})`);
      }
      toast.success("Template enviado! Aguarde o cliente responder para reabrir a janela de 24h.");
      setOpen(false);
    } catch (e: any) {
      toast.error("Falha ao enviar: " + (e?.message || "Erro desconhecido"));
    } finally {
      setSending(false);
    }
  };

  if (!foraJanela) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] px-2 border-amber-500/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Reconectar
          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] border-amber-500/60 text-amber-700 dark:text-amber-400">
            +24h
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              Última mensagem do cliente há <strong>{Math.round(horasDesdeInbound)}h</strong>. Fora da janela de 24h da Meta — só template aprovado pode ser enviado.
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Nenhum template aprovado encontrado.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Template</Label>
                <Select value={selectedNome} onValueChange={setSelectedNome}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.nome} value={t.nome} className="text-xs">
                        {t.nome}
                        <span className="ml-2 text-muted-foreground">({t.categoria})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selected && selected.variaveis.length >= 1 && (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Nome do cliente {"{{1}}"}</Label>
                  <Input
                    value={param1}
                    onChange={(e) => setParam1(e.target.value)}
                    placeholder="Ex: André"
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {selected && selected.variaveis.length >= 2 && (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Contexto/assunto {"{{2}}"}</Label>
                  <Input
                    value={param2}
                    onChange={(e) => setParam2(e.target.value)}
                    placeholder="Ex: seu orçamento de óculos"
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {selected && (
                <div className="rounded-md border border-dashed border-border bg-muted/30 p-2.5">
                  <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Pré-visualização</p>
                  <p className="text-[11px] leading-relaxed whitespace-pre-wrap break-words">{preview}</p>
                </div>
              )}

              <Button
                onClick={handleSend}
                disabled={sending || !selected || !param1.trim()}
                size="sm"
                className="w-full h-8 text-xs"
              >
                {sending ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Enviando...</>
                ) : (
                  <><RefreshCw className="h-3 w-3 mr-1.5" /> Enviar template</>
                )}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
