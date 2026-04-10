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

  // ─── Helper: resolve cod_empresa ───
  async function resolveCodEmpresa(nomeLoja: string): Promise<string | null> {
    try {
      const { data: localMatch } = await supabase
        .from("telefones_lojas")
        .select("cod_empresa")
        .ilike("nome_loja", `%${nomeLoja}%`)
        .eq("ativo", true)
        .limit(1);

      if (localMatch?.[0]?.cod_empresa) {
        console.log(`[bot-lojas] Resolved "${nomeLoja}" → cod_empresa: ${localMatch[0].cod_empresa} (local)`);
        return String(localMatch[0].cod_empresa);
      }

      if (OPTICAL_BUSINESS_URL) {
        const obUrl = OPTICAL_BUSINESS_URL.replace("/functions/v1", "").replace(/\/$/, "");
        const res = await fetch(
          `${obUrl}/rest/v1/empresa?nome_fantasia=ilike.*${encodeURIComponent(nomeLoja)}*&select=cod_empresa&limit=1`,
          { headers: { "apikey": INTERNAL_SERVICE_SECRET || "", "Authorization": `Bearer ${INTERNAL_SERVICE_SECRET || ""}` } }
        );
        const data = await res.json();
        if (Array.isArray(data) && data[0]?.cod_empresa) {
          console.log(`[bot-lojas] Resolved "${nomeLoja}" → cod_empresa: ${data[0].cod_empresa} (OB remote)`);
          return String(data[0].cod_empresa);
        }
      }
      console.warn(`[bot-lojas] Could not resolve "${nomeLoja}"`);
      return null;
    } catch (e) {
      console.error("[bot-lojas] resolveCodEmpresa error:", e);
      return null;
    }
  }

  // ─── Load flow definition from DB ───
  async function loadFluxo(chave: string): Promise<any | null> {
    const { data } = await supabase
      .from("bot_fluxos")
      .select("*")
      .eq("chave", chave)
      .eq("ativo", true)
      .single();
    return data;
  }

  // ─── Load menu options filtered by tipo_bot ───
  async function loadMenuOpcoes(tipoBot = "loja"): Promise<Array<{ chave: string; titulo: string; emoji: string; fluxo: string; ordem: number }>> {
    try {
      const { data } = await supabase
        .from("bot_menu_opcoes")
        .select("chave, titulo, emoji, fluxo, ordem")
        .eq("ativo", true)
        .eq("tipo_bot", tipoBot)
        .order("ordem");
      return data || [];
    } catch {
      return [
        { chave: "link_pagamento", titulo: "Gerar Link de Pagamento", emoji: "1️⃣", fluxo: "link_pagamento", ordem: 1 },
        { chave: "gerar_boleto", titulo: "Gerar Boleto", emoji: "2️⃣", fluxo: "gerar_boleto", ordem: 2 },
        { chave: "consulta_cpf", titulo: "Consultar CPF", emoji: "3️⃣", fluxo: "consulta_cpf", ordem: 3 },
        { chave: "confirmar_comparecimento", titulo: "Confirmar Comparecimento", emoji: "4️⃣", fluxo: "confirmar_comparecimento", ordem: 4 },
      ];
    }
  }

  // ─── Validate input by tipo_input ───
  function validateInput(texto: string, etapa: any, context?: { media_url?: string }): { valid: boolean; value: any; error?: string } {
    const hint = "\n\n_Digite *0* para voltar ao menu._";
    const tipo = etapa.tipo_input || "texto";
    const validacao = etapa.validacao || {};

    switch (tipo) {
      case "decimal": {
        const val = parseFloat(texto.replace(",", ".").replace(/[^\d.]/g, ""));
        if (isNaN(val)) return { valid: false, value: null, error: "⚠️ Valor inválido. Digite um número válido (ex: 150.00)" + hint };
        if (validacao.min !== undefined && val < validacao.min) return { valid: false, value: null, error: `⚠️ Valor mínimo: ${validacao.min}` + hint };
        if (validacao.max !== undefined && val > validacao.max) return { valid: false, value: null, error: `⚠️ Valor máximo: ${validacao.max}` + hint };
        return { valid: true, value: val };
      }
      case "inteiro": {
        const val = parseInt(texto);
        if (isNaN(val)) return { valid: false, value: null, error: "⚠️ Digite um número inteiro válido." + hint };
        if (validacao.min !== undefined && val < validacao.min) return { valid: false, value: null, error: `⚠️ Mínimo: ${validacao.min}` + hint };
        if (validacao.max !== undefined && val > validacao.max) return { valid: false, value: null, error: `⚠️ Máximo: ${validacao.max}` + hint };
        return { valid: true, value: val };
      }
      case "cpf": {
        const cpf = texto.replace(/\D/g, "");
        if (cpf.length !== 11) return { valid: false, value: null, error: "⚠️ CPF inválido. Digite os 11 dígitos:" + hint };
        return { valid: true, value: cpf };
      }
      case "documento": {
        const doc = texto.replace(/\D/g, "");
        if (doc.length !== 11 && doc.length !== 14) return { valid: false, value: null, error: "⚠️ CPF deve ter 11 dígitos ou CNPJ 14 dígitos." + hint };
        return { valid: true, value: doc };
      }
      case "imagem": {
        if (!context?.media_url) {
          return { valid: false, value: null, error: "⚠️ Por favor, envie uma *foto* ou *documento* (não texto)." + hint };
        }
        return { valid: true, value: context.media_url };
      }
      case "texto":
      default: {
        if (validacao.min_length && texto.length < validacao.min_length) {
          return { valid: false, value: null, error: `⚠️ Texto muito curto (mínimo ${validacao.min_length} caracteres).` + hint };
        }
        return { valid: true, value: texto };
      }
    }
  }

  // ─── Build confirmation message from collected data ───
  function buildConfirmacao(fluxo: any, dados: Record<string, any>): string {
    const etapas = fluxo.etapas as any[];
    let msg = "📋 *Confirme os dados:*\n\n";
    // Show selected store if present (for departamento/colaborador flows)
    if (dados.loja_selecionada_nome) {
      msg += `• Unidade: ${dados.loja_selecionada_nome}\n`;
    }
    for (const et of etapas) {
      if (et.tipo_input === "imagem") continue; // skip image fields from confirmation text
      const val = dados[et.campo];
      if (val === null || val === undefined) continue;
      const displayVal = et.tipo_input === "decimal" ? `R$ ${Number(val).toFixed(2)}` : val;
      msg += `• ${et.campo}: ${displayVal}\n`;
    }
    // Show comprovantes count
    if (dados.comprovantes && dados.comprovantes.length > 0) {
      msg += `• Comprovantes: ${dados.comprovantes.length} arquivo(s) anexado(s)\n`;
    }
    msg += "\nResponda *SIM* para confirmar ou *NÃO* para cancelar.";
    return msg;
  }

  // ─── Load active stores for selection ───
  async function loadLojasAtivas(): Promise<Array<{ nome_loja: string; cod_empresa: string }>> {
    const { data } = await supabase
      .from("telefones_lojas")
      .select("nome_loja, cod_empresa")
      .eq("tipo", "loja")
      .eq("ativo", true)
      .order("nome_loja");
    return (data || []).filter((l: any) => l.cod_empresa);
  }

  // ─── Load lojas + setores for selection ───
  async function loadLojasESetores(): Promise<Array<{ nome: string; tipo: string; cod_empresa?: string }>> {
    const { data: lojas } = await supabase
      .from("telefones_lojas")
      .select("nome_loja, cod_empresa")
      .eq("tipo", "loja")
      .eq("ativo", true)
      .order("nome_loja");
    const { data: setores } = await supabase
      .from("setores")
      .select("nome")
      .eq("ativo", true)
      .order("nome");
    const items: Array<{ nome: string; tipo: string; cod_empresa?: string }> = [];
    const uniqueLojas = new Map<string, string>();
    for (const l of (lojas || [])) {
      if (l.cod_empresa && !uniqueLojas.has(l.nome_loja)) {
        uniqueLojas.set(l.nome_loja, l.cod_empresa);
        items.push({ nome: l.nome_loja, tipo: "loja", cod_empresa: l.cod_empresa });
      }
    }
    for (const s of (setores || [])) {
      items.push({ nome: s.nome, tipo: "setor" });
    }
    return items;
  }

  // ─── Generate protocol number ───
  async function generateProtocolo(solicitacaoId: string): Promise<string> {
    const ano = new Date().getFullYear();
    const { data: seqResult } = await supabase.rpc("nextval_protocolo", {});
    // Fallback: if RPC doesn't exist, use a simple query
    let seq: number;
    if (seqResult !== null && seqResult !== undefined) {
      seq = Number(seqResult);
    } else {
      // Direct SQL via postgrest won't work, use timestamp-based fallback
      seq = Date.now() % 100000;
    }
    const protocolo = `SOL-${ano}-${String(seq).padStart(5, "0")}`;
    await supabase.from("solicitacoes").update({ protocolo }).eq("id", solicitacaoId);
    return protocolo;
  }

  // ─── Archive comprovantes to storage ───
  async function archiveComprovantes(
    solicitacaoId: string,
    protocolo: string,
    comprovantes: Array<{ url: string; mime_type?: string }>
  ) {
    const ano = new Date().getFullYear();
    for (let i = 0; i < comprovantes.length; i++) {
      const comp = comprovantes[i];
      try {
        // Download from original URL
        const res = await fetch(comp.url);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        const mime = comp.mime_type || "application/octet-stream";
        const extMap: Record<string, string> = {
          "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
          "application/pdf": "pdf", "image/gif": "gif",
        };
        const ext = extMap[mime] || "bin";
        const storagePath = `comprovantes/${ano}/${protocolo}/comprovante_${i + 1}.${ext}`;

        await supabase.storage.from("whatsapp-media").upload(storagePath, bytes, {
          contentType: mime,
          upsert: true,
        });

        const { data: publicUrl } = supabase.storage.from("whatsapp-media").getPublicUrl(storagePath);

        await supabase.from("solicitacao_anexos").insert({
          solicitacao_id: solicitacaoId,
          tipo: "comprovante",
          descricao: `Comprovante ${i + 1}`,
          storage_path: storagePath,
          url_publica: publicUrl?.publicUrl || comp.url,
          mime_type: mime,
          tamanho_bytes: bytes.byteLength,
        });
      } catch (e) {
        console.error(`[bot-lojas] Failed to archive comprovante ${i + 1}:`, e);
      }
    }
  }

  // ─── Execute final action ───
  async function executarAcaoFinal(
    fluxo: any, dados: Record<string, any>,
    contato_id: string, atendimento_id: string,
    nomeLoja: string, codEmpresa: string
  ): Promise<string> {
    const acao = fluxo.acao_final;
    const tipo = acao.tipo;

    // Override nomeLoja/codEmpresa if a store was selected (departamento/colaborador flows)
    const effectiveNomeLoja = dados.loja_selecionada_nome || nomeLoja;
    const effectiveCodEmpresa = dados.loja_selecionada_cod || codEmpresa;

    if (tipo === "criar_solicitacao") {
      let solicitacaoCriada: any = null;

      // For link_pagamento, call OB API first
      if (acao.endpoint === "payment-links") {
        if (!OPTICAL_BUSINESS_URL || !INTERNAL_SERVICE_SECRET) {
          return "⚠️ Integração de pagamento não configurada. Contate o administrador.";
        }
        const resolvedCod = effectiveCodEmpresa || await resolveCodEmpresa(effectiveNomeLoja);
        if (!resolvedCod) {
          return `⚠️ Não foi possível identificar a loja "${effectiveNomeLoja}" no sistema financeiro. Verifique o cadastro.\n\nDigite *menu* para voltar.`;
        }

        try {
          const payRes = await fetch(`${OPTICAL_BUSINESS_URL}/functions/v1/payment-links`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-service-key": INTERNAL_SERVICE_SECRET },
            body: JSON.stringify({
              action: "criar",
              cod_empresa: resolvedCod,
              valor: dados.valor,
              descricao: dados.descricao,
              parcelas_max: dados.parcelas || 1,
              cliente_nome: dados.cliente || null,
              origem: "CHATBOT",
              origem_ref: atendimento_id,
            }),
          });
          const payResult = await payRes.json();
          if (payResult.error) return `❌ Erro ao gerar link: ${payResult.error}\n\nDigite *menu* para voltar.`;

          const url = payResult.url_pagamento || "Link em processamento";
          dados.url = url;
          dados.payment_link_id = payResult.id;

          solicitacaoCriada = await createFinanceiroSolicitacao(supabase, contato_id, {
            assunto: `Link de Pagamento - R$ ${Number(dados.valor).toFixed(2)}`,
            descricao: `${dados.descricao}${dados.cliente ? ` | Cliente: ${dados.cliente}` : ""} | Parcelas: ${dados.parcelas}x`,
            tipo: acao.tipo_solicitacao,
            coluna_nome: acao.coluna_destino,
            metadata: { payment_link_id: payResult.id, url, alias_loja: effectiveNomeLoja, cod_empresa: resolvedCod },
            evento_descricao: `Link de pagamento R$ ${Number(dados.valor).toFixed(2)} gerado via bot. ${dados.descricao}`,
            evento_tipo: "link_pagamento_gerado",
          });
          if (solicitacaoCriada) {
            const protocolo = await generateProtocolo(solicitacaoCriada.id);
            dados._protocolo = protocolo;
            if (dados.comprovantes?.length) await archiveComprovantes(solicitacaoCriada.id, protocolo, dados.comprovantes);
          }
        } catch (e) {
          console.error("Payment link error:", e);
          return "❌ Erro na comunicação com o sistema de pagamento. Tente novamente.\n\nDigite *menu* para voltar.";
        }
      } else {
        // Generic solicitação creation (boleto, consulta_cpf, etc.)
        // Compute valor_financiado for consulta_cpf
        if (acao.tipo_solicitacao === "consulta_cpf" && dados.valor_compra !== undefined && dados.valor_entrada !== undefined) {
          dados.valor_financiado = Number(dados.valor_compra) - Number(dados.valor_entrada);
        }

        const descParts = Object.entries(dados)
          .filter(([k]) => !k.startsWith("_") && k !== "comprovantes" && k !== "lojas_map" && k !== "loja_selecionada_nome" && k !== "loja_selecionada_cod")
          .map(([k, v]) => `${k}: ${v}`).join(" | ");
        solicitacaoCriada = await createFinanceiroSolicitacao(supabase, contato_id, {
          assunto: `${fluxo.nome} - ${dados.valor ? `R$ ${Number(dados.valor).toFixed(2)}` : (dados.nome_cliente || dados.cliente || "")}`,
          descricao: descParts,
          tipo: acao.tipo_solicitacao,
          coluna_nome: acao.coluna_destino,
          metadata: { ...dados, alias_loja: effectiveNomeLoja, cod_empresa: effectiveCodEmpresa },
          evento_descricao: `${fluxo.nome} solicitado via bot`,
          evento_tipo: `${acao.tipo_solicitacao}_solicitado`,
        });
        if (solicitacaoCriada) {
          const protocolo = await generateProtocolo(solicitacaoCriada.id);
          dados._protocolo = protocolo;
          if (dados.comprovantes?.length) await archiveComprovantes(solicitacaoCriada.id, protocolo, dados.comprovantes);
        }
      }

      // Notify responsáveis via WhatsApp AND create in-app notifications for sector
      await notificarResponsaveis(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, fluxo.chave, effectiveNomeLoja, dados, fluxo.nome);
      await criarNotificacaoSetor(supabase, fluxo, effectiveNomeLoja, dados, solicitacaoCriada?.id || null);

      // Build response from template
      let template = acao.template_confirmacao || `✅ *${fluxo.nome} registrado com sucesso!*`;
      for (const [k, v] of Object.entries(dados)) {
        if (k === "comprovantes" || k === "lojas_map") continue;
        const displayVal = typeof v === "number" ? Number(v).toFixed(2) : String(v || "");
        template = template.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), displayVal);
      }
      // Append protocolo
      if (dados._protocolo) {
        template += `\n\n📋 *Protocolo: ${dados._protocolo}*`;
      }
      return template + "\n\nDigite *menu* para nova operação.";
    }

    if (tipo === "apenas_mensagem") {
      let template = acao.template_confirmacao || "✅ Operação concluída.";
      for (const [k, v] of Object.entries(dados)) {
        template = template.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v || ""));
      }
      return template + "\n\nDigite *menu* para nova operação.";
    }

    return "✅ Operação concluída.\n\nDigite *menu* para nova operação.";
  }

  try {
    const { atendimento_id, contato_id, mensagem_texto, loja_info, media_url, media_mime_type } = await req.json();
    const mediaContext = { media_url, media_mime_type };
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

    // Determine tipo_bot from loja_info or default
    const tipoBot = loja_info?.tipo_bot || "loja";
    const menuOpcoes = await loadMenuOpcoes(tipoBot);

    const { fluxo, etapa, dados } = sessao;

    // ─── Global navigation ───
    if (textoLower === "menu" || textoLower === "voltar" || textoLower === "0") {
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      resposta = buildMenuDynamic(nomeLoja, menuOpcoes);
    }
    // ─── Menu principal ───
    else if (fluxo === "menu_principal" && etapa === "inicio") {
      const selectedIndex = parseInt(texto) - 1;
      const selectedOption = menuOpcoes[selectedIndex];

      if (selectedOption) {
        const selectedFluxo = selectedOption.fluxo;
        const fluxoDef = await loadFluxo(selectedFluxo);

        if (!fluxoDef) {
          resposta = `⚠️ Fluxo "${selectedFluxo}" não encontrado. ${buildMenuDynamic(nomeLoja, menuOpcoes)}`;
        } else if (fluxoDef.acao_final?.tipo === "fluxo_especial" && fluxoDef.acao_final?.fluxo_especial === "confirmar_comparecimento") {
          // Special flow: confirmar_comparecimento (requires appointment listing)
          const result = await handleConfirmarComparecimento(supabase, loja_info, dados);
          resposta = result.resposta;
          updateSessao = result.update;
        } else {
          // Generic flow: start at first step
          const etapas = fluxoDef.etapas as any[];
          if (etapas.length > 0) {
            // Check if non-loja needs to select a store first (e.g. payment-links)
            if (tipoBot !== "loja" && fluxoDef.acao_final?.endpoint === "payment-links") {
              const lojasDisponiveis = await loadLojasAtivas();
              if (lojasDisponiveis.length === 0) {
                resposta = "⚠️ Nenhuma loja cadastrada para seleção. Contate o administrador.\n\nDigite *menu* para voltar.";
                updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
              } else {
                let msg = "🏪 *Selecione a unidade para gerar o link:*\n\n";
                const lojaMap: Record<string, { nome: string; cod: string }> = {};
                lojasDisponiveis.forEach((loja, i) => {
                  msg += `${i + 1}️⃣ ${loja.nome_loja} (${loja.cod_empresa})\n`;
                  lojaMap[String(i + 1)] = { nome: loja.nome_loja, cod: loja.cod_empresa };
                });
                msg += "\n_Digite o número da unidade desejada ou *0* para voltar._";
                resposta = msg;
                updateSessao = { fluxo: selectedFluxo, etapa: "selecionar_loja", dados: { lojas_map: lojaMap } };
              }
            } else {
              const primeiraEtapa = etapas[0];
              resposta = primeiraEtapa.mensagem + "\n\n_Digite *0* para voltar ao menu._";
              updateSessao = { fluxo: selectedFluxo, etapa: "step_0", dados: {} };
            }
          } else {
            resposta = "⚠️ Fluxo sem etapas configuradas.";
            updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
          }
        }
      } else {
        resposta = buildMenuDynamic(nomeLoja, menuOpcoes);
      }
    }
    // ─── Confirmar Comparecimento (special flow) ───
    else if (fluxo === "confirmar_comparecimento") {
      if (etapa === "selecionar") {
        const agMap = (dados as any).agendamentos || {};
        const agId = agMap[texto];
        if (!agId) {
          resposta = "⚠️ Número inválido. Digite o número do agendamento da lista ou *menu* para voltar.";
        } else {
          const { data: agData } = await supabase
            .from("agendamentos")
            .select("contato_id, contato:contatos(nome)")
            .eq("id", agId)
            .single();
          const clienteNome = (agData as any)?.contato?.nome || "Cliente";
          resposta = `O cliente *${clienteNome}* compareceu?\n\nResponda *SIM* ou *NÃO*.`;
          updateSessao = { etapa: "confirmar_presenca", dados: { ...dados, agendamento_id: agId, cliente_nome: clienteNome } };
        }
      } else if (etapa === "confirmar_presenca") {
        const agId = (dados as any).agendamento_id;
        const clienteNome = (dados as any).cliente_nome || "Cliente";

        if (textoLower === "sim" || textoLower === "s") {
          await supabase.from("agendamentos").update({ status: "atendido", loja_confirmou_presenca: true }).eq("id", agId);
          resposta = `✅ Comparecimento de *${clienteNome}* confirmado!\n\nDigite *menu* para nova operação.`;
          updateSessao = { status: "concluido" };
        } else if (["nao", "não", "n"].includes(textoLower)) {
          await supabase.from("agendamentos").update({ status: "no_show", loja_confirmou_presenca: false }).eq("id", agId);
          resposta = `❌ No-show registrado para *${clienteNome}*. O sistema irá acionar o plano de recuperação automaticamente.\n\nDigite *menu* para nova operação.`;
          updateSessao = { status: "concluido" };
        } else {
          resposta = "Responda *SIM* ou *NÃO*.";
        }
      } else {
        resposta = "⚠️ Etapa não reconhecida. Digite *menu* para recomeçar.";
        updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      }
    }
    // ─── Store selection for non-loja bots ───
    else if (etapa === "selecionar_loja") {
      const lojaMap = (dados as any).lojas_map || {};
      const selected = lojaMap[texto];
      if (!selected) {
        resposta = "⚠️ Número inválido. Digite o número da unidade desejada ou *0* para voltar.";
      } else {
        const fluxoDef = await loadFluxo(fluxo);
        if (!fluxoDef || !(fluxoDef.etapas as any[]).length) {
          resposta = "⚠️ Fluxo não encontrado. Digite *menu* para recomeçar.";
          updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
        } else {
          const primeiraEtapa = (fluxoDef.etapas as any[])[0];
          resposta = `✅ Unidade selecionada: *${selected.nome}*\n\n${primeiraEtapa.mensagem}\n\n_Digite *0* para voltar ao menu._`;
          updateSessao = {
            etapa: "step_0",
            dados: { loja_selecionada_nome: selected.nome, loja_selecionada_cod: selected.cod },
          };
        }
      }
    }
    // ─── Generic flow engine (step_N) ───
    else if (etapa.startsWith("step_")) {
      const fluxoDef = await loadFluxo(fluxo);
      if (!fluxoDef) {
        resposta = "⚠️ Fluxo não encontrado. Digite *menu* para recomeçar.";
        updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      } else {
        const etapas = fluxoDef.etapas as any[];
        const stepIndex = parseInt(etapa.replace("step_", ""));
        const currentEtapa = etapas[stepIndex];

        if (!currentEtapa) {
          resposta = "⚠️ Etapa inválida. Digite *menu* para recomeçar.";
          updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
        } else {
          // Handle selecionar_loja_ou_setor type
          if (currentEtapa.tipo_input === "selecionar_loja_ou_setor") {
            const opcoes = (dados as any)._loja_setor_opcoes;
            if (!opcoes) {
              // First time: load and present options
              const items = await loadLojasESetores();
              if (items.length === 0) {
                resposta = "⚠️ Nenhuma loja ou setor cadastrado.\n\n_Digite *0* para voltar ao menu._";
              } else {
                let msg = currentEtapa.mensagem + "\n\n";
                const opMap: Record<string, { nome: string; tipo: string; cod_empresa?: string }> = {};
                items.forEach((item, i) => {
                  const label = item.tipo === "loja" ? `🏪 ${item.nome} (${item.cod_empresa})` : `🏢 ${item.nome} (setor)`;
                  msg += `${i + 1}️⃣ ${label}\n`;
                  opMap[String(i + 1)] = item;
                });
                msg += "\n_Digite o número ou *0* para voltar ao menu._";
                resposta = msg;
                updateSessao = { etapa: etapa, dados: { ...dados as Record<string, any>, _loja_setor_opcoes: opMap } };
              }
            } else {
              // User selected
              const selected = opcoes[texto];
              if (!selected) {
                resposta = "⚠️ Número inválido. Escolha uma opção da lista ou *0* para voltar.";
              } else {
                const displayValue = selected.tipo === "loja" ? `${selected.nome} (${selected.cod_empresa})` : selected.nome;
                const newDados = { ...dados as Record<string, any>, [currentEtapa.campo]: displayValue };
                delete newDados._loja_setor_opcoes;
                if (selected.cod_empresa) {
                  newDados.loja_ou_setor_cod = selected.cod_empresa;
                  newDados.loja_ou_setor_nome = selected.nome;
                }
                const nextIndex = stepIndex + 1;
                const etapas_ = fluxoDef.etapas as any[];
                if (nextIndex >= etapas_.length) {
                  resposta = buildConfirmacao(fluxoDef, newDados);
                  updateSessao = { etapa: "confirmar", dados: newDados };
                } else {
                  resposta = etapas_[nextIndex].mensagem + "\n\n_Digite *0* para voltar ao menu._";
                  updateSessao = { etapa: `step_${nextIndex}`, dados: newDados };
                }
              }
            }
          }
          // Handle skip for optional fields
          else if (!currentEtapa.obrigatorio && textoLower === "pular") {
            const newDados = { ...dados as Record<string, any>, [currentEtapa.campo]: null };
            const nextIndex = stepIndex + 1;

            if (nextIndex >= etapas.length) {
              // Show confirmation
              resposta = buildConfirmacao(fluxoDef, newDados);
              updateSessao = { etapa: "confirmar", dados: newDados };
            } else {
              resposta = etapas[nextIndex].mensagem + "\n\n_Digite *0* para voltar ao menu._";
              updateSessao = { etapa: `step_${nextIndex}`, dados: newDados };
            }
          } else {
            // Validate input
            const validation = validateInput(texto, currentEtapa, mediaContext);
            if (!validation.valid) {
              resposta = validation.error!;
            } else {
              let newDados = { ...dados as Record<string, any> };

              // For imagem type, store in comprovantes array
              if (currentEtapa.tipo_input === "imagem") {
                const comprovantes = newDados.comprovantes || [];
                comprovantes.push({ url: validation.value, mime_type: mediaContext.media_mime_type || null });
                newDados.comprovantes = comprovantes;
                newDados[currentEtapa.campo] = `${comprovantes.length} arquivo(s)`;
                // Ask if more receipts
                resposta = `✅ Comprovante ${comprovantes.length} recebido!\n\nDeseja enviar *mais um comprovante*?\nResponda *SIM* ou *NÃO*.`;
                updateSessao = { etapa: "aguardando_mais_comprovantes", dados: { ...newDados, _current_step: stepIndex } };
              } else {
                newDados[currentEtapa.campo] = validation.value;

                // Special: compute valor_financiado after valor_entrada
                if (currentEtapa.campo === "valor_entrada" && newDados.valor_compra !== undefined) {
                  const entrada = Number(newDados.valor_entrada);
                  const compra = Number(newDados.valor_compra);
                  if (entrada > compra) {
                    resposta = `⚠️ Entrada (R$ ${entrada.toFixed(2)}) não pode ser maior que o valor da compra (R$ ${compra.toFixed(2)}). Digite novamente:\n\n_Digite *0* para voltar ao menu._`;
                  } else {
                    newDados.valor_financiado = compra - entrada;
                  }
                }

                if (!resposta) {
                  const nextIndex = stepIndex + 1;
                  if (nextIndex >= etapas.length) {
                    resposta = buildConfirmacao(fluxoDef, newDados);
                    updateSessao = { etapa: "confirmar", dados: newDados };
                  } else {
                    resposta = etapas[nextIndex].mensagem + "\n\n_Digite *0* para voltar ao menu._";
                    updateSessao = { etapa: `step_${nextIndex}`, dados: newDados };
                  }
                }
              }
            }
          }
        }
      }
    }
    // ─── Multiple receipt loop ───
    else if (etapa === "aguardando_mais_comprovantes") {
      if (["sim", "s"].includes(textoLower)) {
        // Go back to the image step
        const fluxoDef = await loadFluxo(fluxo);
        const stepIndex = (dados as any)._current_step;
        const etapas_ = (fluxoDef?.etapas as any[]) || [];
        const imgEtapa = etapas_[stepIndex];
        resposta = (imgEtapa?.mensagem || "📎 Envie o comprovante:") + "\n\n_Digite *0* para voltar ao menu._";
        const newDados = { ...dados as Record<string, any> };
        updateSessao = { etapa: `step_${stepIndex}`, dados: newDados };
      } else if (["nao", "não", "n"].includes(textoLower)) {
        // Advance to next step
        const fluxoDef = await loadFluxo(fluxo);
        const stepIndex = (dados as any)._current_step;
        const etapas_ = (fluxoDef?.etapas as any[]) || [];
        const newDados = { ...dados as Record<string, any> };
        delete newDados._current_step;
        const nextIndex = stepIndex + 1;
        if (nextIndex >= etapas_.length) {
          resposta = buildConfirmacao(fluxoDef!, newDados);
          updateSessao = { etapa: "confirmar", dados: newDados };
        } else {
          resposta = etapas_[nextIndex].mensagem + "\n\n_Digite *0* para voltar ao menu._";
          updateSessao = { etapa: `step_${nextIndex}`, dados: newDados };
        }
      } else {
        resposta = "Responda *SIM* para enviar mais um comprovante ou *NÃO* para continuar.";
      }
    }
    // ─── Confirmation step ───
    else if (etapa === "confirmar") {
      if (["nao", "não", "n"].includes(textoLower)) {
        resposta = "❌ Operação cancelada.\n\nDigite *menu* para voltar ao início.";
        updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
      } else if (["sim", "s"].includes(textoLower)) {
        const fluxoDef = await loadFluxo(fluxo);
        if (!fluxoDef) {
          resposta = "⚠️ Fluxo não encontrado.";
          updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
        } else {
          resposta = await executarAcaoFinal(fluxoDef, dados as Record<string, any>, contato_id, atendimento_id, nomeLoja, codEmpresa);
          updateSessao = { status: "concluido" };
        }
      } else {
        resposta = "Responda *SIM* para confirmar ou *NÃO* para cancelar.";
      }
    }
    // ─── Fallback ───
    else {
      resposta = buildMenuDynamic(nomeLoja, menuOpcoes);
      updateSessao = { fluxo: "menu_principal", etapa: "inicio", dados: {} };
    }

    // 2. Update session
    if (Object.keys(updateSessao).length > 0) {
      await supabase.from("bot_sessoes").update(updateSessao).eq("id", sessao.id);
    }

    // 3. Send response
    await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id, texto: resposta, remetente_nome: "Bot Lojas" }),
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

// ─── Menu builder ───
function buildMenuDynamic(nomeLoja: string, opcoes: Array<{ emoji: string; titulo: string }>): string {
  let menu = `Olá *${nomeLoja}*! 👋\n\nEscolha uma opção:\n\n`;
  opcoes.forEach((op, i) => {
    menu += `${op.emoji || `${i + 1}️⃣`} ${op.titulo}\n`;
  });
  menu += `\n_Digite o número da opção desejada._\n_A qualquer momento, digite *0* para voltar ao menu._`;
  return menu;
}

// ─── Confirmar Comparecimento (special handler) ───
async function handleConfirmarComparecimento(supabase: any, loja_info: any, dados: any) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

  const cleanLojaTel = (loja_info?.telefone || "").replace(/\D/g, "");
  const { data: agendamentosHoje } = await supabase
    .from("agendamentos")
    .select("id, contato_id, data_horario, loja_nome, status, contato:contatos(nome)")
    .eq("loja_telefone", cleanLojaTel)
    .in("status", ["agendado", "confirmado"])
    .gte("data_horario", todayStart)
    .lt("data_horario", todayEnd)
    .order("data_horario", { ascending: true });

  if (!agendamentosHoje?.length) {
    return {
      resposta: "📋 Não há agendamentos pendentes para hoje.\n\nDigite *menu* para voltar.",
      update: { fluxo: "menu_principal", etapa: "inicio", dados: {} },
    };
  }

  let lista = "📋 *Agendamentos de Hoje*\n\n";
  const agMap: Record<string, string> = {};
  agendamentosHoje.forEach((ag: any, i: number) => {
    const dt = new Date(ag.data_horario);
    const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const nomeCliente = ag.contato?.nome || "Cliente";
    lista += `${i + 1}️⃣ ${nomeCliente} — ${hora}\n`;
    agMap[String(i + 1)] = ag.id;
  });
  lista += "\nDigite o *número* do agendamento para confirmar.";

  return {
    resposta: lista,
    update: { fluxo: "confirmar_comparecimento", etapa: "selecionar", dados: { agendamentos: agMap } },
  };
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

// Map tipo_solicitacao to setor name
function resolveSetorForTipo(tipo: string): string {
  const tiMap: Record<string, string> = {
    impressao: "TI",
    suporte_tecnico: "TI",
  };
  return tiMap[tipo] || "Financeiro";
}

async function createFinanceiroSolicitacao(supabase: any, contatoId: string, params: SolicitacaoParams) {
  try {
    const setorNome = resolveSetorForTipo(params.tipo);
    const { data: setor } = await supabase
      .from("setores")
      .select("id")
      .eq("nome", setorNome)
      .single();

    let colunaId: string | null = null;

    if (setor) {
      const { data: colunasAtivas } = await supabase
        .from("pipeline_colunas")
        .select("id, nome, ordem")
        .eq("setor_id", setor.id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });

      const activeCols = (colunasAtivas || []) as Array<{ id: string; nome: string; ordem: number }>;
      const nomesPrioritarios = [
        params.coluna_nome,
        ...(params.tipo === "link_pagamento" ? ["Link Enviado", "Novo"] : []),
        ...(params.tipo === "boleto" ? ["Solicitação de Boleto", "Boleto Enviado"] : []),
        ...(params.tipo === "consulta_cpf" ? ["Consulta CPF"] : []),
      ];
      const colunaEncontrada = activeCols.find((c) => nomesPrioritarios.includes(c.nome));
      colunaId = colunaEncontrada?.id || activeCols[0]?.id || null;
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

    return solicitacao;
  } catch (e) {
    console.error("Error creating solicitacao:", e);
    return null;
  }
}

// ─── Notify flow responsáveis via WhatsApp ───
async function notificarResponsaveis(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  fluxoChave: string,
  nomeLoja: string,
  dados: Record<string, any>,
  fluxoNome: string
) {
  try {
    const { data: responsaveis } = await supabase
      .from("fluxo_responsaveis")
      .select("*")
      .eq("fluxo_chave", fluxoChave)
      .eq("ativo", true)
      .eq("tipo", "primario");

    if (!responsaveis?.length) {
      console.log(`[bot-lojas] No responsáveis for flow: ${fluxoChave}`);
      return;
    }

    // Build summary
    const resumo = Object.entries(dados)
      .map(([k, v]) => `• ${k}: ${typeof v === "number" ? `R$ ${Number(v).toFixed(2)}` : v}`)
      .join("\n");

    const mensagem = `🔔 *Nova solicitação: ${fluxoNome}*\n\n🏪 Loja: *${nomeLoja}*\n\n${resumo}\n\n_Acompanhe no pipeline do sistema._`;

    for (const resp of responsaveis) {
      try {
        // Find or create contato for responsável
        const tel = resp.telefone.replace(/\D/g, "");
        let { data: contatoResp } = await supabase
          .from("canais")
          .select("contato_id")
          .eq("identificador", tel)
          .eq("tipo", "whatsapp")
          .limit(1)
          .single();

        if (contatoResp) {
          // Find active atendimento or send direct
          const { data: atendResp } = await supabase
            .from("atendimentos")
            .select("id")
            .eq("contato_id", contatoResp.contato_id)
            .in("status", ["aguardando", "em_atendimento"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (atendResp) {
            await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ atendimento_id: atendResp.id, texto: mensagem, remetente_nome: "Sistema" }),
            });
          } else {
            // Send via template or direct message to phone
            await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ telefone: tel, texto: mensagem, remetente_nome: "Sistema" }),
            });
          }
        } else {
          // No canal found, send direct to phone number
          await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ telefone: tel, texto: mensagem, remetente_nome: "Sistema" }),
          });
        }
        console.log(`[bot-lojas] Notified ${resp.nome} (${resp.telefone}) for ${fluxoChave}`);
      } catch (notifErr) {
        console.error(`[bot-lojas] Failed to notify ${resp.nome}:`, notifErr);
      }
    }
  } catch (e) {
    console.error("[bot-lojas] notificarResponsaveis error:", e);
  }
}

// ─── Create in-app notifications for the destination sector ───
async function criarNotificacaoSetor(
  supabase: any,
  fluxo: any,
  nomeLoja: string,
  dados: Record<string, any>,
  solicitacaoId: string | null
) {
  try {
    const setorDestinoId = fluxo.setor_destino_id;
    if (!setorDestinoId) {
      console.log(`[bot-lojas] No setor_destino_id for flow ${fluxo.chave}, skipping in-app notification`);
      return;
    }

    // Get all profiles in this sector
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("setor_id", setorDestinoId)
      .eq("ativo", true);

    const protocolo = dados._protocolo || "";
    const titulo = `Nova solicitação: ${fluxo.nome}`;
    const mensagem = `🏪 ${nomeLoja}${protocolo ? ` | 📋 ${protocolo}` : ""}`;

    // Create notification for each user in the sector + a sector-wide one
    const notifs: any[] = [];

    // Sector-wide notification (for any user assigned to this sector)
    notifs.push({
      setor_id: setorDestinoId,
      titulo,
      mensagem,
      tipo: "solicitacao",
      referencia_id: solicitacaoId,
    });

    // Individual notifications for each profile in the sector
    if (profiles?.length) {
      for (const p of profiles) {
        notifs.push({
          usuario_id: p.id,
          setor_id: setorDestinoId,
          titulo,
          mensagem,
          tipo: "solicitacao",
          referencia_id: solicitacaoId,
        });
      }
    }

    if (notifs.length > 0) {
      await supabase.from("notificacoes").insert(notifs);
      console.log(`[bot-lojas] Created ${notifs.length} in-app notifications for sector ${setorDestinoId}`);
    }
  } catch (e) {
    console.error("[bot-lojas] criarNotificacaoSetor error:", e);
  }
}
