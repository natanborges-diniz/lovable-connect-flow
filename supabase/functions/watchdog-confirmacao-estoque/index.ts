// Re-notifica a loja a cada 15min enquanto card "aguardando".
// Após max_tentativas, abre tarefa para supervisor do setor Estoque.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SETOR_ID = "0e7b7572-4581-4e74-88eb-afca41ab71cf";
const DEFAULT_INTERVAL_MIN = 15;
const DEFAULT_MAX_TENTATIVAS = 4;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SRK);

    // Lê payload do cron (opcional)
    let intervaloMin = DEFAULT_INTERVAL_MIN;
    let maxTentativas = DEFAULT_MAX_TENTATIVAS;
    try {
      const { data: cronRow } = await supabase
        .from("cron_jobs").select("payload")
        .eq("funcao_alvo", "watchdog-confirmacao-estoque").maybeSingle();
      const p = (cronRow?.payload || {}) as Record<string, unknown>;
      if (typeof p.intervalo_min === "number") intervaloMin = p.intervalo_min;
      if (typeof p.max_tentativas === "number") maxTentativas = p.max_tentativas;
    } catch { /* ignore */ }

    const nowIso = new Date().toISOString();

    const { data: cards, error } = await supabase
      .from("confirmacoes_estoque")
      .select("*")
      .eq("status", "aguardando")
      .not("proximo_lembrete_at", "is", null)
      .lte("proximo_lembrete_at", nowIso)
      .limit(50);
    if (error) throw error;

    const processed: Array<Record<string, unknown>> = [];

    for (const card of cards || []) {
      const tentativaAtual = (card.tentativas_lembrete || 0) + 1;

      if (tentativaAtual > maxTentativas) {
        // Escala: cria tarefa pro setor + sinaliza no card; para de re-disparar
        await supabase.from("tarefas").insert({
          titulo: `⚠️ ${card.loja_nome} não respondeu confirmação ${card.protocolo}`,
          descricao: `REF ${card.referencia} • COD ${card.codigo_produto}. Loja não respondeu após ${maxTentativas} lembretes (≈${maxTentativas * intervaloMin}min).`,
          status: "pendente",
          prioridade: "alta",
          metadata: { confirmacao_estoque_id: card.id, protocolo: card.protocolo },
        });
        await supabase.from("confirmacoes_estoque").update({
          proximo_lembrete_at: null,
          metadata: { ...(card.metadata || {}), escalado_supervisor_at: nowIso },
        }).eq("id", card.id);
        processed.push({ id: card.id, action: "escalated" });
        continue;
      }

      // Re-notifica destinatários da loja
      const { data: dests } = await supabase
        .rpc("resolver_destinatarios_loja", { _loja_nome: card.loja_nome });

      const titulo = `⏰ Lembrete ${tentativaAtual}/${maxTentativas} — ${card.protocolo}`;
      const mensagem = `${card.loja_nome}: confirmar peça REF ${card.referencia} (COD ${card.codigo_produto}). Aguardando há ${tentativaAtual * intervaloMin}min.`;

      for (const d of (dests || []) as Array<{ user_id: string; setor_id: string | null }>) {
        await supabase.from("notificacoes").insert({
          usuario_id: d.user_id,
          setor_id: d.setor_id,
          tipo: "confirmacao_estoque_lembrete",
          titulo,
          mensagem,
          referencia_id: card.demanda_id,
        });
      }

      if (card.demanda_id) {
        await supabase.from("demanda_mensagens").insert({
          demanda_id: card.demanda_id,
          direcao: "sistema",
          autor_nome: "Sistema",
          conteudo: `⏰ Lembrete ${tentativaAtual}/${maxTentativas}: aguardando confirmação da peça há ${tentativaAtual * intervaloMin}min.`,
          metadata: { lembrete: true, tentativa: tentativaAtual },
        });
      }

      await supabase.from("confirmacoes_estoque").update({
        tentativas_lembrete: tentativaAtual,
        proximo_lembrete_at: new Date(Date.now() + intervaloMin * 60_000).toISOString(),
      }).eq("id", card.id);

      processed.push({ id: card.id, action: "reminded", tentativa: tentativaAtual });
    }

    return new Response(JSON.stringify({ status: "ok", processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[watchdog-confirmacao-estoque] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
