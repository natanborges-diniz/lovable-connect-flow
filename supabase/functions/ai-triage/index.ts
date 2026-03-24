import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { atendimento_id, mensagem_texto, contato_id, media } = await req.json();
    if (!atendimento_id) throw new Error("atendimento_id is required");

    // 1. Load atendimento
    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, canal_provedor, modo")
      .eq("id", atendimento_id)
      .single();
    if (atErr || !atendimento) throw new Error("Atendimento not found");

    if (atendimento.modo === "humano") {
      return new Response(JSON.stringify({ status: "skipped", reason: "modo humano" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isHibrido = atendimento.modo === "hibrido";
    const contatoIdToUpdate = contato_id || atendimento.contato_id;

    // 2. Load prompt from configuracoes_ia
    const { data: promptConfig } = await supabase
      .from("configuracoes_ia")
      .select("valor")
      .eq("chave", "prompt_atendimento")
      .single();
    const systemPrompt = promptConfig?.valor || "Você é um assistente de atendimento ao cliente.";

    // 3. Load knowledge base
    const { data: conhecimentos } = await supabase
      .from("conhecimento_ia")
      .select("categoria, titulo, conteudo")
      .eq("ativo", true);

    // 3b. Load few-shot examples
    const { data: exemplos } = await supabase
      .from("ia_exemplos")
      .select("categoria, pergunta, resposta_ideal")
      .eq("ativo", true)
      .limit(20);

    // 3c. Load recent negative feedbacks as anti-examples
    const { data: antiExemplos } = await supabase
      .from("ia_feedbacks")
      .select("motivo, resposta_corrigida")
      .eq("avaliacao", "negativo")
      .order("created_at", { ascending: false })
      .limit(5);

    let fewShotBlock = "";
    if (exemplos && exemplos.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const ex of exemplos) {
        const cat = (ex.categoria || "geral").toUpperCase();
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(`Cliente: "${ex.pergunta}"\nResposta ideal: "${ex.resposta_ideal}"`);
      }
      const sections = Object.entries(grouped)
        .map(([cat, items]) => `[${cat}]\n${items.join("\n\n")}`)
        .join("\n\n");
      fewShotBlock = `\n\nEXEMPLOS DE RESPOSTAS APROVADAS (use como referência de tom e qualidade — NÃO copie literalmente, adapte ao contexto):\n\n${sections}`;
    }

    let antiExemploBlock = "";
    if (antiExemplos && antiExemplos.length > 0) {
      const items = antiExemplos
        .filter((f: any) => f.motivo)
        .map((f: any) => `- Erro: ${f.motivo}${f.resposta_corrigida ? `\n  Correção: ${f.resposta_corrigida}` : ""}`)
        .join("\n");
      if (items) {
        antiExemploBlock = `\n\nERROS RECENTES DA IA (EVITE REPETIR ESTES PADRÕES):\n${items}`;
      }
    }

    let knowledgeBlock = "";
    if (conhecimentos && conhecimentos.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const item of conhecimentos) {
        const cat = (item.categoria || "geral").toUpperCase();
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(`### ${item.titulo}\n${JSON.stringify(item.conteudo, null, 2)}`);
      }
      const sections = Object.entries(grouped)
        .map(([cat, items]) => `[${cat}]\n${items.join("\n\n")}`)
        .join("\n\n");
      knowledgeBlock = `\n\nBASE DE CONHECIMENTO (consulte para responder sobre produtos, serviços, políticas e FAQ):\n\n${sections}`;
    }

    console.log(`Prompt loaded: ${systemPrompt.length} chars, knowledge items: ${conhecimentos?.length || 0}, modo: ${atendimento.modo}`);

    // 4. Load last 20 messages for context (including media)
    const { data: msgs } = await supabase
      .from("mensagens")
      .select("direcao, conteudo, remetente_nome, created_at, tipo_conteudo, metadata")
      .eq("atendimento_id", atendimento_id)
      .order("created_at", { ascending: true })
      .limit(20);

    // Build multimodal chat history
    const chatHistory: any[] = [];
    for (const m of (msgs || [])) {
      const role = m.direcao === "inbound" ? "user" : "assistant";
      const mediaUrl = (m.metadata as any)?.media_url;
      const tipoConteudo = (m as any).tipo_conteudo || "text";

      if (tipoConteudo === "image" && mediaUrl) {
        // Multimodal: image + optional caption
        const content: any[] = [
          { type: "image_url", image_url: { url: mediaUrl, detail: "high" } },
        ];
        if (m.conteudo && m.conteudo !== "[image]") {
          content.push({ type: "text", text: m.conteudo });
        }
        chatHistory.push({ role, content });
      } else {
        chatHistory.push({ role, content: m.conteudo });
      }
    }

    const inboundCount = (msgs || []).filter((m: any) => m.direcao === "inbound").length;

    const outboundMessages = (msgs || []).filter((m: any) => m.direcao === "outbound").map((m: any) => m.conteudo);
    const alreadySentSummary = outboundMessages.length > 0
      ? outboundMessages.join("\n---\n")
      : "Nenhuma mensagem enviada ainda.";

    // 5. Load pipeline columns and setores
    const { data: colunas } = await supabase
      .from("pipeline_colunas")
      .select("id, nome")
      .eq("ativo", true)
      .order("ordem");

    const { data: setores } = await supabase
      .from("setores")
      .select("id, nome")
      .eq("ativo", true);

    const colunasNomes = (colunas || []).map((c: any) => c.nome).join(", ");
    const setoresNomes = (setores || []).map((s: any) => s.nome).join(", ");

    // 6. Build instructions
    let instructions = `REGRAS DE ATENDIMENTO (PRIORIDADE MÁXIMA — SIGA RIGOROSAMENTE):\n\n${systemPrompt}\n\nREGRA DE TERMINOLOGIA (OBRIGATÓRIA): Ao se referir a atendimento por uma pessoa real, use SEMPRE e EXCLUSIVAMENTE o termo "Consultor especializado". NUNCA use "atendente", "operador", "humano", "agente" ou qualquer sinônimo. Sempre "Consultor especializado".`;

    instructions += `\n\nREGRA ANTI-REPETIÇÃO (OBRIGATÓRIA):\n- NUNCA repita endereço, horário, telefone, ou QUALQUER informação já presente nas mensagens anteriores.\n- Releia TODO o histórico ANTES de gerar a resposta.\n- Se o cliente perguntar algo já respondido, diga "Conforme mencionei anteriormente..." de forma BREVE.\n- Respostas devem ser CURTAS e DIRETAS.\n\nINFORMAÇÕES JÁ ENVIADAS NESTA CONVERSA (NÃO REPITA NADA DISTO):\n${alreadySentSummary}`;

    instructions += `\n\nCAPACIDADES DE VISÃO (IMAGENS):\n- Você pode receber e interpretar imagens enviadas pelo cliente.\n- Se o cliente enviar uma foto de receita oftalmológica, use a tool 'interpretar_receita' para extrair os dados.\n- Se o cliente enviar uma foto de produto, documento ou qualquer outra imagem, descreva o que vê e responda no contexto da conversa.\n- SEMPRE reconheça que recebeu a imagem e descreva brevemente o que vê antes de prosseguir.`;

    if (knowledgeBlock) {
      instructions += knowledgeBlock;
    }

    if (isHibrido) {
      instructions += `\n\nCONTEXTO MODO HÍBRIDO:\nUm Consultor especializado foi solicitado anteriormente mas ainda não assumiu a conversa. Você continua respondendo normalmente — trate qualquer assunto dentro do seu escopo com a mesma qualidade.\n\nCOMPORTAMENTO:\n- Se o cliente trouxer um assunto NOVO que você consegue resolver, responda naturalmente como se estivesse no modo normal.\n- Se o cliente insistir no assunto que gerou a solicitação do Consultor especializado, ou surgir algo fora do seu escopo, reforce que o Consultor especializado já foi acionado.\n- A cada resposta, REAVALIE se o cliente ainda precisa de um Consultor especializado considerando o histórico completo da conversa.\n- Se a questão original foi sanada ou o cliente mudou completamente de assunto para algo que você resolve, indique que não precisa mais do Consultor especializado (ainda_precisa_humano = false).`;
    }

    instructions += `\n\nINSTRUÇÕES DE CLASSIFICAÇÃO E AÇÃO (uso interno, não mostrar ao cliente):\n- Você é um agente autônomo com múltiplas ferramentas. Escolha a mais adequada para cada situação.\n- Colunas disponíveis no pipeline: ${colunasNomes}\n- Setores internos disponíveis: ${setoresNomes || "nenhum cadastrado"}\n- Esta é a mensagem número ${inboundCount} do cliente nesta conversa.\n- Se é a 1ª ou 2ª mensagem, use pipeline_coluna_sugerida = "Novo Contato" (a menos que precise de Consultor especializado).\n- Só mova para colunas específicas após 3+ mensagens quando a intenção estiver clara.\n- Se precisa_humano = true, SEMPRE mova para "Atendimento Humano".\n- TERMINOLOGIA: em respostas ao cliente, SEMPRE diga "Consultor especializado". NUNCA "atendente", "operador", "humano" ou "agente".${isHibrido ? '\n- O atendimento está em MODO HÍBRIDO. Reavalie se ainda_precisa_humano é true ou false.' : ''}`;

    // 7. Build input (chat history + highlighted current message)
    const lastInboundIndex = chatHistory.length - 1 - [...chatHistory].reverse().findIndex(m => m.role === "user");
    const historyWithoutLast = lastInboundIndex >= 0 && lastInboundIndex < chatHistory.length
      ? chatHistory.filter((_: any, i: number) => i !== lastInboundIndex)
      : chatHistory;

    const lastMessage = lastInboundIndex >= 0 && lastInboundIndex < chatHistory.length
      ? chatHistory[lastInboundIndex]
      : null;

    const input: any[] = [...historyWithoutLast];

    // Build the current message input (could be multimodal)
    if (lastMessage) {
      if (typeof lastMessage.content === "string") {
        input.push({
          role: "user",
          content: `MENSAGEM ATUAL DO CLIENTE (responda especificamente a esta mensagem):\n\n${lastMessage.content}`,
        });
      } else if (Array.isArray(lastMessage.content)) {
        // Multimodal content (image + text)
        const enhancedContent = [
          { type: "text", text: "MENSAGEM ATUAL DO CLIENTE (responda especificamente a esta mensagem):" },
          ...lastMessage.content,
        ];
        input.push({ role: "user", content: enhancedContent });
      }
    } else if (mensagem_texto) {
      input.push({
        role: "user",
        content: `MENSAGEM ATUAL DO CLIENTE (responda especificamente a esta mensagem):\n\n${mensagem_texto}`,
      });
    }

    // 8. Define agent tools
    const tools = [
      {
        type: "function",
        name: "classify_and_respond",
        description: "Classifica a intenção do cliente e gera a resposta. Use como ferramenta padrão para responder mensagens de texto.",
        parameters: {
          type: "object",
          properties: {
            resposta: {
              type: "string",
              description: "Texto de resposta para enviar ao cliente via WhatsApp. REGRAS: 1) NUNCA repita dados já enviados. 2) Respostas CURTAS e DIRETAS. 3) Siga as regras de atendimento. 4) Use SEMPRE 'Consultor especializado'.",
            },
            intencao: {
              type: "string",
              enum: ["orcamento", "status", "reclamacao", "parceria", "compras", "marketing", "agendamento", "informacoes", "receita_oftalmologica", "outro"],
              description: "Classificação da intenção do cliente",
            },
            precisa_humano: {
              type: "boolean",
              description: "true se a IA não consegue resolver e precisa de intervenção de um Consultor especializado",
            },
            ainda_precisa_humano: {
              type: "boolean",
              description: "Reavaliação contínua: o cliente AINDA precisa de um Consultor especializado?",
            },
            pipeline_coluna_sugerida: {
              type: "string",
              description: "Nome exato da coluna do pipeline para onde mover o contato",
            },
            setor_sugerido: {
              type: "string",
              description: "Nome do setor interno para rotear (se aplicável, senão string vazia)",
            },
          },
          required: ["resposta", "intencao", "precisa_humano", "ainda_precisa_humano", "pipeline_coluna_sugerida"],
          additionalProperties: false,
        },
      },
      {
        type: "function",
        name: "interpretar_receita",
        description: "Extrai dados de uma imagem de receita oftalmológica. Use quando o cliente enviar uma foto de receita/prescrição de óculos ou lentes. Extraia grau (esférico, cilíndrico), eixo, adição, DNP e tipo de lente recomendado.",
        parameters: {
          type: "object",
          properties: {
            olho_direito: {
              type: "object",
              properties: {
                esferico: { type: "string", description: "Grau esférico (ex: -2.00, +1.50)" },
                cilindrico: { type: "string", description: "Grau cilíndrico (ex: -0.75)" },
                eixo: { type: "string", description: "Eixo em graus (ex: 180)" },
                adicao: { type: "string", description: "Adição para perto (ex: +2.00), se houver" },
                dnp: { type: "string", description: "Distância naso-pupilar em mm, se informada" },
              },
              required: ["esferico"],
              additionalProperties: false,
            },
            olho_esquerdo: {
              type: "object",
              properties: {
                esferico: { type: "string", description: "Grau esférico" },
                cilindrico: { type: "string", description: "Grau cilíndrico" },
                eixo: { type: "string", description: "Eixo em graus" },
                adicao: { type: "string", description: "Adição para perto, se houver" },
                dnp: { type: "string", description: "Distância naso-pupilar em mm, se informada" },
              },
              required: ["esferico"],
              additionalProperties: false,
            },
            tipo_lente_recomendado: {
              type: "string",
              enum: ["visao_simples", "bifocal", "multifocal", "progressiva", "nao_identificado"],
              description: "Tipo de lente baseado na prescrição",
            },
            observacoes: {
              type: "string",
              description: "Observações adicionais como nome do médico, CRM, validade, etc.",
            },
            resposta_cliente: {
              type: "string",
              description: "Mensagem para enviar ao cliente confirmando os dados extraídos e próximos passos",
            },
          },
          required: ["olho_direito", "olho_esquerdo", "tipo_lente_recomendado", "resposta_cliente"],
          additionalProperties: false,
        },
      },
      {
        type: "function",
        name: "solicitar_humano",
        description: "Escalona o atendimento para um Consultor especializado quando a IA detecta que não pode resolver. Forneça contexto completo.",
        parameters: {
          type: "object",
          properties: {
            motivo: {
              type: "string",
              description: "Resumo do motivo do escalonamento para o Consultor especializado",
            },
            resposta_cliente: {
              type: "string",
              description: "Mensagem para o cliente informando que um Consultor especializado foi acionado",
            },
            setor_sugerido: {
              type: "string",
              description: "Setor para rotear (se identificável)",
            },
          },
          required: ["motivo", "resposta_cliente"],
          additionalProperties: false,
        },
      },
    ];

    // 9. Call OpenAI Responses API
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        instructions,
        input,
        tools,
        tool_choice: "required",
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      if (aiResponse.status === 429) {
        console.error("OpenAI rate limited:", errText);
        return new Response(JSON.stringify({ error: "Rate limited, will retry" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        console.error("OpenAI credits exhausted:", errText);
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`OpenAI API error [${aiResponse.status}]: ${errText}`);
    }

    const aiData = await aiResponse.json();

    // 10. Process ALL function calls from the agent
    const functionCalls = (aiData.output || []).filter((item: any) => item.type === "function_call");
    if (!functionCalls.length) {
      console.error("OpenAI response:", JSON.stringify(aiData));
      throw new Error("OpenAI did not return any function_call in output");
    }

    let resposta = "";
    let intencao = "outro";
    let precisa_humano = false;
    let ainda_precisa_humano = false;
    let pipeline_coluna_sugerida = "Novo Contato";
    let setor_sugerido = "";

    for (const fc of functionCalls) {
      const args = JSON.parse(fc.arguments);
      console.log(`Agent tool called: ${fc.name}`, JSON.stringify(args).substring(0, 200));

      if (fc.name === "classify_and_respond") {
        resposta = args.resposta;
        intencao = args.intencao;
        precisa_humano = args.precisa_humano;
        ainda_precisa_humano = args.ainda_precisa_humano;
        pipeline_coluna_sugerida = args.pipeline_coluna_sugerida;
        setor_sugerido = args.setor_sugerido || "";

      } else if (fc.name === "interpretar_receita") {
        resposta = args.resposta_cliente;
        intencao = "receita_oftalmologica";

        // Save prescription data to contato metadata
        await supabase
          .from("contatos")
          .update({
            metadata: {
              ultima_receita: {
                olho_direito: args.olho_direito,
                olho_esquerdo: args.olho_esquerdo,
                tipo_lente: args.tipo_lente_recomendado,
                observacoes: args.observacoes,
                data_leitura: new Date().toISOString(),
              },
            },
          })
          .eq("id", contatoIdToUpdate);

        // Log CRM event for prescription
        await supabase.from("eventos_crm").insert({
          contato_id: contatoIdToUpdate,
          tipo: "receita_interpretada",
          descricao: `IA interpretou receita: OD ${args.olho_direito.esferico}/${args.olho_direito.cilindrico || 'plano'} OE ${args.olho_esquerdo.esferico}/${args.olho_esquerdo.cilindrico || 'plano'} — ${args.tipo_lente_recomendado}`,
          metadata: { olho_direito: args.olho_direito, olho_esquerdo: args.olho_esquerdo, tipo_lente: args.tipo_lente_recomendado, observacoes: args.observacoes },
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });

        pipeline_coluna_sugerida = inboundCount >= 3 ? "Orçamento" : "Novo Contato";

      } else if (fc.name === "solicitar_humano") {
        resposta = args.resposta_cliente;
        precisa_humano = true;
        pipeline_coluna_sugerida = "Atendimento Humano";
        setor_sugerido = args.setor_sugerido || "";

        // Log escalation event
        await supabase.from("eventos_crm").insert({
          contato_id: contatoIdToUpdate,
          tipo: "escalonamento_humano",
          descricao: `IA solicitou Consultor especializado: ${args.motivo}`,
          metadata: { motivo: args.motivo, setor: args.setor_sugerido },
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });
      }
    }

    console.log(`AI Agent: tools=${functionCalls.map((f: any) => f.name).join(',')}, intencao=${intencao}, precisa_humano=${precisa_humano}, coluna=${pipeline_coluna_sugerida}`);

    // 11. Send response via send-whatsapp
    if (resposta) {
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          atendimento_id,
          texto: resposta,
          remetente_nome: "Assistente IA",
        }),
      });
      if (!sendRes.ok) {
        console.error("Failed to send WhatsApp response:", await sendRes.text());
      }
    }

    // 12. Determine new modo
    const contatoUpdates: any = { ultimo_contato_at: new Date().toISOString() };
    let newModo: string | null = null;

    if (isHibrido) {
      if (ainda_precisa_humano === false) {
        newModo = "ia";
        console.log("Hybrid → IA: AI resolved the pending issue");
      }
    } else if (precisa_humano) {
      newModo = "hibrido";
      console.log("IA → Híbrido: escalation triggered, AI continues monitoring");
    }

    if (newModo) {
      await supabase.from("atendimentos").update({ modo: newModo }).eq("id", atendimento_id);
    }

    // 13. Pipeline column movement
    if (precisa_humano || (isHibrido && ainda_precisa_humano !== false)) {
      const humanoColuna = colunas?.find((c: any) => c.nome === "Atendimento Humano");
      if (humanoColuna) contatoUpdates.pipeline_coluna_id = humanoColuna.id;
    } else if (isHibrido && ainda_precisa_humano === false) {
      const targetColuna = colunas?.find((c: any) => c.nome === pipeline_coluna_sugerida);
      if (targetColuna) contatoUpdates.pipeline_coluna_id = targetColuna.id;
    } else if (inboundCount >= 3 || pipeline_coluna_sugerida === "Novo Contato") {
      const targetColuna = colunas?.find((c: any) => c.nome === pipeline_coluna_sugerida);
      if (targetColuna) contatoUpdates.pipeline_coluna_id = targetColuna.id;
    }

    // 14. Route to setor if suggested
    if (setor_sugerido) {
      const matchedSetor = setores?.find((s: any) => s.nome.toLowerCase() === setor_sugerido.toLowerCase());
      if (matchedSetor) contatoUpdates.setor_destino = matchedSetor.id;
    }

    await supabase.from("contatos").update(contatoUpdates).eq("id", contatoIdToUpdate);

    // 15. Log CRM event (for classify_and_respond)
    if (intencao !== "receita_oftalmologica" && !precisa_humano) {
      const modoDesc = newModo === "hibrido"
        ? "Escalado para Consultor especializado (IA continua monitorando)."
        : newModo === "ia"
        ? "IA resolveu a pendência, Consultor especializado não é mais necessário."
        : `Movido para "${pipeline_coluna_sugerida}".`;

      await supabase.from("eventos_crm").insert({
        contato_id: contatoIdToUpdate,
        tipo: "triagem_ia",
        descricao: `IA classificou como "${intencao}". ${modoDesc}`,
        metadata: { intencao, precisa_humano, ainda_precisa_humano, pipeline_coluna_sugerida, setor_sugerido, modo: newModo || atendimento.modo },
        referencia_tipo: "atendimento",
        referencia_id: atendimento_id,
      });
    }

    return new Response(JSON.stringify({
      status: "ok",
      tools_used: functionCalls.map((f: any) => f.name),
      intencao,
      precisa_humano,
      ainda_precisa_humano,
      pipeline_coluna_sugerida,
      setor_sugerido,
      modo: newModo || atendimento.modo,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-triage error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
