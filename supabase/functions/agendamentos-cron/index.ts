import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Agendamentos CRON — Motor de Transição Temporal
 * 
 * Este cron NÃO envia mensagens diretamente. Ele apenas MOVE cards entre colunas/status.
 * As automações (mensagens, templates, tarefas) são disparadas pelos triggers de mudança
 * de status, que chamam a edge function `pipeline-automations`.
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
    // A) TRANSIÇÃO → "confirmado" (lembrete: dia anterior)
    //    Agendamentos de amanhã que ainda estão "agendado"
    //    Move para "confirmado" → trigger dispara lembrete
    // ═══════════════════════════════════════════
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();
    const tomorrowEnd = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1).toISOString();

    const { data: paraConfirmar } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("status", "agendado")
      .gte("data_horario", tomorrowStart)
      .lt("data_horario", tomorrowEnd);

    for (const ag of paraConfirmar || []) {
      await supabase.from("agendamentos").update({ status: "confirmado" }).eq("id", ag.id);
      results.push(`confirmado:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // B) DETECÇÃO DE NO-SHOW
    //    Agendamentos cujo horário já passou + 2h sem confirmação da loja
    //    Move para "no_show" → trigger dispara recuperação
    // ═══════════════════════════════════════════
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: semConfirmacao } = await supabase
      .from("agendamentos")
      .select("id, loja_telefone, data_horario")
      .in("status", ["agendado", "confirmado"])
      .is("loja_confirmou_presenca", null)
      .lt("data_horario", twoHoursAgo);

    for (const ag of semConfirmacao || []) {
      // Check store hours before marking no-show
      if (ag.loja_telefone) {
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
          // Schedule for next morning
          const nextDay = new Date(now);
          nextDay.setDate(nextDay.getDate() + 1);
          nextDay.setHours(9, 0, 0, 0);
          await supabase.from("agendamentos").update({
            noshow_agendar_para: nextDay.toISOString(),
          }).eq("id", ag.id);
          results.push(`agendado_amanha:${ag.id}`);
          continue;
        }
      }

      // Move to no_show — trigger will handle messaging
      await supabase.from("agendamentos").update({ status: "no_show" }).eq("id", ag.id);
      results.push(`no_show:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // C) COBRANÇAS AGENDADAS (noshow_agendar_para)
    //    Executar cobranças agendadas para a manhã seguinte
    // ═══════════════════════════════════════════
    const { data: cobranvasAgendadas } = await supabase
      .from("agendamentos")
      .select("id")
      .in("status", ["agendado", "confirmado"])
      .is("loja_confirmou_presenca", null)
      .not("noshow_agendar_para", "is", null)
      .lte("noshow_agendar_para", now.toISOString());

    for (const ag of cobranvasAgendadas || []) {
      await supabase.from("agendamentos").update({
        status: "no_show",
        noshow_agendar_para: null,
      }).eq("id", ag.id);
      results.push(`cobranca_executada:${ag.id}`);
    }

    // ═══════════════════════════════════════════
    // D) ABANDONO — 48h+ sem resposta após 2 tentativas
    // ═══════════════════════════════════════════
    const { data: emRecuperacao } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, tentativas_recuperacao, updated_at, atendimento_id")
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

    // ═══════════════════════════════════════════
    // E) COBRANÇA À LOJA — horário do agendamento passou
    //    Agendamentos que passaram do horário mas loja não confirmou
    //    Não muda status, apenas envia cobrança à loja via automação
    // ═══════════════════════════════════════════
    const { data: paraCobranca } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, loja_telefone, data_horario")
      .in("status", ["agendado", "confirmado"])
      .eq("confirmacao_enviada", false)
      .lt("data_horario", now.toISOString());

    for (const ag of paraCobranca || []) {
      if (!ag.loja_telefone) continue;

      // Mark confirmacao_enviada so we don't repeat
      await supabase.from("agendamentos").update({ confirmacao_enviada: true }).eq("id", ag.id);

      // Send store confirmation request via pipeline-automations won't work here
      // because the status didn't change. We call send-whatsapp directly for store contact.
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

      if (lojaContato) {
        const { data: lojaAt } = await supabase
          .from("atendimentos")
          .select("id")
          .eq("contato_id", lojaContato.id)
          .eq("canal", "whatsapp")
          .neq("status", "encerrado")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (lojaAt) {
          const msg = `📋 *Confirmação de Comparecimento*\n\nO cliente *${contato?.nome || "Cliente"}* tinha agendamento às *${hora}*.\n\nEle compareceu? Use a opção *4* do menu para confirmar.`;
          await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ atendimento_id: lojaAt.id, texto: msg, remetente_nome: "Sistema" }),
          });
        }
      }

      results.push(`cobranca_loja:${ag.id}`);
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
