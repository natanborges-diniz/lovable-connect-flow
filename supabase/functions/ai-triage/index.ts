import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// PHASE 2 — PRE-LLM DETERMINISTIC ROUTER
// ═══════════════════════════════════════════

const ESCALATION_KEYWORDS = [
  "falar com consultor", "falar com atendente", "falar com humano",
  "falar com pessoa", "atendente humano", "quero um consultor",
  "quero falar com alguem", "quero falar com alguém", "pessoa real",
  "atendimento humano", "falar com gente", "preciso de ajuda humana",
  "nao quero robo", "não quero robô", "me transfira",
  "transferir para atendente", "quero atendente", "consultor especializado",
];

const SUBJECT_CHANGE_KEYWORDS = [
  "outro assunto", "outra coisa", "mudar de assunto", "trocar de assunto",
  "falar de outra coisa", "quero falar sobre", "vamos falar de",
  "muda o assunto", "assunto diferente",
];

function norm(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function matchesEscalation(msg: string): boolean {
  const n = norm(msg);
  return ESCALATION_KEYWORDS.some((kw) => n.includes(norm(kw)));
}

function matchesSubjectChange(msg: string): boolean {
  const n = norm(msg);
  return SUBJECT_CHANGE_KEYWORDS.some((kw) => n.includes(norm(kw)));
}

function deterministicIntentFallback(msg: string, inboundCount: number, isHibrido: boolean): {
  resposta: string;
  intencao: string;
  pipeline_coluna: string;
  precisa_humano: boolean;
} {
  const n = norm(msg);

  if (/lente|oculos|óculos|arma[çc]|comprar|or[çc]amento|pre[çc]o|valor/.test(n)) {
    return {
      resposta:
        "Boa! Me manda uma foto da sua receita que eu já te passo os valores certinhos. Se ainda não tem receita, posso te orientar também 😉",
      intencao: "orcamento",
      pipeline_coluna: inboundCount >= 3 ? "Orçamento" : "Novo Contato",
      precisa_humano: false,
    };
  }

  if (/status|pedido|entrega|retirada|retirar|pronto/.test(n)) {
    return {
      resposta: "Vou verificar pra você! Me passa seu nome completo ou o número da OS que eu consulto aqui rapidinho.",
      intencao: "status",
      pipeline_coluna: "Acompanhamento",
      precisa_humano: false,
    };
  }

  if (/pagamento|financeiro|boleto|pix|cart[aã]o|parcel/.test(n)) {
    return {
      resposta: "Tranquilo! Me explica melhor o que precisa no financeiro — é sobre parcelamento, segunda via de boleto ou outra coisa?",
      intencao: "outro",
      pipeline_coluna: "Financeiro",
      precisa_humano: false,
    };
  }

  if (/^oi\b|^ol[aá]\b|bom dia|boa tarde|boa noite/.test(n)) {
    return {
      resposta: "Oi! Tudo bem? Me conta no que posso te ajudar 😊",
      intencao: "outro",
      pipeline_coluna: "Novo Contato",
      precisa_humano: false,
    };
  }

  if (isHibrido) {
    return {
      resposta: "Opa, me conta o que precisa que eu te ajudo agora mesmo!",
      intencao: "outro",
      pipeline_coluna: "Novo Contato",
      precisa_humano: false,
    };
  }

  return {
    resposta: "Me conta o que tá precisando que eu resolvo pra você!",
    intencao: "outro",
    pipeline_coluna: "Novo Contato",
    precisa_humano: false,
  };
}

// ═══════════════════════════════════════════
// PHASE 3 — POST-LLM VALIDATOR (GUARDRAILS)
// ═══════════════════════════════════════════

const BLACKLIST_PHRASES = [
  "se precisar", "estou por aqui", "estou à disposição",
  "se tiver alguma dúvida", "qualquer dúvida", "me avise",
  "posso ajudar em algo mais", "é só me chamar",
  "a gente se fala", "fico à disposição",
  "precisar de mais informações",
];

function validateResponse(resposta: string, recentOutbound: string[]): { valid: boolean; reason: string } {
  const rNorm = norm(resposta);

  // Check blacklist
  for (const phrase of BLACKLIST_PHRASES) {
    if (rNorm.includes(norm(phrase))) {
      return { valid: false, reason: `blacklist: "${phrase}"` };
    }
  }

  // Check similarity to last 3 outbound messages
  for (const prev of recentOutbound.slice(-3)) {
    const similarity = computeSimilarity(rNorm, norm(prev));
    if (similarity > 0.7) {
      return { valid: false, reason: `similarity ${(similarity * 100).toFixed(0)}% with recent message` };
    }
  }

  // Must contain a question OR a concrete action (not just a statement)
  const hasQuestion = resposta.includes("?");
  const hasAction = /envie|enviar|agende|agendar|acesse|clique|ligue|visite|orçamento|receita|foto/i.test(resposta);
  if (!hasQuestion && !hasAction && resposta.length < 100) {
    return { valid: false, reason: "no question or action — stalls conversation" };
  }

  return { valid: true, reason: "" };
}

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// ═══════════════════════════════════════════
// TOOLS — with strict contract (proximo_passo required)
// ═══════════════════════════════════════════

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "responder",
      description:
        "Responde ao cliente. NÃO use se o cliente pedir pessoa/consultor. OBRIGATÓRIO: proximo_passo com pergunta ou ação concreta.",
      parameters: {
        type: "object",
        properties: {
          resposta: {
            type: "string",
            description: "Texto para o cliente. Máximo 3 frases. DEVE conter uma pergunta ou oferta de ação.",
          },
          proximo_passo: {
            type: "string",
            description: "Pergunta objetiva ou ação concreta para avançar a conversa. Ex: 'Qual o grau da sua receita?' ou 'Posso gerar um orçamento?'",
          },
          intencao: {
            type: "string",
            enum: ["orcamento", "status", "reclamacao", "parceria", "compras", "marketing", "agendamento", "informacoes", "receita_oftalmologica", "outro"],
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
        required: ["resposta", "proximo_passo", "intencao", "coluna_pipeline"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalar_consultor",
      description:
        "Transfere para Consultor especializado. Use quando: cliente pede pessoa real, IA não sabe responder, frustração detectada.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Razão do escalonamento." },
          resposta: { type: "string", description: "Mensagem informando que um Consultor foi acionado." },
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
      description: "Extrai dados de foto de receita oftalmológica enviada pelo cliente.",
      parameters: {
        type: "object",
        properties: {
          olho_direito: {
            type: "object",
            properties: {
              esferico: { type: "string" }, cilindrico: { type: "string" },
              eixo: { type: "string" }, adicao: { type: "string" },
            },
            required: ["esferico"], additionalProperties: false,
          },
          olho_esquerdo: {
            type: "object",
            properties: {
              esferico: { type: "string" }, cilindrico: { type: "string" },
              eixo: { type: "string" }, adicao: { type: "string" },
            },
            required: ["esferico"], additionalProperties: false,
          },
          tipo_lente: { type: "string", enum: ["visao_simples", "bifocal", "multifocal", "progressiva"] },
          observacoes: { type: "string" },
          resposta: { type: "string", description: "Mensagem confirmando dados extraídos e próximos passos." },
        },
        required: ["olho_direito", "olho_esquerdo", "tipo_lente", "resposta"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "agendar_visita",
      description: "Agenda uma visita do cliente a uma loja. Use quando o cliente quer visitar uma loja e já definiu loja, data e horário.",
      parameters: {
        type: "object",
        properties: {
          loja_nome: { type: "string", description: "Nome da loja escolhida." },
          data_horario: { type: "string", description: "Data e hora no formato ISO 8601 (ex: 2026-03-25T14:00:00-03:00)." },
          observacoes: { type: "string", description: "Observações adicionais sobre a visita." },
          resposta: { type: "string", description: "Mensagem confirmando o agendamento ao cliente." },
        },
        required: ["loja_nome", "data_horario", "resposta"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reagendar_visita",
      description: "Reagenda uma visita de um cliente que teve no-show. Use quando o cliente deseja remarcar após não ter comparecido.",
      parameters: {
        type: "object",
        properties: {
          loja_nome: { type: "string", description: "Nome da loja para o novo agendamento." },
          data_horario: { type: "string", description: "Nova data e hora ISO 8601." },
          observacoes: { type: "string" },
          resposta: { type: "string", description: "Mensagem confirmando o reagendamento." },
        },
        required: ["loja_nome", "data_horario", "resposta"],
        additionalProperties: false,
      },
    },
  },
];

// ═══════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ═══════════════════════════════════════════

function buildSystemPrompt(opts: {
  businessRules: string;
  knowledge: string;
  examples: string;
  antiExamples: string;
  regrasProibidas: { regra: string; categoria: string }[];
  sentTopics: string[];
  colunasNomes: string;
  setoresNomes: string;
  inboundCount: number;
  isHibrido: boolean;
  hasKnowledge: boolean;
}): string {
  const s: string[] = [];

  s.push(`# IDENTIDADE
Você é o Assistente Virtual da Óticas Diniz. Atendimento rápido, preciso e humano via WhatsApp.

# REGRAS DE ATENDIMENTO
${opts.businessRules}

# TERMINOLOGIA
- Pessoa real = "Consultor especializado". NUNCA "atendente", "operador", "humano".`);

  // Inject prohibited rules FIRST — maximum weight
  if (opts.regrasProibidas.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const r of opts.regrasProibidas) {
      const cat = r.categoria || "geral";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r.regra);
    }
    let block = "# ⛔ PROIBIÇÕES ABSOLUTAS — VIOLAR = FALHA CRÍTICA\nAs regras abaixo são INVIOLÁVEIS. Quebrá-las é um erro gravíssimo.\n";
    for (const [cat, rules] of Object.entries(grouped)) {
      block += `\n## ${cat.toUpperCase()}\n`;
      for (const rule of rules) {
        block += `- ❌ ${rule}\n`;
      }
    }
    s.push(block);
  }

  s.push(`# REGRAS DE PRECISÃO
1. NUNCA invente dados. Sem dados → escale para Consultor.
2. NUNCA invente preços, endereços, horários fora do contexto.
3. Máximo 3 frases por resposta.
4. SEMPRE termine com pergunta objetiva OU oferta de ação concreta.
5. Se o cliente mudar de assunto, SIGA imediatamente o novo tema.
6. NUNCA repita informação já dada.

# PROIBIDO (NUNCA USE)
- "Se precisar estou por aqui"
- "Estou à disposição"
- "Se tiver dúvidas me avise"
- "Entendi! Se precisar de mais informações..."
- "Qualquer dúvida é só me chamar"
- Qualquer frase genérica de encerramento
→ Em vez disso: PERGUNTE algo relevante ou ofereça ação nova.`);

  if (opts.sentTopics.length > 0) {
    // Only recent topics (from last ~10 outbound), not global
    s.push(`# TÓPICOS JÁ COBERTOS (NÃO REPITA)
${opts.sentTopics.map((t) => `- ❌ ${t}`).join("\n")}
Se cliente perguntar algo já coberto: "Como já mencionei..." + mude para assunto novo.`);
  }

  if (opts.knowledge) {
    s.push(`# BASE DE CONHECIMENTO\n${opts.knowledge}`);
  }

  if (!opts.hasKnowledge) {
    s.push(`# MODO RESTRITO (BASE VAZIA)
Sem dados detalhados de produtos. Use APENAS valores das REGRAS DE ATENDIMENTO.
Sugira envio de foto da receita. NUNCA responda sobre produtos com endereço de loja.
Se não souber responder: "Vou encaminhar para um Consultor especializado que pode detalhar isso."
→ Use escalar_consultor se o tema exigir informações que você não tem.`);
  }

  if (opts.examples) s.push(`# EXEMPLOS CORRETOS\n${opts.examples}`);
  if (opts.antiExamples) s.push(`# ERROS A EVITAR\n${opts.antiExamples}`);

  s.push(`# CLASSIFICAÇÃO
Colunas: ${opts.colunasNomes}
Setores: ${opts.setoresNomes || "nenhum"}
Mensagem nº ${opts.inboundCount}.
${opts.inboundCount < 3 ? 'Use "Novo Contato" até 3ª msg (exceto escalonamento).' : "Mova para coluna adequada."}`);

  if (opts.isHibrido) {
    s.push(`# MODO HÍBRIDO
Consultor solicitado mas não respondeu. Continue atendendo.
Para mensagens vagas: faça pergunta objetiva ("Sobre qual tema: orçamento, lentes, pedidos, financeiro?").
NUNCA responda com CTA genérico de visita.`);
  }

  return s.join("\n\n");
}

// ═══════════════════════════════════════════
// PHASE 1 — CONTEXT ENGINE (recent window)
// ═══════════════════════════════════════════

function extractSentTopics(outboundTexts: string[]): string[] {
  // Only check recent outbound (last 10), not entire history
  const recent = outboundTexts.slice(-10);
  const all = recent.join(" ").toLowerCase();
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

// Deterministic fallback responses
const DETERMINISTIC_FALLBACKS: Record<string, string> = {
  subject_change: "Sem problemas! Me diz sobre o que quer falar agora que eu te ajudo 😊",
  validator_failed: "Conta pra mim com mais detalhes o que você precisa que eu te dou um retorno certeiro!",
  no_response: "Opa, me conta o que tá precisando!",
};

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
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
      .select("id, contato_id, canal, canal_provedor, modo, metadata")
      .eq("id", atendimento_id)
      .single();
    if (atErr || !atendimento) throw new Error("Atendimento not found");

    if (atendimento.modo === "humano") {
      return jsonResponse({ status: "skipped", reason: "modo humano" });
    }

    // ── 1.5. DEBOUNCE — prevent parallel processing for rapid messages ──
    const meta = (atendimento.metadata as Record<string, any>) || {};
    const iaLock = meta.ia_lock ? new Date(meta.ia_lock).getTime() : 0;
    const now = Date.now();
    const LOCK_TTL_MS = 15_000; // 15 second lock
    const DEBOUNCE_WAIT_MS = 3_000; // wait 3 seconds for more messages

    if (iaLock && (now - iaLock) < LOCK_TTL_MS) {
      // Another instance is processing — wait then check if it handled our message
      console.log(`[DEBOUNCE] Lock active (${Math.round((now - iaLock) / 1000)}s ago), waiting ${DEBOUNCE_WAIT_MS}ms...`);
      await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));

      // Check if an outbound message was sent after our inbound arrived
      const { data: recentOut } = await supabase
        .from("mensagens")
        .select("id")
        .eq("atendimento_id", atendimento_id)
        .eq("direcao", "outbound")
        .gte("created_at", new Date(now - DEBOUNCE_WAIT_MS).toISOString())
        .limit(1);

      if (recentOut?.length) {
        console.log("[DEBOUNCE] Another instance already responded, skipping");
        return jsonResponse({ status: "skipped", reason: "debounce — already handled" });
      }
      // If no outbound yet, proceed (the other instance may have failed)
      console.log("[DEBOUNCE] No response found, proceeding as fallback");
    }

    // Set lock
    await supabase.from("atendimentos").update({
      metadata: { ...meta, ia_lock: new Date().toISOString() },
    }).eq("id", atendimento_id);

    const isHibrido = atendimento.modo === "hibrido";
    const contatoId = contato_id || atendimento.contato_id;
    const currentMsg = mensagem_texto || "";

    // ── 2. PRE-LLM ROUTER: keyword escalation ──
    if (matchesEscalation(currentMsg)) {
      console.log("[ROUTER] Escalation keyword detected");
      return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, currentMsg, "keyword");
    }

    // ── 3. PRE-LLM ROUTER: subject change → deterministic ──
    if (matchesSubjectChange(currentMsg)) {
      console.log("[ROUTER] Subject change detected — deterministic response");
      await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, DETERMINISTIC_FALLBACKS.subject_change);
      await logEvent(supabase, contatoId, atendimento_id, "router_subject_change", currentMsg);
      return jsonResponse({ status: "ok", tools_used: ["router_subject_change"], intencao: "outro", precisa_humano: false, pipeline_coluna_sugerida: "Novo Contato", modo: atendimento.modo });
    }

    // ── 4. LOAD ALL DATA IN PARALLEL ──
    const [promptRes, kbRes, exRes, antiRes, regrasRes, msgsRes, colRes, setRes, lojasRes, agendRes] = await Promise.all([
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_atendimento").single(),
      supabase.from("conhecimento_ia").select("categoria, titulo, conteudo").eq("ativo", true),
      supabase.from("ia_exemplos").select("categoria, pergunta, resposta_ideal").eq("ativo", true).limit(30),
      supabase.from("ia_feedbacks").select("motivo, resposta_corrigida").eq("avaliacao", "negativo").order("created_at", { ascending: false }).limit(10),
      supabase.from("ia_regras_proibidas").select("regra, categoria").eq("ativo", true),
      supabase.from("mensagens").select("direcao, conteudo, remetente_nome, created_at, tipo_conteudo, metadata")
        .eq("atendimento_id", atendimento_id)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("pipeline_colunas").select("id, nome").eq("ativo", true).order("ordem"),
      supabase.from("setores").select("id, nome").eq("ativo", true),
      supabase.from("telefones_lojas").select("nome_loja, telefone, endereco, horario_abertura, horario_fechamento, departamento").eq("ativo", true),
      supabase.from("agendamentos").select("id, loja_nome, data_horario, status, observacoes").eq("contato_id", contatoId).in("status", ["agendado", "confirmado", "no_show", "recuperacao"]).order("data_horario", { ascending: false }).limit(5),
    ]);

    const businessRules = promptRes.data?.valor || "Você é um assistente de atendimento.";
    const conhecimentos = kbRes.data || [];
    const exemplos = exRes.data || [];
    const antiFeedbacks = antiRes.data || [];
    const regrasProibidas = regrasRes.data || [];
    // Reverse to chronological order
    const allMsgs = (msgsRes.data || []).reverse();
    const colunas = colRes.data || [];
    const setores = setRes.data || [];
    const lojas = lojasRes.data || [];
    const agendamentosAtivos = agendRes.data || [];

    const inboundCount = allMsgs.filter((m: any) => m.direcao === "inbound").length;
    // Recent outbound for anti-repetition (last 10 only)
    const recentOutbound = allMsgs.filter((m: any) => m.direcao === "outbound").slice(-10).map((m: any) => m.conteudo);

    // ── 5. BUILD CONTEXT ──
    const sentTopics = extractSentTopics(recentOutbound);

    let knowledgeStr = "";
    if (conhecimentos.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const k of conhecimentos) {
        const cat = (k.categoria || "geral").toUpperCase();
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(`**${k.titulo}**: ${JSON.stringify(k.conteudo)}`);
      }
      knowledgeStr = Object.entries(grouped).map(([cat, items]) => `## ${cat}\n${items.join("\n")}`).join("\n\n");
    }

    // Inject lojas into knowledge
    if (lojas.length > 0) {
      knowledgeStr += "\n\n## LOJAS DISPONÍVEIS\n";
      for (const l of lojas) {
        const parts = [`**${l.nome_loja}**`];
        if (l.endereco) parts.push(l.endereco);
        if (l.horario_abertura && l.horario_fechamento) parts.push(`Horário: ${l.horario_abertura}-${l.horario_fechamento}`);
        if (l.telefone) parts.push(`Tel: ${l.telefone}`);
        if (l.departamento && l.departamento !== "geral") parts.push(`Depto: ${l.departamento}`);
        knowledgeStr += `- ${parts.join(" | ")}\n`;
      }
    }

    // Inject active appointments context
    let agendamentoCtx = "";
    if (agendamentosAtivos.length > 0) {
      agendamentoCtx = "\n\n# AGENDAMENTOS DESTE CLIENTE\n";
      for (const ag of agendamentosAtivos) {
        const dt = new Date(ag.data_horario);
        const dataStr = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        const horaStr = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        agendamentoCtx += `- ${ag.loja_nome} em ${dataStr} às ${horaStr} — Status: ${ag.status}${ag.observacoes ? ` (${ag.observacoes})` : ""}\n`;
      }
      const hasNoShow = agendamentosAtivos.some((a: any) => a.status === "no_show" || a.status === "recuperacao");
      if (hasNoShow) {
        agendamentoCtx += "\n⚠️ O cliente tem no-show recente. Seja empático, entenda o motivo. Se ele demonstra interesse, use reagendar_visita. Se não quer mais, encerre com elegância.";
      }
    }

    let examplesStr = "";
    if (exemplos.length > 0) {
      examplesStr = exemplos.map((e: any) => `[${e.categoria}] P: "${e.pergunta}" → R: "${e.resposta_ideal}"`).join("\n");
    }

    let antiStr = "";
    if (antiFeedbacks.length > 0) {
      antiStr = antiFeedbacks.filter((f: any) => f.motivo).map((f: any) => `- ${f.motivo}${f.resposta_corrigida ? ` → Correto: ${f.resposta_corrigida}` : ""}`).join("\n");
    }

    const systemPrompt = buildSystemPrompt({
      businessRules,
      knowledge: knowledgeStr + agendamentoCtx,
      examples: examplesStr,
      antiExamples: antiStr,
      regrasProibidas: regrasProibidas as { regra: string; categoria: string }[],
      sentTopics,
      colunasNomes: colunas.map((c: any) => c.nome).join(", "),
      setoresNomes: setores.map((s: any) => s.nome).join(", "),
      inboundCount,
      isHibrido,
      hasKnowledge: conhecimentos.length > 0 || lojas.length > 0,
    });

    // ── 6. BUILD MESSAGES — use last 20 from the 60 loaded ──
    const contextWindow = allMsgs.slice(-20);
    const messages: any[] = [{ role: "system", content: systemPrompt }];

    for (const m of contextWindow) {
      const role = m.direcao === "inbound" ? "user" : "assistant";
      if (m.direcao === "internal") continue;

      const mediaUrl = (m.metadata as any)?.media_url;
      const tipo = (m as any).tipo_conteudo || "text";

      if (tipo === "image" && mediaUrl && role === "user") {
        const content: any[] = [{ type: "image_url", image_url: { url: mediaUrl, detail: "high" } }];
        if (m.conteudo && m.conteudo !== "[image]") content.push({ type: "text", text: m.conteudo });
        messages.push({ role, content });
      } else {
        const prefix = role === "assistant" && m.remetente_nome === "Operador" ? "[Operador] " : "";
        messages.push({ role, content: prefix + m.conteudo });
      }
    }

    const historyRange = contextWindow.length > 0
      ? `${contextWindow[0]?.created_at} → ${contextWindow[contextWindow.length - 1]?.created_at}`
      : "empty";

    console.log(`[CONTEXT] Prompt:${systemPrompt.length}ch | KB:${conhecimentos.length} | Ex:${exemplos.length} | Anti:${antiFeedbacks.length} | Regras:${regrasProibidas.length} | Modo:${atendimento.modo} | Window:${contextWindow.length}/${allMsgs.length} | Range:${historyRange} | Topics:${sentTopics.join(",") || "none"}`);

    // ── 7. CALL LOVABLE AI GATEWAY (gpt-5) ──
    const callAI = async (retryCorrection?: string) => {
      const callMessages = [...messages];
      if (retryCorrection) {
        callMessages.push({ role: "system", content: retryCorrection });
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5",
          messages: callMessages,
          tools: TOOLS,
          tool_choice: "required",
          max_completion_tokens: 1200,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error(`[AI] Error ${aiResponse.status}:`, errText);
        if (aiResponse.status === 429 || aiResponse.status === 402) {
          return { error: aiResponse.status, data: null };
        }
        throw new Error(`AI ${aiResponse.status}: ${errText}`);
      }

      return { error: null, data: await aiResponse.json() };
    };

    // First attempt
    let aiResult = await callAI();
    if (aiResult.error) {
      return new Response(JSON.stringify({ error: `AI ${aiResult.error}` }), {
        status: aiResult.error, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let choice = aiResult.data?.choices?.[0];
    console.log(
      `[AI] finish_reason=${choice?.finish_reason || "unknown"} | tool_calls=${choice?.message?.tool_calls?.length || 0} | content_len=${(choice?.message?.content || "").length}`,
    );
    if (!choice) throw new Error("No choice from AI");

    // ── 8. PROCESS TOOL CALLS ──
    let resposta = "";
    let intencao = "outro";
    let precisa_humano = false;
    let pipeline_coluna = "Novo Contato";
    let setor_sugerido = "";
    let validatorFlags: string[] = [];

    const toolCalls = choice.message?.tool_calls || [];

    if (toolCalls.length === 0) {
      const plainContent = (choice.message?.content || "").trim();
      if (plainContent) {
        resposta = plainContent;
        validatorFlags.push("no_tool_plain_text");
      } else {
        const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido);
        resposta = fallback.resposta;
        intencao = fallback.intencao;
        pipeline_coluna = fallback.pipeline_coluna;
        precisa_humano = fallback.precisa_humano;
        validatorFlags.push("no_tool_deterministic");
      }
      console.log("[WARN] No tool call despite required — deterministic fallback applied");
    }

    for (const tc of toolCalls) {
      const fn = tc.function?.name;
      let args: any;
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        console.error("[PARSE] Failed to parse tool args:", tc.function?.arguments);
        continue;
      }
      console.log(`[TOOL] ${fn}:`, JSON.stringify(args).substring(0, 300));

      if (fn === "responder") {
        // Merge proximo_passo into resposta if not already included
        resposta = args.resposta || "";
        if (args.proximo_passo && !resposta.includes(args.proximo_passo)) {
          resposta = resposta.trimEnd().replace(/[.!]$/, "") + ". " + args.proximo_passo;
        }
        intencao = args.intencao || "outro";
        pipeline_coluna = args.coluna_pipeline || "Novo Contato";
        setor_sugerido = args.setor || "";

      } else if (fn === "escalar_consultor") {
        resposta = args.resposta;
        precisa_humano = true;
        pipeline_coluna = "Atendimento Humano";
        setor_sugerido = args.setor || "";

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "escalonamento_humano",
          descricao: `IA escalou: ${args.motivo}`,
          metadata: { motivo: args.motivo, setor: args.setor },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

      } else if (fn === "interpretar_receita") {
        resposta = args.resposta;
        intencao = "receita_oftalmologica";
        pipeline_coluna = inboundCount >= 3 ? "Orçamento" : "Novo Contato";

        await supabase.from("contatos").update({
          metadata: {
            ultima_receita: {
              olho_direito: args.olho_direito, olho_esquerdo: args.olho_esquerdo,
              tipo_lente: args.tipo_lente, observacoes: args.observacoes,
              data_leitura: new Date().toISOString(),
            },
          },
        }).eq("id", contatoId);

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "receita_interpretada",
          descricao: `Receita: OD ${args.olho_direito.esferico} OE ${args.olho_esquerdo.esferico} — ${args.tipo_lente}`,
          metadata: args, referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });
      } else if (fn === "agendar_visita" || fn === "reagendar_visita") {
        resposta = args.resposta;
        intencao = "agendamento";
        pipeline_coluna = "Agendamento";

        // Find loja telephone
        const lojaMatch = lojas.find((l: any) => l.nome_loja.toLowerCase() === (args.loja_nome || "").toLowerCase());

        // If reagendar, mark old agendamento as reagendado
        if (fn === "reagendar_visita") {
          const oldNoShow = agendamentosAtivos.find((a: any) => a.status === "no_show" || a.status === "recuperacao");
          if (oldNoShow) {
            await supabase.from("agendamentos").update({ status: "reagendado" }).eq("id", oldNoShow.id);
          }
        }

        // Create new agendamento via agendar-cliente function
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/agendar-cliente`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              contato_id: contatoId,
              atendimento_id,
              loja_nome: args.loja_nome,
              loja_telefone: lojaMatch?.telefone || null,
              data_horario: args.data_horario,
              observacoes: args.observacoes || (fn === "reagendar_visita" ? "Reagendamento após no-show" : null),
            }),
          });
        } catch (e) {
          console.error("[TOOL] agendar-cliente call failed:", e);
        }

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: fn === "reagendar_visita" ? "reagendamento_visita" : "agendamento_visita",
          descricao: `${fn === "reagendar_visita" ? "Reagendamento" : "Agendamento"}: ${args.loja_nome} em ${args.data_horario}`,
          metadata: args,
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });
      }
    }

    // ── 9. POST-LLM VALIDATION (Phase 3) ──
    if (resposta && !precisa_humano) {
      const validation = validateResponse(resposta, recentOutbound);

      if (!validation.valid) {
        console.log(`[VALIDATOR] REJECTED: ${validation.reason} — attempting retry`);
        validatorFlags.push(`rejected:${validation.reason}`);

        // One retry with explicit correction
        const retryResult = await callAI(
          `CORREÇÃO: Sua resposta anterior foi rejeitada porque: ${validation.reason}. Gere uma resposta COMPLETAMENTE DIFERENTE que avance a conversa com uma PERGUNTA OBJETIVA. NÃO use frases genéricas.`
        );

        if (!retryResult.error && retryResult.data?.choices?.[0]) {
          const retryChoice = retryResult.data.choices[0];
          const retryToolCalls = retryChoice.message?.tool_calls || [];
          let retryResposta = "";

          for (const tc of retryToolCalls) {
            if (tc.function?.name === "responder") {
              const retryArgs = JSON.parse(tc.function?.arguments || "{}");
              retryResposta = retryArgs.resposta || "";
              if (retryArgs.proximo_passo && !retryResposta.includes(retryArgs.proximo_passo)) {
                retryResposta = retryResposta.trimEnd().replace(/[.!]$/, "") + ". " + retryArgs.proximo_passo;
              }
              intencao = retryArgs.intencao || intencao;
              pipeline_coluna = retryArgs.coluna_pipeline || pipeline_coluna;
            }
          }

          const retryValidation = validateResponse(retryResposta || "", recentOutbound);
          if (retryValidation.valid && retryResposta) {
            resposta = retryResposta;
            validatorFlags.push("retry_accepted");
            console.log("[VALIDATOR] Retry accepted");
          } else {
            // Deterministic fallback
            resposta = DETERMINISTIC_FALLBACKS.validator_failed;
            validatorFlags.push("deterministic_fallback");
            console.log("[VALIDATOR] Retry also rejected — using deterministic fallback");
          }
        } else {
          resposta = DETERMINISTIC_FALLBACKS.validator_failed;
          validatorFlags.push("deterministic_fallback");
        }
      } else {
        validatorFlags.push("passed");
      }
    }

    if (!resposta) {
      const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido);
      resposta = fallback.resposta;
      intencao = fallback.intencao;
      pipeline_coluna = fallback.pipeline_coluna;
      precisa_humano = fallback.precisa_humano;
      validatorFlags.push("empty_response_deterministic");
    }

    // ── 10. SEND RESPONSE ──
    await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, resposta);

    // ── 11. UPDATE MODO + PIPELINE ──
    let newModo: string | null = null;
    if (precisa_humano && !isHibrido) {
      newModo = "hibrido";
      console.log("[MODE] IA → Híbrido");
    }

    if (newModo) {
      await supabase.from("atendimentos").update({ modo: newModo }).eq("id", atendimento_id);
    }

    const contatoUpdates: any = { ultimo_contato_at: new Date().toISOString() };

    if (precisa_humano) {
      const col = colunas.find((c: any) => c.nome === "Atendimento Humano");
      if (col) contatoUpdates.pipeline_coluna_id = col.id;
    } else if (inboundCount >= 3 || pipeline_coluna !== "Novo Contato") {
      const col = colunas.find((c: any) => c.nome === pipeline_coluna);
      if (col) contatoUpdates.pipeline_coluna_id = col.id;
    }

    if (setor_sugerido) {
      const s = setores.find((s: any) => s.nome.toLowerCase() === setor_sugerido.toLowerCase());
      if (s) contatoUpdates.setor_destino = s.id;
    }

    await supabase.from("contatos").update(contatoUpdates).eq("id", contatoId);

    // ── 12. STRUCTURED LOG (Phase 6) ──
    await supabase.from("eventos_crm").insert({
      contato_id: contatoId,
      tipo: precisa_humano ? "escalonamento_humano" : "triagem_ia",
      descricao: `IA: "${intencao}" → ${pipeline_coluna}`,
      metadata: {
        intencao, pipeline_coluna, setor_sugerido,
        modo: newModo || atendimento.modo,
        history_window: `${contextWindow.length}/${allMsgs.length}`,
        history_range: historyRange,
        validator_flags: validatorFlags,
        topics_blocked: sentTopics,
      },
      referencia_tipo: "atendimento",
      referencia_id: atendimento_id,
    });

    console.log(`[RESULT] tools=${toolCalls.map((t: any) => t.function?.name).join(",") || "text"} | intent=${intencao} | human=${precisa_humano} | col=${pipeline_coluna} | validator=${validatorFlags.join(",")}`);

    // Clear debounce lock
    const currentMeta = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
    delete currentMeta.ia_lock;
    await supabase.from("atendimentos").update({ metadata: currentMeta }).eq("id", atendimento_id);

    return jsonResponse({
      status: "ok",
      tools_used: toolCalls.map((t: any) => t.function?.name) || ["text"],
      intencao, precisa_humano,
      pipeline_coluna_sugerida: pipeline_coluna,
      setor_sugerido,
      modo: newModo || atendimento.modo,
      validator_flags: validatorFlags,
    });

  } catch (e) {
    console.error("[ERROR] ai-triage:", e);
    // Clear lock on error too
    try {
      const errMeta = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
      delete errMeta.ia_lock;
      await supabase.from("atendimentos").update({ metadata: errMeta }).eq("id", atendimento_id);
    } catch (_) { /* ignore lock cleanup errors */ }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendWhatsApp(supabaseUrl: string, serviceKey: string, atendimentoId: string, texto: string) {
  const maxAttempts = 3;
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort("send_whatsapp_timeout"), 15000);

      const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ atendimento_id: atendimentoId, texto, remetente_nome: "Assistente IA" }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) return;

      const body = await res.text();
      lastError = `status=${res.status} body=${(body || "<empty>").slice(0, 500)}`;
      console.error(`[SEND] WhatsApp error (attempt ${attempt}/${maxAttempts}): ${lastError}`);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[SEND] WhatsApp exception (attempt ${attempt}/${maxAttempts}): ${lastError}`);
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw new Error(`send-whatsapp failed after ${maxAttempts} attempts: ${lastError}`);
}

async function logEvent(supabase: any, contatoId: string, atendimentoId: string, tipo: string, msg: string) {
  await supabase.from("eventos_crm").insert({
    contato_id: contatoId, tipo,
    descricao: msg.substring(0, 200),
    metadata: { trigger: tipo },
    referencia_tipo: "atendimento", referencia_id: atendimentoId,
  });
}

async function handleEscalation(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atendimentoId: string, contatoId: string, mensagem: string, trigger: string
) {
  const resposta = "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve. Posso te ajudar com algo rápido enquanto isso? 😊";

  await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, resposta);

  // Load colunas for pipeline update
  const { data: colunas } = await supabase.from("pipeline_colunas").select("id, nome").eq("ativo", true);
  const col = (colunas || []).find((c: any) => c.nome === "Atendimento Humano");

  await supabase.from("atendimentos").update({ modo: "hibrido" }).eq("id", atendimentoId);

  const updates: any = { ultimo_contato_at: new Date().toISOString() };
  if (col) updates.pipeline_coluna_id = col.id;
  await supabase.from("contatos").update(updates).eq("id", contatoId);

  await supabase.from("eventos_crm").insert({
    contato_id: contatoId, tipo: "escalonamento_humano",
    descricao: `Escalonamento (${trigger}): cliente pediu Consultor`,
    metadata: { trigger, mensagem },
    referencia_tipo: "atendimento", referencia_id: atendimentoId,
  });

  return jsonResponse({
    status: "ok", tools_used: [`escalar_consultor_${trigger}`],
    intencao: "escalonamento", precisa_humano: true,
    pipeline_coluna_sugerida: "Atendimento Humano", setor_sugerido: "", modo: "hibrido",
  });
}
