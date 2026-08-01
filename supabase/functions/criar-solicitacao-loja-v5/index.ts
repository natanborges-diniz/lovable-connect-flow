// Fluxo A — Loja → Setor (gera card no pipeline do setor destino)
// Chamado pelo app InFoco Messenger (JWT da loja). Substitui a lógica antes
// dormente em `bot-lojas`. Sem WhatsApp: canal único corporativo é o app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnexoIn {
  url: string;
  mime_type?: string;
  nome?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OB_URL = Deno.env.get("OPTICAL_BUSINESS_URL");
    const OB_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

    const supabase = createClient(SUPABASE_URL, SERVICE);

    // ── Auth ──
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const fluxoChave: string = body.fluxo_chave;
    const dados: Record<string, unknown> = body.dados || {};
    const anexos: AnexoIn[] = Array.isArray(body.anexos) ? body.anexos : [];
    const lojaSelecionada: { nome_loja?: string; cod_empresa?: string } = body.loja || {};

    if (!fluxoChave) {
      return new Response(JSON.stringify({ error: "fluxo_chave é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Profile + role da loja ──
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, nome, tipo_usuario")
      .eq("id", user.id)
      .single();
    if (!profile || !["loja", "colaborador", "admin"].includes(profile.tipo_usuario)) {
      return new Response(JSON.stringify({ error: "Apenas usuários loja/colaborador podem abrir solicitações" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("loja_nome")
      .eq("user_id", user.id)
      .not("loja_nome", "is", null)
      .limit(1)
      .single();

    const nomeLoja = lojaSelecionada.nome_loja || roleRow?.loja_nome || "";
    if (!nomeLoja) {
      return new Response(JSON.stringify({ error: "Loja não identificada para o usuário" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve cod_empresa via telefones_lojas
    let codEmpresa = lojaSelecionada.cod_empresa || "";
    if (!codEmpresa) {
      const { data: tel } = await supabase
        .from("telefones_lojas")
        .select("cod_empresa")
        .ilike("nome_loja", `%${nomeLoja}%`)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      codEmpresa = tel?.cod_empresa || "";
    }

    // ── Resolve / cria contato âncora da loja (PK = telefone) ──
    // Usamos um telefone sintético "loja:<nome>" para não conflitar com clientes finais.
    const telSintetico = `loja:${nomeLoja}`.toLowerCase().replace(/\s+/g, "_");
    const { data: contatoExistente } = await supabase
      .from("contatos")
      .select("id")
      .eq("telefone", telSintetico)
      .maybeSingle();
    let contatoId = contatoExistente?.id;
    if (!contatoId) {
      const { data: novo, error: cErr } = await supabase
        .from("contatos")
        .insert({
          nome: nomeLoja,
          telefone: telSintetico,
          tipo: "loja",
          metadata: { loja_nome: nomeLoja, cod_empresa: codEmpresa, origem: "criar-solicitacao-loja" },
        })
        .select("id")
        .single();
      if (cErr) throw cErr;
      contatoId = novo.id;
    }

    // ── Carrega fluxo ──
    const { data: fluxo } = await supabase
      .from("bot_fluxos")
      .select("*")
      .eq("chave", fluxoChave)
      .eq("ativo", true)
      .maybeSingle();
    if (!fluxo) {
      return new Response(JSON.stringify({ error: `Fluxo "${fluxoChave}" não encontrado/ativo` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acao = (fluxo as any).acao_final || {};
    const tipoSolicitacao: string = acao.tipo_solicitacao || fluxoChave;
    // Roteamento Pix imune a configuração: se o tipo é pix_pagamento, vai pro
    // caminho Pix independentemente do acao_final.endpoint gravado no fluxo.
    const isPixFluxo = tipoSolicitacao === "pix_pagamento" || fluxoChave === "pix_pagamento" || acao.endpoint === "pix-charges";

    // ── Gate "Gerar Boleto" exige Consulta de CPF aprovada ──
    let consultaCpfOrigem: any = null;
    if (fluxoChave === "gerar_boleto") {
      const consultaId = (dados as any).consulta_cpf_id as string | undefined;
      if (!consultaId) {
        return new Response(JSON.stringify({
          error: "Selecione uma Consulta de CPF aprovada para gerar o boleto.",
          code: "CONSULTA_CPF_OBRIGATORIA",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: consulta } = await supabase
        .from("solicitacoes")
        .select("id, tipo, metadata, created_at")
        .eq("id", consultaId)
        .maybeSingle();
      if (!consulta || consulta.tipo !== "consulta_cpf") {
        return new Response(JSON.stringify({ error: "Consulta de CPF não encontrada.", code: "CONSULTA_NAO_ENCONTRADA" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const meta = (consulta.metadata || {}) as Record<string, any>;
      if (meta.resultado_consulta !== "aprovado") {
        return new Response(JSON.stringify({ error: "A Consulta de CPF não está aprovada.", code: "CONSULTA_NAO_APROVADA" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (meta.boleto_solicitacao_id) {
        return new Response(JSON.stringify({ error: "Esta consulta já gerou um boleto.", code: "CONSULTA_JA_USADA" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const lojaConsulta = String(meta.loja_nome || meta.alias_loja || "").trim().toLowerCase();
      if (lojaConsulta && lojaConsulta !== nomeLoja.trim().toLowerCase()) {
        return new Response(JSON.stringify({ error: "A consulta pertence a outra loja.", code: "LOJA_DIVERGENTE" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const idadeDias = (Date.now() - new Date(consulta.created_at).getTime()) / 86400000;
      if (idadeDias > 30) {
        return new Response(JSON.stringify({ error: "Consulta expirada (mais de 30 dias).", code: "CONSULTA_EXPIRADA" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      consultaCpfOrigem = consulta;
      // Herda dados da consulta — sobrescreve qualquer input do cliente
      (dados as any).cpf = meta.cpf ?? (dados as any).cpf;
      (dados as any).cliente = meta.nome_cliente ?? meta.cliente ?? (dados as any).cliente;
      (dados as any).valor = meta.valor_aprovado ?? meta.valor ?? (dados as any).valor;
      (dados as any).consulta_cpf_id = consultaId;

      // Validação dos detalhes do boleto enviados pela loja
      const qtdParcelas = Number((dados as any).qtd_parcelas);
      const diaVencimento = Number((dados as any).dia_vencimento);
      const valorParcela = Number((dados as any).valor_parcela);
      if (!Number.isInteger(qtdParcelas) || qtdParcelas < 1 || qtdParcelas > 24) {
        return new Response(JSON.stringify({ error: "qtd_parcelas inválida (1-24).", code: "PARCELAS_INVALIDAS" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) {
        return new Response(JSON.stringify({ error: "dia_vencimento inválido (1-28).", code: "DIA_VENC_INVALIDO" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Number.isFinite(valorParcela) || valorParcela <= 0) {
        return new Response(JSON.stringify({ error: "valor_parcela inválido.", code: "VALOR_PARCELA_INVALIDO" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Projeção: gera datas e valores das parcelas (1ª = próximo dia X >= hoje)
      const hoje = new Date();
      const projecao: Array<{ n: number; vencimento: string; valor: number }> = [];
      const baseY = hoje.getFullYear(); const baseM = hoje.getMonth();
      let startM = baseM, startY = baseY;
      // próximo dia diaVencimento >= hoje (se já passou, vai para mês seguinte)
      if (hoje.getDate() > diaVencimento) {
        startM = baseM + 1;
        if (startM > 11) { startM = 0; startY = baseY + 1; }
      }
      for (let i = 0; i < qtdParcelas; i++) {
        const m = startM + i;
        const y = startY + Math.floor(m / 12);
        const mm = ((m % 12) + 12) % 12;
        const venc = new Date(Date.UTC(y, mm, diaVencimento));
        projecao.push({
          n: i + 1,
          vencimento: venc.toISOString().slice(0, 10),
          valor: Number(valorParcela.toFixed(2)),
        });
      }
      (dados as any).boleto_parcelas_projecao = projecao;
      (dados as any).boleto_impresso = Boolean((dados as any).boleto_impresso);
      (dados as any).boleto_valor_total = Number((valorParcela * qtdParcelas).toFixed(2));
    }


    // ── Caso especial: link_pagamento via Optical Business ──
    let extraMetadata: Record<string, unknown> = {};
    let respostaCliente: {
      url?: string; payment_link_id?: string;
      cliente_envio_status?: string; cliente_envio_erro?: string | null;
      txid?: string; pix_copia_cola?: string; qr_code_base64?: string; expira_em?: string;
    } = {};
    let contatoClienteId: string | null = null;
    if (acao.endpoint === "payment-links" && !isPixFluxo) {
      if (!OB_URL || !OB_SECRET) {
        return new Response(JSON.stringify({ error: "Integração de pagamento não configurada" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!codEmpresa) {
        return new Response(JSON.stringify({ error: `Loja "${nomeLoja}" sem cod_empresa cadastrado` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let obRes: Response;
      try {
        obRes = await fetch(`${OB_URL}/functions/v1/payment-links`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-service-key": OB_SECRET },
          body: JSON.stringify({
            action: "criar",
            cod_empresa: codEmpresa,
            valor: dados.valor,
            descricao: dados.descricao,
            parcelas_max: dados.parcelas || 1,
            parcelas_fixas: dados.parcelas || 1,
            cliente_nome: dados.cliente || null,
            origem: "ATRIUM_INFOCO",
            origem_ref: user.id,
          }),
        });
      } catch (netErr) {
        console.error("[criar-solicitacao-loja] OB fetch network error:", netErr);
        return new Response(JSON.stringify({
          ok: false,
          error: `Falha de rede ao contatar OB: ${netErr instanceof Error ? netErr.message : String(netErr)}`,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const obContentType = obRes.headers.get("content-type") || "";
      const obRawText = await obRes.text();
      console.log(`[criar-solicitacao-loja] OB response status=${obRes.status} ct=${obContentType} body=${obRawText.slice(0, 300)}`);

      let obData: any = null;
      if (obContentType.includes("application/json")) {
        try { obData = JSON.parse(obRawText); } catch (e) {
          return new Response(JSON.stringify({
            ok: false,
            error: `OB retornou JSON inválido (status ${obRes.status}): ${obRawText.slice(0, 200)}`,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } else {
        return new Response(JSON.stringify({
          ok: false,
          error: `OB retornou ${obRes.status} (${obContentType || "sem content-type"}): ${obRawText.slice(0, 200)}`,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!obRes.ok || obData?.error) {
        return new Response(JSON.stringify({
          ok: false,
          error: `OB (${obRes.status}): ${obData?.error || obData?.message || "erro desconhecido"}`,
          ob_status: obRes.status,
          ob_payload: obData,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      respostaCliente = { url: obData.url_pagamento, payment_link_id: obData.id };
      extraMetadata = { payment_link_id: obData.id, url: obData.url_pagamento };

      // ── Envio do link ao cliente final via WhatsApp template ──
      const rawTel = String(dados.cliente_whatsapp || "").replace(/\D/g, "");
      const nomeClienteRaw = String(dados.cliente || "").trim();
      let envioClienteStatus: "enviado" | "falhou" | "pulado" = "pulado";
      let envioClienteErro: string | null = null;

      if (rawTel.length >= 10 && nomeClienteRaw) {
        // Normaliza para padrão internacional BR (55 + DDD + número)
        const telNormalizado = rawTel.startsWith("55") ? rawTel : `55${rawTel}`;
        const primeiroNome = nomeClienteRaw.split(/\s+/)[0] || nomeClienteRaw;

        try {
          // Upsert contato (PK telefone)
          const { data: contatoExist } = await supabase
            .from("contatos")
            .select("id, nome")
            .eq("telefone", telNormalizado)
            .maybeSingle();

          contatoClienteId = contatoExist?.id ?? null;
          if (!contatoClienteId) {
            const { data: novoCont, error: ncErr } = await supabase
              .from("contatos")
              .insert({
                nome: nomeClienteRaw,
                telefone: telNormalizado,
                tipo: "cliente",
                metadata: {
                  origem: "link_pagamento_loja",
                  loja_origem: nomeLoja,
                  payment_link_id: obData.id,
                },
              })
              .select("id")
              .single();
            if (ncErr) throw ncErr;
            contatoClienteId = novoCont.id;
          } else if (!contatoExist?.nome || contatoExist.nome.trim().length < 2) {
            await supabase
              .from("contatos")
              .update({ nome: nomeClienteRaw })
              .eq("id", contatoClienteId);
          }

          // Formata valor
          const valorNum = Number(String(dados.valor).replace(",", "."));
          const valorFmt = Number.isFinite(valorNum)
            ? valorNum.toFixed(2).replace(".", ",")
            : String(dados.valor);

          // Protocolo curto: últimos 8 chars do payment_link_id (UTILITY v3 exige protocolo)
          const protocolo = String(obData.id || "").slice(-8).toUpperCase() || "PAGTO";

          // Dispara template via send-whatsapp-template usando alias (resolve para versão UTILITY aprovada)
          const tplRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE}`,
            },
            body: JSON.stringify({
              contato_id: contatoClienteId,
              template_alias: "link_pagamento_cliente",
              template_params: [
                protocolo,           // {{1}} protocolo
                valorFmt,            // {{2}} valor
                obData.url_pagamento, // {{3}} link
              ],
              language: "pt_BR",
            }),
          });
          const tplJson = await tplRes.json().catch(() => ({}));
          if (!tplRes.ok || tplJson?.status === "blocked_template_not_approved") {
            envioClienteStatus = "falhou";
            envioClienteErro = tplJson?.template_status
              ? `template_${tplJson.template_status}`
              : tplJson?.error || `http_${tplRes.status}`;
          } else if (tplJson?.status === "sent") {
            envioClienteStatus = "enviado";
          } else {
            envioClienteStatus = "falhou";
            envioClienteErro = tplJson?.error || "resposta_inesperada";
          }

          await supabase.from("eventos_crm").insert({
            contato_id: contatoClienteId,
            tipo:
              envioClienteStatus === "enviado"
                ? "link_pagamento_enviado_cliente"
                : "link_pagamento_envio_falhou",
            descricao:
              envioClienteStatus === "enviado"
                ? `Link de pagamento enviado para ${primeiroNome} (${nomeLoja})`
                : `Falha ao enviar link de pagamento: ${envioClienteErro}`,
            metadata: {
              payment_link_id: obData.id,
              loja_nome: nomeLoja,
              telefone_mascarado: telNormalizado.slice(0, 4) + "****" + telNormalizado.slice(-2),
              erro: envioClienteErro,
            },
          });
        } catch (e) {
          console.error("[criar-solicitacao-loja] envio cliente falhou", e);
          envioClienteStatus = "falhou";
          envioClienteErro = e instanceof Error ? e.message : "erro_desconhecido";
        }
      }

      respostaCliente = {
        ...respostaCliente,
        cliente_envio_status: envioClienteStatus,
        cliente_envio_erro: envioClienteErro,
      } as typeof respostaCliente & { cliente_envio_status?: string; cliente_envio_erro?: string | null };
      extraMetadata = {
        ...extraMetadata,
        cliente_whatsapp: rawTel,
        cliente_envio_status: envioClienteStatus,
      };
    }

    // ── Caso especial: pix_pagamento (cob dinâmica BTG) via Optical Business ──
    // Mesmo padrão do cartão: OB fala com o BTG, gera QR Code + copia-e-cola,
    // e a confirmação volta automaticamente pelo payment-webhook.
    if (isPixFluxo) {
      if (!OB_URL || !OB_SECRET) {
        return new Response(JSON.stringify({ error: "Integração de pagamento não configurada" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!codEmpresa) {
        return new Response(JSON.stringify({ error: `Loja "${nomeLoja}" sem cod_empresa cadastrado` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // ── Pix DIRETO no BTG (sem edge functions do OB) ──
      // Lê conta/token/ambiente no banco do OB via REST (INTERNAL_SERVICE_SECRET
      // como apikey — mesmo padrão histórico do bot-lojas) e cria a cobrança
      // instant-collections no BTG. Persiste em payment_links do OB via REST.
      const obHeaders: Record<string, string> = { apikey: OB_SECRET, Authorization: `Bearer ${OB_SECRET}` };
      const obGet = async (path: string) => {
        const r = await fetch(`${OB_URL}/rest/v1/${path}`, { headers: obHeaders });
        const t = await r.text();
        if (!r.ok) throw new Error(`OB REST ${path.split("?")[0]} -> ${r.status}: ${t.slice(0, 160)}`);
        return JSON.parse(t);
      };

      let obData: any = null;
      try {
        const codNum = Number(codEmpresa);
        const contas = await obGet(`btg_contas_bancarias?cod_empresa=eq.${codNum}&ativa=eq.true&select=cnpj,chave_pix&limit=1`);
        const conta = contas?.[0];
        if (!conta?.cnpj) throw new Error(`Empresa ${codNum} sem conta BTG ativa no OB`);
        if (!conta?.chave_pix) throw new Error(`Empresa ${codNum} sem chave_pix cadastrada (tela BTG Validação)`);
        const cnpj = String(conta.cnpj).replace(/\D/g, "");

        const toks = await obGet(`btg_tokens?cod_empresa=eq.${codNum}&select=access_token,expires_at&limit=1`);
        const tokRow = toks?.[0];
        if (!tokRow?.access_token) throw new Error(`Empresa ${codNum} não autenticada no BTG`);
        if (new Date(tokRow.expires_at) < new Date()) throw new Error(`Token BTG expirado para empresa ${codNum}`);

        const cfgs = await obGet(`fornecedor_configuracao?fornecedor=eq.btg&ativo=eq.true&select=ambiente&limit=1`);
        const isSandbox = cfgs?.[0]?.ambiente !== "production";
        const apiBase = isSandbox ? "https://api.sandbox.empresas.btgpactual.com" : "https://api.empresas.btgpactual.com";

        const valorNum = Number(String(dados.valor).replace(",", "."));
        let txid = ""; let emv = ""; let btgId = ""; let qrImageUrl: string | null = null;

        if (isSandbox) {
          btgId = `sandbox-pix-${Date.now()}`;
          txid = btgId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 35);
          emv = `00020126580014br.gov.bcb.pix0136sandbox-${crypto.randomUUID()}5204000053039865406${valorNum.toFixed(2)}5802BR5913OTICAS DINIZ6009SAO PAULO62070503***6304ABCD`;
        } else {
          const btgPayload = {
            pixKey: conta.chave_pix,
            expiresIn: 86400,
            amount: { value: Number(valorNum.toFixed(2)), allowCustomerChangeValue: false },
            displayText: String(dados.descricao || "Óticas Diniz").slice(0, 140),
            tags: { origem: "ATRIUM_INFOCO", origem_ref: user.id },
          };
          console.log("[pix-direto] BTG payload:", JSON.stringify(btgPayload).slice(0, 400));
          const btgRes = await fetch(`${apiBase}/v1/companies/${cnpj}/pix-cash-in/instant-collections`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokRow.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify(btgPayload),
          });
          const btgText = await btgRes.text();
          console.log(`[pix-direto] BTG response ${btgRes.status}: ${btgText.slice(0, 400)}`);
          let braw: any = {}; try { braw = JSON.parse(btgText); } catch (_e) { /* non-JSON */ }
          const d = (braw?.data ?? braw) as Record<string, any>;
          if (!btgRes.ok) throw new Error(`BTG rejeitou a cobrança (${btgRes.status}): ${btgText.slice(0, 200)}`);
          btgId = String(d.instantCollectionId ?? d.collectionId ?? d.id ?? "");
          txid = String(d.txId ?? d.txid ?? d.transactionId ?? btgId);
          emv = String(d.emv ?? d.qrCode ?? d.pixCopiaECola ?? d.brcode ?? "");
          qrImageUrl = d.location?.url ? String(d.location.url) : null;
          if (!emv.startsWith("000201")) throw new Error(`BTG não retornou o copia-e-cola (emv). Resposta: ${btgText.slice(0, 200)}`);
        }

        const expiraEm = new Date(Date.now() + 86400 * 1000).toISOString();
        const insRes = await fetch(`${OB_URL}/rest/v1/payment_links`, {
          method: "POST",
          headers: { ...obHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({
            cod_empresa: codNum,
            adquirente: "PIX_BTG",
            valor: valorNum,
            descricao: dados.descricao || "Óticas Diniz",
            parcelas_max: 1,
            expira_em: expiraEm,
            status: "ATIVO",
            qr_code_pix: emv,
            cliente_nome: dados.cliente || null,
            origem: "ATRIUM_INFOCO",
            origem_ref: user.id,
            dados_extras: { metodo: "pix", txid, btg_collection_id: btgId, qr_image_url: qrImageUrl, criado_por: "criar-solicitacao-loja-v5" },
          }),
        });
        const insText = await insRes.text();
        if (!insRes.ok) throw new Error(`OB REST insert payment_links -> ${insRes.status}: ${insText.slice(0, 160)}`);
        const inserted = JSON.parse(insText)?.[0];
        const linkId = inserted?.id;
        const payUrl = `https://lens-data-vision.lovable.app/pix/${linkId}`;
        await fetch(`${OB_URL}/rest/v1/payment_links?id=eq.${linkId}`, {
          method: "PATCH",
          headers: { ...obHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ url_pagamento: payUrl }),
        }).catch(() => undefined);

        let qrDataUrl: string | undefined;
        try {
          const { renderSVG } = await import("https://esm.sh/uqr@0.1.2");
          qrDataUrl = `data:image/svg+xml;base64,${btoa(renderSVG(emv, { border: 1 }))}`;
        } catch (_e) { qrDataUrl = undefined; }

        obData = { id: linkId, txid, pix_copia_cola: emv, qr_code_base64: qrDataUrl, url_pagamento: payUrl, expira_em: expiraEm };
      } catch (e) {
        console.error("[pix-direto] falhou:", e);
        return new Response(JSON.stringify({
          ok: false,
          error: `Pix: ${e instanceof Error ? e.message : String(e)}`,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      respostaCliente = {
        url: obData.url_pagamento || undefined,
        payment_link_id: obData.id,
        txid: obData.txid,
        pix_copia_cola: obData.pix_copia_cola,
        qr_code_base64: obData.qr_code_base64 || undefined, // só resposta ao app; não persiste
        expira_em: obData.expira_em || undefined,
      };
      extraMetadata = {
        payment_link_id: obData.id,
        metodo: "pix",
        txid: obData.txid,
        pix_copia_cola: obData.pix_copia_cola,
        url: obData.url_pagamento || null,
        expira_em: obData.expira_em || null,
      };

      // ── Envio da cobrança ao cliente final via WhatsApp template ──
      const rawTel = String(dados.cliente_whatsapp || "").replace(/\D/g, "");
      const nomeClienteRaw = String(dados.cliente || "").trim();
      let envioClienteStatus: "enviado" | "falhou" | "pulado" = "pulado";
      let envioClienteErro: string | null = null;

      if (rawTel.length >= 10 && nomeClienteRaw) {
        const telNormalizado = rawTel.startsWith("55") ? rawTel : `55${rawTel}`;
        const primeiroNome = nomeClienteRaw.split(/\s+/)[0] || nomeClienteRaw;

        try {
          const { data: contatoExist } = await supabase
            .from("contatos")
            .select("id, nome")
            .eq("telefone", telNormalizado)
            .maybeSingle();

          contatoClienteId = contatoExist?.id ?? null;
          if (!contatoClienteId) {
            const { data: novoCont, error: ncErr } = await supabase
              .from("contatos")
              .insert({
                nome: nomeClienteRaw,
                telefone: telNormalizado,
                tipo: "cliente",
                metadata: {
                  origem: "pix_pagamento_loja",
                  loja_origem: nomeLoja,
                  payment_link_id: obData.id,
                },
              })
              .select("id")
              .single();
            if (ncErr) throw ncErr;
            contatoClienteId = novoCont.id;
          } else if (!contatoExist?.nome || contatoExist.nome.trim().length < 2) {
            await supabase
              .from("contatos")
              .update({ nome: nomeClienteRaw })
              .eq("id", contatoClienteId);
          }

          const valorNum = Number(String(dados.valor).replace(",", "."));
          const valorFmt = Number.isFinite(valorNum)
            ? valorNum.toFixed(2).replace(".", ",")
            : String(dados.valor);

          const protocolo = String(obData.id || "").slice(-8).toUpperCase() || "PIX";

          const tplRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE}`,
            },
            body: JSON.stringify({
              contato_id: contatoClienteId,
              template_alias: "pix_pagamento_cliente",
              template_params: [
                protocolo,             // {{1}} protocolo
                valorFmt,              // {{2}} valor
                obData.pix_copia_cola, // {{3}} Pix copia-e-cola (pagamento direto no app do banco)
                obData.url_pagamento || obData.pix_copia_cola, // {{4}} página com QR + status
              ],
              language: "pt_BR",
            }),
          });
          const tplJson = await tplRes.json().catch(() => ({}));
          if (!tplRes.ok || tplJson?.status === "blocked_template_not_approved") {
            envioClienteStatus = "falhou";
            envioClienteErro = tplJson?.template_status
              ? `template_${tplJson.template_status}`
              : tplJson?.error || `http_${tplRes.status}`;
          } else if (tplJson?.status === "sent") {
            envioClienteStatus = "enviado";
          } else {
            envioClienteStatus = "falhou";
            envioClienteErro = tplJson?.error || "resposta_inesperada";
          }

          await supabase.from("eventos_crm").insert({
            contato_id: contatoClienteId,
            tipo:
              envioClienteStatus === "enviado"
                ? "pix_pagamento_enviado_cliente"
                : "pix_pagamento_envio_falhou",
            descricao:
              envioClienteStatus === "enviado"
                ? `Cobrança Pix enviada para ${primeiroNome} (${nomeLoja})`
                : `Falha ao enviar cobrança Pix: ${envioClienteErro}`,
            metadata: {
              payment_link_id: obData.id,
              txid: obData.txid,
              loja_nome: nomeLoja,
              telefone_mascarado: telNormalizado.slice(0, 4) + "****" + telNormalizado.slice(-2),
              erro: envioClienteErro,
            },
          });
        } catch (e) {
          console.error("[criar-solicitacao-loja] envio pix cliente falhou", e);
          envioClienteStatus = "falhou";
          envioClienteErro = e instanceof Error ? e.message : "erro_desconhecido";
        }
      }

      respostaCliente = {
        ...respostaCliente,
        cliente_envio_status: envioClienteStatus,
        cliente_envio_erro: envioClienteErro,
      };
      extraMetadata = {
        ...extraMetadata,
        cliente_whatsapp: rawTel,
        cliente_envio_status: envioClienteStatus,
      };
    }

    // ── Resolve coluna destino (primeira do setor do fluxo) ──
    let colunaId: string | null = null;
    if ((fluxo as any).setor_destino_id) {
      const { data: cols } = await supabase
        .from("pipeline_colunas")
        .select("id, nome, ordem")
        .eq("setor_id", (fluxo as any).setor_destino_id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      const destinoConfigurado = (acao.coluna_destino || "").toString().trim();
      if (destinoConfigurado) {
        const found = (cols || []).find((c: any) => c.nome === destinoConfigurado);
        if (!found) {
          return new Response(JSON.stringify({
            ok: false,
            error: `Coluna destino "${destinoConfigurado}" do fluxo "${fluxoChave}" não existe ou está inativa no setor.`,
            code: "COLUNA_DESTINO_INVALIDA",
          }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        colunaId = found.id;
      } else {
        colunaId = (cols && cols[0]?.id) || null;
      }
    }

    // ── Insere solicitação ──
    const assunto = `${(fluxo as any).nome} — ${nomeLoja}`;
    // Whitelist de chaves de controle interno (preservadas no metadata mas excluídas da descrição).
    const INTERNAL_KEYS = new Set([
      "comprovantes", "lojas_map", "loja_selecionada_nome", "loja_selecionada_cod",
    ]);
    const descricao = Object.entries(dados)
      .filter(([k, v]) => !INTERNAL_KEYS.has(k) && v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k, v]) => `${k.replace(/^_+/, "")}: ${v}`)
      .join(" | ");

    const { data: solicitacao, error: sErr } = await supabase
      .from("solicitacoes")
      .insert({
        contato_id: contatoId,
        assunto,
        descricao,
        canal_origem: "sistema",
        status: "em_atendimento",
        tipo: tipoSolicitacao,
        metadata: { ...dados, ...extraMetadata, loja_nome: nomeLoja, alias_loja: nomeLoja, cod_empresa: codEmpresa, origem_app: "infoco_messenger", _endpoint_runtime: acao.endpoint || null, _fluxo_chave_runtime: fluxoChave, _pix_route: isPixFluxo },
        ...(colunaId ? { pipeline_coluna_id: colunaId } : {}),
      })
      .select("id")
      .single();
    if (sErr) throw sErr;

    // ── Protocolo ──
    const ano = new Date().getFullYear();
    const { data: seqRes } = await supabase.rpc("nextval_protocolo", {});
    const seq = seqRes !== null && seqRes !== undefined ? Number(seqRes) : Date.now() % 100000;
    const protocolo = `SOL-${ano}-${String(seq).padStart(5, "0")}`;
    await supabase.from("solicitacoes").update({ protocolo }).eq("id", solicitacao.id);

    // ── Vínculo bidirecional Boleto ↔ Consulta CPF ──
    if (consultaCpfOrigem) {
      const metaOrigem = (consultaCpfOrigem.metadata || {}) as Record<string, any>;
      await supabase
        .from("solicitacoes")
        .update({
          metadata: {
            ...metaOrigem,
            boleto_solicitacao_id: solicitacao.id,
            boleto_protocolo: protocolo,
            boleto_gerado_at: new Date().toISOString(),
          },
        })
        .eq("id", consultaCpfOrigem.id);
    }

    // ── Anexos (resilientes: nunca grava caminho fantasma; cai pra URL original do Messenger) ──
    for (let i = 0; i < anexos.length; i++) {
      const a = anexos[i];
      const mime = a.mime_type || "application/octet-stream";
      const extMap: Record<string, string> = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "application/pdf": "pdf", "image/gif": "gif",
      };
      const ext = extMap[mime] || "bin";
      const path = `comprovantes/${ano}/${protocolo}/anexo_${i + 1}.${ext}`;

      let storagePath: string | null = null;
      let urlPublica: string = a.url;
      let tamanho: number | null = null;
      const uploadIssues: string[] = [];

      try {
        const r = await fetch(a.url);
        if (!r.ok) {
          uploadIssues.push(`fetch_${r.status}`);
          console.error(`[criar-solicitacao-loja] anexo ${i + 1}: fetch falhou (${r.status}) — mantendo URL original ${a.url}`);
        } else {
          const bytes = await r.arrayBuffer();
          tamanho = bytes.byteLength;
          const { error: upErr } = await supabase.storage
            .from("whatsapp-media")
            .upload(path, bytes, { contentType: mime, upsert: true });
          if (upErr) {
            uploadIssues.push(`upload_${upErr.message}`);
            console.error(`[criar-solicitacao-loja] anexo ${i + 1}: upload falhou — ${upErr.message}. Mantendo URL original.`);
          } else {
            storagePath = path;
            const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
            if (pub?.publicUrl) urlPublica = pub.publicUrl;
          }
        }
      } catch (e) {
        uploadIssues.push(`exception_${e instanceof Error ? e.message : String(e)}`);
        console.error(`[criar-solicitacao-loja] anexo ${i + 1}: exceção — ${e}`);
      }

      const { error: insErr } = await supabase.from("solicitacao_anexos").insert({
        solicitacao_id: solicitacao.id,
        tipo: "comprovante",
        descricao: a.nome || `Anexo ${i + 1}`,
        storage_path: storagePath,
        url_publica: urlPublica,
        mime_type: mime,
        tamanho_bytes: tamanho,
      });
      if (insErr) {
        console.error(`[criar-solicitacao-loja] anexo ${i + 1}: insert solicitacao_anexos falhou — ${insErr.message}`);
      } else if (uploadIssues.length) {
        console.log(`[criar-solicitacao-loja] anexo ${i + 1} registrado com fallback (issues=${uploadIssues.join(",")}, url=${urlPublica})`);
      }
    }


    // ── Evento CRM ──
    await supabase.from("eventos_crm").insert({
      contato_id: contatoId,
      tipo: `${tipoSolicitacao}_solicitado`,
      descricao: `${(fluxo as any).nome} solicitado por ${profile.nome} (${nomeLoja})`,
      referencia_tipo: "solicitacao",
      referencia_id: solicitacao.id,
      metadata: { protocolo, loja_nome: nomeLoja, alias_loja: nomeLoja, cod_empresa: codEmpresa },
    });

    // ── Espelha em pagamentos_link (rastreabilidade financeira) ──
    if (["link_pagamento", "pix_pagamento"].includes(tipoSolicitacao) && (extraMetadata as any).payment_link_id) {
      try {
        const phone = String((extraMetadata as any).cliente_whatsapp || "").replace(/\D/g, "");
        let contatoIdResolved: string | null = contatoClienteId || contatoId;
        if (!contatoIdResolved && phone) {
          const { data: c } = await supabase.from("contatos").select("id").eq("telefone", phone).maybeSingle();
          contatoIdResolved = c?.id || null;
        }
        const envioOk = (respostaCliente as any).cliente_envio_status === "enviado";
        await supabase.from("pagamentos_link").upsert({
          payment_link_id: (extraMetadata as any).payment_link_id,
          solicitacao_id: solicitacao.id,
          contato_id: contatoIdResolved,
          loja_nome: nomeLoja?.replace(/^DINIZ\s+/i, "Diniz "),
          alias_loja: nomeLoja,
          cod_empresa: codEmpresa,
          cliente_nome: (dados as any).cliente || null,
          cliente_telefone: phone || null,
          valor: (dados as any).valor ? Number(String((dados as any).valor).replace(/[^0-9.]/g, "")) : null,
          parcelas: (dados as any).parcelas ? Number((dados as any).parcelas) : null,
          parcelas_fixas: (dados as any).parcelas ? Number((dados as any).parcelas) : null,
          descricao: (dados as any).descricao || null,
          status: envioOk ? "enviado" : "criado",
          link_url: (extraMetadata as any).url || null,
          metodo: tipoSolicitacao === "pix_pagamento" ? "pix" : "cartao",
          pix_txid: (extraMetadata as any).txid || null,
          pix_copia_cola: (extraMetadata as any).pix_copia_cola || null,
          pix_expira_at: (extraMetadata as any).expira_em || null,
          enviado_at: envioOk ? new Date().toISOString() : null,
          metadata: { ...dados, ...extraMetadata, loja_nome: nomeLoja, alias_loja: nomeLoja, cod_empresa: codEmpresa, origem_app: "infoco_messenger" },
        }, { onConflict: "payment_link_id" });
      } catch (mErr) {
        console.error("[criar-solicitacao-loja] mirror pagamentos_link falhou", mErr);
      }
    }

    // ── Notificações in-app para o setor destino (canal único = app) ──
    // Pula notificações para link_pagamento/pix_pagamento: fluxo 100% automático (gerar → aguardando → pago).
    const setorId = (fluxo as any).setor_destino_id;
    if (setorId && !["link_pagamento", "pix_pagamento"].includes(tipoSolicitacao)) {
      const { data: prof } = await supabase
        .from("profiles").select("id").eq("setor_id", setorId).eq("ativo", true);
      const titulo = `Nova solicitação: ${(fluxo as any).nome}`;
      const mensagem = `🏪 ${nomeLoja} | 📋 ${protocolo}`;
      const notifs: any[] = [{
        setor_id: setorId, titulo, mensagem,
        tipo: "solicitacao", referencia_id: solicitacao.id,
      }];
      for (const p of (prof || [])) {
        notifs.push({
          usuario_id: p.id, setor_id: setorId,
          titulo, mensagem, tipo: "solicitacao",
          referencia_id: solicitacao.id,
        });
      }
      if (notifs.length) await supabase.from("notificacoes").insert(notifs);
    }

    return new Response(JSON.stringify({
      status: "ok",
      solicitacao_id: solicitacao.id,
      protocolo,
      tipo: tipoSolicitacao,
      ...respostaCliente,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("criar-solicitacao-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
