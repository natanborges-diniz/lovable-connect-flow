import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Agendamentos CRON — Motor de Transição Temporal
 * 
 * Parâmetros configuráveis via payload do cron_job.
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

  // Read configurable parameters from payload (with defaults)
  let payload: Record<string, any> = {};
  try {
    const body = await req.json();
    payload = body || {};
  } catch {
    // No body = manual trigger or empty payload
  }

  const HORAS_REENVIO_LEMBRETE = payload.horas_reenvio_lembrete ?? 4;
  const HORAS_SEGUNDA_COBRANCA_LOJA = payload.horas_segunda_cobranca_loja ?? 3;
  const HORAS_TIMEOUT_LOJA = payload.horas_timeout_loja ?? 6;
  const HORAS_ABANDONO = payload.horas_abandono ?? 48;
  const MAX_TENTATIVAS_RECUPERACAO = payload.max_tentativas_recuperacao ?? 2;
  const HORAS_SEGUNDA_RECUPERACAO = payload.horas_segunda_recuperacao ?? 24;

  const now = new Date();
  const results: string[] = [];

  try {
    // ═══════════════════════════════════════════
    // A) TRANSIÇÃO → "lembrete_enviado" (24h antes)
    // ═══════════════════════════════════════════
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
    // ═══════════════════════════════════════════
    await processLembreteRetry(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results, HORAS_REENVIO_LEMBRETE);

    // ═══════════════════════════════════════════
    // B2) LEMBRETE DIA-D às 08:00 (America/Sao_Paulo)
    // ═══════════════════════════════════════════
    await processLembreteDiaD(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results);

    // ═══════════════════════════════════════════
    // C) COBRANÇA À LOJA — horário do agendamento passou
    // ═══════════════════════════════════════════
    await processFirstStoreCharge(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results);

    // ═══════════════════════════════════════════
    // D) SEGUNDA COBRANÇA À LOJA
    // ═══════════════════════════════════════════
    await processSecondStoreCharge(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results, HORAS_SEGUNDA_COBRANCA_LOJA);

    // ═══════════════════════════════════════════
    // E) TIMEOUT DA LOJA
    // ═══════════════════════════════════════════
    await processStoreTimeout(supabase, now, results, HORAS_TIMEOUT_LOJA);

    // ═══════════════════════════════════════════
    // F) COBRANÇAS AGENDADAS (noshow_agendar_para)
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
    // G) ABANDONO — sem resposta após tentativas de recuperação
    // ═══════════════════════════════════════════
    const { data: emRecuperacao } = await supabase
      .from("agendamentos")
      .select("id, contato_id, tentativas_recuperacao, updated_at, atendimento_id, status")
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

      // Second recovery attempt
      if ((ag.tentativas_recuperacao || 0) === 1 && hoursSinceUpdate >= HORAS_SEGUNDA_RECUPERACAO) {
        await supabase.from("agendamentos").update({
          tentativas_recuperacao: 2,
          status: "recuperacao",
        }).eq("id", ag.id);
        results.push(`recuperacao_2:${ag.id}`);
      }

      // Abandon after max attempts + wait
      if ((ag.tentativas_recuperacao || 0) >= MAX_TENTATIVAS_RECUPERACAO && hoursSinceUpdate >= HORAS_ABANDONO) {
        await supabase.from("agendamentos").update({ status: "abandonado" }).eq("id", ag.id);
        results.push(`abandonado:${ag.id}`);
      }
    }

    console.log(`[CRON] Processed: ${results.join(", ") || "nothing"}`);
    await supabase.from("cron_jobs").update({ ultimo_disparo: new Date().toISOString() }).eq("funcao_alvo", "agendamentos-cron");
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
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[],
  horasReenvio: number
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

    if (hoursSinceUpdate < horasReenvio && hoursUntilAppointment > 2) continue;

    if (ag.atendimento_id) {
      const { data: recentInbound } = await supabase
        .from("mensagens")
        .select("id")
        .eq("atendimento_id", ag.atendimento_id)
        .eq("direcao", "inbound")
        .gt("created_at", lastUpdate.toISOString())
        .limit(1);
      if (recentInbound?.length) continue;
    }

    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    const firstName = contato?.nome?.split(" ")[0] || "Cliente";
    const quando = resolveQuando(ag.data_horario, now);

    if (ag.atendimento_id) {
      const msg = `Oi ${firstName}, ainda não conseguimos confirmar sua visita *${quando}* na *${ag.loja_nome}*. Podemos manter? Responda SIM ou se preferir reagendar, é só dizer 😊`;
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

    await sendStoreChargeMessage(supabase, ag, now, SUPABASE_URL, SERVICE_KEY);
    await supabase.from("agendamentos").update({
      confirmacao_enviada: true,
      tentativas_cobranca_loja: 1,
    }).eq("id", ag.id);
    results.push(`cobranca_loja_1:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Segunda cobrança à loja
// ═══════════════════════════════════════════
async function processSecondStoreCharge(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[],
  horasSegundaCobranca: number
) {
  const cutoff = new Date(now.getTime() - horasSegundaCobranca * 60 * 60 * 1000).toISOString();

  const { data: pendentes } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario, updated_at")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .eq("confirmacao_enviada", true)
    .eq("tentativas_cobranca_loja", 1)
    .is("loja_confirmou_presenca", null)
    .lt("updated_at", cutoff);

  for (const ag of pendentes || []) {
    if (!ag.loja_telefone) continue;
    await sendStoreChargeMessage(supabase, ag, now, SUPABASE_URL, SERVICE_KEY, true);
    await supabase.from("agendamentos").update({ tentativas_cobranca_loja: 2 }).eq("id", ag.id);
    results.push(`cobranca_loja_2:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Timeout da loja
// ═══════════════════════════════════════════
async function processStoreTimeout(supabase: any, now: Date, results: string[], horasTimeout: number) {
  const cutoff = new Date(now.getTime() - horasTimeout * 60 * 60 * 1000).toISOString();

  const { data: timeout } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .gte("tentativas_cobranca_loja", 2)
    .is("loja_confirmou_presenca", null)
    .lt("updated_at", cutoff);

  for (const ag of timeout || []) {
    await supabase.from("agendamentos").update({ status: "no_show" }).eq("id", ag.id);
    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    await supabase.from("tarefas").insert({
      titulo: `Loja ${ag.loja_nome} não respondeu sobre ${contato?.nome || "cliente"}`,
      descricao: `A loja não confirmou presença do cliente após 2 cobranças. Verificar manualmente.`,
      prioridade: "alta",
    });
    results.push(`timeout_noshow:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Notifica loja via app Atrium Messenger (NÃO mais via WhatsApp)
// ═══════════════════════════════════════════
async function sendStoreChargeMessage(
  supabase: any, ag: any, _now: Date, _SUPABASE_URL: string, _SERVICE_KEY: string, isSecondAttempt = false
) {
  const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
  const dt = new Date(ag.data_horario);
  const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const clienteName = contato?.nome || "Cliente";

  const titulo = isSecondAttempt
    ? `⚠️ Pendência de confirmação — ${clienteName}`
    : `📋 Confirme comparecimento — ${clienteName}`;
  const mensagem = isSecondAttempt
    ? `Cliente ${clienteName} (agendado às ${hora}) ainda sem confirmação. Atualize no app.`
    : `Cliente ${clienteName} tinha agendamento às ${hora}. Compareceu?`;

  const { data: dests } = await supabase
    .rpc("resolver_destinatarios_loja", { _loja_nome: ag.loja_nome });
  const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;

  for (const d of list) {
    await supabase.from("notificacoes").insert({
      usuario_id: d.user_id,
      setor_id: d.setor_id,
      tipo: "agendamento_confirmacao",
      titulo,
      mensagem,
      referencia_id: ag.id,
    });
  }

  if (list.length === 0) {
    console.warn(`[agendamentos-cron] Loja "${ag.loja_nome}" sem destinatários internos — confirmação não entregue.`);
  }
}

// ═══════════════════════════════════════════
// Helper: Resolve temporal label
// ═══════════════════════════════════════════
function resolveQuando(dataHorario: string, now?: Date): string {
  if (!dataHorario) return "";
  const ref = now || new Date();
  const dt = new Date(dataHorario);
  const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  const refSP = new Date(ref.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dtSP = new Date(dt.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const refDay = new Date(refSP.getFullYear(), refSP.getMonth(), refSP.getDate()).getTime();
  const dtDay = new Date(dtSP.getFullYear(), dtSP.getMonth(), dtSP.getDate()).getTime();
  const diffDays = Math.round((dtDay - refDay) / 86400000);

  if (diffDays === 0) return `hoje às ${hora}`;
  if (diffDays === 1) return `amanhã às ${hora}`;
  if (diffDays > 1 && diffDays <= 6) {
    const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    return `${dias[dtSP.getDay()]} às ${hora}`;
  }
  const dia = dtSP.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${dia} às ${hora}`;
}

// ═══════════════════════════════════════════
// Helper: Lembrete DIA-D às 08:00 (America/Sao_Paulo)
// Reabre a conversa com o cliente no dia da visita.
// Idempotente via metadata.lembrete_dia_d_at.
// ═══════════════════════════════════════════
async function processLembreteDiaD(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  // Hora atual em São Paulo
  const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const spHour = spNow.getHours();

  // Janela: roda só entre 08:00 e 08:59 SP. Cron de 5 em 5 min cobre isso com folga.
  if (spHour !== 8) return;

  // Limites do "hoje" em SP, traduzidos para UTC para o filtro do banco
  const startSP = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate(), 0, 0, 0);
  const endSP = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate(), 23, 59, 59);
  // Convert SP wall-time → UTC ISO. SP é UTC-3 fixo (sem DST desde 2019).
  const toUtcIso = (d: Date) => new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const { data: doDia } = await supabase
    .from("agendamentos")
    .select("id, contato_id, atendimento_id, data_horario, loja_nome, metadata, status")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .is("loja_confirmou_presenca", null)
    .gte("data_horario", toUtcIso(startSP))
    .lte("data_horario", toUtcIso(endSP));

  for (const ag of doDia || []) {
    const md = (ag.metadata || {}) as Record<string, any>;
    if (md.lembrete_dia_d_at) continue; // já enviado hoje

    if (!ag.atendimento_id) {
      // Sem atendimento aberto: registra evento e pula (envio HSM fica para futuro).
      await supabase.from("eventos_crm").insert({
        contato_id: ag.contato_id,
        tipo: "lembrete_dia_d_skip",
        descricao: "Lembrete dia-D não enviado: sem atendimento aberto",
        referencia_id: ag.id,
        referencia_tipo: "agendamento",
      });
      await supabase.from("agendamentos").update({
        metadata: { ...md, lembrete_dia_d_skipped_at: new Date().toISOString() },
      }).eq("id", ag.id);
      continue;
    }

    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    const firstName = contato?.nome?.split(" ")[0] || "";
    const dt = new Date(ag.data_horario);
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const lojaTxt = ag.loja_nome ? `*Diniz ${ag.loja_nome}*` : "*Diniz*";

    const msg = `Bom dia${firstName ? ", " + firstName : ""}! 👋 Passando pra lembrar da sua visita hoje às *${hora}* na ${lojaTxt}. Posso confirmar que você vem?`;

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id: ag.atendimento_id, texto: msg, remetente_nome: "Sistema" }),
    });

    const sentOk = sendRes.ok;

    await supabase.from("agendamentos").update({
      metadata: { ...md, lembrete_dia_d_at: new Date().toISOString(), lembrete_dia_d_ok: sentOk },
    }).eq("id", ag.id);

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: sentOk ? "lembrete_dia_d_enviado" : "lembrete_dia_d_falha",
      descricao: `Lembrete dia-D ${sentOk ? "enviado" : "falhou"} (${hora} ${ag.loja_nome || ""})`,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
    });

    results.push(`lembrete_dia_d:${ag.id}`);
  }
}
