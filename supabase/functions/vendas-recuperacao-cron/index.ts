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
    payload.delay_primeira_tentativa ?? 1,
    payload.delay_segunda_tentativa ?? 24,
  ];
  const FINAL_WAIT_HOURS = payload.espera_final ?? 1;
  const MAX_TENTATIVAS = payload.max_tentativas ?? 2;
  const INACTIVITY_DEFAULT = payload.inatividade_default ?? 48;

  // ── Cadência HUMANO (mais lenta — assume consultor pode estar conduzindo) ──
  const HUMANO_DELAY_HOURS = [
    payload.humano_delay_primeira ?? 24,
    payload.humano_delay_segunda ?? 48,
  ];
  const HUMANO_FINAL_WAIT_HOURS = payload.humano_espera_final ?? 24;
  const HUMANO_MAX_TENTATIVAS = payload.humano_max_tentativas ?? 2;
  // Se houve outbound humano nas últimas N horas, suspende retomada (consultor ativo)
  const HUMANO_COOLDOWN_HORAS = payload.humano_cooldown_horas ?? 24;

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
          DELAY_HOURS, FINAL_WAIT_HOURS, MAX_TENTATIVAS, INACTIVITY_THRESHOLDS,
          HUMANO_DELAY_HOURS, HUMANO_FINAL_WAIT_HOURS, HUMANO_MAX_TENTATIVAS, HUMANO_COOLDOWN_HORAS
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
  INACTIVITY_THRESHOLDS: Record<string, number>,
  HUMANO_DELAY_HOURS: number[], HUMANO_FINAL_WAIT_HOURS: number,
  HUMANO_MAX_TENTATIVAS: number, HUMANO_COOLDOWN_HORAS: number
) {
  const result = { processed: 0, movedToPerdidos: 0, inactivityAlerts: 0 };
  const meta = (contato.metadata as any) || {};
  const recuperacao = meta.recuperacao_vendas || { tentativas: 0 };
  const tentativas = recuperacao.tentativas || 0;

  const currentCol = colunas.find((c: any) => c.id === contato.pipeline_coluna_id);
  const colNome = currentCol?.nome || "";

  const { data: atendimento } = await supabase
    .from("atendimentos")
    .select("id, created_at, modo, metadata")
    .eq("contato_id", contato.id)
    .eq("canal", "whatsapp")
    .neq("status", "encerrado")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!atendimento) return result;

  // ─────────────────────────────────────────────────────────────
  // MODO HUMANO/HÍBRIDO — cadência via templates Meta (>24h janela)
  // ─────────────────────────────────────────────────────────────
  if (atendimento.modo === "humano" || atendimento.modo === "hibrido") {
    return await processHumano(
      supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
      contato, atendimento, colNome, perdidosCol, now,
      HUMANO_DELAY_HOURS, HUMANO_FINAL_WAIT_HOURS, HUMANO_MAX_TENTATIVAS,
      HUMANO_COOLDOWN_HORAS, INACTIVITY_THRESHOLDS, result
    );
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

  // ── COOLDOWN PÓS-HANDOFF HUMANO (24h) ──
  // Se houve mensagem outbound humana (consultor/atendente) nas últimas 24h,
  // não dispara cadência de recuperação — o consultor está conduzindo manualmente.
  // Evita templates "retomada_contexto_X" interrompendo o fluxo do operador.
  const COOLDOWN_HUMANO_MS = 24 * 60 * 60 * 1000;
  const { data: lastHumanOut } = await supabase
    .from("mensagens")
    .select("created_at, remetente_nome")
    .eq("atendimento_id", atendimento.id)
    .eq("direcao", "outbound")
    .order("created_at", { ascending: false })
    .limit(10);

  if (lastHumanOut?.length) {
    const humanOut = lastHumanOut.find((m: any) => {
      const nome = String(m.remetente_nome || "").toLowerCase();
      // Considera humano qualquer remetente que NÃO seja Gael/IA/Sistema/template
      return nome && !/gael|sistema|template|bot|ia\b/i.test(nome);
    });
    if (humanOut) {
      const since = now.getTime() - new Date(humanOut.created_at).getTime();
      if (since < COOLDOWN_HUMANO_MS) {
        const horas = Math.round(since / (60 * 60 * 1000));
        console.log(`[COOLDOWN-HUMANO] ${contato.nome}: humano respondeu há ${horas}h (<24h) — recuperação suspensa`);
        return result;
      }
    }
  }

  // ── Recovery cadence (IA-mode only) ──

  // If already completed max attempts, check if time to move to Perdidos
  if (tentativas >= MAX_TENTATIVAS) {
    const lastAttemptAt = recuperacao.ultima_tentativa_at ? new Date(recuperacao.ultima_tentativa_at) : lastInboundAt;
    const hoursSinceLastAttempt = (now.getTime() - lastAttemptAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastAttempt >= FINAL_WAIT_HOURS) {
      const firstName = (contato.nome || "").split(" ")[0] || "tudo bem";
      const despedida = `Olá ${firstName}! 😊 Agradeço muito o seu contato com as Óticas Diniz Osasco. Não quero te incomodar, então vou encerrar nossa conversa por aqui. Qualquer dúvida que surgir — sobre lentes, armações, agendamento ou orçamento — é só me chamar de volta, estou à disposição. Tenha um ótimo dia! ✨`;

      // Envia mensagem fixa de despedida via send-whatsapp (Evolution mantém continuidade)
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            atendimento_id: atendimento.id,
            texto: despedida,
            remetente_nome: "Gael",
          }),
        });
      } catch (despedidaErr) {
        console.error(`[DESPEDIDA] Failed to send for ${contato.id}:`, despedidaErr);
      }

      await supabase.from("atendimentos")
        .update({ status: "encerrado", fim_at: now.toISOString() })
        .eq("id", atendimento.id);

      await supabase.from("contatos").update({
        pipeline_coluna_id: perdidosCol.id,
        metadata: { ...meta, recuperacao_vendas: { ...recuperacao, status: "perdido", despedida_enviada_at: now.toISOString() } },
      }).eq("id", contato.id);

      await supabase.from("eventos_crm").insert({
        contato_id: contato.id,
        tipo: "lead_despedida_final",
        descricao: `Despedida final enviada após ${MAX_TENTATIVAS} retomadas sem resposta. Atendimento encerrado e lead movido para Perdidos.`,
        metadata: { mensagem: despedida },
      });

      result.movedToPerdidos++;
      console.log(`[DESPEDIDA] ${contato.nome} (${contato.id}) recebeu despedida + movido para Perdidos`);
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

// ─────────────────────────────────────────────────────────────────────
// Cadência de retomada para atendimentos em modo HUMANO/HÍBRIDO
// (cliente sem resposta após handoff). Usa templates Meta aprovados
// pois normalmente está fora da janela de 24h. Respeita cooldown
// quando o consultor responde manualmente.
// ─────────────────────────────────────────────────────────────────────
async function processHumano(
  supabase: any, SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string,
  contato: any, atendimento: any, colNome: string, perdidosCol: any, now: Date,
  DELAY_HOURS: number[], FINAL_WAIT_HOURS: number, MAX_TENTATIVAS: number,
  COOLDOWN_HORAS: number, INACTIVITY_THRESHOLDS: Record<string, number>,
  result: { processed: number; movedToPerdidos: number; inactivityAlerts: number }
) {
  const atMeta = (atendimento.metadata as any) || {};
  const recH = atMeta.recuperacao_humano || { tentativas: 0 };
  const tentativas = recH.tentativas || 0;

  const { data: lastInbound } = await supabase
    .from("mensagens")
    .select("created_at, conteudo")
    .eq("atendimento_id", atendimento.id)
    .eq("direcao", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lastInbound) return result;

  const lastInboundAt = new Date(lastInbound.created_at);
  const hoursSinceInbound = (now.getTime() - lastInboundAt.getTime()) / (1000 * 60 * 60);

  // Alerta interno em ALERTA_HORAS (default da coluna ou 6h fallback humano)
  const ALERTA_HORAS = INACTIVITY_THRESHOLDS[colNome] || 6;
  if (hoursSinceInbound >= ALERTA_HORAS) {
    const { data: existingNotif } = await supabase
      .from("notificacoes")
      .select("id")
      .eq("referencia_id", contato.id)
      .eq("tipo", "inatividade_humano")
      .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString())
      .limit(1);
    if (!existingNotif?.length) {
      await supabase.from("notificacoes").insert({
        titulo: `⚠ Inatividade humano: ${contato.nome}`,
        mensagem: `Cliente em "${colNome}" sem resposta há ${Math.round(hoursSinceInbound)}h após handoff`,
        tipo: "inatividade_humano",
        referencia_id: contato.id,
      });
      result.inactivityAlerts++;
    }
  }

  // Cooldown: se houve outbound humano nas últimas N horas, suspende retomada
  const { data: lastOutbound } = await supabase
    .from("mensagens")
    .select("created_at, remetente_nome, conteudo")
    .eq("atendimento_id", atendimento.id)
    .eq("direcao", "outbound")
    .order("created_at", { ascending: false })
    .limit(10);

  if (lastOutbound?.length) {
    const humanOut = lastOutbound.find((m: any) => {
      const nome = String(m.remetente_nome || "").toLowerCase();
      return nome && !/gael|sistema|template|bot|ia\b/i.test(nome);
    });
    if (humanOut) {
      const sinceOut = (now.getTime() - new Date(humanOut.created_at).getTime()) / (1000 * 3600);
      if (sinceOut < COOLDOWN_HORAS) {
        console.log(`[HUMANO-COOLDOWN] ${contato.nome}: consultor respondeu há ${Math.round(sinceOut)}h (<${COOLDOWN_HORAS}h)`);
        return result;
      }
    }
  }

  // Despedida final: já atingiu MAX e passou FINAL_WAIT_HOURS desde a última tentativa
  if (tentativas >= MAX_TENTATIVAS) {
    const lastAttemptAt = recH.ultima_tentativa_at ? new Date(recH.ultima_tentativa_at) : lastInboundAt;
    const hoursSince = (now.getTime() - lastAttemptAt.getTime()) / (1000 * 3600);
    if (hoursSince < FINAL_WAIT_HOURS) return result;

    const firstName = (contato.nome || "").split(" ")[0] || "tudo bem";
    const topico = inferirTopico(lastOutbound) || "seu atendimento";

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          contato_id: contato.id,
          template_name: "retomada_despedida",
          template_params: [firstName, topico],
          language: "pt_BR",
        }),
      });
    } catch (e) {
      console.error(`[HUMANO-DESPEDIDA] template falhou para ${contato.id}:`, e);
    }

    await supabase.from("atendimentos").update({
      status: "encerrado",
      modo: "ia",
      fim_at: now.toISOString(),
      metadata: { ...atMeta, recuperacao_humano: { ...recH, status: "perdido_humano", despedida_at: now.toISOString() } },
    }).eq("id", atendimento.id);

    await supabase.from("contatos").update({
      pipeline_coluna_id: perdidosCol.id,
    }).eq("id", contato.id);

    await supabase.from("eventos_crm").insert({
      contato_id: contato.id,
      tipo: "lead_despedida_humano",
      descricao: `Despedida via template enviada após ${MAX_TENTATIVAS} retomadas humano sem resposta. Movido para Perdidos.`,
      metadata: { topico, tentativas },
    });

    result.movedToPerdidos++;
    console.log(`[HUMANO-DESPEDIDA] ${contato.nome} → Perdidos`);
    return result;
  }

  // Disparo de retomada
  const requiredDelay = DELAY_HOURS[tentativas] ?? DELAY_HOURS[DELAY_HOURS.length - 1] ?? 24;
  const referenceTime = tentativas === 0
    ? lastInboundAt
    : (recH.ultima_tentativa_at ? new Date(recH.ultima_tentativa_at) : lastInboundAt);
  const hoursSinceRef = (now.getTime() - referenceTime.getTime()) / (1000 * 3600);
  if (hoursSinceRef < requiredDelay) return result;

  const firstName = (contato.nome || "").split(" ")[0] || "tudo bem";
  const topico = inferirTopico(lastOutbound) || "seu atendimento";
  const TEMPLATES = ["retomada_contexto_1", "retomada_contexto_2"];
  const templateName = TEMPLATES[tentativas] || TEMPLATES[TEMPLATES.length - 1];

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contato_id: contato.id,
        template_name: templateName,
        template_params: [firstName, topico],
        language: "pt_BR",
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`[HUMANO-RETOMADA] template ${templateName} falhou para ${contato.id}: ${txt}`);
      return result;
    }

    await supabase.from("atendimentos").update({
      metadata: {
        ...atMeta,
        recuperacao_humano: {
          tentativas: tentativas + 1,
          ultima_tentativa_at: now.toISOString(),
          template_usado: templateName,
          topico,
        },
      },
    }).eq("id", atendimento.id);

    await supabase.from("eventos_crm").insert({
      contato_id: contato.id,
      tipo: "recuperacao_humano_tentativa",
      descricao: `Retomada humano ${tentativas + 1}/${MAX_TENTATIVAS} via template ${templateName} (tópico: ${topico})`,
      metadata: { tentativa: tentativas + 1, template: templateName, topico },
    });

    result.processed++;
    console.log(`[HUMANO-RETOMADA] ${contato.nome}: ${templateName} (tentativa ${tentativas + 1}/${MAX_TENTATIVAS}) tópico="${topico}"`);
  } catch (e) {
    console.error(`[HUMANO-RETOMADA] erro para ${contato.id}:`, e);
  }

  return result;
}

// Infere tópico ({{2}} do template) das últimas mensagens outbound humanas
function inferirTopico(outbound: any[] | null): string | null {
  if (!outbound?.length) return null;
  const humanos = outbound.filter((m: any) => {
    const nome = String(m.remetente_nome || "").toLowerCase();
    return nome && !/gael|sistema|template|bot|ia\b/i.test(nome);
  }).slice(0, 5);
  const texto = humanos.map((m: any) => String(m.conteudo || "")).join(" ").toLowerCase();
  if (!texto) return null;

  if (/lentes? de contato|lente diária|lente mensal/.test(texto)) return "as lentes de contato";
  if (/orçamento|orcamento|preço|preco|valor/.test(texto)) return "seu orçamento";
  if (/agendar|agendamento|visita|horário|horario/.test(texto)) return "sua visita à loja";
  if (/receita|grau|exame/.test(texto)) return "sua receita";
  if (/armaç|armac|óculos|oculos|modelo/.test(texto)) return "seus óculos";
  if (/multifocal|progressiv/.test(texto)) return "suas lentes multifocais";
  return null;
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
