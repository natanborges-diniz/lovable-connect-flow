import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Read configurable parameters from payload (with defaults)
  let payload: Record<string, any> = {};
  try {
    const body = await req.json();
    payload = body || {};
  } catch {
    // No body = manual trigger
  }

  const DELAY_HOURS = [
    payload.delay_primeira_tentativa ?? 48,
    payload.delay_segunda_tentativa ?? 72,
    payload.delay_terceira_tentativa ?? 72,
  ];
  const FINAL_WAIT_HOURS = payload.espera_final ?? 72;
  const MAX_TENTATIVAS = payload.max_tentativas ?? 3;
  const INACTIVITY_DEFAULT = payload.inatividade_default ?? 48;

  // Eligible columns — configurable via payload
  const colunasElegiveisStr = payload.colunas_elegiveis ?? "Novo Contato,Lead,Orçamento,Qualificado,Retorno";
  const ELIGIBLE_COLUMNS = typeof colunasElegiveisStr === "string"
    ? colunasElegiveisStr.split(",").map((s: string) => s.trim()).filter(Boolean)
    : colunasElegiveisStr;

  const INACTIVITY_THRESHOLDS: Record<string, number> = {
    "Reclamações": 24,
    default: INACTIVITY_DEFAULT,
  };

  try {
    // ── 0. PROCESS PENDING LEMBRETES ──
    const lembretesEnviados = await processLembretes(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 1. Get eligible sales columns IDs ──
    const { data: colunas } = await supabase
      .from("pipeline_colunas")
      .select("id, nome, grupo_funil")
      .eq("ativo", true)
      .is("setor_id", null);

    if (!colunas?.length) {
      return jsonResponse({ status: "no_columns", lembretes_enviados: lembretesEnviados });
    }

    const eligibleIds = colunas
      .filter((c: any) => ELIGIBLE_COLUMNS.includes(c.nome))
      .map((c: any) => c.id);

    const perdidosCol = colunas.find((c: any) => c.nome === "Perdidos");
    if (!perdidosCol) {
      console.error("Coluna 'Perdidos' not found");
      return jsonResponse({ error: "Perdidos column missing" }, 500);
    }

    if (!eligibleIds.length) {
      return jsonResponse({ status: "no_eligible_columns", lembretes_enviados: lembretesEnviados });
    }

    // ── 2. Get contacts in eligible columns ──
    const { data: contatos } = await supabase
      .from("contatos")
      .select("id, nome, telefone, pipeline_coluna_id, metadata")
      .eq("ativo", true)
      .eq("tipo", "cliente")
      .in("pipeline_coluna_id", eligibleIds);

    if (!contatos?.length) {
      return jsonResponse({ status: "no_contacts", processed: 0, lembretes_enviados: lembretesEnviados });
    }

    const now = new Date();
    let processed = 0;
    let movedToPerdidos = 0;
    let inactivityAlerts = 0;

    for (const contato of contatos) {
      try {
        const result = await processContato(
          supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
          contato, colunas, perdidosCol, now,
          DELAY_HOURS, FINAL_WAIT_HOURS, MAX_TENTATIVAS, INACTIVITY_THRESHOLDS
        );
        processed += result.processed;
        movedToPerdidos += result.movedToPerdidos;
        inactivityAlerts += result.inactivityAlerts;
      } catch (contactErr) {
        console.error(`Error processing contact ${contato.id}:`, contactErr);
      }
    }

    return jsonResponse({
      status: "ok",
      processed,
      moved_to_perdidos: movedToPerdidos,
      inactivity_alerts: inactivityAlerts,
      lembretes_enviados: lembretesEnviados,
      total_checked: contatos.length,
    });
  } catch (e) {
    console.error("vendas-recuperacao-cron error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

// ── Process a single contact ──
async function processContato(
  supabase: any, SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string,
  contato: any, colunas: any[], perdidosCol: any, now: Date,
  DELAY_HOURS: number[], FINAL_WAIT_HOURS: number, MAX_TENTATIVAS: number,
  INACTIVITY_THRESHOLDS: Record<string, number>
) {
  const result = { processed: 0, movedToPerdidos: 0, inactivityAlerts: 0 };
  const meta = (contato.metadata as any) || {};
  const recuperacao = meta.recuperacao_vendas || { tentativas: 0 };
  const tentativas = recuperacao.tentativas || 0;

  const currentCol = colunas.find((c: any) => c.id === contato.pipeline_coluna_id);
  const colNome = currentCol?.nome || "";

  const { data: atendimento } = await supabase
    .from("atendimentos")
    .select("id, created_at, modo")
    .eq("contato_id", contato.id)
    .eq("canal", "whatsapp")
    .neq("status", "encerrado")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!atendimento) return result;

  // Skip contacts in human mode
  if (atendimento.modo === "humano" || atendimento.modo === "hibrido") {
    // Inactivity alerts for human-mode
    const { data: lastInbound } = await supabase
      .from("mensagens")
      .select("created_at")
      .eq("atendimento_id", atendimento.id)
      .eq("direcao", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (lastInbound) {
      const hoursSinceInbound = (now.getTime() - new Date(lastInbound.created_at).getTime()) / (1000 * 60 * 60);
      const threshold = INACTIVITY_THRESHOLDS[colNome] || INACTIVITY_THRESHOLDS.default;
      if (hoursSinceInbound >= threshold) {
        const { data: existingNotif } = await supabase
          .from("notificacoes")
          .select("id")
          .eq("referencia_id", contato.id)
          .eq("tipo", "inatividade_humano")
          .gte("created_at", new Date(now.getTime() - threshold * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (!existingNotif?.length) {
          await supabase.from("notificacoes").insert({
            titulo: `⚠ Inatividade: ${contato.nome}`,
            mensagem: `Contato em "${colNome}" aguardando atendimento humano há ${Math.round(hoursSinceInbound)}h`,
            tipo: "inatividade_humano",
            referencia_id: contato.id,
          });
          result.inactivityAlerts++;
        }
      }
    }
    return result;
  }

  // Find last inbound message time
  const { data: lastInbound } = await supabase
    .from("mensagens")
    .select("created_at")
    .eq("atendimento_id", atendimento.id)
    .eq("direcao", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastInbound) return result;

  const lastInboundAt = new Date(lastInbound.created_at);

  // ── Recovery cadence (IA-mode only) ──

  // If already completed max attempts, check if time to move to Perdidos
  if (tentativas >= MAX_TENTATIVAS) {
    const lastAttemptAt = recuperacao.ultima_tentativa_at ? new Date(recuperacao.ultima_tentativa_at) : lastInboundAt;
    const hoursSinceLastAttempt = (now.getTime() - lastAttemptAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastAttempt >= FINAL_WAIT_HOURS) {
      await supabase.from("atendimentos")
        .update({ status: "encerrado", fim_at: now.toISOString() })
        .eq("id", atendimento.id);

      await supabase.from("contatos").update({
        pipeline_coluna_id: perdidosCol.id,
        metadata: { ...meta, recuperacao_vendas: { ...recuperacao, status: "perdido" } },
      }).eq("id", contato.id);

      await supabase.from("eventos_crm").insert({
        contato_id: contato.id,
        tipo: "lead_perdido",
        descricao: `Lead movido para Perdidos após ${MAX_TENTATIVAS} tentativas de recuperação sem resposta. Atendimento encerrado automaticamente.`,
      });

      result.movedToPerdidos++;
      console.log(`[PERDIDO] ${contato.nome} (${contato.id}) moved to Perdidos + atendimento closed`);
    }
    return result;
  }

  // Determine required delay
  const requiredDelay = DELAY_HOURS[tentativas] ?? DELAY_HOURS[DELAY_HOURS.length - 1] ?? 72;

  const referenceTime = tentativas === 0
    ? lastInboundAt
    : (recuperacao.ultima_tentativa_at ? new Date(recuperacao.ultima_tentativa_at) : lastInboundAt);

  const hoursSinceReference = (now.getTime() - referenceTime.getTime()) / (1000 * 60 * 60);
  if (hoursSinceReference < requiredDelay) return result;

  // Generate context summary on first attempt
  let resumoContexto = recuperacao.resumo_contexto || "";
  if (tentativas === 0) {
    resumoContexto = await generateSummary(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento.id, contato.id);
  }

  const firstName = contato.nome.split(" ")[0];
  try {
    const aiResp = await fetch(`${SUPABASE_URL}/functions/v1/responder-solicitacao`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        atendimento_id: atendimento.id,
        modo: "recuperacao",
        contexto: {
          tentativa: tentativas + 1,
          total_tentativas: MAX_TENTATIVAS,
          nome_cliente: firstName,
          resumo: resumoContexto,
          is_final: tentativas === MAX_TENTATIVAS - 1,
        },
      }),
    });

    if (!aiResp.ok) {
      console.warn(`AI recovery failed for ${contato.id}, falling back to template`);
      await sendRecoveryTemplate(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, contato, tentativas, firstName, resumoContexto);
    }

    const updatedRecuperacao = {
      tentativas: tentativas + 1,
      ultima_tentativa_at: now.toISOString(),
      resumo_contexto: resumoContexto,
    };

    await supabase.from("contatos").update({
      metadata: { ...meta, recuperacao_vendas: updatedRecuperacao },
    }).eq("id", contato.id);

    await supabase.from("eventos_crm").insert({
      contato_id: contato.id,
      tipo: "recuperacao_tentativa",
      descricao: `Tentativa ${tentativas + 1}/${MAX_TENTATIVAS} de recuperação via IA`,
      metadata: { tentativa: tentativas + 1 },
    });

    result.processed++;
    console.log(`[RECOVERY] ${contato.nome}: attempt ${tentativas + 1}/${MAX_TENTATIVAS} via IA`);
  } catch (sendErr) {
    console.error(`Send error for ${contato.id}:`, sendErr);
  }

  return result;
}

// ── Generate summary ──
async function generateSummary(
  supabase: any, SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string,
  atendimentoId: string, contatoId: string
): Promise<string> {
  try {
    const sumResp = await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ atendimento_id: atendimentoId }),
    });
    if (sumResp.ok) {
      const sumData = await sumResp.json();
      let resumo = sumData.summary || sumData.resumo || "seus óculos";
      if (resumo.length > 100) resumo = resumo.substring(0, 97) + "...";
      return resumo;
    }
  } catch (e) {
    console.error(`Summary failed for ${contatoId}:`, e);
  }
  return "seus óculos";
}

// ── Fallback: send template ──
async function sendRecoveryTemplate(
  supabase: any, SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string,
  contato: any, tentativas: number, firstName: string, resumoContexto: string
) {
  const TEMPLATES = ["retomada_contexto_1", "retomada_contexto_2", "retomada_despedida"];
  const templateName = TEMPLATES[tentativas] || TEMPLATES[TEMPLATES.length - 1];

  await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contato_id: contato.id,
      template_name: templateName,
      template_params: [firstName, resumoContexto],
      language: "pt_BR",
    }),
  });
}

// ── Process pending lembretes ──
async function processLembretes(supabase: any, SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string): Promise<number> {
  let lembretesEnviados = 0;
  try {
    const { data: lembretesPendentes } = await supabase
      .from("lembretes")
      .select("id, contato_id, atendimento_id, mensagem")
      .eq("status", "pendente")
      .lte("data_disparo", new Date().toISOString())
      .limit(50);

    if (!lembretesPendentes?.length) return 0;

    for (const lembrete of lembretesPendentes) {
      try {
        let atendimentoId = lembrete.atendimento_id;
        if (!atendimentoId) {
          const { data: at } = await supabase
            .from("atendimentos")
            .select("id")
            .eq("contato_id", lembrete.contato_id)
            .eq("canal", "whatsapp")
            .neq("status", "encerrado")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          atendimentoId = at?.id;
        }

        if (atendimentoId) {
          const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              atendimento_id: atendimentoId,
              mensagem: lembrete.mensagem,
              remetente_nome: "Gael",
            }),
          });

          if (sendResp.ok) {
            await supabase.from("lembretes").update({ status: "enviado", updated_at: new Date().toISOString() }).eq("id", lembrete.id);
            lembretesEnviados++;
          } else {
            console.error(`[LEMBRETE] Send failed for ${lembrete.id}: ${await sendResp.text()}`);
          }
        } else {
          await supabase.from("lembretes").update({ status: "falhou", updated_at: new Date().toISOString() }).eq("id", lembrete.id);
        }
      } catch (lemErr) {
        console.error(`[LEMBRETE] Error processing ${lembrete.id}:`, lemErr);
      }
    }
  } catch (lemGlobalErr) {
    console.error("[LEMBRETE] Global error:", lemGlobalErr);
  }
  return lembretesEnviados;
}

// ── Helpers ──
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
