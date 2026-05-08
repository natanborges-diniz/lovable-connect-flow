import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * migrar-card-pipeline
 *
 * Move um contato do CRM (Vendas) para o Pipeline Lojas, criando o agendamento
 * e amarrando explicitamente o atendimento de origem para que o histórico de
 * conversa possa ser renderizado dentro do card do Pipeline Lojas.
 *
 * Body esperado:
 *  - contato_id (uuid, obrigatório)
 *  - loja_nome (string, obrigatório)
 *  - loja_telefone (string, opcional)
 *  - data_horario (ISO 8601 com offset, obrigatório)
 *  - observacoes (string, opcional)
 *  - coluna_origem_id (uuid, opcional)  — coluna no CRM antes da transferência
 *  - coluna_origem_nome (string, opcional)
 *  - transferido_por (uuid, opcional)   — auth.uid() do operador
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const {
      contato_id,
      loja_nome,
      loja_telefone,
      data_horario,
      observacoes,
      coluna_origem_id,
      coluna_origem_nome,
      transferido_por,
    } = body || {};

    if (!contato_id || !loja_nome || !data_horario) {
      return new Response(JSON.stringify({ error: "contato_id, loja_nome and data_horario are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Atendimento ativo mais recente do contato (para amarrar histórico)
    const { data: atendimentoAtivo } = await supabase
      .from("atendimentos")
      .select("id, status, modo, canal_provedor, created_at")
      .eq("contato_id", contato_id)
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const atendimento_id = atendimentoAtivo?.id || null;

    // 2) Cria o agendamento via edge function existente (preserva validações
    //    de horário, idempotência e disparo de notificar-loja-agendamento).
    const agRes = await fetch(`${SUPABASE_URL}/functions/v1/agendar-cliente`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contato_id,
        atendimento_id,
        loja_nome,
        loja_telefone: loja_telefone || null,
        data_horario,
        observacoes: observacoes || null,
      }),
    });

    const agJson = await agRes.json();
    if (!agRes.ok) {
      return new Response(JSON.stringify({ error: "agendar-cliente_failed", detail: agJson }), {
        status: agRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agendamento = agJson.agendamento;

    // 3) Persiste rastreabilidade origem_crm no metadata do agendamento
    if (agendamento?.id) {
      const md = (agendamento.metadata || {}) as Record<string, any>;
      const origem_crm = {
        atendimento_id,
        coluna_origem_id: coluna_origem_id || null,
        coluna_origem_nome: coluna_origem_nome || null,
        transferido_at: new Date().toISOString(),
        transferido_por: transferido_por || null,
      };
      await supabase
        .from("agendamentos")
        .update({ metadata: { ...md, origem_crm } })
        .eq("id", agendamento.id);
    }

    // 4) Limpa pipeline_coluna_id do contato (sai do CRM)
    await supabase
      .from("contatos")
      .update({ pipeline_coluna_id: null })
      .eq("id", contato_id);

    // 5) Evento de auditoria no histórico do card (entidade=contato)
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "contato",
      entidade_id: contato_id,
      tipo: "transferencia_crm_lojas",
      descricao: `Transferido do CRM para Pipeline Lojas — ${loja_nome}`,
      coluna_anterior_id: coluna_origem_id || null,
      coluna_nova_id: null,
      usuario_id: transferido_por || null,
      metadata: {
        agendamento_id: agendamento?.id || null,
        atendimento_id,
        loja_nome,
        data_horario,
      },
    });

    return new Response(JSON.stringify({
      status: "ok",
      agendamento,
      atendimento_id,
      duplicate: agJson.duplicate || false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("migrar-card-pipeline error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
