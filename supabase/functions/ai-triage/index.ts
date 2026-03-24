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
    const { atendimento_id, mensagem_texto, contato_id } = await req.json();
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

    // 4. Load last 20 messages for context
    const { data: msgs } = await supabase
      .from("mensagens")
      .select("direcao, conteudo, remetente_nome, created_at")
      .eq("atendimento_id", atendimento_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const chatHistory = (msgs || []).map((m: any) => ({
      role: m.direcao === "inbound" ? "user" : "assistant",
      content: m.conteudo,
    }));

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

    // 6. Build instructions (single string for OpenAI Responses API)
    let instructions = `REGRAS DE ATENDIMENTO (PRIORIDADE MÁXIMA — SIGA RIGOROSAMENTE):\n\n${systemPrompt}\n\nREGRA DE TERMINOLOGIA (OBRIGATÓRIA): Ao se referir a atendimento por uma pessoa real, use SEMPRE e EXCLUSIVAMENTE o termo "Consultor especializado". NUNCA use "atendente", "operador", "humano", "agente" ou qualquer sinônimo. Sempre "Consultor especializado".`;

    instructions += `\n\nREGRA ANTI-REPETIÇÃO (OBRIGATÓRIA):\n- NUNCA repita endereço, horário, telefone, ou QUALQUER informação já presente nas mensagens anteriores.\n- Releia TODO o histórico ANTES de gerar a resposta.\n- Se o cliente perguntar algo já respondido, diga "Conforme mencionei anteriormente..." de forma BREVE.\n- Respostas devem ser CURTAS e DIRETAS.\n\nINFORMAÇÕES JÁ ENVIADAS NESTA CONVERSA (NÃO REPITA NADA DISTO):\n${alreadySentSummary}`;

    if (knowledgeBlock) {
      instructions += knowledgeBlock;
    }

    if (isHibrido) {
      instructions += `\n\nCONTEXTO MODO HÍBRIDO:\nUm Consultor especializado foi solicitado anteriormente mas ainda não assumiu a conversa. Você continua respondendo normalmente — trate qualquer assunto dentro do seu escopo com a mesma qualidade.\n\nCOMPORTAMENTO:\n- Se o cliente trouxer um assunto NOVO que você consegue resolver, responda naturalmente como se estivesse no modo normal.\n- Se o cliente insistir no assunto que gerou a solicitação do Consultor especializado, ou surgir algo fora do seu escopo, reforce que o Consultor especializado já foi acionado.\n- A cada resposta, REAVALIE se o cliente ainda precisa de um Consultor especializado considerando o histórico completo da conversa.\n- Se a questão original foi sanada ou o cliente mudou completamente de assunto para algo que você resolve, indique que não precisa mais do Consultor especializado (ainda_precisa_humano = false).`;
    }

    instructions += `\n\nINSTRUÇÕES DE CLASSIFICAÇÃO (uso interno, não mostrar ao cliente):\n- Você DEVE usar a ferramenta 'classify_and_respond' para responder.\n- Colunas disponíveis no pipeline: ${colunasNomes}\n- Setores internos disponíveis: ${setoresNomes || "nenhum cadastrado"}\n- Esta é a mensagem número ${inboundCount} do cliente nesta conversa.\n- Se é a 1ª ou 2ª mensagem, use pipeline_coluna_sugerida = "Novo Contato" (a menos que precise de Consultor especializado).\n- Só mova para colunas específicas após 3+ mensagens quando a intenção estiver clara.\n- Se precisa_humano = true, SEMPRE mova para "Atendimento Humano".\n- TERMINOLOGIA: em respostas ao cliente, SEMPRE diga "Consultor especializado". NUNCA "atendente", "operador", "humano" ou "agente".${isHibrido ? '\n- O atendimento está em MODO HÍBRIDO. Reavalie se ainda_precisa_humano é true ou false.' : ''}`;

    // 7. Build input (chat history + highlighted current message)
    const lastInboundIndex = chatHistory.length - 1 - [...chatHistory].reverse().findIndex(m => m.role === "user");
    const historyWithoutLast = lastInboundIndex >= 0 && lastInboundIndex < chatHistory.length
      ? chatHistory.filter((_: any, i: number) => i !== lastInboundIndex)
      : chatHistory;
    const currentMessage = lastInboundIndex >= 0 && lastInboundIndex < chatHistory.length
      ? chatHistory[lastInboundIndex].content
      : mensagem_texto || "";

    const input: any[] = [...historyWithoutLast];
    if (currentMessage) {
      input.push({
        role: "user",
        content: `MENSAGEM ATUAL DO CLIENTE (responda especificamente a esta mensagem):\n\n${currentMessage}`,
      });
    }

    // 8. Call OpenAI Responses API
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
        tools: [
          {
            type: "function",
            name: "classify_and_respond",
            description: "Classifica a intenção do cliente e gera a resposta",
            parameters: {
              type: "object",
              properties: {
                resposta: {
                  type: "string",
                  description: "Texto de resposta para enviar ao cliente via WhatsApp. REGRAS: 1) NUNCA repita dados já enviados. 2) Respostas CURTAS e DIRETAS. 3) Siga as regras de atendimento. 4) Use SEMPRE 'Consultor especializado' — NUNCA 'atendente', 'operador', 'humano' ou 'agente'.",
                },
                intencao: {
                  type: "string",
                  enum: ["orcamento", "status", "reclamacao", "parceria", "compras", "marketing", "agendamento", "informacoes", "outro"],
                  description: "Classificação da intenção do cliente",
                },
                precisa_humano: {
                  type: "boolean",
                  description: "true se a IA não consegue resolver e precisa de intervenção de um Consultor especializado",
                },
                ainda_precisa_humano: {
                  type: "boolean",
                  description: "Reavaliação contínua: o cliente AINDA precisa de um Consultor especializado? Considere o histórico completo. Se a questão original foi sanada ou o cliente mudou de assunto para algo dentro do seu escopo, retorne false. Se ainda há pendência que só um Consultor especializado pode resolver, retorne true.",
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
        ],
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

    // Parse Responses API output: find the function_call item
    const functionCall = aiData.output?.find((item: any) => item.type === "function_call");
    if (!functionCall) {
      console.error("OpenAI response:", JSON.stringify(aiData));
      throw new Error("OpenAI did not return a function_call in output");
    }

    const result = JSON.parse(functionCall.arguments);
    const { resposta, intencao, precisa_humano, ainda_precisa_humano, pipeline_coluna_sugerida, setor_sugerido } = result;

    console.log(`AI Triage (OpenAI): intencao=${intencao}, precisa_humano=${precisa_humano}, ainda_precisa=${ainda_precisa_humano}, coluna=${pipeline_coluna_sugerida}, setor=${setor_sugerido}, modo=${atendimento.modo}`);

    // 9. Send response via send-whatsapp
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
      const errBody = await sendRes.text();
      console.error("Failed to send WhatsApp response:", errBody);
    }

    // 10. Determine new modo based on hybrid logic
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
      await supabase
        .from("atendimentos")
        .update({ modo: newModo })
        .eq("id", atendimento_id);
    }

    // 11. Pipeline column movement
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

    // 12. Route to setor if suggested
    if (setor_sugerido) {
      const matchedSetor = setores?.find((s: any) => s.nome.toLowerCase() === setor_sugerido.toLowerCase());
      if (matchedSetor) {
        contatoUpdates.setor_destino = matchedSetor.id;
      }
    }

    const contatoIdToUpdate = contato_id || atendimento.contato_id;
    await supabase
      .from("contatos")
      .update(contatoUpdates)
      .eq("id", contatoIdToUpdate);

    // 13. Log CRM event
    const modoDesc = newModo === "hibrido"
      ? "Escalado para Consultor especializado (IA continua monitorando)."
      : newModo === "ia"
      ? "IA resolveu a pendência, Consultor especializado não é mais necessário."
      : precisa_humano
      ? "Encaminhado para Consultor especializado."
      : `Movido para "${pipeline_coluna_sugerida}".`;

    await supabase.from("eventos_crm").insert({
      contato_id: contatoIdToUpdate,
      tipo: "triagem_ia",
      descricao: `IA classificou como "${intencao}". ${modoDesc}`,
      metadata: { intencao, precisa_humano, ainda_precisa_humano, pipeline_coluna_sugerida, setor_sugerido, modo: newModo || atendimento.modo },
      referencia_tipo: "atendimento",
      referencia_id: atendimento_id,
    });

    return new Response(JSON.stringify({
      status: "ok",
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
