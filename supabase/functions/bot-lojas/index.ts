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

    const { fluxo, etapa, dados } = sessao;

    // ─── Global navigation ───
    if (textoLower === "menu" || textoLower === "voltar" || textoLower === "0") {
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      resposta = buildMenu(nomeLoja);
    }
    // ─── Menu principal ───
    else if (fluxo === "menu_principal" && etapa === "inicio") {
      if (texto === "1") {
        updateSessao = { fluxo: "link_pagamento", etapa: "valor", dados: {} };
        resposta = "💳 *Gerar Link de Pagamento*\n\nQual o *valor* do link? (ex: 150.00)";
      } else if (texto === "2") {
        updateSessao = { fluxo: "gerar_boleto", etapa: "valor", dados: {} };
        resposta = "🧾 *Gerar Boleto*\n\nQual o *valor* do boleto? (ex: 250.00)";
      } else if (texto === "3") {
        updateSessao = { fluxo: "consulta_cpf", etapa: "cpf", dados: {} };
        resposta = "🔍 *Consultar CPF*\n\nDigite o *CPF* para consulta (somente números):";
      } else {
        resposta = buildMenu(nomeLoja);
      }
    }
    // ─── Link de Pagamento ───
    else if (fluxo === "link_pagamento") {
      const result = handleLinkPagamento(etapa, texto, dados as Record<string, unknown>);
      resposta = result.resposta;
      updateSessao = result.update;

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

              // Create solicitação in "Link Enviado" column
              await createFinanceiroSolicitacao(supabase, contato_id, {
                assunto: `Link de Pagamento - R$ ${Number(paymentData.valor).toFixed(2)}`,
                descricao: `${paymentData.descricao}${paymentData.cliente ? ` | Cliente: ${paymentData.cliente}` : ""} | Parcelas: ${paymentData.parcelas}x`,
                tipo: "link_pagamento",
                coluna_nome: "Link Enviado",
                metadata: { payment_link_id: payResult.id, url: payResult.url_pagamento, cod_empresa: codEmpresa },
                evento_descricao: `Link de pagamento R$ ${Number(paymentData.valor).toFixed(2)} gerado via bot. ${paymentData.descricao}`,
                evento_tipo: "link_pagamento_gerado",
              });
            }
          } catch (e) {
            console.error("Payment link error:", e);
            resposta = `❌ Erro na comunicação com o sistema de pagamento. Tente novamente.\n\nDigite *menu* para voltar.`;
            updateSessao = { status: "concluido" };
          }
        }
      }
    }
    // ─── Gerar Boleto ───
    else if (fluxo === "gerar_boleto") {
      const result = handleGerarBoleto(etapa, texto, dados as Record<string, unknown>);
      resposta = result.resposta;
      updateSessao = result.update;

      if (etapa === "confirmar" && (textoLower === "sim" || textoLower === "s")) {
        const boletoData = dados as Record<string, unknown>;
        resposta = `✅ *Solicitação de boleto registrada!*\n\n💰 Valor: R$ ${Number(boletoData.valor).toFixed(2)}\n👤 Cliente: ${boletoData.cliente}\n📄 CPF/CNPJ: ${boletoData.documento}\n📝 ${boletoData.descricao}\n\nO setor financeiro irá processar e enviar o boleto.\n\nDigite *menu* para nova operação.`;
        updateSessao = { status: "concluido" };

        await createFinanceiroSolicitacao(supabase, contato_id, {
          assunto: `Solicitação de Boleto - R$ ${Number(boletoData.valor).toFixed(2)}`,
          descricao: `Cliente: ${boletoData.cliente} | Doc: ${boletoData.documento} | ${boletoData.descricao}`,
          tipo: "boleto",
          coluna_nome: "Solicitação de Boleto",
          metadata: { cliente: boletoData.cliente, documento: boletoData.documento, cod_empresa: codEmpresa },
          evento_descricao: `Solicitação de boleto R$ ${Number(boletoData.valor).toFixed(2)} via bot. Cliente: ${boletoData.cliente}`,
          evento_tipo: "boleto_solicitado",
        });
      }
    }
    // ─── Consulta CPF ───
    else if (fluxo === "consulta_cpf") {
      const result = handleConsultaCPF(etapa, texto, dados as Record<string, unknown>);
      resposta = result.resposta;
      updateSessao = result.update;

      if (etapa === "confirmar" && (textoLower === "sim" || textoLower === "s")) {
        const cpfData = dados as Record<string, unknown>;
        resposta = `✅ *Consulta de CPF registrada!*\n\n📄 CPF: ${cpfData.cpf}\n👤 Nome: ${cpfData.nome_cliente}\n📝 Motivo: ${cpfData.motivo}\n\nO setor financeiro irá processar a consulta.\n\nDigite *menu* para nova operação.`;
        updateSessao = { status: "concluido" };

        await createFinanceiroSolicitacao(supabase, contato_id, {
          assunto: `Consulta CPF - ${cpfData.cpf}`,
          descricao: `Nome: ${cpfData.nome_cliente} | Motivo: ${cpfData.motivo}`,
          tipo: "consulta_cpf",
          coluna_nome: "Consulta CPF",
          metadata: { cpf: cpfData.cpf, nome_cliente: cpfData.nome_cliente, cod_empresa: codEmpresa },
          evento_descricao: `Consulta de CPF ${cpfData.cpf} solicitada via bot. Nome: ${cpfData.nome_cliente}`,
          evento_tipo: "consulta_cpf_solicitada",
        });
      }
    }
    // ─── Fallback ───
    else {
      resposta = buildMenu(nomeLoja);
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
    }

    // 2. Update session
    if (Object.keys(updateSessao).length > 0) {
      await supabase.from("bot_sessoes").update(updateSessao).eq("id", sessao.id);
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

// ─── Menu ───

function buildMenu(nomeLoja: string): string {
  return `Olá *${nomeLoja}*! 👋\n\nEscolha uma opção:\n\n1️⃣ Gerar Link de Pagamento\n2️⃣ Gerar Boleto\n3️⃣ Consultar CPF\n\n_Digite o número da opção desejada._`;
}

// ─── Link de Pagamento Flow ───

function handleLinkPagamento(
  etapa: string, texto: string, dados: Record<string, unknown>
): { resposta: string; update: Record<string, unknown> } {
  switch (etapa) {
    case "valor": {
      const valor = parseFloat(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (isNaN(valor) || valor <= 0) return { resposta: "⚠️ Valor inválido. Digite um número válido (ex: 150.00)", update: {} };
      return { resposta: "📝 Descreva o pagamento (ex: Lente Transition CR39)", update: { etapa: "descricao", dados: { ...dados, valor } } };
    }
    case "descricao": {
      if (!texto || texto.length < 3) return { resposta: "⚠️ Descrição muito curta. Descreva o pagamento com mais detalhes.", update: {} };
      return { resposta: "💳 Máximo de parcelas? (1-12)", update: { etapa: "parcelas", dados: { ...dados, descricao: texto } } };
    }
    case "parcelas": {
      const parcelas = parseInt(texto);
      if (isNaN(parcelas) || parcelas < 1 || parcelas > 12) return { resposta: "⚠️ Digite um número entre 1 e 12.", update: {} };
      return { resposta: "👤 Nome do cliente (ou digite *pular*)", update: { etapa: "cliente", dados: { ...dados, parcelas } } };
    }
    case "cliente": {
      const cliente = texto.toLowerCase() === "pular" ? null : texto;
      const d = { ...dados, cliente };
      return {
        resposta: `📋 *Confirme os dados:*\n\n💰 Valor: R$ ${Number(d.valor).toFixed(2)}\n📝 Descrição: ${d.descricao}\n💳 Parcelas: até ${d.parcelas}x${cliente ? `\n👤 Cliente: ${cliente}` : ""}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`,
        update: { etapa: "confirmar", dados: d },
      };
    }
    case "confirmar": {
      if (["nao", "não", "n"].includes(texto.toLowerCase())) {
        return { resposta: "❌ Operação cancelada.\n\nDigite *menu* para voltar ao início.", update: { status: "concluido" } };
      }
      return { resposta: "⏳ Gerando link de pagamento...", update: {} };
    }
    default:
      return { resposta: "⚠️ Etapa não reconhecida. Digite *menu* para recomeçar.", update: { fluxo: "menu_principal", etapa: "inicio", dados: {} } };
  }
}

// ─── Gerar Boleto Flow ───

function handleGerarBoleto(
  etapa: string, texto: string, dados: Record<string, unknown>
): { resposta: string; update: Record<string, unknown> } {
  switch (etapa) {
    case "valor": {
      const valor = parseFloat(texto.replace(",", ".").replace(/[^\d.]/g, ""));
      if (isNaN(valor) || valor <= 0) return { resposta: "⚠️ Valor inválido. Digite um número válido (ex: 250.00)", update: {} };
      return { resposta: "👤 Nome completo do cliente:", update: { etapa: "cliente", dados: { ...dados, valor } } };
    }
    case "cliente": {
      if (!texto || texto.length < 3) return { resposta: "⚠️ Nome muito curto. Digite o nome completo do cliente.", update: {} };
      return { resposta: "📄 CPF ou CNPJ do cliente (somente números):", update: { etapa: "documento", dados: { ...dados, cliente: texto } } };
    }
    case "documento": {
      const doc = texto.replace(/\D/g, "");
      if (doc.length !== 11 && doc.length !== 14) return { resposta: "⚠️ CPF deve ter 11 dígitos ou CNPJ 14 dígitos. Digite novamente:", update: {} };
      return { resposta: "📝 Descrição do boleto (ex: Armação Ray-Ban + Lentes):", update: { etapa: "descricao", dados: { ...dados, documento: doc } } };
    }
    case "descricao": {
      if (!texto || texto.length < 3) return { resposta: "⚠️ Descrição muito curta.", update: {} };
      const d = { ...dados, descricao: texto };
      return {
        resposta: `📋 *Confirme os dados do boleto:*\n\n💰 Valor: R$ ${Number(d.valor).toFixed(2)}\n👤 Cliente: ${d.cliente}\n📄 Doc: ${d.documento}\n📝 ${d.descricao}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`,
        update: { etapa: "confirmar", dados: d },
      };
    }
    case "confirmar": {
      if (["nao", "não", "n"].includes(texto.toLowerCase())) {
        return { resposta: "❌ Operação cancelada.\n\nDigite *menu* para voltar ao início.", update: { status: "concluido" } };
      }
      return { resposta: "⏳ Registrando solicitação de boleto...", update: {} };
    }
    default:
      return { resposta: "⚠️ Etapa não reconhecida. Digite *menu* para recomeçar.", update: { fluxo: "menu_principal", etapa: "inicio", dados: {} } };
  }
}

// ─── Consulta CPF Flow ───

function handleConsultaCPF(
  etapa: string, texto: string, dados: Record<string, unknown>
): { resposta: string; update: Record<string, unknown> } {
  switch (etapa) {
    case "cpf": {
      const cpf = texto.replace(/\D/g, "");
      if (cpf.length !== 11) return { resposta: "⚠️ CPF inválido. Digite os 11 dígitos:", update: {} };
      return { resposta: "👤 Nome do cliente:", update: { etapa: "nome_cliente", dados: { ...dados, cpf } } };
    }
    case "nome_cliente": {
      if (!texto || texto.length < 3) return { resposta: "⚠️ Nome muito curto. Digite o nome do cliente.", update: {} };
      return { resposta: "📝 Motivo da consulta (ex: Venda a prazo, Crediário):", update: { etapa: "motivo", dados: { ...dados, nome_cliente: texto } } };
    }
    case "motivo": {
      if (!texto || texto.length < 3) return { resposta: "⚠️ Motivo muito curto.", update: {} };
      const d = { ...dados, motivo: texto };
      return {
        resposta: `📋 *Confirme a consulta:*\n\n📄 CPF: ${d.cpf}\n👤 Nome: ${d.nome_cliente}\n📝 Motivo: ${d.motivo}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`,
        update: { etapa: "confirmar", dados: d },
      };
    }
    case "confirmar": {
      if (["nao", "não", "n"].includes(texto.toLowerCase())) {
        return { resposta: "❌ Operação cancelada.\n\nDigite *menu* para voltar ao início.", update: { status: "concluido" } };
      }
      return { resposta: "⏳ Registrando consulta de CPF...", update: {} };
    }
    default:
      return { resposta: "⚠️ Etapa não reconhecida. Digite *menu* para recomeçar.", update: { fluxo: "menu_principal", etapa: "inicio", dados: {} } };
  }
}

// ─── Unified solicitação creator ───

interface SolicitacaoParams {
  assunto: string;
  descricao: string;
  tipo: string;
  coluna_nome: string;
  metadata: Record<string, unknown>;
  evento_descricao: string;
  evento_tipo: string;
}

async function createFinanceiroSolicitacao(
  supabase: any,
  contatoId: string,
  params: SolicitacaoParams
) {
  try {
    const { data: financeiroSetor } = await supabase
      .from("setores")
      .select("id")
      .eq("nome", "Financeiro")
      .single();

    let colunaId: string | null = null;
    if (financeiroSetor) {
      const { data: coluna } = await supabase
        .from("pipeline_colunas")
        .select("id")
        .eq("setor_id", financeiroSetor.id)
        .eq("nome", params.coluna_nome)
        .eq("ativo", true)
        .single();
      colunaId = coluna?.id || null;
    }

    const { data: solicitacao } = await supabase
      .from("solicitacoes")
      .insert({
        contato_id: contatoId,
        assunto: params.assunto,
        descricao: params.descricao,
        canal_origem: "whatsapp",
        status: "em_atendimento",
        tipo: params.tipo,
        metadata: params.metadata,
        ...(colunaId ? { pipeline_coluna_id: colunaId } : {}),
      })
      .select()
      .single();

    if (solicitacao) {
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: params.evento_tipo,
        descricao: params.evento_descricao,
        referencia_tipo: "solicitacao",
        referencia_id: solicitacao.id,
        metadata: params.metadata,
      });
    }
  } catch (e) {
    console.error("Error creating financeiro solicitacao:", e);
  }
}
