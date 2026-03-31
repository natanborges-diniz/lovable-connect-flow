import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_SERVICE_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

  // Authenticate via x-service-key
  const serviceKey = req.headers.get("x-service-key");
  if (!serviceKey || serviceKey !== INTERNAL_SERVICE_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();
    const { payment_link_id, status, tid, authorization, valor, origem_ref } = payload;

    console.log("[payment-webhook] Received:", { payment_link_id, status, tid, origem_ref });

    if (!payment_link_id) {
      throw new Error("payment_link_id é obrigatório");
    }

    // Find the solicitação by payment_link_id in metadata
    const { data: solicitacoes } = await supabase
      .from("solicitacoes")
      .select("id, metadata, contato_id, pipeline_coluna_id")
      .eq("tipo", "link_pagamento")
      .order("created_at", { ascending: false })
      .limit(100);

    const solicitacao = (solicitacoes || []).find((s: any) => {
      const meta = s.metadata as Record<string, unknown> | null;
      return meta?.payment_link_id === payment_link_id;
    });

    if (!solicitacao) {
      console.warn("[payment-webhook] No solicitação found for payment_link_id:", payment_link_id);
      return new Response(JSON.stringify({ received: true, processed: false, reason: "solicitacao_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine target column based on payment status
    let targetColunaNome: string | null = null;
    if (status === "PAGO") {
      targetColunaNome = "Pago";
    } else if (status === "CANCELADO" || status === "EXPIRADO") {
      targetColunaNome = "Cancelado";
    }

    let colunaId: string | null = null;
    if (targetColunaNome) {
      // Find the Financeiro sector and target column
      const { data: financeiroSetor } = await supabase
        .from("setores")
        .select("id")
        .eq("nome", "Financeiro")
        .single();

      if (financeiroSetor) {
        const { data: coluna } = await supabase
          .from("pipeline_colunas")
          .select("id")
          .eq("setor_id", financeiroSetor.id)
          .eq("nome", targetColunaNome)
          .eq("ativo", true)
          .single();

        colunaId = coluna?.id || null;
      }
    }

    // Update solicitação metadata with TID and move to target column
    const existingMeta = (solicitacao.metadata || {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      tid: tid || null,
      authorization: authorization || null,
      payment_status: status,
      payment_confirmed_at: new Date().toISOString(),
    };

    const updateData: Record<string, unknown> = { metadata: updatedMeta };
    if (colunaId) {
      updateData.pipeline_coluna_id = colunaId;
    }
    if (status === "PAGO") {
      updateData.status = "concluida";
    }

    await supabase
      .from("solicitacoes")
      .update(updateData)
      .eq("id", solicitacao.id);

    // Log CRM event
    await supabase.from("eventos_crm").insert({
      contato_id: solicitacao.contato_id,
      tipo: status === "PAGO" ? "pagamento_confirmado" : "pagamento_status_atualizado",
      descricao: status === "PAGO"
        ? `Pagamento confirmado via link. TID: ${tid || "N/A"} | Valor: R$ ${valor ? Number(valor).toFixed(2) : "N/A"}`
        : `Status do link atualizado para ${status}`,
      referencia_tipo: "solicitacao",
      referencia_id: solicitacao.id,
      metadata: { payment_link_id, tid, status, authorization, valor },
    });

    console.log("[payment-webhook] Solicitação updated:", solicitacao.id, "→", targetColunaNome);

    return new Response(JSON.stringify({ received: true, processed: true, solicitacao_id: solicitacao.id, coluna: targetColunaNome }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[payment-webhook] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
