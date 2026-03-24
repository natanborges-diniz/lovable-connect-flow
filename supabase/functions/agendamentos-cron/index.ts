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

  const now = new Date();
  const results: string[] = [];

  try {
    // ═══════════════════════════════════════════
    // A) LEMBRETES — dia anterior ao cliente
    // ═══════════════════════════════════════════
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();
    const tomorrowEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1).toISOString();

    const { data: lembretes } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, data_horario, atendimento_id")
      .eq("status", "agendado")
      .eq("lembrete_enviado", false)
      .gte("data_horario", tomorrowStart)
      .lt("data_horario", tomorrowEnd);

    for (const ag of lembretes || []) {
      const { data: contato } = await supabase.from("contatos").select("nome, telefone").eq("id", ag.contato_id).single();
      if (!contato) continue;

      const dt = new Date(ag.data_horario);
      const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

      // Try sending template, fallback to regular message
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            contato_id: ag.contato_id,
            template_name: "lembrete_agendamento",
            template_params: [contato.nome?.split(" ")[0] || "Cliente", ag.loja_nome, hora],
          }),
        });
      } catch {
        // Fallback: send via existing atendimento if available
        if (ag.atendimento_id) {
          const msg = `⏰ *Lembrete!*\n\nOlá ${contato.nome?.split(" ")[0]}! Seu agendamento na *${ag.loja_nome}* é amanhã às *${hora}*.\n\nTe esperamos lá! 😊`;
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag.atendimento_id, msg);
        }
      }

      await supabase.from("agendamentos").update({ lembrete_enviado: true }).eq("id", ag.id);
      results.push(`lembrete:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // B) ACIONAMENTO DA LOJA — horário do agendamento passou
    // ═══════════════════════════════════════════
    const { data: paraConfirmar } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, loja_telefone, data_horario")
      .in("status", ["agendado", "confirmado"])
      .eq("confirmacao_enviada", false)
      .lt("data_horario", now.toISOString());

    for (const ag of paraConfirmar || []) {
      if (!ag.loja_telefone) continue;

      const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
      const dt = new Date(ag.data_horario);
      const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

      // Find loja's atendimento to send message
      const lojaAtendimento = await findOrCreateLojaAtendimento(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag.loja_telefone);

      if (lojaAtendimento) {
        const msg = `📋 *Confirmação de Comparecimento*\n\nO cliente *${contato?.nome || "Cliente"}* tinha agendamento às *${hora}*.\n\nEle compareceu? Use a opção *4* do menu para confirmar.`;
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, lojaAtendimento, msg);
      }

      await supabase.from("agendamentos").update({ confirmacao_enviada: true }).eq("id", ag.id);
      results.push(`confirmacao_loja:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // C) COBRANÇA À LOJA — 2h depois sem confirmação
    // ═══════════════════════════════════════════
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: semConfirmacao } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, loja_telefone, data_horario")
      .in("status", ["agendado", "confirmado"])
      .eq("cobranca_loja_enviada", false)
      .is("loja_confirmou_presenca", null)
      .lt("data_horario", twoHoursAgo);

    for (const ag of semConfirmacao || []) {
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
        // Schedule for 09:00 next day
        const nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(9, 0, 0, 0);
        await supabase.from("agendamentos").update({
          noshow_agendar_para: nextDay.toISOString(),
          cobranca_loja_enviada: true,
        }).eq("id", ag.id);
        results.push(`cobranca_agendada_amanha:${ag.id}`);
        continue;
      }

      // Send nagging to store
      const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();
      const lojaAtendimento = await findOrCreateLojaAtendimento(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag.loja_telefone);

      if (lojaAtendimento) {
        const msg = `⚠️ *Aguardando confirmação*\n\nAinda não recebemos a confirmação de comparecimento do cliente *${contato?.nome || "Cliente"}*.\n\nPor favor, confirme usando a opção *4* do menu.`;
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, lojaAtendimento, msg);
      }

      // Mark no-show and trigger recovery
      await supabase.from("agendamentos").update({
        status: "no_show",
        cobranca_loja_enviada: true,
        noshow_enviado: true,
      }).eq("id", ag.id);

      results.push(`noshow_marcado:${ag.id}`);

      // Trigger recovery for client
      await triggerRecovery(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag);
    }

    // ═══════════════════════════════════════════
    // D) COBRANÇAS AGENDADAS (noshow_agendar_para)
    // ═══════════════════════════════════════════
    const { data: cobranvasAgendadas } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, loja_telefone, data_horario")
      .in("status", ["agendado", "confirmado"])
      .is("loja_confirmou_presenca", null)
      .not("noshow_agendar_para", "is", null)
      .lte("noshow_agendar_para", now.toISOString());

    for (const ag of cobranvasAgendadas || []) {
      const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();

      if (ag.loja_telefone) {
        const lojaAtendimento = await findOrCreateLojaAtendimento(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag.loja_telefone);
        if (lojaAtendimento) {
          const msg = `🔔 *Bom dia!*\n\nO cliente *${contato?.nome || "Cliente"}* tinha agendamento ontem.\n\nEle compareceu? Use a opção *4* do menu para confirmar.`;
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, lojaAtendimento, msg);
        }
      }

      await supabase.from("agendamentos").update({
        status: "no_show",
        noshow_enviado: true,
        noshow_agendar_para: null,
      }).eq("id", ag.id);

      await triggerRecovery(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag);
      results.push(`cobranca_executada:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // E) RECUPERAÇÃO — follow-ups automáticos
    // ═══════════════════════════════════════════
    const { data: emRecuperacao } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, data_horario, tentativas_recuperacao, updated_at, atendimento_id")
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
          // Client is responding, keep in recuperacao, let ai-triage handle
          if (ag.status !== "recuperacao") {
            await supabase.from("agendamentos").update({ status: "recuperacao" }).eq("id", ag.id);
          }
          continue;
        }
      }

      // Second attempt at 24h
      if (ag.tentativas_recuperacao === 1 && hoursSinceUpdate >= 24) {
        const { data: contato } = await supabase.from("contatos").select("nome").eq("id", ag.contato_id).single();

        if (ag.atendimento_id) {
          const msg = `Olá ${contato?.nome?.split(" ")[0] || ""}! Vi que ainda não conseguimos reagendar sua visita. A gente tem horários flexíveis, quer que eu veja uma opção que encaixe melhor na sua agenda? 😊`;
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ag.atendimento_id, msg);
        }

        await supabase.from("agendamentos").update({
          tentativas_recuperacao: 2,
          status: "recuperacao",
        }).eq("id", ag.id);

        results.push(`recuperacao_2:${ag.id}`);
      }

      // Abandon at 48h+ after 2 attempts
      if (ag.tentativas_recuperacao >= 2 && hoursSinceUpdate >= 48) {
        await supabase.from("agendamentos").update({ status: "abandonado" }).eq("id", ag.id);

        await supabase.from("eventos_crm").insert({
          contato_id: ag.contato_id,
          tipo: "agendamento_abandonado",
          descricao: `Agendamento ${ag.loja_nome} sem resposta após ${ag.tentativas_recuperacao} tentativas`,
          referencia_tipo: "agendamento",
          referencia_id: ag.id,
        });

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

// ─── Helpers ───

async function sendWhatsApp(supabaseUrl: string, serviceKey: string, atendimentoId: string, texto: string) {
  await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ atendimento_id: atendimentoId, texto, remetente_nome: "Sistema" }),
  });
}

async function findOrCreateLojaAtendimento(
  supabase: any, supabaseUrl: string, serviceKey: string, lojaTelefone: string
): Promise<string | null> {
  const cleanPhone = lojaTelefone.replace(/\D/g, "");

  // Find contato for this store
  const { data: contato } = await supabase
    .from("contatos")
    .select("id")
    .eq("telefone", cleanPhone)
    .eq("tipo", "loja")
    .single();

  if (!contato) return null;

  // Find open atendimento
  const { data: atendimento } = await supabase
    .from("atendimentos")
    .select("id")
    .eq("contato_id", contato.id)
    .eq("canal", "whatsapp")
    .neq("status", "encerrado")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (atendimento) return atendimento.id;

  // Create new
  const { data: sol } = await supabase.from("solicitacoes").insert({
    contato_id: contato.id,
    assunto: "Confirmação de comparecimento",
    canal_origem: "whatsapp",
    status: "aberta",
  }).select().single();

  if (!sol) return null;

  const { data: newAt } = await supabase.from("atendimentos").insert({
    solicitacao_id: sol.id,
    contato_id: contato.id,
    canal: "whatsapp",
    status: "aguardando",
    canal_provedor: "meta_official",
    modo: "ia",
  }).select().single();

  return newAt?.id || null;
}

async function triggerRecovery(
  supabase: any, supabaseUrl: string, serviceKey: string,
  agendamento: { id: string; contato_id: string; loja_nome: string; data_horario: string; atendimento_id?: string }
) {
  const { data: contato } = await supabase
    .from("contatos")
    .select("nome, telefone")
    .eq("id", agendamento.contato_id)
    .single();

  if (!contato) return;

  // Try template first
  try {
    await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-template`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contato_id: agendamento.contato_id,
        template_name: "noshow_reagendamento",
        template_params: [contato.nome?.split(" ")[0] || "Cliente", agendamento.loja_nome],
      }),
    });
  } catch {
    // Fallback: send regular message via existing atendimento
    if (agendamento.atendimento_id) {
      const msg = `Olá ${contato.nome?.split(" ")[0] || ""}! Vimos que você não conseguiu comparecer à nossa loja *${agendamento.loja_nome}*. Entendemos que a correria do dia a dia é grande. Gostaria de reagendar sua visita? 😊`;
      await sendWhatsApp(supabaseUrl, serviceKey, agendamento.atendimento_id, msg);
    }
  }

  await supabase.from("agendamentos").update({
    tentativas_recuperacao: 1,
    status: "recuperacao",
  }).eq("id", agendamento.id);

  await supabase.from("eventos_crm").insert({
    contato_id: agendamento.contato_id,
    tipo: "recuperacao_noshow_iniciada",
    descricao: `Recuperação iniciada para agendamento ${agendamento.loja_nome}`,
    referencia_tipo: "agendamento",
    referencia_id: agendamento.id,
  });
}
