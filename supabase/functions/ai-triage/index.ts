import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── ESCALATION KEYWORDS (hard-coded safety net) ──
const ESCALATION_KEYWORDS = [
  "falar com consultor", "falar com atendente", "falar com humano",
  "falar com pessoa", "atendente humano", "quero um consultor",
  "quero falar com alguem", "quero falar com alguém", "pessoa real",
  "atendimento humano", "falar com gente", "preciso de ajuda humana",
  "nao quero robo", "não quero robô", "me transfira",
  "transferir para atendente", "quero atendente", "consultor especializado",
];

function normalizeText(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function matchesEscalation(msg: string): boolean {
  const norm = normalizeText(msg);
  return ESCALATION_KEYWORDS.some((kw) => norm.includes(normalizeText(kw)));
}

// ── TOOLS (minimal, clean descriptions) ──
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "responder",
      description:
        "Responde ao cliente com texto e classifica a intenção. NÃO use se o cliente pedir para falar com uma pessoa.",
      parameters: {
        type: "object",
        properties: {
          resposta: {
            type: "string",
            description: "Texto curto e direto para o cliente. Máximo 3 frases.",
          },
          intencao: {
            type: "string",
            enum: [
              "orcamento", "status", "reclamacao", "parceria", "compras",
              "marketing", "agendamento", "informacoes", "receita_oftalmologica", "outro",
            ],
          },
          coluna_pipeline: {
            type: "string",
            description: "Coluna do pipeline para mover o contato.",
          },
          setor: {
            type: "string",
            description: "Setor interno, se aplicável.",
          },
        },
        required: ["resposta", "intencao", "coluna_pipeline"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalar_consultor",
      description:
        "Transfere para Consultor especializado. Use quando: o cliente pede pessoa real, a IA não sabe responder, ou há frustração.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Razão do escalonamento." },
          resposta: {
            type: "string",
            description: "Mensagem informando o cliente que um Consultor foi acionado.",
          },
          setor: { type: "string", description: "Setor se identificável." },
        },
        required: ["motivo", "resposta"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "interpretar_receita",
      description:
        "Extrai dados de foto de receita oftalmológica enviada pelo cliente.",
      parameters: {
        type: "object",
        properties: {
          olho_direito: {
            type: "object",
            properties: {
              esferico: { type: "string" },
              cilindrico: { type: "string" },
              eixo: { type: "string" },
              adicao: { type: "string" },
            },
            required: ["esferico"],
            additionalProperties: false,
          },
          olho_esquerdo: {
            type: "object",
            properties: {
              esferico: { type: "string" },
              cilindrico: { type: "string" },
              eixo: { type: "string" },
              adicao: { type: "string" },
            },
            required: ["esferico"],
            additionalProperties: false,
          },
          tipo_lente: {
            type: "string",
            enum: ["visao_simples", "bifocal", "multifocal", "progressiva"],
          },
          observacoes: { type: "string" },
          resposta: {
            type: "string",
            description: "Mensagem confirmando dados extraídos e próximos passos.",
          },
        },
        required: ["olho_direito", "olho_esquerdo", "tipo_lente", "resposta"],
        additionalProperties: false,
      },
    },
  },
];

// ── BUILD SYSTEM PROMPT ──
function buildSystemPrompt(opts: {
  businessRules: string;
  knowledge: string;
  examples: string;
  antiExamples: string;
  sentTopics: string[];
  colunasNomes: string;
  setoresNomes: string;
  inboundCount: number;
  isHibrido: boolean;
  hasKnowledge: boolean;
}): string {
  const sections: string[] = [];

  // SECTION 1: Identity + business rules (TOP PRIORITY)
  sections.push(`# IDENTIDADE
Você é o Assistente Virtual da Óticas Diniz. Seu objetivo é atender clientes pelo WhatsApp de forma rápida, precisa e humana.

# REGRAS DE ATENDIMENTO
${opts.businessRules}

# TERMINOLOGIA OBRIGATÓRIA
- Para se referir a uma pessoa real, diga SEMPRE "Consultor especializado". NUNCA "atendente", "operador", "humano".`);

  // SECTION 2: Anti-hallucination
  sections.push(`# REGRAS DE PRECISÃO
1. NUNCA invente informações. Se não sabe, diga que vai encaminhar para um Consultor especializado.
2. NUNCA invente preços, endereços, horários ou dados que não estejam abaixo.
3. Responda SOMENTE com base nas informações fornecidas neste contexto.
4. Respostas CURTAS: máximo 3 frases. Sem repetir saudações.`);

  // SECTION 3: Anti-repetition (structured)
  if (opts.sentTopics.length > 0) {
    sections.push(`# INFORMAÇÕES JÁ ENVIADAS (NÃO REPITA)
${opts.sentTopics.map((t) => `- ${t}`).join("\n")}

Se o cliente perguntar algo já informado acima, diga brevemente "Conforme mencionei" sem repetir os dados.`);
  }

  // SECTION 4: Knowledge base
  if (opts.knowledge) {
    sections.push(`# BASE DE CONHECIMENTO\n${opts.knowledge}`);
  }

  // SECTION 5: Fallback for empty KB
  if (!opts.hasKnowledge) {
    sections.push(`# FALLBACK (SEM BASE DE CONHECIMENTO DETALHADA)
- Para perguntas sobre produtos, use os valores das REGRAS DE ATENDIMENTO acima.
- Sugira que o cliente envie foto da receita para orçamento personalizado.
- NUNCA responda pergunta sobre produtos com endereço de loja.`);
  }

  // SECTION 6: Few-shot examples
  if (opts.examples) {
    sections.push(`# EXEMPLOS DE REFERÊNCIA\n${opts.examples}`);
  }
  if (opts.antiExamples) {
    sections.push(`# ERROS A EVITAR\n${opts.antiExamples}`);
  }

  // SECTION 7: Pipeline routing
  sections.push(`# CLASSIFICAÇÃO (uso interno)
Colunas disponíveis: ${opts.colunasNomes}
Setores: ${opts.setoresNomes || "nenhum"}
Mensagem nº ${opts.inboundCount} do cliente.
${opts.inboundCount < 3 ? 'Use coluna "Novo Contato" até 3ª mensagem (exceto escalonamento).' : "Mova para a coluna mais adequada à intenção."}`);

  // SECTION 8: Hybrid mode
  if (opts.isHibrido) {
    sections.push(`# MODO HÍBRIDO ATIVO
Consultor já foi solicitado mas ainda não respondeu. Continue atendendo normalmente.
Se resolver a dúvida do cliente, informe que não precisa mais do Consultor.`);
  }

  return sections.join("\n\n");
}

// ── EXTRACT ALREADY-SENT TOPICS ──
function extractSentTopics(outboundTexts: string[]): string[] {
  const all = outboundTexts.join(" ").toLowerCase();
  const topics: string[] = [];
  const checks: [RegExp, string][] = [
    [/endere[çc]o|rua |av\.|avenida/i, "Endereço de loja"],
    [/hor[áa]rio|funciona|abre|fecha/i, "Horário de funcionamento"],
    [/telefone|\(\d{2}\)|\d{4,5}-\d{4}/i, "Telefone"],
    [/agend|visita|marcar/i, "Agendamento"],
    [/pre[çc]o|valor|r\$|or[çc]amento/i, "Preço/orçamento"],
    [/lente|[óo]culos|arma[çc]/i, "Produtos ópticos"],
    [/consultor|especializado/i, "Consultor acionado"],
    [/receita/i, "Receita mencionada"],
  ];
  for (const [re, label] of checks) {
    if (re.test(all)) topics.push(label);
  }
  return topics;
}

// ── MAIN ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { atendimento_id, mensagem_texto, contato_id, media } = await req.json();
    if (!atendimento_id) throw new Error("atendimento_id is required");

    // ── 1. LOAD ATENDIMENTO ──
    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, canal_provedor, modo")
      .eq("id", atendimento_id)
      .single();
    if (atErr || !atendimento) throw new Error("Atendimento not found");

    if (atendimento.modo === "humano") {
      return new Response(
        JSON.stringify({ status: "skipped", reason: "modo humano" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isHibrido = atendimento.modo === "hibrido";
    const contatoId = contato_id || atendimento.contato_id;

    // ── 2. LOAD ALL DATA IN PARALLEL ──
    const [promptRes, kbRes, exRes, antiRes, msgsRes, colRes, setRes] = await Promise.all([
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_atendimento").single(),
      supabase.from("conhecimento_ia").select("categoria, titulo, conteudo").eq("ativo", true),
      supabase.from("ia_exemplos").select("categoria, pergunta, resposta_ideal").eq("ativo", true).limit(10),
      supabase.from("ia_feedbacks").select("motivo, resposta_corrigida").eq("avaliacao", "negativo").order("created_at", { ascending: false }).limit(3),
      supabase.from("mensagens").select("direcao, conteudo, remetente_nome, created_at, tipo_conteudo, metadata").eq("atendimento_id", atendimento_id).order("created_at", { ascending: true }).limit(30),
      supabase.from("pipeline_colunas").select("id, nome").eq("ativo", true).order("ordem"),
      supabase.from("setores").select("id, nome").eq("ativo", true),
    ]);

    const businessRules = promptRes.data?.valor || "Você é um assistente de atendimento.";
    const conhecimentos = kbRes.data || [];
    const exemplos = exRes.data || [];
    const antiFeedbacks = antiRes.data || [];
    const msgs = msgsRes.data || [];
    const colunas = colRes.data || [];
    const setores = setRes.data || [];

    const inboundCount = msgs.filter((m: any) => m.direcao === "inbound").length;
    const outboundTexts = msgs.filter((m: any) => m.direcao === "outbound").map((m: any) => m.conteudo);

    // ── 3. KEYWORD ESCALATION BYPASS ──
    const currentMsg = mensagem_texto || "";
    if (matchesEscalation(currentMsg)) {
      console.log("KEYWORD ESCALATION BYPASS");
      return await handleEscalation(
        supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
        atendimento_id, contatoId, currentMsg, colunas, isHibrido, "keyword"
      );
    }

    // ── 4. BUILD CONTEXT ──
    const sentTopics = extractSentTopics(outboundTexts);

    // Knowledge block
    let knowledgeStr = "";
    if (conhecimentos.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const k of conhecimentos) {
        const cat = (k.categoria || "geral").toUpperCase();
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(`**${k.titulo}**: ${JSON.stringify(k.conteudo)}`);
      }
      knowledgeStr = Object.entries(grouped)
        .map(([cat, items]) => `## ${cat}\n${items.join("\n")}`)
        .join("\n\n");
    }

    // Examples block
    let examplesStr = "";
    if (exemplos.length > 0) {
      examplesStr = exemplos
        .map((e: any) => `[${e.categoria}] P: "${e.pergunta}" → R: "${e.resposta_ideal}"`)
        .join("\n");
    }

    // Anti-examples block
    let antiStr = "";
    if (antiFeedbacks.length > 0) {
      antiStr = antiFeedbacks
        .filter((f: any) => f.motivo)
        .map((f: any) => `- ${f.motivo}${f.resposta_corrigida ? ` → Correto: ${f.resposta_corrigida}` : ""}`)
        .join("\n");
    }

    const systemPrompt = buildSystemPrompt({
      businessRules,
      knowledge: knowledgeStr,
      examples: examplesStr,
      antiExamples: antiStr,
      sentTopics,
      colunasNomes: colunas.map((c: any) => c.nome).join(", "),
      setoresNomes: setores.map((s: any) => s.nome).join(", "),
      inboundCount,
      isHibrido,
      hasKnowledge: conhecimentos.length > 0,
    });

    console.log(
      `Prompt: ${systemPrompt.length} chars | KB: ${conhecimentos.length} | Exemplos: ${exemplos.length} | Anti: ${antiFeedbacks.length} | Modo: ${atendimento.modo} | Msgs: ${msgs.length} | Topics sent: ${sentTopics.join(", ") || "none"}`
    );

    // ── 5. BUILD MESSAGES (Chat Completions format) ──
    const messages: any[] = [{ role: "system", content: systemPrompt }];

    // Add conversation history (last 20 messages)
    const recentMsgs = msgs.slice(-20);
    for (const m of recentMsgs) {
      const role = m.direcao === "inbound" ? "user" : "assistant";
      if (m.direcao === "internal") continue; // skip internal notes

      const mediaUrl = (m.metadata as any)?.media_url;
      const tipo = (m as any).tipo_conteudo || "text";

      if (tipo === "image" && mediaUrl && role === "user") {
        const content: any[] = [
          { type: "image_url", image_url: { url: mediaUrl, detail: "high" } },
        ];
        if (m.conteudo && m.conteudo !== "[image]") {
          content.push({ type: "text", text: m.conteudo });
        }
        messages.push({ role, content });
      } else {
        // For assistant messages, prefix with name to track
        const prefix = role === "assistant" && m.remetente_nome === "Operador" ? "[Operador] " : "";
        messages.push({ role, content: prefix + m.conteudo });
      }
    }

    // ── 6. CALL OPENAI CHAT COMPLETIONS API ──
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0,
        max_tokens: 500,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`OpenAI error [${aiResponse.status}]:`, errText);
      if (aiResponse.status === 429 || aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: `OpenAI ${aiResponse.status}` }), {
          status: aiResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`OpenAI ${aiResponse.status}: ${errText}`);
    }

    const aiData = await aiResponse.json();
    const choice = aiData.choices?.[0];

    if (!choice) throw new Error("No choice returned from OpenAI");

    // ── 7. PROCESS RESPONSE ──
    let resposta = "";
    let intencao = "outro";
    let precisa_humano = false;
    let pipeline_coluna = "Novo Contato";
    let setor_sugerido = "";

    const toolCalls = choice.message?.tool_calls || [];

    if (toolCalls.length === 0) {
      // Model responded with plain text (no tool call) — use it as response
      resposta = choice.message?.content || "";
      console.log("AI responded without tool call (plain text)");
    }

    for (const tc of toolCalls) {
      const fn = tc.function?.name;
      const args = JSON.parse(tc.function?.arguments || "{}");
      console.log(`Tool: ${fn}`, JSON.stringify(args).substring(0, 200));

      if (fn === "responder") {
        resposta = args.resposta;
        intencao = args.intencao || "outro";
        pipeline_coluna = args.coluna_pipeline || "Novo Contato";
        setor_sugerido = args.setor || "";

      } else if (fn === "escalar_consultor") {
        resposta = args.resposta;
        precisa_humano = true;
        pipeline_coluna = "Atendimento Humano";
        setor_sugerido = args.setor || "";

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "escalonamento_humano",
          descricao: `IA escalou: ${args.motivo}`,
          metadata: { motivo: args.motivo, setor: args.setor },
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });

      } else if (fn === "interpretar_receita") {
        resposta = args.resposta;
        intencao = "receita_oftalmologica";
        pipeline_coluna = inboundCount >= 3 ? "Orçamento" : "Novo Contato";

        await supabase.from("contatos").update({
          metadata: {
            ultima_receita: {
              olho_direito: args.olho_direito,
              olho_esquerdo: args.olho_esquerdo,
              tipo_lente: args.tipo_lente,
              observacoes: args.observacoes,
              data_leitura: new Date().toISOString(),
            },
          },
        }).eq("id", contatoId);

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "receita_interpretada",
          descricao: `Receita: OD ${args.olho_direito.esferico} OE ${args.olho_esquerdo.esferico} — ${args.tipo_lente}`,
          metadata: args,
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });
      }
    }

    // ── 8. SEND RESPONSE ──
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
      if (!sendRes.ok) console.error("WhatsApp send error:", await sendRes.text());
    }

    // ── 9. UPDATE MODO + PIPELINE ──
    let newModo: string | null = null;
    if (precisa_humano && !isHibrido) {
      newModo = "hibrido";
      console.log("IA → Híbrido");
    }

    if (newModo) {
      await supabase.from("atendimentos").update({ modo: newModo }).eq("id", atendimento_id);
    }

    // Pipeline column
    const contatoUpdates: any = { ultimo_contato_at: new Date().toISOString() };

    if (precisa_humano) {
      const col = colunas.find((c: any) => c.nome === "Atendimento Humano");
      if (col) contatoUpdates.pipeline_coluna_id = col.id;
    } else if (inboundCount >= 3 || pipeline_coluna === "Novo Contato") {
      const col = colunas.find((c: any) => c.nome === pipeline_coluna);
      if (col) contatoUpdates.pipeline_coluna_id = col.id;
    }

    if (setor_sugerido) {
      const s = setores.find((s: any) => s.nome.toLowerCase() === setor_sugerido.toLowerCase());
      if (s) contatoUpdates.setor_destino = s.id;
    }

    await supabase.from("contatos").update(contatoUpdates).eq("id", contatoId);

    // CRM event
    if (!precisa_humano) {
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "triagem_ia",
        descricao: `IA: "${intencao}" → ${pipeline_coluna}`,
        metadata: { intencao, pipeline_coluna, setor_sugerido, modo: newModo || atendimento.modo },
        referencia_tipo: "atendimento",
        referencia_id: atendimento_id,
      });
    }

    console.log(`Result: tool=${toolCalls.map((t: any) => t.function?.name).join(",") || "text"} | intencao=${intencao} | humano=${precisa_humano} | coluna=${pipeline_coluna}`);

    return new Response(JSON.stringify({
      status: "ok",
      tools_used: toolCalls.map((t: any) => t.function?.name) || ["text"],
      intencao,
      precisa_humano,
      pipeline_coluna_sugerida: pipeline_coluna,
      setor_sugerido,
      modo: newModo || atendimento.modo,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ai-triage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── ESCALATION HANDLER (reused by keyword bypass and tool call) ──
async function handleEscalation(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
  contatoId: string,
  mensagem: string,
  colunas: any[],
  isHibrido: boolean,
  trigger: string
) {
  const resposta =
    "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve. Enquanto isso, se tiver alguma dúvida rápida, estou à disposição! 😊";

  // Send response
  await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      atendimento_id: atendimentoId,
      texto: resposta,
      remetente_nome: "Assistente IA",
    }),
  });

  // Update to hibrido
  if (!isHibrido) {
    await supabase.from("atendimentos").update({ modo: "hibrido" }).eq("id", atendimentoId);
  }

  // Move to Atendimento Humano
  const col = colunas.find((c: any) => c.nome === "Atendimento Humano");
  const updates: any = { ultimo_contato_at: new Date().toISOString() };
  if (col) updates.pipeline_coluna_id = col.id;
  await supabase.from("contatos").update(updates).eq("id", contatoId);

  // Log
  await supabase.from("eventos_crm").insert({
    contato_id: contatoId,
    tipo: "escalonamento_humano",
    descricao: `Escalonamento (${trigger}): cliente pediu Consultor`,
    metadata: { trigger, mensagem },
    referencia_tipo: "atendimento",
    referencia_id: atendimentoId,
  });

  return new Response(JSON.stringify({
    status: "ok",
    tools_used: [`escalar_consultor_${trigger}`],
    intencao: "escalonamento",
    precisa_humano: true,
    pipeline_coluna_sugerida: "Atendimento Humano",
    setor_sugerido: "",
    modo: "hibrido",
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
