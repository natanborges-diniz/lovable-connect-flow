import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-key",
};

// Resolve a bandeira do cartão a partir do BIN (6 primeiros dígitos).
// Cobre os principais emissores BR; retorna null se não bater.
function resolveBrandFromBin(binRaw: string | null | undefined): string | null {
  if (!binRaw) return null;
  const digits = String(binRaw).replace(/\D/g, "");
  if (digits.length < 4) return null;
  const bin6 = Number(digits.slice(0, 6));
  const bin4 = Number(digits.slice(0, 4));
  const bin2 = Number(digits.slice(0, 2));
  const bin1 = Number(digits.slice(0, 1));

  // Elo (faixas oficiais)
  const eloRanges: Array<[number, number]> = [
    [401178, 401179], [438935, 438935], [451416, 451416], [457393, 457393],
    [457631, 457632], [504175, 504175], [506699, 506778], [509000, 509999],
    [627780, 627780], [636297, 636297], [636368, 636368],
    [650031, 650033], [650035, 650051], [650405, 650439], [650485, 650538],
    [650541, 650598], [650700, 650718], [650720, 650727], [650901, 650920],
    [651652, 651679], [655000, 655019], [655021, 655058],
  ];
  if (eloRanges.some(([a, b]) => bin6 >= a && bin6 <= b)) return "Elo";

  // Hipercard
  if (bin6 === 606282 || bin6 === 637095 || (bin6 >= 637568 && bin6 <= 637599)) return "Hipercard";

  // Mastercard (51-55, 2221-2720)
  if (bin2 >= 51 && bin2 <= 55) return "Mastercard";
  if (bin4 >= 2221 && bin4 <= 2720) return "Mastercard";

  // Visa
  if (bin1 === 4) return "Visa";

  // Amex
  if (bin2 === 34 || bin2 === 37) return "Amex";

  // Diners
  if (bin2 === 36 || bin2 === 38) return "Diners";
  if (bin4 >= 3000 && bin4 <= 3059) return "Diners";

  // Discover
  if (bin4 === 6011 || bin2 === 65) return "Discover";

  // JCB
  if (bin2 === 35) return "JCB";

  // Aura (5067, 4576, 4011)
  if (bin4 === 5067 || bin4 === 4576 || bin4 === 4011) return "Aura";

  return null;
}

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
      brand, brandName, cardBin, kind, dateTime, date, time,
    } = payload;

    const brandFromPayload: string | null = brand || brandName || null;
    const brandDerived: string | null = brandFromPayload ? null : resolveBrandFromBin(cardBin);
    const bandeira: string | null = brandFromPayload || brandDerived;
    const brandOrigem: string | null = brandFromPayload ? "webhook" : (brandDerived ? "derivado_bin" : null);
    const redeDateTime: string | null = dateTime || null;
    const redeDate: string | null = date || (redeDateTime ? redeDateTime.slice(0, 10) : null);
    const redeTime: string | null = time || (redeDateTime ? redeDateTime.slice(11, 19) : null);

    console.log("[payment-webhook] Received:", { payment_link_id, status, tid, nsu, origem_ref, brand: bandeira, brand_origem: brandOrigem, kind, cardBin });
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

    // Se já existe comprovante anexado pelo cliente, marca conciliação
    let conciliadoComPrint = false;
    try {
      const { count } = await supabase
        .from("solicitacao_anexos")
        .select("id", { count: "exact", head: true })
        .eq("solicitacao_id", solicitacao.id)
        .eq("tipo", "comprovante_pagamento_cliente");
      conciliadoComPrint = (count ?? 0) > 0;
    } catch (_) { /* noop */ }

    const updatedMeta = {
      ...existingMeta,
      tid: tid || null,
      authorization: authorization || null,
      nsu: nsu || null,
      last4: last4 || null,
      installments: installments || null,
      descricao: descricao || null,
      nome_cliente: nome_cliente || null,
      brand: bandeira,
      brand_origem: brandOrigem,
      card_bin: cardBin || null,
      kind: kind || null,
      rede_datetime: redeDateTime,
      rede_date: redeDate,
      rede_time: redeTime,
      payment_status: status,
      payment_confirmed_at: now.toISOString(),
      ...(conciliadoComPrint && status === "PAGO" ? { conciliado_com_print: true } : {}),
    };

    const updateData: Record<string, unknown> = { metadata: updatedMeta };
    if (colunaId) updateData.pipeline_coluna_id = colunaId;
    if (status === "PAGO") updateData.status = "concluida";

    await supabase.from("solicitacoes").update(updateData).eq("id", solicitacao.id);

    // Espelha em pagamentos_link (fonte de verdade financeira)
    try {
      const newStatus = status === "PAGO" ? "pago"
                      : status === "CANCELADO" ? "estornado"
                      : status === "EXPIRADO" ? "expirado"
                      : "enviado";
      const phone = String(existingMeta.cliente_whatsapp || "").replace(/\D/g, "");
      let contatoIdResolved: string | null = solicitacao.contato_id || null;
      if (!contatoIdResolved && phone) {
        const { data: c } = await supabase.from("contatos").select("id").eq("telefone", phone).maybeSingle();
        contatoIdResolved = c?.id || null;
      }
      await supabase.from("pagamentos_link").upsert({
        payment_link_id,
        solicitacao_id: solicitacao.id,
        contato_id: contatoIdResolved,
        loja_nome: (existingMeta.alias_loja as string)?.replace(/^DINIZ\s+/i, "Diniz ") || null,
        cod_empresa: existingMeta.cod_empresa as string || null,
        alias_loja: existingMeta.alias_loja as string || null,
        cliente_nome: nome_cliente || existingMeta.cliente as string || null,
        cliente_telefone: phone || null,
        valor: valor ? Number(valor) : (existingMeta.valor ? Number(String(existingMeta.valor).replace(/[^0-9.]/g,"")) : null),
        parcelas: installments || (existingMeta.parcelas ? Number(existingMeta.parcelas) : null),
        descricao: descricao || existingMeta.descricao as string || null,
        status: newStatus,
        tid: tid || null,
        nsu: nsu || null,
        authorization_code: authorization || null,
        last4: last4 || null,
        link_url: existingMeta.url as string || null,
        pago_at: status === "PAGO" ? (redeDateTime || now.toISOString()) : null,
        enviado_at: existingMeta.enviado_at as string || null,
        metadata: updatedMeta,
      }, { onConflict: "payment_link_id" });
    } catch (mirrorErr) {
      console.error("[payment-webhook] Failed mirror pagamentos_link:", mirrorErr);
    }

    const nsuLabel = nsu ? ` | NSU: ${nsu}` : "";
    await supabase.from("eventos_crm").insert({
      contato_id: solicitacao.contato_id,
      tipo: status === "PAGO" ? "pagamento_confirmado" : "pagamento_status_atualizado",
      descricao: status === "PAGO"
        ? `Pagamento confirmado via link. TID: ${tid || "N/A"}${nsuLabel} | Valor: R$ ${valor ? Number(valor).toFixed(2) : "N/A"}`
        : `Status do link atualizado para ${status}`,
      referencia_tipo: "solicitacao",
      referencia_id: solicitacao.id,
      metadata: { payment_link_id, tid, nsu, status, authorization, valor, last4, installments, brand: bandeira, card_bin: cardBin || null, kind: kind || null, rede_datetime: redeDateTime },
    });

    // Comprovante "picote" entregue via app Atrium Messenger (notificações + comentário no ticket).
    if (status === "PAGO") {
      try {
        const { data: contato } = await supabase
          .from("contatos").select("id, nome, telefone").eq("id", solicitacao.contato_id).single();

        const dateStr = redeDate
          ? redeDate.split("-").reverse().join("/")
          : now.toLocaleDateString("pt-BR");
        const timeStr = redeTime
          ? redeTime.slice(0, 5)
          : now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const clienteName = nome_cliente || "N/A";
        const valorFmt = valor ? `R$ ${Number(valor).toFixed(2)}` : "N/A";
        const descFmt = descricao || "";
        const nsuFmt = nsu || "N/A";
        const tidFmt = tid || "N/A";
        const authFmt = authorization || "N/A";
        const last4Fmt = last4 || "****";
        const installmentsFmt = installments || 1;
        const kindLabel = kind === "credit" ? "Crédito" : kind === "debit" ? "Débito" : "";
        const cartaoLinha = [bandeira, kindLabel].filter(Boolean).join(" ").trim();

        let receiptMsg = `📩 *Comprovante de pagamento — ${clienteName}*\n\n`;
        receiptMsg += `✅ *Pagamento Confirmado!*\n`;
        receiptMsg += `💰 Valor: ${valorFmt}\n`;
        if (descFmt) receiptMsg += `📋 ${descFmt}\n`;
        receiptMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
        receiptMsg += `🔑 *NSU: ${nsuFmt}*\n`;
        receiptMsg += `   ↳ Use para baixa no sistema\n`;
        receiptMsg += `━━━━━━━━━━━━━━━━━━\n\n`;
        receiptMsg += `🆔 TID: ${tidFmt}\n`;
        receiptMsg += `🔐 Autorização: ${authFmt}\n`;
        receiptMsg += `📅 ${dateStr} às ${timeStr}\n`;
        receiptMsg += `💳 ${cartaoLinha ? `${cartaoLinha} ` : ""}**** ${last4Fmt} — ${installmentsFmt}x`;

        // Nome da LOJA (nunca do cliente) — alias_loja/loja_nome no metadata.
        const lojaNome = ((existingMeta.alias_loja as string) || (existingMeta.loja_nome as string) || contato?.nome || "Loja").trim();

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

        // Comentário sistema no ticket (Messenger "Minhas demandas" lê daqui)
        await supabase.from("solicitacao_comentarios").insert({
          solicitacao_id: solicitacao.id,
          tipo: "sistema",
          autor_nome: "Sistema Financeiro",
          conteudo: receiptMsg,
        });

        // ── Garante que a loja receba o CARD no Messenger via demandas_loja ──
        // Se a solicitação não tem demanda vinculada (link criado direto pelo
        // painel financeiro sem passar por demandas_loja), auto-cria uma
        // demanda + mensagem para a loja receber o comprovante no app.
        try {
          let demandaId = (existingMeta.demanda_id as string) || null;

          if (!demandaId) {
            const { data: lojaInfo } = await supabase
              .from("telefones_lojas")
              .select("telefone, setor_destino_id")
              .ilike("nome_loja", lojaNome)
              .eq("ativo", true)
              .maybeSingle();

            if (lojaInfo?.telefone) {
              const protocolo = `FIN-${new Date().getFullYear()}-${String(solicitacao.id).slice(0, 8)}`;
              const { data: novaDem, error: novaDemErr } = await supabase
                .from("demandas_loja")
                .insert({
                  protocolo,
                  loja_nome: lojaNome,
                  loja_telefone: lojaInfo.telefone,
                  assunto: `Comprovante de pagamento — ${clienteName}`.slice(0, 120),
                  pergunta: `Pagamento confirmado NSU ${nsuFmt} — ${valorFmt}`,
                  status: "aberta",
                  origem: "sistema",
                  tipo_chave: "comprovante_pagamento",
                  setor_destino_id: lojaInfo.setor_destino_id,
                  solicitante_nome: "Sistema Financeiro",
                  vista_pelo_operador: false,
                  metadata: { solicitacao_id: solicitacao.id, auto_created_from: "payment-webhook", payment_link_id, no_auto_encerrar: true },
                })
                .select("id")
                .single();

              if (novaDemErr) {
                console.error("[payment-webhook] auto-create demanda failed:", novaDemErr);
              } else if (novaDem?.id) {
                demandaId = novaDem.id;
                // Backfill demanda_id no metadata da solicitação
                await supabase.from("solicitacoes")
                  .update({ metadata: { ...updatedMeta, demanda_id: demandaId } })
                  .eq("id", solicitacao.id);
              }
            } else {
              console.warn(`[payment-webhook] sem telefone cadastrado para loja "${lojaNome}" — demanda não criada`);
            }
          }

          if (demandaId) {
            await supabase.from("demanda_mensagens").insert({
              demanda_id: demandaId,
              direcao: "operador_para_loja",
              autor_nome: "Sistema Financeiro",
              conteudo: receiptMsg,
              metadata: { tipo: "comprovante_pagamento", solicitacao_id: solicitacao.id, payment_link_id, nsu, tid },
            });

            // Mantém status 'aberta' para que a loja veja o card no Messenger
            // (auto-encerrar-demandas só fecha 'respondida'). A loja/operador encerra manualmente.
            await supabase.from("demandas_loja").update({
              status: "aberta",
              vista_pelo_operador: false,
            }).eq("id", demandaId);
          }
        } catch (demErr) {
          console.error("[payment-webhook] Failed to create/post demanda:", demErr);
        }

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
