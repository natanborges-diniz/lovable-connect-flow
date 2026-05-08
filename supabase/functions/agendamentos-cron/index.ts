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
  // Cobrança loja: 1ª = 2h após horário marcado; 2ª = 10:00 SP do dia seguinte; tarefa interna = 48h
  const HORAS_PRIMEIRA_COBRANCA_LOJA = payload.horas_primeira_cobranca_loja ?? 2;
  const HORAS_TIMEOUT_LOJA = payload.horas_timeout_loja ?? 48;
  // Cadência cliente perdido: 1ª imediata + 2ª em 24h + 3ª em 24h → despedida e abandonado em 72h
  const HORAS_ABANDONO = payload.horas_abandono ?? 72;
  const MAX_TENTATIVAS_RECUPERACAO = payload.max_tentativas_recuperacao ?? 3;
  const HORAS_SEGUNDA_RECUPERACAO = payload.horas_segunda_recuperacao ?? 24;
  const HORAS_TERCEIRA_RECUPERACAO = payload.horas_terceira_recuperacao ?? 24;

  const now = new Date();
  const results: string[] = [];

  const safeRun = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) {
      console.error(`[CRON][${label}] erro:`, e);
      results.push(`${label}_error:${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  try {
    // A) LEMBRETE VÉSPERA — 08h SP
    await safeRun("A_lembrete_vespera", () => processLembreteVespera(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results));
    // B) LEMBRETE 1H ANTES
    await safeRun("B_lembrete_1h", () => processLembrete1hAntes(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results));
    // C) 1ª COBRANÇA LOJA
    await safeRun("C_cobranca_1", () => processFirstStoreCharge(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results, HORAS_PRIMEIRA_COBRANCA_LOJA));
    // D) 2ª COBRANÇA LOJA — 10:00 SP D+1
    await safeRun("D_cobranca_2", () => processSecondStoreChargeNextMorning(supabase, now, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, results));
    // E) TIMEOUT LOJA
    await safeRun("E_timeout_loja", () => processStoreTimeout(supabase, now, results, HORAS_TIMEOUT_LOJA));

    // ═══════════════════════════════════════════
    // F) COBRANÇAS AGENDADAS (noshow_agendar_para)
    await safeRun("F_cobrancas_agendadas", async () => {
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
    });

    // G) RECUPERAÇÃO CLIENTE — 3 tentativas + abandono em 72h com despedida
    await safeRun("G_recuperacao", async () => {
      const { data: emRecuperacao } = await supabase
        .from("agendamentos")
        .select("id, contato_id, tentativas_recuperacao, updated_at, atendimento_id, status, metadata, loja_nome")
        .in("status", ["no_show", "recuperacao"]);

      for (const ag of emRecuperacao || []) {
        const lastUpdate = new Date(ag.updated_at);
        const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

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

        const tentativas = ag.tentativas_recuperacao || 0;

        if (tentativas <= 1 && hoursSinceUpdate >= HORAS_SEGUNDA_RECUPERACAO) {
          await supabase.from("agendamentos").update({
            tentativas_recuperacao: 2,
            status: "recuperacao",
          }).eq("id", ag.id);
          results.push(`recuperacao_2:${ag.id}`);
          continue;
        }

        if (tentativas === 2 && hoursSinceUpdate >= HORAS_TERCEIRA_RECUPERACAO) {
          await supabase.from("agendamentos").update({
            tentativas_recuperacao: 3,
            status: "recuperacao",
          }).eq("id", ag.id);
          results.push(`recuperacao_3:${ag.id}`);
          continue;
        }

        if (tentativas >= MAX_TENTATIVAS_RECUPERACAO && hoursSinceUpdate >= HORAS_ABANDONO) {
          const md = (ag.metadata || {}) as Record<string, any>;
          if (!md.despedida_enviada_at && ag.atendimento_id && dentroDeJanelaComunicacaoCliente(now)) {
            const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
            const firstName = contato?.nome?.split(" ")[0] || "";
            const msg = `Tudo bem${firstName ? ", " + firstName : ""}! Como não consegui retorno, vou encerrar este atendimento por aqui. Se quiser remarcar sua visita${ag.loja_nome ? " na " + ag.loja_nome : ""}, é só me chamar. Um abraço! 👋`;
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ atendimento_id: ag.atendimento_id, texto: msg, remetente_nome: "Sistema" }),
            });
            await supabase.from("agendamentos").update({
              metadata: { ...md, despedida_enviada_at: new Date().toISOString() },
            }).eq("id", ag.id);
            await supabase.from("eventos_crm").insert({
              contato_id: ag.contato_id,
              tipo: "agendamento_despedida_enviada",
              descricao: `Despedida enviada antes de marcar como abandonado (${ag.loja_nome || ""})`,
              referencia_id: ag.id,
              referencia_tipo: "agendamento",
            });
            results.push(`despedida:${ag.id}`);
            continue;
          }
          const despedidaAt = md.despedida_enviada_at ? new Date(md.despedida_enviada_at) : null;
          if (despedidaAt && (now.getTime() - despedidaAt.getTime()) >= 60 * 60 * 1000) {
            await supabase.from("agendamentos").update({ status: "abandonado" }).eq("id", ag.id);
            await supabase.from("eventos_crm").insert({
              contato_id: ag.contato_id,
              tipo: "agendamento_perdido",
              descricao: `Cliente declarado perdido após 3 tentativas + despedida (${ag.loja_nome || ""})`,
              referencia_id: ag.id,
              referencia_tipo: "agendamento",
            });
            results.push(`abandonado:${ag.id}`);
          }
        }
      }
    });

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
// Helper: Janela de comunicação outbound ao cliente (08:00–21:59 SP)
// Lembretes/cobranças automáticas só saem dentro dessa janela.
// Bloqueado: 22:00–07:59 (alinhado com cadência de retomada).
// ═══════════════════════════════════════════
function dentroDeJanelaComunicacaoCliente(now: Date): boolean {
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const h = sp.getHours();
  return h >= 8 && h < 22;
}

// ═══════════════════════════════════════════
// Helper: Lembrete VÉSPERA — 1 mensagem às 08h SP no dia anterior ao agendamento.
// Idempotente via metadata.lembrete_enviado_at. Pula clientes que já confirmaram.
// ═══════════════════════════════════════════
async function processLembreteVespera(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  // Roda só entre 08:00 e 08:59 SP. Cron de 5 em 5 min cobre.
  if (spNow.getHours() !== 8) return;
  if (!dentroDeJanelaComunicacaoCliente(now)) return;

  // Janela "amanhã em SP" → ISO UTC
  const startSP = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate() + 1, 0, 0, 0);
  const endSP = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate() + 1, 23, 59, 59);
  const toUtcIso = (d: Date) => new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const { data: paraLembrar } = await supabase
    .from("agendamentos")
    .select("id, contato_id, atendimento_id, data_horario, loja_nome, metadata, status")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .is("loja_confirmou_presenca", null)
    .gte("data_horario", toUtcIso(startSP))
    .lte("data_horario", toUtcIso(endSP));

  for (const ag of paraLembrar || []) {
    const md = (ag.metadata || {}) as Record<string, any>;
    if (md.lembrete_enviado_at) continue;
    if (md.cliente_confirmou_at) continue;
    if (!ag.atendimento_id) continue;

    // Lock atômico
    const stampNow = new Date().toISOString();
    const { data: locked } = await supabase
      .from("agendamentos")
      .update({ metadata: { ...md, lembrete_enviado_at: stampNow, lembrete_tipo: "vespera" } })
      .eq("id", ag.id)
      .is("metadata->>lembrete_enviado_at", null)
      .select("id")
      .maybeSingle();
    if (!locked) continue;

    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    const firstName = contato?.nome?.split(" ")[0] || "";
    const dt = new Date(ag.data_horario);
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const lojaTxt = ag.loja_nome ? `*${ag.loja_nome}*` : "*Óticas Diniz*";
    const msg = `Bom dia${firstName ? ", " + firstName : ""}! 👋 Passando pra confirmar sua visita amanhã às *${hora}* na ${lojaTxt}. Posso confirmar?`;

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id: ag.atendimento_id, texto: msg, remetente_nome: "Sistema" }),
    });

    await supabase.from("agendamentos").update({
      status: "lembrete_enviado",
      tentativas_lembrete: 1,
      metadata: { ...md, lembrete_enviado_at: stampNow, lembrete_tipo: "vespera", lembrete_ok: sendRes.ok },
    }).eq("id", ag.id);

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: sendRes.ok ? "lembrete_vespera_enviado" : "lembrete_vespera_falha",
      descricao: `Lembrete véspera ${sendRes.ok ? "enviado" : "falhou"} (${hora} ${ag.loja_nome || ""})`,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
    });
    results.push(`lembrete_vespera:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Lembrete 1H ANTES — para agendamentos do MESMO DIA que faltam ~1h.
// Pula se foi marcado com <60min de antecedência ou se cliente já confirmou.
// Idempotente via metadata.lembrete_enviado_at.
// ═══════════════════════════════════════════
async function processLembrete1hAntes(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  if (!dentroDeJanelaComunicacaoCliente(now)) return;

  // Janela: agendamentos com data_horario entre now+55min e now+65min
  const lo = new Date(now.getTime() + 55 * 60 * 1000).toISOString();
  const hi = new Date(now.getTime() + 65 * 60 * 1000).toISOString();

  const { data: agora } = await supabase
    .from("agendamentos")
    .select("id, contato_id, atendimento_id, data_horario, loja_nome, metadata, status, created_at")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .is("loja_confirmou_presenca", null)
    .gte("data_horario", lo)
    .lte("data_horario", hi);

  for (const ag of agora || []) {
    const md = (ag.metadata || {}) as Record<string, any>;
    if (md.lembrete_enviado_at) continue;
    if (md.cliente_confirmou_at) continue;
    if (!ag.atendimento_id) continue;

    // Antecedência de criação vs. horário do agendamento
    const created = new Date(ag.created_at).getTime();
    const dataAg = new Date(ag.data_horario).getTime();
    const antecedenciaMin = (dataAg - created) / (1000 * 60);

    if (antecedenciaMin < 60) {
      // Marcado com menos de 1h de antecedência → não envia lembrete.
      await supabase.from("agendamentos").update({
        metadata: { ...md, lembrete_skip_motivo: "janela_curta", lembrete_skipped_at: new Date().toISOString() },
      }).eq("id", ag.id);
      await supabase.from("eventos_crm").insert({
        contato_id: ag.contato_id,
        tipo: "lembrete_1h_skip_janela_curta",
        descricao: `Lembrete 1h antes pulado: agendamento marcado com ${Math.round(antecedenciaMin)}min de antecedência (${ag.loja_nome || ""})`,
        referencia_id: ag.id,
        referencia_tipo: "agendamento",
      });
      results.push(`lembrete_1h_skip:${ag.id}`);
      continue;
    }

    // Lock atômico
    const stampNow = new Date().toISOString();
    const { data: locked } = await supabase
      .from("agendamentos")
      .update({ metadata: { ...md, lembrete_enviado_at: stampNow, lembrete_tipo: "1h_antes" } })
      .eq("id", ag.id)
      .is("metadata->>lembrete_enviado_at", null)
      .select("id")
      .maybeSingle();
    if (!locked) continue;

    const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
    const firstName = contato?.nome?.split(" ")[0] || "";
    const dt = new Date(ag.data_horario);
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const lojaTxt = ag.loja_nome ? `*${ag.loja_nome}*` : "*Óticas Diniz*";
    const msg = `Oi${firstName ? ", " + firstName : ""}! 👋 Passando pra lembrar da sua visita hoje às *${hora}* na ${lojaTxt}. Posso confirmar?`;

    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id: ag.atendimento_id, texto: msg, remetente_nome: "Sistema" }),
    });

    await supabase.from("agendamentos").update({
      status: "lembrete_enviado",
      tentativas_lembrete: 1,
      metadata: { ...md, lembrete_enviado_at: stampNow, lembrete_tipo: "1h_antes", lembrete_ok: sendRes.ok },
    }).eq("id", ag.id);

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: sendRes.ok ? "lembrete_1h_enviado" : "lembrete_1h_falha",
      descricao: `Lembrete 1h antes ${sendRes.ok ? "enviado" : "falhou"} (${hora} ${ag.loja_nome || ""})`,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
    });
    results.push(`lembrete_1h:${ag.id}`);
  }
}


// ═══════════════════════════════════════════
// Helper: Primeira cobrança à loja
// ═══════════════════════════════════════════
async function processFirstStoreCharge(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[],
  horasDelay: number
) {
  // 1ª cobrança só dispara se já passou (horário do agendamento + horasDelay).
  // Filtro por tentativas_cobranca_loja=0 (e não mais confirmacao_enviada) para
  // não pular cards que tiveram confirmacao_enviada=true setado por engano
  // (ex.: automação confundindo "cliente confirmou" com "loja foi cobrada").
  const cutoff = new Date(now.getTime() - horasDelay * 60 * 60 * 1000).toISOString();
  const { data: paraCobranca } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .eq("tentativas_cobranca_loja", 0)
    .is("loja_confirmou_presenca", null)
    .lt("data_horario", cutoff);

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
// Helper: Segunda cobrança à loja — 10:00 SP do dia seguinte ao agendamento
// ═══════════════════════════════════════════
async function processSecondStoreChargeNextMorning(
  supabase: any, now: Date, SUPABASE_URL: string, SERVICE_KEY: string, results: string[]
) {
  // Roda só entre 10:00 e 10:59 SP
  const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  if (spNow.getHours() !== 10) return;

  const { data: pendentes } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario, updated_at, metadata")
    .in("status", ["agendado", "lembrete_enviado", "confirmado"])
    .eq("confirmacao_enviada", true)
    .eq("tentativas_cobranca_loja", 1)
    .is("loja_confirmou_presenca", null);

  for (const ag of pendentes || []) {
    if (!ag.loja_telefone) continue;
    // Confere se o agendamento foi em dia anterior (em SP)
    const dt = new Date(ag.data_horario);
    const dtSP = new Date(dt.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const dtDay = new Date(dtSP.getFullYear(), dtSP.getMonth(), dtSP.getDate()).getTime();
    const todayDay = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate()).getTime();
    if (todayDay <= dtDay) continue; // ainda não é "dia seguinte"

    await sendStoreChargeMessage(supabase, ag, now, SUPABASE_URL, SERVICE_KEY, true);
    await supabase.from("agendamentos").update({ tentativas_cobranca_loja: 2 }).eq("id", ag.id);
    results.push(`cobranca_loja_2:${ag.id}`);
  }
}

// ═══════════════════════════════════════════
// Helper: Timeout da loja — após 48h sem resposta, cria tarefa interna detalhada
// para o supervisor cobrar a loja diretamente, e notifica admins.
// ═══════════════════════════════════════════
async function processStoreTimeout(supabase: any, now: Date, results: string[], horasTimeout: number) {
  const cutoff = new Date(now.getTime() - horasTimeout * 60 * 60 * 1000).toISOString();

  const { data: timeout } = await supabase
    .from("agendamentos")
    .select("id, contato_id, loja_nome, loja_telefone, data_horario, metadata")
    .in("status", ["agendado", "lembrete_enviado", "confirmado", "no_show"])
    .gte("tentativas_cobranca_loja", 2)
    .is("loja_confirmou_presenca", null)
    .lt("updated_at", cutoff);

  for (const ag of timeout || []) {
    const md = (ag.metadata || {}) as Record<string, any>;
    if (md.tarefa_supervisor_at) continue; // já criou

    const { data: contato } = await supabase.from("contatos").select("nome, telefone").eq("id", ag.contato_id).single();
    const dt = new Date(ag.data_horario);
    const horaAg = dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

    // Resolve responsáveis ativos da loja para apontar a tarefa
    const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: ag.loja_nome });
    const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;
    const setorId = list.find((d) => d.setor_id)?.setor_id || null;

    const titulo = `🚨 Loja ${ag.loja_nome} silenciou — cobrar comparecimento de ${contato?.nome || "cliente"}`;
    const descricao = [
      `A loja **${ag.loja_nome}** não respondeu sobre o comparecimento do cliente após 2 cobranças no app.`,
      ``,
      `**Cliente:** ${contato?.nome || "(sem nome)"}${contato?.telefone ? ` — ${contato.telefone}` : ""}`,
      `**Agendamento:** ${horaAg}`,
      `**Loja:** ${ag.loja_nome}${ag.loja_telefone ? ` (${ag.loja_telefone})` : ""}`,
      ``,
      `**Como cobrar com eficiência:**`,
      `1. Ligue diretamente para a loja e confirme se o cliente compareceu.`,
      `2. Se não há registro, marque manualmente como **No-show** ou **Compareceu** no card.`,
      `3. Registre observações no card do agendamento sobre o motivo do silêncio da loja (sistema do PDV fora do ar, esquecimento, etc.).`,
      `4. Reincidências serão refletidas no placar de comparecimento da loja.`,
    ].join("\n");

    await supabase.from("tarefas").insert({
      titulo,
      descricao,
      prioridade: "alta",
      status: "pendente",
      fila_id: null,
      metadata: {
        agendamento_id: ag.id,
        loja_nome: ag.loja_nome,
        contato_id: ag.contato_id,
        origem: "agendamentos-cron/timeout-loja",
      },
    });

    // Notifica supervisores/admin do setor
    if (setorId) {
      await supabase.from("notificacoes").insert({
        setor_id: setorId,
        tipo: "loja_silenciou_agendamento",
        titulo: `Loja silenciou: ${ag.loja_nome}`,
        mensagem: `Cobrar comparecimento do cliente ${contato?.nome || ""} (agendado ${horaAg}).`,
        referencia_id: ag.id,
      });
    }

    // Marca agendamento como no_show e registra evento (placar)
    await supabase.from("agendamentos").update({
      status: "no_show",
      metadata: { ...md, tarefa_supervisor_at: new Date().toISOString() },
    }).eq("id", ag.id);

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: "loja_silenciou",
      descricao: `Loja ${ag.loja_nome} não respondeu sobre comparecimento — tarefa interna criada para supervisor`,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
      metadata: { loja_nome: ag.loja_nome },
    });

    results.push(`timeout_supervisor:${ag.id}`);
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
    ? `⚠️ 2ª cobrança — ${clienteName} compareceu?`
    : `📋 Confirme comparecimento — ${clienteName}`;
  const mensagem = isSecondAttempt
    ? `Cliente ${clienteName} (agendado às ${hora}) ainda sem confirmação. Toque para responder: Compareceu / Não compareceu / Venda fechada.`
    : `Cliente ${clienteName} tinha agendamento às ${hora}. Toque para responder: Compareceu / Não compareceu / Venda fechada.`;

  const { data: dests } = await supabase
    .rpc("resolver_destinatarios_loja", { _loja_nome: ag.loja_nome });
  const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;

  // Tipo padronizado para o Messenger renderizar os 3 botões de ação
  const tipoNotif = isSecondAttempt
    ? "cobranca_comparecimento_loja_2"
    : "cobranca_comparecimento_loja";

  for (const d of list) {
    await supabase.from("notificacoes").insert({
      usuario_id: d.user_id,
      setor_id: d.setor_id,
      tipo: tipoNotif,
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

// (processLembreteDiaD removido — substituído por processLembrete1hAntes/processLembreteVespera)

