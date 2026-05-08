// Cancela uma solicitação (link de pagamento, CPF, boleto, etc.) com motivo opcional.
// - Marca solicitacoes.status='cancelada'
// - Marca pagamentos_link.status='cancelado' se vinculado
// - Encerra demanda_loja vinculada (com mensagem) e notifica loja
// - Registra evento na timeline
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve usuário
    const authHeader = req.headers.get("Authorization") || "";
    let usuario_id: string | null = null;
    let usuario_nome: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u } = await userClient.auth.getUser();
      usuario_id = u?.user?.id || null;
      if (usuario_id) {
        const { data: prof } = await supabase.from("profiles").select("nome").eq("id", usuario_id).maybeSingle();
        usuario_nome = prof?.nome || u?.user?.email || null;
      }
    }

    const { solicitacao_id, motivo } = await req.json();
    if (!solicitacao_id) {
      return new Response(JSON.stringify({ error: "solicitacao_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sol } = await supabase
      .from("solicitacoes").select("*").eq("id", solicitacao_id).single();
    if (!sol) {
      return new Response(JSON.stringify({ error: "nao_encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = (sol.metadata || {}) as Record<string, unknown>;
    const colunaAnterior = sol.pipeline_coluna_id;
    const motivoTexto = String(motivo || "").trim();

    // Solicitação
    await supabase.from("solicitacoes").update({
      status: "cancelada",
      pipeline_coluna_id: null,
      metadata: {
        ...meta,
        cancelado_em: new Date().toISOString(),
        cancelado_por: usuario_nome,
        motivo_cancelamento: motivoTexto || null,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", solicitacao_id);

    // pagamentos_link
    if ((meta as any).payment_link_id) {
      await supabase.from("pagamentos_link").update({
        status: "cancelado",
        metadata: {
          ...(meta as any),
          cancelado_em: new Date().toISOString(),
          cancelado_por: usuario_nome,
          motivo_cancelamento: motivoTexto || null,
        },
        updated_at: new Date().toISOString(),
      }).eq("payment_link_id", (meta as any).payment_link_id);
    }

    // demanda_loja
    const demandaId = (meta as any).demanda_id as string | undefined;
    if (demandaId) {
      const corpo = motivoTexto
        ? `🚫 Solicitação cancelada pelo ${usuario_nome || "operador"}.\n\nMotivo: ${motivoTexto}`
        : `🚫 Solicitação cancelada pelo ${usuario_nome || "operador"}.`;
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demandaId,
        direcao: "operador_para_loja",
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Operador",
        conteudo: corpo,
        metadata: { tipo: "cancelamento", solicitacao_id },
      });
      await supabase.from("demandas_loja").update({
        status: "encerrada",
        encerrada_at: new Date().toISOString(),
        metadata: { ...((sol.metadata as any) || {}), cancelada: true, motivo: motivoTexto || null },
      }).eq("id", demandaId);
    }

    // Evento timeline
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: solicitacao_id,
      tipo: "cancelado",
      descricao: motivoTexto ? `Cancelado: ${motivoTexto.slice(0, 200)}` : "Cancelado",
      coluna_anterior_id: colunaAnterior,
      usuario_id, usuario_nome,
      metadata: { motivo: motivoTexto || null, demanda_id: demandaId || null },
    });

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[cancelar-solicitacao-loja] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
