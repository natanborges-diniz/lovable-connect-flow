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
  const OPTICAL_BUSINESS_URL = Deno.env.get("OPTICAL_BUSINESS_URL");
  const INTERNAL_SERVICE_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { atendimento_id, contato_id, mensagem_texto, loja_info } = await req.json();
    if (!atendimento_id) throw new Error("atendimento_id is required");

    // 1. Get or create bot session
    let { data: sessao } = await supabase
      .from("bot_sessoes")
      .select("*")
      .eq("atendimento_id", atendimento_id)
      .eq("status", "ativo")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!sessao) {
      const { data: newSessao, error: sErr } = await supabase
        .from("bot_sessoes")
        .insert({ atendimento_id, fluxo: "menu_principal", etapa: "inicio", dados: {} })
        .select()
        .single();
      if (sErr) throw sErr;
      sessao = newSessao;
    }

    const nomeLoja = loja_info?.nome_loja || "Loja";
    const codEmpresa = loja_info?.cod_empresa || "";
    const texto = (mensagem_texto || "").trim();
    const textoLower = texto.toLowerCase();

    let resposta = "";
    let updateSessao: Record<string, unknown> = {};

    // ─── State Machine ───
    const { fluxo, etapa, dados } = sessao;

    if (textoLower === "menu" || textoLower === "voltar" || textoLower === "0") {
      // Reset to menu
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      resposta = buildMenu(nomeLoja);
    } else if (fluxo === "menu_principal" && etapa === "inicio") {
      // First message or menu display
      if (texto === "1") {
        updateSessao = { fluxo: "link_pagamento", etapa: "valor", dados: {} };
        resposta = "💳 *Gerar Link de Pagamento*\n\nQual o *valor* do link? (ex: 150.00)";
      } else {
        resposta = buildMenu(nomeLoja);
      }
    } else if (fluxo === "link_pagamento") {
      const result = handleLinkPagamento(etapa, texto, dados as Record<string, unknown>);
      resposta = result.resposta;
      updateSessao = result.update;

      // If confirming, call payment-links
      if (etapa === "confirmar" && (textoLower === "sim" || textoLower === "s")) {
        if (!OPTICAL_BUSINESS_URL || !INTERNAL_SERVICE_SECRET) {
          resposta = "⚠️ Integração de pagamento não configurada. Contate o administrador.";
          updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {}, status: "ativo" };
        } else {
          try {
            const paymentData = dados as Record<string, unknown>;
            const payRes = await fetch(`${OPTICAL_BUSINESS_URL}/functions/v1/payment-links`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-service-key": INTERNAL_SERVICE_SECRET,
              },
              body: JSON.stringify({
                action: "criar",
                cod_empresa: codEmpresa,
                valor: paymentData.valor,
                descricao: paymentData.descricao,
                parcelas_max: paymentData.parcelas || 1,
                cliente_nome: paymentData.cliente || null,
                origem: "CHATBOT",
                origem_ref: atendimento_id,
              }),
            });

            const payResult = await payRes.json();

            if (payResult.error) {
              resposta = `❌ Erro ao gerar link: ${payResult.error}\n\nDigite *menu* para voltar.`;
              updateSessao = { status: "concluido" };
            } else {
              const url = payResult.url_pagamento || "Link em processamento";
              resposta = `✅ *Link gerado com sucesso!*\n\n🔗 ${url}\n💰 R$ ${Number(paymentData.valor).toFixed(2)}\n📝 ${paymentData.descricao}\n💳 Até ${paymentData.parcelas || 1}x\n⏰ Válido por 24h\n\nDigite *menu* para nova operação.`;
              updateSessao = { status: "concluido" };

              // Create solicitação for pipeline tracking
              await createFinanceiroSolicitacao(supabase, contato_id, paymentData, payResult);
            }
          } catch (e) {
            console.error("Payment link error:", e);
            resposta = `❌ Erro na comunicação com o sistema de pagamento. Tente novamente.\n\nDigite *menu* para voltar.`;
            updateSessao = { status: "concluido" };
          }
        }
      }
    } else {
      resposta = buildMenu(nomeLoja);
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
    }

    // 2. Update session
    if (Object.keys(updateSessao).length > 0) {
      await supabase
        .from("bot_sessoes")
        .update(updateSessao)
        .eq("id", sessao.id);

      // If session completed, allow new sessions
      if (updateSessao.status === "concluido") {
        // Session is done, next message will create a new one
      }
    }

    // 3. Send response via send-whatsapp
    await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        atendimento_id,
        texto: resposta,
        remetente_nome: "Bot Lojas",
      }),
    });

    return new Response(JSON.stringify({ status: "ok", resposta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bot-lojas error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Helpers ───

function buildMenu(nomeLoja: string): string {
  return `Olá *${nomeLoja}*! 👋\n\nEscolha uma opção:\n\n1️⃣ Gerar Link de Pagamento\n\n_Digite o número da opção desejada._`;
}

function handleLinkPagamento(
  etapa: string,
  texto: string,
  dados: Record<string, unknown>
): { resposta: string; update: Record<string, unknown> } {
  switch (etapa) {
    case "valor": {
      const valor = parseFloat(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (isNaN(valor) || valor <= 0) {
        return { resposta: "⚠️ Valor inválido. Digite um número válido (ex: 150.00)", update: {} };
      }
      return {
        resposta: "📝 Descreva o pagamento (ex: Lente Transition CR39)",
        update: { etapa: "descricao", dados: { ...dados, valor } },
      };
    }

    case "descricao": {
      if (!texto || texto.length < 3) {
        return { resposta: "⚠️ Descrição muito curta. Descreva o pagamento com mais detalhes.", update: {} };
      }
      return {
        resposta: "💳 Máximo de parcelas? (1-12)",
        update: { etapa: "parcelas", dados: { ...dados, descricao: texto } },
      };
    }

    case "parcelas": {
      const parcelas = parseInt(texto);
      if (isNaN(parcelas) || parcelas < 1 || parcelas > 12) {
        return { resposta: "⚠️ Digite um número entre 1 e 12.", update: {} };
      }
      return {
        resposta: "👤 Nome do cliente (ou digite *pular*)",
        update: { etapa: "cliente", dados: { ...dados, parcelas } },
      };
    }

    case "cliente": {
      const cliente = texto.toLowerCase() === "pular" ? null : texto;
      const d = { ...dados, cliente };
      const resumo = `📋 *Confirme os dados:*\n\n💰 Valor: R$ ${Number(d.valor).toFixed(2)}\n📝 Descrição: ${d.descricao}\n💳 Parcelas: até ${d.parcelas}x${cliente ? `\n👤 Cliente: ${cliente}` : ""}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`;
      return {
        resposta: resumo,
        update: { etapa: "confirmar", dados: d },
      };
    }

    case "confirmar": {
      if (texto.toLowerCase() === "nao" || texto.toLowerCase() === "não" || texto.toLowerCase() === "n") {
        return {
          resposta: "❌ Operação cancelada.\n\nDigite *menu* para voltar ao início.",
          update: { status: "concluido" },
        };
      }
      // "sim" case is handled in the main flow (needs async call)
      return { resposta: "⏳ Gerando link de pagamento...", update: {} };
    }

    default:
      return {
        resposta: "⚠️ Etapa não reconhecida. Digite *menu* para recomeçar.",
        update: { fluxo: "menu_principal", etapa: "inicio", dados: {} },
      };
  }
}

async function createFinanceiroSolicitacao(
  supabase: any,
  contatoId: string,
  dados: Record<string, unknown>,
  payResult: Record<string, unknown>
) {
  try {
    // Create solicitação
    const { data: solicitacao } = await supabase
      .from("solicitacoes")
      .insert({
        contato_id: contatoId,
        assunto: `Link de Pagamento - R$ ${Number(dados.valor).toFixed(2)}`,
        descricao: `${dados.descricao}${dados.cliente ? ` | Cliente: ${dados.cliente}` : ""} | Parcelas: ${dados.parcelas}x`,
        canal_origem: "whatsapp",
        status: "em_atendimento",
        tipo: "link_pagamento",
        metadata: { payment_link_id: payResult.id, url: payResult.url_pagamento },
      })
      .select()
      .single();

    // Move contact to Financeiro pipeline column
    const { data: financeiroColuna } = await supabase
      .from("pipeline_colunas")
      .select("id")
      .eq("nome", "Financeiro")
      .single();

    if (financeiroColuna && contatoId) {
      await supabase
        .from("contatos")
        .update({ pipeline_coluna_id: financeiroColuna.id })
        .eq("id", contatoId);
    }

    // Log CRM event
    if (solicitacao) {
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "link_pagamento_gerado",
        descricao: `Link de pagamento R$ ${Number(dados.valor).toFixed(2)} gerado via bot. ${dados.descricao}`,
        referencia_tipo: "solicitacao",
        referencia_id: solicitacao.id,
        metadata: { payment_link_id: payResult.id },
      });
    }
  } catch (e) {
    console.error("Error creating financeiro solicitacao:", e);
  }
}
