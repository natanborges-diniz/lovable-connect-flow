import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_SERVICE_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

  const serviceKey = req.headers.get("x-service-key");
  if (!serviceKey || serviceKey !== INTERNAL_SERVICE_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();
    const {
      payment_link_id, status, tid, authorization, valor, origem_ref,
      nsu, last4, installments, descricao, nome_cliente,
    } = payload;

    console.log("[payment-webhook] Received:", { payment_link_id, status, tid, nsu, origem_ref });
    if (!payment_link_id) throw new Error("payment_link_id é obrigatório");

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

    let targetColunaNome: string | null = null;
    if (status === "PAGO") targetColunaNome = "Link Pago";
    else if (status === "CANCELADO" || status === "EXPIRADO") targetColunaNome = "Cancelado";

    let colunaId: string | null = null;
    if (targetColunaNome) {
      const { data: financeiroSetor } = await supabase
        .from("setores").select("id").eq("nome", "Financeiro").single();
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

    const now = new Date();
    const existingMeta = (solicitacao.metadata || {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      tid: tid || null,
      authorization: authorization || null,
      nsu: nsu || null,
      last4: last4 || null,
      installments: installments || null,
      descricao: descricao || null,
      nome_cliente: nome_cliente || null,
      payment_status: status,
      payment_confirmed_at: now.toISOString(),
    };

    const updateData: Record<string, unknown> = { metadata: updatedMeta };
    if (colunaId) updateData.pipeline_coluna_id = colunaId;
    if (status === "PAGO") updateData.status = "concluida";

    await supabase.from("solicitacoes").update(updateData).eq("id", solicitacao.id);

    const nsuLabel = nsu ? ` | NSU: ${nsu}` : "";
    await supabase.from("eventos_crm").insert({
      contato_id: solicitacao.contato_id,
      tipo: status === "PAGO" ? "pagamento_confirmado" : "pagamento_status_atualizado",
      descricao: status === "PAGO"
        ? `Pagamento confirmado via link. TID: ${tid || "N/A"}${nsuLabel} | Valor: R$ ${valor ? Number(valor).toFixed(2) : "N/A"}`
        : `Status do link atualizado para ${status}`,
      referencia_tipo: "solicitacao",
      referencia_id: solicitacao.id,
      metadata: { payment_link_id, tid, nsu, status, authorization, valor, last4, installments },
    });

    // Comprovante "picote" entregue via app Atrium Messenger (notificações + comentário no ticket).
    if (status === "PAGO") {
      try {
        const { data: contato } = await supabase
          .from("contatos").select("id, nome, telefone").eq("id", solicitacao.contato_id).single();

        const dateStr = now.toLocaleDateString("pt-BR");
        const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const clienteName = nome_cliente || "N/A";
        const valorFmt = valor ? `R$ ${Number(valor).toFixed(2)}` : "N/A";
        const descFmt = descricao || "";
        const nsuFmt = nsu || "N/A";
        const tidFmt = tid || "N/A";
        const last4Fmt = last4 || "****";
        const installmentsFmt = installments || 1;

        let receiptMsg = `📩 *Comprovante de pagamento — ${clienteName}*\n\n`;
        receiptMsg += `✅ *Pagamento Confirmado!*\n`;
        receiptMsg += `💰 Valor: ${valorFmt}\n`;
        if (descFmt) receiptMsg += `📋 ${descFmt}\n`;
        receiptMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
        receiptMsg += `🔑 *NSU: ${nsuFmt}*\n`;
        receiptMsg += `   ↳ Use para baixa no sistema\n`;
        receiptMsg += `━━━━━━━━━━━━━━━━━━\n\n`;
        receiptMsg += `🆔 TID: ${tidFmt}\n`;
        receiptMsg += `📅 ${dateStr} às ${timeStr}\n`;
        receiptMsg += `💳 Cartão: **** ${last4Fmt} | ${installmentsFmt}x`;

        const lojaNome = contato?.nome || "Loja";
        const { data: dests } = await supabase
          .rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
        const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;

        for (const d of list) {
          await supabase.from("notificacoes").insert({
            usuario_id: d.user_id,
            setor_id: d.setor_id,
            tipo: "comprovante_pagamento",
            titulo: `💳 Pagamento confirmado — ${clienteName}`,
            mensagem: `Valor ${valorFmt} | NSU ${nsuFmt}`,
            referencia_id: solicitacao.id,
          });
        }

        await supabase.from("solicitacao_comentarios").insert({
          solicitacao_id: solicitacao.id,
          tipo: "sistema",
          autor_nome: "Sistema Financeiro",
          conteudo: receiptMsg,
        });

        console.log(`[payment-webhook] Picote entregue via app para ${list.length} destinatário(s) — loja "${lojaNome}"`);
      } catch (notifyErr) {
        console.error("[payment-webhook] Failed to dispatch picote internally:", notifyErr);
      }
    }

    console.log("[payment-webhook] Solicitação updated:", solicitacao.id, "→", targetColunaNome);

    return new Response(JSON.stringify({
      received: true, processed: true, solicitacao_id: solicitacao.id, coluna: targetColunaNome,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[payment-webhook] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
