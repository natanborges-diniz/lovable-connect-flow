// Notifica a loja (via App Atrium Messenger) quando um agendamento é
// confirmado pelo cliente. Idempotente via metadata.aviso_loja_enviado_at.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function fmtDataHora(iso: string): { dataLabel: string; horaLabel: string } {
  const dt = new Date(iso);
  const dataLabel = dt.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  const horaLabel = dt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return { dataLabel, horaLabel };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { agendamento_id, evento } = await req.json();
    if (!agendamento_id) {
      return new Response(JSON.stringify({ error: "agendamento_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const eventoLabel: "novo" | "confirmado" = evento === "novo" ? "novo" : "confirmado";

    // 1) Carrega agendamento + contato
    const { data: ag, error: agErr } = await supabase
      .from("agendamentos")
      .select(
        "id, contato_id, atendimento_id, loja_nome, loja_telefone, data_horario, status, observacoes, metadata"
      )
      .eq("id", agendamento_id)
      .single();
    if (agErr || !ag) {
      return new Response(JSON.stringify({ error: "agendamento not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const md = (ag.metadata || {}) as Record<string, unknown>;
    if (md.aviso_loja_enviado_at) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "ja_enviado", em: md.aviso_loja_enviado_at }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: contato } = await supabase
      .from("contatos")
      .select("nome, telefone")
      .eq("id", ag.contato_id)
      .single();

    // 2) Resumo: usa metadata.resumo_ia se houver; senão chama summarize-atendimento
    let resumo: string | null = null;
    if (ag.atendimento_id) {
      const { data: at } = await supabase
        .from("atendimentos")
        .select("metadata")
        .eq("id", ag.atendimento_id)
        .single();
      const atMeta = (at?.metadata || {}) as Record<string, unknown>;
      const resumoExistente = atMeta.resumo_ia as string | undefined;
      const geradoEm = atMeta.resumo_gerado_em as string | undefined;
      const fresh =
        geradoEm && Date.now() - new Date(geradoEm).getTime() < 6 * 60 * 60 * 1000;
      if (resumoExistente && fresh) {
        resumo = resumoExistente;
      } else {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ atendimento_id: ag.atendimento_id, audience: "interno" }),
          });
          const j = await r.json();
          if (r.ok && j?.resumo) resumo = j.resumo as string;
        } catch (e) {
          console.warn("[notificar-loja-agendamento] summarize falhou:", e);
        }
      }
    }
    if (!resumo) {
      resumo = ag.observacoes || "Cliente confirmou presença. Sem detalhes adicionais do atendimento.";
    }

    // 3) Monta título + mensagem
    const { dataLabel, horaLabel } = fmtDataHora(ag.data_horario);
    const clienteNome = contato?.nome || "Cliente";
    const clienteTel = contato?.telefone ? ` 📞 ${contato.telefone}` : "";

    const titulo = `📅 Agendamento confirmado — ${clienteNome}`;
    const mensagem =
      `Cliente *${clienteNome}* confirmou presença na *${ag.loja_nome}*.\n` +
      `🗓 ${dataLabel} às ${horaLabel}${clienteTel}\n\n` +
      `*Resumo do atendimento:*\n${resumo}`;

    // 4) Resolve destinatários
    const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", {
      _loja_nome: ag.loja_nome,
    });
    const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;

    if (list.length === 0) {
      // Cria tarefa para supervisor configurar a loja
      await supabase.from("tarefas").insert({
        titulo: `⚠️ Configurar usuários da loja "${ag.loja_nome}" — agendamento sem destinatário`,
        descricao:
          `Cliente ${clienteNome} confirmou agendamento ${dataLabel} às ${horaLabel} na ${ag.loja_nome}, ` +
          `mas a loja não tem usuários internos configurados para receber o aviso. ` +
          `Vincule um usuário ao setor/loja em Configurações → Usuários e Telefones Corporativos.`,
        status: "pendente",
        prioridade: "alta",
      } as any);

      await supabase.from("eventos_crm").insert({
        contato_id: ag.contato_id,
        tipo: "aviso_loja_sem_destinatario",
        descricao: `Loja "${ag.loja_nome}" sem destinatários internos — tarefa criada para supervisor`,
        referencia_id: ag.id,
        referencia_tipo: "agendamento",
        metadata: { loja_nome: ag.loja_nome },
      });

      // Marca como tentado para não criar tarefa repetidamente
      await supabase
        .from("agendamentos")
        .update({
          metadata: {
            ...md,
            aviso_loja_enviado_at: new Date().toISOString(),
            aviso_loja_status: "sem_destinatario",
          },
        })
        .eq("id", ag.id);

      return new Response(
        JSON.stringify({ ok: true, status: "sem_destinatario", tarefa_criada: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5) Insere notificações (trigger trg_push_nova_notificacao envia push automaticamente)
    const notifs = list.map((d) => ({
      usuario_id: d.user_id,
      setor_id: d.setor_id,
      tipo: "agendamento_confirmado_loja",
      titulo,
      mensagem,
      referencia_id: ag.id,
    }));
    const { error: notifErr } = await supabase.from("notificacoes").insert(notifs);
    if (notifErr) throw notifErr;

    // 6) Marca idempotência + log no CRM
    await supabase
      .from("agendamentos")
      .update({
        metadata: {
          ...md,
          aviso_loja_enviado_at: new Date().toISOString(),
          aviso_loja_destinatarios: list.length,
        },
      })
      .eq("id", ag.id);

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: "aviso_loja_agendamento",
      descricao: `Aviso de agendamento confirmado entregue a ${list.length} usuário(s) da ${ag.loja_nome}`,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
      metadata: { loja_nome: ag.loja_nome, destinatarios: list.length },
    });

    return new Response(
      JSON.stringify({ ok: true, status: "enviado", destinatarios: list.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[notificar-loja-agendamento] erro:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
