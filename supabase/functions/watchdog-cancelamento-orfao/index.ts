// Watchdog Cancelamento Órfão
// Detecta agendamentos ainda ativos (agendado/lembrete_enviado/confirmado) cuja conversa
// contém um pedido de cancelamento do cliente e a IA NÃO chamou cancelar_visita
// (regressão do prompt, falha de tool, ou conversa antes do deploy da tool).
//
// Estratégia conservadora p/ evitar falso positivo:
//  - SE houver inbound de cancelamento + outbound posterior do bot reconhecendo o cancelamento
//    → cancela direto (status='cancelado', metadata.cancelado_origem='watchdog_cancelamento').
//  - SE houver SÓ inbound de cancelamento (sem confirmação do bot)
//    → marca metadata.pedido_cancelamento_detectado_at e cria notificação para a loja revisar.
//
// Janela: agendamentos com data_horario entre now()-12h e now()+48h (foco no horizonte útil).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Editáveis via cron_jobs.payload.thresholds
const DEFAULTS = {
  janela_passada_horas: 12,
  janela_futura_horas: 48,
  msg_lookback: 12, // últimas N mensagens consideradas
  inbound_max_horas: 48, // só considera inbound de cancelamento ≤ 48h atrás
};

// Regex de intent — conservadoras
const RE_CANCELAR = /\b(desmarc(?:ar|ado|ado\(a\)|amos|ou|ei)|cancel(?:ar|ado|amento|ei|ou)|n[aã]o (?:vou|poderei|consigo|posso|vai dar|conseguirei|conseguiria) (?:ir|comparecer|ser)|n[aã]o vou conseguir|n[aã]o vai dar|preciso (?:cancelar|desmarcar))\b/i;
// Negações que indicam que NÃO é cancelamento e sim reagendamento ("não posso nesse horário, prefiro outro")
const RE_NAO_CANCELAR = /\b(reagendar|remarcar|outro hor[aá]rio|outro dia|prefiro|antes (?:das|de)|depois (?:das|de)|mais tarde|mais cedo)\b/i;
// Bot reconhecendo o cancelamento
const RE_BOT_RECONHECEU = /\b(cancel(?:ei|amos|ado|ada)|desmarc(?:ado|ada|amos|ei)|removi\s+seu(?:\s+horário|\s+agendamento)|tudo certo,? (?:vou )?cancel)/i;

async function loadThresholds(supabase: any) {
  try {
    const { data } = await supabase
      .from("cron_jobs").select("payload")
      .eq("funcao_alvo", "watchdog-cancelamento-orfao").maybeSingle();
    const t = (data?.payload?.thresholds) || {};
    return {
      janela_passada_horas: Number(t.janela_passada_horas ?? DEFAULTS.janela_passada_horas),
      janela_futura_horas: Number(t.janela_futura_horas ?? DEFAULTS.janela_futura_horas),
      msg_lookback: Number(t.msg_lookback ?? DEFAULTS.msg_lookback),
      inbound_max_horas: Number(t.inbound_max_horas ?? DEFAULTS.inbound_max_horas),
    };
  } catch { return { ...DEFAULTS }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = Date.now();
  const TH = await loadThresholds(supabase);

  try {
    const now = Date.now();
    const janelaIni = new Date(now - TH.janela_passada_horas * 3600_000).toISOString();
    const janelaFim = new Date(now + TH.janela_futura_horas * 3600_000).toISOString();

    const { data: ags, error: agErr } = await supabase
      .from("agendamentos")
      .select("id, contato_id, atendimento_id, status, data_horario, loja_nome, metadata")
      .in("status", ["agendado", "lembrete_enviado", "confirmado"])
      .gte("data_horario", janelaIni)
      .lte("data_horario", janelaFim);
    if (agErr) throw agErr;

    if (!ags?.length) {
      return jsonOk({ checked: 0, cancelados: 0, sinalizados: 0 });
    }

    let cancelados = 0;
    let sinalizados = 0;
    const inboundCutoff = now - TH.inbound_max_horas * 3600_000;

    for (const ag of ags as any[]) {
      try {
        // Skip se já marcado como cancelado em metadata (paranoia)
        if (ag?.metadata?.cancelado_em) continue;

        // Sem atendimento_id não dá pra avaliar conversa
        if (!ag.atendimento_id) continue;

        const { data: msgs } = await supabase
          .from("mensagens")
          .select("direcao, conteudo, created_at")
          .eq("atendimento_id", ag.atendimento_id)
          .order("created_at", { ascending: false })
          .limit(TH.msg_lookback);
        if (!msgs?.length) continue;

        // ordem cronológica
        const ordered = [...msgs].reverse();

        // Procura último inbound de cancelamento (após criação do agendamento)
        let inboundIdx = -1;
        for (let i = ordered.length - 1; i >= 0; i--) {
          const m = ordered[i];
          if (m.direcao !== "inbound") continue;
          const t = new Date(m.created_at).getTime();
          if (t < inboundCutoff) break;
          const txt = String(m.conteudo || "");
          if (RE_CANCELAR.test(txt) && !RE_NAO_CANCELAR.test(txt)) {
            inboundIdx = i;
            break;
          }
        }
        if (inboundIdx < 0) continue;

        // Verifica se há outbound POSTERIOR do bot reconhecendo o cancelamento
        let botReconheceu = false;
        for (let j = inboundIdx + 1; j < ordered.length; j++) {
          const m = ordered[j];
          if (m.direcao !== "outbound") continue;
          if (RE_BOT_RECONHECEU.test(String(m.conteudo || ""))) {
            botReconheceu = true;
            break;
          }
        }

        if (botReconheceu) {
          // Cancela com segurança
          const newMeta = {
            ...(ag.metadata || {}),
            cancelado_em: new Date().toISOString(),
            cancelado_por: "cliente",
            cancelado_motivo: "Cliente desmarcou pelo WhatsApp e bot reconheceu o cancelamento",
            cancelado_origem: "watchdog_cancelamento",
            cancelado_inbound_at: ordered[inboundIdx].created_at,
          };
          await supabase.from("agendamentos")
            .update({ status: "cancelado", metadata: newMeta, updated_at: new Date().toISOString() })
            .eq("id", ag.id);
          await supabase.from("eventos_crm").insert({
            contato_id: ag.contato_id,
            tipo: "agendamento_cancelado_cliente",
            descricao: "Cancelamento detectado pelo watchdog (cliente + bot reconheceu) — IA não acionou cancelar_visita.",
            referencia_id: ag.id,
            referencia_tipo: "agendamento",
            metadata: { origem: "watchdog_cancelamento", loja_nome: ag.loja_nome, data_horario: ag.data_horario },
          });
          cancelados++;
        } else {
          // Sinaliza para revisão manual da loja
          if (ag?.metadata?.pedido_cancelamento_detectado_at) continue; // idempotente
          const newMeta = {
            ...(ag.metadata || {}),
            pedido_cancelamento_detectado_at: new Date().toISOString(),
            pedido_cancelamento_inbound_at: ordered[inboundIdx].created_at,
          };
          await supabase.from("agendamentos")
            .update({ metadata: newMeta, updated_at: new Date().toISOString() })
            .eq("id", ag.id);

          // Notifica setor da loja (se houver mapeamento). Sem conhecimento garantido do setor_id,
          // criamos uma notificação genérica vinculada ao agendamento (usuários verão pelo painel).
          await supabase.from("notificacoes").insert({
            tipo: "agendamento_pedido_cancelamento",
            titulo: `Possível cancelamento — ${ag.loja_nome}`,
            mensagem: `Cliente sinalizou cancelamento no WhatsApp. Reveja o card no Pipeline Lojas.`,
            referencia_id: ag.id,
          });
          await supabase.from("eventos_crm").insert({
            contato_id: ag.contato_id,
            tipo: "agendamento_pedido_cancelamento_detectado",
            descricao: "Watchdog detectou pedido de cancelamento sem reconhecimento do bot.",
            referencia_id: ag.id,
            referencia_tipo: "agendamento",
            metadata: { origem: "watchdog_cancelamento", loja_nome: ag.loja_nome },
          });
          sinalizados++;
        }
      } catch (e) {
        console.error(`[CANCEL-WATCHDOG] erro ag=${ag.id}:`, e);
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[CANCEL-WATCHDOG] checked=${ags.length} cancelados=${cancelados} sinalizados=${sinalizados} elapsed=${elapsed}ms`);
    await supabase.from("cron_jobs").update({ ultimo_disparo: new Date().toISOString() }).eq("funcao_alvo", "watchdog-cancelamento-orfao");
    return jsonOk({ checked: ags.length, cancelados, sinalizados });
  } catch (e) {
    console.error("[CANCEL-WATCHDOG] erro fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonOk(data: any) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
