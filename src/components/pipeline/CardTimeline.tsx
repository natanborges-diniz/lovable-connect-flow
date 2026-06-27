import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRightLeft, MessageSquare, Undo2, Ban, CheckCircle2, Zap, Clock, RefreshCw, FileText, Paperclip, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineEntidade = "solicitacao" | "demanda_loja" | "contato" | "agendamento";

interface Evento {
  id: string;
  tipo: string;
  descricao: string | null;
  coluna_anterior_id: string | null;
  coluna_nova_id: string | null;
  usuario_nome: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  movido_coluna: ArrowRightLeft,
  comentario: MessageSquare,
  devolvido_para_loja: Undo2,
  devolvido_pela_loja: CheckCircle2,
  cancelado: Ban,
  automacao: Zap,
  boleto_enviado: FileText,
  boleto_revisao_solicitada: RefreshCw,
  boleto_revisao_concluida: CheckCircle2,
  boleto_anexo_extra: Paperclip,
  boleto_envio_bloqueado: ShieldAlert,
};

const COLOR_MAP: Record<string, string> = {
  movido_coluna: "text-primary",
  comentario: "text-muted-foreground",
  devolvido_para_loja: "text-amber-600",
  devolvido_pela_loja: "text-emerald-600",
  cancelado: "text-destructive",
  automacao: "text-blue-600",
  boleto_enviado: "text-emerald-600",
  boleto_revisao_solicitada: "text-amber-600",
  boleto_revisao_concluida: "text-emerald-600",
  boleto_anexo_extra: "text-blue-600",
  boleto_envio_bloqueado: "text-destructive",
};

export function CardTimeline({
  entidade,
  entidadeId,
}: {
  entidade: TimelineEntidade;
  entidadeId: string;
}) {
  const qc = useQueryClient();

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["pipeline_card_eventos", entidade, entidadeId],
    enabled: !!entidadeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_card_eventos" as any)
        .select("*")
        .eq("entidade", entidade)
        .eq("entidade_id", entidadeId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as unknown as Evento[];
    },
  });

  const { data: colunas = [] } = useQuery({
    queryKey: ["pipeline_colunas_lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("pipeline_colunas").select("id, nome");
      return (data || []) as { id: string; nome: string }[];
    },
  });

  const colunaNome = (id: string | null) =>
    id ? colunas.find((c) => c.id === id)?.nome || "—" : "—";

  // Realtime
  useEffect(() => {
    if (!entidadeId) return;
    const ch = supabase
      .channel(`card-eventos-${entidade}-${entidadeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pipeline_card_eventos", filter: `entidade_id=eq.${entidadeId}` },
        () => qc.invalidateQueries({ queryKey: ["pipeline_card_eventos", entidade, entidadeId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [entidade, entidadeId, qc]);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground py-4">Carregando histórico…</p>;
  }
  if (eventos.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs">Nenhum evento registrado ainda.</p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-3 border-l border-border pl-4 ml-1">
      {eventos.map((e) => {
        const Icon = ICON_MAP[e.tipo] || Clock;
        const color = COLOR_MAP[e.tipo] || "text-muted-foreground";
        return (
          <li key={e.id} className="relative">
            <span className={cn(
              "absolute -left-[22px] flex h-4 w-4 items-center justify-center rounded-full bg-background border border-border",
              color,
            )}>
              <Icon className="h-2.5 w-2.5" />
            </span>
            <div className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{e.usuario_nome || "Sistema"}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {format(new Date(e.created_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              </div>
              {e.tipo === "movido_coluna" ? (
                <p className="text-muted-foreground">
                  Moveu de <span className="font-medium text-foreground">{colunaNome(e.coluna_anterior_id)}</span>
                  {" → "}
                  <span className="font-medium text-foreground">{colunaNome(e.coluna_nova_id)}</span>
                </p>
              ) : (
                <p className="text-muted-foreground whitespace-pre-wrap">{e.descricao || e.tipo}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Helper para registrar movimentação no Kanban. */
export async function logCardMove(args: {
  entidade: TimelineEntidade;
  entidadeId: string;
  colunaAnterior: string | null;
  colunaNova: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  let usuario_nome: string | null = null;
  if (u?.user?.id) {
    const { data: prof } = await supabase
      .from("profiles").select("nome").eq("id", u.user.id).maybeSingle();
    usuario_nome = prof?.nome || u.user.email || null;
  }
  await supabase.from("pipeline_card_eventos" as any).insert({
    entidade: args.entidade,
    entidade_id: args.entidadeId,
    tipo: "movido_coluna",
    descricao: null,
    coluna_anterior_id: args.colunaAnterior,
    coluna_nova_id: args.colunaNova,
    usuario_id: u?.user?.id || null,
    usuario_nome,
  } as any);
}
