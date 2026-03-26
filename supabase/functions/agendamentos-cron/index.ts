import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Agendamentos CRON — Motor de Transição Temporal
 * 
 * Apenas MOVE cards entre colunas/status.
 * As automações são disparadas pelos triggers de mudança de status → pipeline-automations.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date();
  const results: string[] = [];

  try {
    // ═══════════════════════════════════════════
    // A) TRANSIÇÃO → "lembrete_enviado" (24h antes)
    //    Agendamentos de amanhã que ainda estão "agendado"
    //    Move para "lembrete_enviado" → trigger dispara template lembrete
    // ═══════════════════════════════════════════
    // Include TODAY (same-day agendamentos still in "agendado") and TOMORROW
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

    const { data: paraLembrete } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("status", "agendado")
      .gte("data_horario", todayStart)
      .lt("data_horario", tomorrowEnd);

    for (const ag of paraLembrete || []) {
      await supabase.from("agendamentos").update({
        status: "lembrete_enviado",
        tentativas_lembrete: 1,
      }).eq("id", ag.id);
      results.push(`lembrete_enviado:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // B) REENVIO DE LEMBRETE ao cliente (2ª tentativa)
    //    Status "lembrete_enviado", tentativas_lembrete = 1,
    //    4h+ sem resposta inbound OU 2h antes do horário
    // ═══════════════════════════════════════════
    await processLembreteRetry(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results);

    // ═══════════════════════════════════════════
    // C) COBRANÇA À LOJA — horário do agendamento passou
    //    Envia primeira cobrança, seta tentativas_cobranca_loja = 1
    // ═══════════════════════════════════════════
    await processFirstStoreCharge(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results);

    // ═══════════════════════════════════════════
    // D) SEGUNDA COBRANÇA À LOJA (3h sem resposta)
    // ═══════════════════════════════════════════
    await processSecondStoreCharge(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results);

    // ═══════════════════════════════════════════
    // E) TIMEOUT DA LOJA (6h+ após 2ª cobrança)
    //    Assume NO-SHOW + cria tarefa manual
    // ═══════════════════════════════════════════
    await processStoreTimeout(supabase, now, results);

    // ═══════════════════════════════════════════
    // F) COBRANÇAS AGENDADAS (noshow_agendar_para)
    //    Executar cobranças agendadas para a manhã seguinte
    // ═══════════════════════════════════════════
    const { data: cobrancasAgendadas } = await supabase
      .from("agendamentos")
      .select("id")
      .in("status", ["agendado", "lembrete_enviado", "confirmado"])
      .is("loja_confirmou_presenca", null)
      .not("noshow_agendar_para", "is", null)
      .lte("noshow_agendar_para", now.toISOString());

    for (const ag of cobrancasAgendadas || []) {
      await supabase.from("agendamentos").update({
        status: "no_show",
        noshow_agendar_para: null,
      }).eq("id", ag.id);
      results.push(`cobranca_executada:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // G) ABANDONO — 48h+ sem resposta após 2 tentativas de recuperação
    // ═══════════════════════════════════════════
    const { data: emRecuperacao } = await supabase
      .from("agendamentos")
      .select("id, contato_id, tentativas_recuperacao, updated_at, atendimento_id")
      .in("status", ["no_show", "recuperacao"]);

    for (const ag of emRecuperacao || []) {
      const lastUpdate = new Date(ag.updated_at);
      const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

      // Check if client responded recently
      if (ag.atendimento_id) {
        const { data: recentInbound } = await supabase
          .from("mensagens")
          .select("id")
          .eq("atendimento_id", ag.atendimento_id)
          .eq("direcao", "inbound")
          .gt("created_at", lastUpdate.toISOString())
          .limit(1);

        if (recentInbound?.length) {
          if (ag.status !== "recuperacao") {
            await supabase.from("agendamentos").update({ status: "recuperacao" }).eq("id", ag.id);
          }
          continue;
        }
      }

      // Second recovery attempt at 24h
      if ((ag.tentativas_recuperacao || 0) === 1 && hoursSinceUpdate >= 24) {
        await supabase.from("agendamentos").update({
          tentativas_recuperacao: 2,
          status: "recuperacao",
        }).eq("id", ag.id);
        results.push(`recuperacao_2:${ag.id}`);
      }

      // Abandon at 48h+ after 2 attempts
      if ((ag.tentativas_recuperacao || 0) >= 2 && hoursSinceUpdate >= 48) {
        await supabase.from("agendamentos").update({ status: "abandonado" }).eq("id", ag.id);
        results.push(`abandonado:${ag.id}`);
      }
    }

    console.log(`[CRON] Processed: ${results.join(", ") || "nothing"}`);
    return new Response(JSON.stringify({ status: "ok", processed: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("agendamentos-cron error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ═══════════════════════════════════════════
// Helper: Reenvio de lembrete ao cliente
// ═══════════════════════════════════════════
async function processLembreteRetry(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  const { data: pendentes } = await supabase
    .from("agendamentos")
    .select("id, contato_id, atendimento_id, data_horario, updated_at, loja_nome")
    .eq("status", "lembrete_enviado")
    .eq("tentativas_lembrete", 1);

  for (const ag of pendentes || []) {
    const lastUpdate = new Date(ag.updated_at);
    const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);
    const hoursUntilAppointment = (new Date(ag.data_horario).getTime() - now.getTime()) / (1000 * 60 * 60);

    // Send 2nd attempt if 4h+ passed OR less than 2h until appointment
    if (hoursSinceUpdate < 4 && hoursUntilAppointment > 2) continue;

    // Check if client responded (skip if they did)
    if (ag.atendimento_id) {
      const { data: recentInbound } = await supabase
        .from("mensagens")
        .select("id")
        .eq("atendimento_id", ag.atendimento_id)
        .eq("direcao", "inbound")
        .gt("created_at", lastUpdate.toISOString())
        .limit(1);

      if (recentInbound?.length) continue; // Client responded, skip
    }

    // Get client name for message
    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    const firstName = contato?.nome?.split(" ")[0] || "Cliente";
    const dt = new Date(ag.data_horario);
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

    // Send 2nd reminder via atendimento if available
    if (ag.atendimento_id) {
      const msg = `Oi ${firstName}, ainda não conseguimos confirmar sua visita às *${hora}* na *${ag.loja_nome}*. Podemos manter? Responda SIM ou se preferir reagendar, é só dizer 😊`;
      await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ atendimento_id: ag.atendimento_id, texto: msg, remetente_nome: "Sistema" }),
      });
    }

    await supabase.from("agendamentos").update({ tentativas_lembrete: 2 }).eq("id", ag.id);
    results.push(`lembrete_2:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Primeira cobrança à loja
// ═══════════════════════════════════════════
async function processFirstStoreCharge(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  const { data: paraCobranca } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .eq("confirmacao_enviada", false)
    .eq("tentativas_cobranca_loja", 0)
    .lt("data_horario", now.toISOString());

  for (const ag of paraCobranca || []) {
    if (!ag.loja_telefone) continue;

    // Check store hours
    const cleanPhone = ag.loja_telefone.replace(/\D/g, "");
    const { data: lojaInfo } = await supabase
      .from("telefones_lojas")
      .select("horario_fechamento")
      .eq("telefone", cleanPhone)
      .single();

    const horarioFechamento = lojaInfo?.horario_fechamento || "19:00";
    const [hFecha, mFecha] = horarioFechamento.split(":").map(Number);
    const nowHour = now.getHours();
    const nowMin = now.getMinutes();
    const storeIsOpen = (nowHour < hFecha) || (nowHour === hFecha && nowMin < mFecha);

    if (!storeIsOpen) {
      const nextDay = new Date(now);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(9, 0, 0, 0);
      await supabase.from("agendamentos").update({
        noshow_agendar_para: nextDay.toISOString(),
      }).eq("id", ag.id);
      results.push(`agendado_amanha:${ag.id}`);
      continue;
    }

    // Send store charge message
    await sendStoreChargeMessage(supabase, ag, now, SUPABASE_URL, SERVICE_KEY);

    await supabase.from("agendamentos").update({
      confirmacao_enviada: true,
      tentativas_cobranca_loja: 1,
    }).eq("id", ag.id);
    results.push(`cobranca_loja_1:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Segunda cobrança à loja (3h sem resposta)
// ═══════════════════════════════════════════
async function processSecondStoreCharge(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

  const { data: pendentes } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario, updated_at")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .eq("confirmacao_enviada", true)
    .eq("tentativas_cobranca_loja", 1)
    .is("loja_confirmou_presenca", null)
    .lt("updated_at", threeHoursAgo);

  for (const ag of pendentes || []) {
    if (!ag.loja_telefone) continue;

    await sendStoreChargeMessage(supabase, ag, now, SUPABASE_URL, SERVICE_KEY, true);

    await supabase.from("agendamentos").update({
      tentativas_cobranca_loja: 2,
    }).eq("id", ag.id);
    results.push(`cobranca_loja_2:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Timeout da loja (6h+ após 2ª cobrança)
// ═══════════════════════════════════════════
async function processStoreTimeout(supabase: any, now: Date, results: string[]) {
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

  const { data: timeout } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .gte("tentativas_cobranca_loja", 2)
    .is("loja_confirmou_presenca", null)
    .lt("updated_at", sixHoursAgo);

  for (const ag of timeout || []) {
    // Move to no_show — trigger will handle recovery message
    await supabase.from("agendamentos").update({ status: "no_show" }).eq("id", ag.id);

    // Get client name for task
    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();

    // Create manual task for operator
    await supabase.from("tarefas").insert({
      titulo: `Loja ${ag.loja_nome} não respondeu sobre ${contato?.nome || "cliente"}`,
      descricao: `A loja não confirmou presença do cliente após 2 cobranças. Verificar manualmente.`,
      prioridade: "alta",
    });

    results.push(`timeout_noshow:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Envia mensagem de cobrança à loja
// ═══════════════════════════════════════════
async function sendStoreChargeMessage(
  supabase: any, ag: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, isSecondAttempt = false
) {
  const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
  const dt = new Date(ag.data_horario);
  const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  const cleanPhone = ag.loja_telefone.replace(/\D/g, "");
  const { data: lojaContato } = await supabase
    .from("contatos")
    .select("id")
    .eq("telefone", cleanPhone)
    .eq("tipo", "loja")
    .single();

  if (!lojaContato) return;

  const { data: lojaAt } = await supabase
    .from("atendimentos")
    .select("id")
    .eq("contato_id", lojaContato.id)
    .eq("canal", "whatsapp")
    .neq("status", "encerrado")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!lojaAt) return;

  const clienteName = contato?.nome || "Cliente";
  const msg = isSecondAttempt
    ? `⚠️ *Pendência de Confirmação*\n\nAinda precisamos da confirmação sobre o cliente *${clienteName}* (agendamento às *${hora}*).\n\nPor favor, use a opção *4* do menu para informar se ele compareceu.`
    : `📋 *Confirmação de Comparecimento*\n\nO cliente *${clienteName}* tinha agendamento às *${hora}*.\n\nEle compareceu? Use a opção *4* do menu para confirmar.`;

  await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ atendimento_id: lojaAt.id, texto: msg, remetente_nome: "Sistema" }),
  });
}
