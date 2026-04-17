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

// ── PRE-LLM: Rede Diniz / Franchising detection ──
const REDE_DINIZ_PATTERNS = [
  /sou d[ao] diniz/i,
  /diniz de \w+/i,
  /diniz franchising/i,
  /outra unidade/i,
  /franqueado/i,
  /sou franqueado/i,
  /lojista diniz/i,
  /sou gerente d[aoe]/i,
  /sou d[ao] loja d/i,
  /trabalho n[ao] diniz/i,
  /somos d[ao] diniz/i,
  /outra [oó]tica diniz/i,
  /filial diniz/i,
];

// ── PRE-LLM: Fornecedor / B2B detection ──
const FORNECEDOR_B2B_PATTERNS = [
  /representante comercial/i,
  /proposta comercial/i,
  /tabela de pre[çc]os? (para|pra) /i,
  /sou fornecedor/i,
  /somos fornecedores/i,
  /distribuidor[a]? d[eao]/i,
  /ofere[çc]o /i,
  /oferta de (servi[çc]o|produto)/i,
  /vendo \w+ para (lojas|empresas|[oó]ticas)/i,
  /parceria (comercial|empresarial)/i,
  /gostaria de oferecer/i,
  /apresentar (nosso|nossa|meu|minha) (produto|servi[çc]o|empresa|marca)/i,
];

function matchesRedeDiniz(msg: string): boolean {
  return REDE_DINIZ_PATTERNS.some((re) => re.test(msg));
}

function matchesFornecedorB2B(msg: string): boolean {
  return FORNECEDOR_B2B_PATTERNS.some((re) => re.test(msg));
}

function norm(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function hasSupportedImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true; // jpeg
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return true; // png
  if (bytes.length >= 6) {
    const ascii = Array.from(bytes.slice(0, 12)).map((b) => String.fromCharCode(b)).join("");
    if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return true;
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return true;
  }
  return false;
}

function cleanBase64(base64String: string): string {
  let cleaned = base64String.trim();
  if (cleaned.includes(",") && cleaned.startsWith("data:")) {
    cleaned = cleaned.split(",")[1] ?? "";
  }
  return cleaned.replace(/\s/g, "");
}

function imageContentFromBase64(base64String: string, mimeType: string): any | null {
  const rawMime = String(mimeType || "image/jpeg").split(";")[0].trim().toLowerCase();
  const normalizedMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const supportedMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (!supportedMimes.has(normalizedMime)) return null;

  const cleaned = cleanBase64(base64String);
  if (!cleaned) return null;

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (!hasSupportedImageSignature(bytes)) return null;

  return {
    type: "image_url",
    image_url: { url: `data:${normalizedMime};base64,${cleaned}`, detail: "high" },
  };
}

function matchesEscalation(msg: string): boolean {
  const n = norm(msg);
  return ESCALATION_KEYWORDS.some((kw) => n.includes(norm(kw)));
}

function matchesSubjectChange(msg: string): boolean {
  const n = norm(msg);
  return SUBJECT_CHANGE_KEYWORDS.some((kw) => n.includes(norm(kw)));
}

// Pool of image-context fallback responses
const IMAGE_CONTEXT_FALLBACK_POOL = [
  "Recebi sua imagem aqui! É uma receita oftalmológica? Se sim, me confirma que eu analiso pra você 😊",
  "Vi que me enviou uma imagem. Se for uma receita, me manda com boa iluminação que eu leio pra você!",
  "Recebi seu envio! Se for receita, eu consigo ler e já te mostrar opções de lentes compatíveis. É receita?",
  "Obrigado por enviar! Se isso for uma receita oftalmológica, posso analisar e te passar opções. Me confirma? 😊",
  "Recebi a imagem! Parece ser uma receita? Se sim, já analiso e te passo as melhores opções de lente.",
];

function imageContextFallback(recentOutbound: string[]): string {
  const recentNorm = (recentOutbound || []).slice(-10).map(norm);
  for (const fb of IMAGE_CONTEXT_FALLBACK_POOL) {
    const fbNorm = norm(fb);
    const alreadySent = recentNorm.some((prev) => computeSimilarity(fbNorm, prev) > 0.5);
    if (!alreadySent) return fb;
  }
  return IMAGE_CONTEXT_FALLBACK_POOL[0]; // Always return something for images
}

// ── Pending intent detector (used after humano→ia handoff) ──
function detectPendingIntent(
  recentInbound: string[],
  hasUnparsedImage: boolean,
  hasReceitas: boolean,
): { intent: string; hint: string } | null {
  const joined = recentInbound.slice(-5).map((t) => String(t || "").toLowerCase()).join(" | ");
  if (!joined.trim() && !hasUnparsedImage) return null;

  if (hasUnparsedImage && !hasReceitas) {
    return {
      intent: "prescription_pending",
      hint: "Cliente enviou imagem (provável receita) ainda não interpretada. PRIORIDADE: chamar interpretar_receita agora.",
    };
  }
  if (/\b(agendar|marcar|hor[aá]rio|amanh[aã]|hoje|que dia|que horas|disponibilidade)\b/i.test(joined)) {
    return {
      intent: "scheduling",
      hint: "Cliente quer AGENDAR. Continue o agendamento — pergunte loja/data/hora se faltar, ou use agendar_cliente se já tiver os dados.",
    };
  }
  if (/\b(pre[çc]o|valor|or[çc]amento|quanto custa|quanto fica|quanto sai)\b/i.test(joined)) {
    return {
      intent: "quote",
      hint: hasReceitas
        ? "Cliente quer ORÇAMENTO e já há receita salva. Use consultar_lentes para responder com opções."
        : "Cliente quer ORÇAMENTO mas falta receita. Peça foto da receita uma única vez.",
    };
  }
  if (/\b(endere[çc]o|onde fica|onde [eé]|como chegar|fica onde|qual loja|maps)\b/i.test(joined)) {
    return {
      intent: "location",
      hint: "Cliente quer ENDEREÇO/LOCALIZAÇÃO. Responda com endereço da loja relevante (use base de conhecimento de lojas).",
    };
  }
  if (/\b(confirma[rs]?|confirmado|fechado|pode marcar|pode agendar|t[aá] bom|beleza)\b/i.test(joined)) {
    return {
      intent: "confirmation",
      hint: "Cliente está CONFIRMANDO algo discutido. Identifique o que e finalize a ação correspondente.",
    };
  }
  return null;
}

// ── Loop detector: scans last 3 outbound for >70% similarity between any 2 ──
// Returns: { detected: boolean, similarity: number }
function detectLoop(recentOutbound: string[]): { detected: boolean; similarity: number } {
  const last3 = recentOutbound.slice(-3).map(norm).filter((s) => s.length > 0);
  if (last3.length < 2) return { detected: false, similarity: 0 };
  let maxSim = 0;
  for (let i = 0; i < last3.length; i++) {
    for (let j = i + 1; j < last3.length; j++) {
      const sim = computeSimilarity(last3[i], last3[j]);
      if (sim > maxSim) maxSim = sim;
    }
  }
  return { detected: maxSim > 0.7, similarity: maxSim };
}

// ── Forced intent → tool mapping ──
// When the customer responds with clear keywords to a previous AI question,
// forces the corresponding tool execution to break out of repetitive prompts.
function detectForcedToolIntent(
  lastInboundText: string,
  hasReceitas: boolean,
  hasUnparsedImage: boolean,
): { tool: string; reason: string } | null {
  const t = norm(lastInboundText);
  if (!t) return null;

  // Quote / pricing keywords
  if (/\b(or[cç]amento|or[cç]a|pre[cç]o|valor|quanto|lentes? compat[ií]veis|op[cç][oõ]es? de lente|cota[cç][aã]o)\b/.test(t)) {
    if (hasReceitas) return { tool: "consultar_lentes", reason: "cliente pediu orçamento e há receita salva" };
    if (hasUnparsedImage) return { tool: "interpretar_receita", reason: "cliente pediu orçamento e há imagem pendente" };
    return { tool: "responder_pedindo_receita", reason: "cliente pediu orçamento mas não há receita" };
  }

  // Scheduling keywords
  if (/\b(agendar|marcar|hor[aá]rio|amanh[aã]|hoje|essa semana|pode marcar|pode agendar|reservar)\b/.test(t)) {
    return { tool: "agendar_cliente_intent", reason: "cliente quer agendar" };
  }

  return null;
}

// ── Prescription correction detector ──
// Detects when the customer is correcting a previously-interpreted prescription
// by typing values directly (OD/OE, longe/perto, esf/cil/eixo/adição).
// Returns parsed prescription data if detected, otherwise null.
function detectPrescriptionCorrection(text: string): {
  od: { sphere: number | null; cylinder: number | null; axis: number | null; add: number | null };
  oe: { sphere: number | null; cylinder: number | null; axis: number | null; add: number | null };
  has_addition: boolean;
  rx_type: "single_vision" | "progressive";
  raw: string;
} | null {
  if (!text || text.length < 8) return null;
  const t = text.toLowerCase();

  // Strong signals: must contain at least 2 of these markers
  const markers = [
    /\bod\b/, /\boe\b/, /\bos\b/,
    /\blonge\b/, /\bperto\b/,
    /\besf[eé]rico\b|\besf\b/,
    /\bcil[ií]ndrico\b|\bcil\b/,
    /\beixo\b/,
    /\badi[cç][aã]o\b|\badd?\b/,
  ];
  const numericPairs = (t.match(/[+-]?\d+[.,]?\d*/g) || []).length;
  const markerHits = markers.filter((r) => r.test(t)).length;
  if (markerHits < 2 || numericPairs < 2) return null;

  // Helper: parse a number like "-9,25" / "+0.50" / "0.00"
  const parseNum = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // Try to extract values per eye. Patterns supported:
  //   "OD 0.00 com -2,25 eixo 180"
  //   "OD: esf -9 cil -2,75 eixo 180 add +2,00"
  //   "LONGE: OD 0.00 com -2,25"  /  "PERTO: -0,25 com -2,00"
  const num = "([+-]?\\d+[.,]?\\d*)";
  const buildEye = () => ({ sphere: null as number | null, cylinder: null as number | null, axis: null as number | null, add: null as number | null });
  const od = buildEye();
  const oe = buildEye();

  // Pattern A: "OD <esf> com <cil> [eixo <axis>] [add <add>]"
  const reA = new RegExp(`(od|oe|os)[^\\d+\\-]{0,15}${num}\\s*(?:com|x|\\/)?\\s*${num}?\\s*(?:eixo\\s*${num})?(?:[^\\d]*(?:add?|adi[cç][aã]o)\\s*${num})?`, "gi");
  let m: RegExpExecArray | null;
  while ((m = reA.exec(t)) !== null) {
    const eye = m[1].toLowerCase() === "od" ? od : oe;
    if (eye.sphere == null) eye.sphere = parseNum(m[2]);
    if (eye.cylinder == null) eye.cylinder = parseNum(m[3]);
    if (eye.axis == null) eye.axis = parseNum(m[4]);
    if (eye.add == null) eye.add = parseNum(m[5]);
  }

  // Pattern B: longe/perto blocks (when client splits longe/perto with single eye line each)
  // "LONGE: OD <s> com <c>" / "PERTO: <s> com <c> eixo <ax>"
  const longeMatch = t.match(/longe[^a-z]*([\s\S]*?)(?=perto|$)/i);
  const pertoMatch = t.match(/perto[^a-z]*([\s\S]*?)$/i);
  const eyeFromBlock = (block: string, eye: any) => {
    const r = new RegExp(`(?:od|oe|os)?\\s*${num}\\s*(?:com|x|\\/)?\\s*${num}?\\s*(?:eixo\\s*${num})?`, "i");
    const mm = block.match(r);
    if (mm) {
      if (eye.sphere == null) eye.sphere = parseNum(mm[1]);
      if (eye.cylinder == null) eye.cylinder = parseNum(mm[2]);
      if (eye.axis == null) eye.axis = parseNum(mm[3]);
    }
  };
  if (longeMatch && od.sphere == null) eyeFromBlock(longeMatch[1], od);
  if (pertoMatch) {
    // "perto" line implies addition exists → progressive
    const pBlock = pertoMatch[1];
    // If the client only gives ONE pair under "perto", treat it as the additional set for OE if OE empty, else as add reference for OD
    eyeFromBlock(pBlock, oe.sphere == null ? oe : od);
  }

  // Need at least one eye with sphere defined to be valid
  if (od.sphere == null && oe.sphere == null) return null;

  // Mirror values when only one eye provided (best-effort: keep nulls — let LLM ask)
  const has_addition = (od.add != null && od.add !== 0) || (oe.add != null && oe.add !== 0) || /\bperto\b|\badi[cç][aã]o\b|\badd?\b/.test(t);
  const rx_type: "single_vision" | "progressive" = has_addition ? "progressive" : "single_vision";

  return { od, oe, has_addition, rx_type, raw: text.slice(0, 400) };
}

function deterministicIntentFallback(msg: string, inboundCount: number, isHibrido: boolean, recentOutbound?: string[], isImageContext?: boolean): {
  resposta: string;
  intencao: string;
  pipeline_coluna: string;
  precisa_humano: boolean;
} {
  const n = norm(msg);

  // If image context, use dedicated image fallback pool
  if (isImageContext || /\[image\]|\[document\]/.test(n)) {
    const recentNorm = (recentOutbound || []).slice(-10).map(norm);
    const receitaPool = [
      "Recebi sua receita aqui 😊 Se você quiser, eu posso seguir por dois caminhos: te mostrar opções de lentes compatíveis ou montar um orçamento inicial. Qual você prefere?",
      "Recebi sua imagem! Parece ser uma receita. Quer que eu leia e te passe opções de lentes? 😊",
      "Vi que enviou uma imagem. Se for receita, eu consigo analisar e já te mostrar as melhores opções de lente!",
    ];
    for (const fb of receitaPool) {
      const fbNorm = norm(fb);
      const alreadySent = recentNorm.some((prev) => computeSimilarity(fbNorm, prev) > 0.5);
      if (!alreadySent) {
        return {
          resposta: fb,
          intencao: "receita_oftalmologica",
          pipeline_coluna: "Orçamento",
          precisa_humano: false,
        };
      }
    }
    return {
      resposta: receitaPool[0],
      intencao: "receita_oftalmologica",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  if (/receita|grau|prescri[cç][aã]o|oftalmol[oó]g|enviei minha receita|recebeu minha receita/.test(n)) {
    return {
      resposta: "Recebi sua receita aqui 😊 Se você quiser, eu posso seguir por dois caminhos: te mostrar opções de lentes compatíveis ou montar um orçamento inicial. Qual você prefere?",
      intencao: "receita_oftalmologica",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  if (/lente|oculos|óculos|arma[çc]|comprar|or[çc]amento|pre[çc]o|valor|barato|caro|mais em conta|econom/.test(n)) {
    return {
      resposta:
        "Boa! Me manda uma foto da sua receita que eu já te passo os valores certinhos. Se ainda não tem receita, posso te orientar também 😉",
      intencao: "orcamento",
      pipeline_coluna: "Orçamento",
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

  // For híbrido or generic cases, use rotating pool to avoid repetition
  const genericPool = [
    "Sobre o que a gente estava falando — quer que eu retome o orçamento ou te ajudo com outra coisa?",
    "Pode me explicar melhor o que precisa? Quero te dar um retorno certeiro!",
    "Me diz com mais detalhes o que tá buscando que eu resolvo pra você 😊",
    "Pra eu te ajudar certinho, preciso entender melhor — pode elaborar?",
    "Me conta: é sobre lentes, agendamento, ou outro assunto?",
  ];

  const recentNorm = (recentOutbound || []).slice(-10).map(norm);
  for (const msg of genericPool) {
    const msgNorm = norm(msg);
    const alreadySent = recentNorm.some((prev) => computeSimilarity(msgNorm, prev) > 0.5);
    if (!alreadySent) {
      return {
        resposta: msg,
        intencao: "outro",
        pipeline_coluna: "Novo Contato",
        precisa_humano: false,
      };
    }
  }

  // All pool exhausted — escalate to human (keep current column, flag modo=humano)
  return {
    resposta: "Vou chamar um Consultor especializado pra te ajudar melhor, tá? Ele já entra em contato!",
    intencao: "outro",
    pipeline_coluna: "Novo Contato",
    precisa_humano: true,
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
  // But only reject very short responses — longer ones likely have context
  const hasQuestion = resposta.includes("?");
  const hasAction = /envie|enviar|agende|agendar|acesse|clique|ligue|visite|orçamento|receita|foto|confirmo|agendado|reserv|marc/i.test(resposta);
  if (!hasQuestion && !hasAction && resposta.length < 80) {
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
      description: "Extrai dados de foto/PDF de receita oftalmológica. Retorne NÚMEROS (não strings). Se ilegível, use null. NÃO invente valores. Infira o 'label' da pessoa a quem pertence a receita pelo contexto da conversa (ex: 'cliente', 'filho', 'mãe').",
      parameters: {
        type: "object",
        properties: {
          eyes: {
            type: "object",
            properties: {
              od: {
                type: "object",
                properties: {
                  sphere: { type: "number", description: "ESF/SPH olho direito" },
                  cylinder: { type: "number", description: "CIL/CYL olho direito" },
                  axis: { type: "number", description: "EIXO/AXIS olho direito" },
                  add: { type: "number", description: "ADIÇÃO/ADD olho direito" },
                },
                additionalProperties: false,
              },
              oe: {
                type: "object",
                properties: {
                  sphere: { type: "number", description: "ESF/SPH olho esquerdo" },
                  cylinder: { type: "number", description: "CIL/CYL olho esquerdo" },
                  axis: { type: "number", description: "EIXO/AXIS olho esquerdo" },
                  add: { type: "number", description: "ADIÇÃO/ADD olho esquerdo" },
                },
                additionalProperties: false,
              },
            },
            required: ["od", "oe"],
            additionalProperties: false,
          },
          pd: { type: "number", description: "DP/PD (distância pupilar) se disponível" },
          issued_at: { type: "string", description: "Data da receita se visível (formato YYYY-MM-DD)" },
          confidence: { type: "number", description: "Confiança na leitura de 0.0 a 1.0" },
          missing_fields: { type: "array", items: { type: "string" }, description: "Campos ilegíveis ou ausentes" },
          raw_notes: { type: "array", items: { type: "string" }, description: "Observações do médico" },
          label: { type: "string", description: "Identificador da pessoa dona da receita (ex: 'cliente', 'filho', 'mãe', 'pai'). Infira pelo contexto da conversa." },
          resposta: { type: "string", description: "Mensagem confirmando dados extraídos e próximos passos." },
        },
        required: ["eyes", "confidence", "resposta"],
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
  {
    type: "function" as const,
    function: {
      name: "consultar_lentes",
      description: "Busca lentes compatíveis com a receita do cliente. Use SOMENTE quando o cliente demonstrar interesse em orçamento/preço/opções de lentes APÓS a receita já ter sido interpretada. NÃO use logo após interpretar_receita — espere o cliente pedir. Se o contexto indicar que a receita JÁ FOI INTERPRETADA (seção RECEITAS JÁ INTERPRETADAS), use esta tool diretamente — NÃO peça a receita novamente.",
      parameters: {
        type: "object",
        properties: {
          receita_label: { type: "string", description: "Label da receita a usar (ex: 'cliente', 'filho', 'mãe'). Se não especificado, usa a mais recente. Se houver mais de uma receita, pergunte ao cliente qual usar ANTES de chamar esta tool." },
          filtro_blue: { type: "boolean", description: "Se o cliente mencionou filtro de luz azul" },
          filtro_photo: { type: "boolean", description: "Se o cliente mencionou lente fotossensível/transitions" },
          preferencia_marca: { type: "string", description: "Marca preferida se mencionada (HOYA, ZEISS, DNZ)" },
          resposta_fallback: { type: "string", description: "Resposta caso nenhuma lente seja encontrada" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "agendar_lembrete",
      description: "Registra um lembrete futuro para enviar ao cliente. Use quando o cliente pedir para ser lembrado ou quando combinar um retorno em data específica. OBRIGATÓRIO usar esta tool antes de prometer qualquer ação futura.",
      parameters: {
        type: "object",
        properties: {
          data_disparo: { type: "string", description: "Data e hora para enviar o lembrete no formato ISO 8601 (ex: 2026-04-11T10:00:00-03:00)." },
          mensagem: { type: "string", description: "Mensagem a ser enviada ao cliente no momento do lembrete." },
          resposta: { type: "string", description: "Mensagem confirmando ao cliente que o lembrete foi agendado." },
        },
        required: ["data_disparo", "mensagem", "resposta"],
        additionalProperties: false,
      },
    },
  },
];

// ═══════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ═══════════════════════════════════════════

function buildDateContext(): string {
  const DAYS_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  
  // Use São Paulo timezone
  const now = new Date();
  const spFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long" });
  const parts = spFormatter.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  
  const dayName = get("weekday");
  const dd = get("day");
  const mm = get("month");
  const yyyy = get("year");
  const hh = get("hour");
  const min = get("minute");
  
  // Calculate next 7 days with names
  const lines: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const future = new Date(now.getTime() + i * 86400000);
    const fParts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", weekday: "long" }).formatToParts(future);
    const fGet = (t: string) => fParts.find(p => p.type === t)?.value || "";
    lines.push(`- ${fGet("weekday")}: ${fGet("day")}/${fGet("month")}/${yyyy}`);
  }
  
  return `# 📅 DATA E HORA ATUAL
Agora: ${dayName}, ${dd}/${mm}/${yyyy} às ${hh}:${min} (horário de Brasília)

Próximos 7 dias:
${lines.join("\n")}

REGRA CRÍTICA: Quando o cliente disser "sábado", "segunda", "amanhã", etc., 
CALCULE a data automaticamente usando as informações acima. 
NUNCA peça ao cliente para informar a data em DD/MM — isso é trabalho SEU.
Use formato ISO 8601 na tool agendar_visita (ex: ${yyyy}-${mm}-${dd}T10:00:00-03:00).`;
}

function buildProhibitionsBlock(regrasProibidas: { regra: string; categoria: string }[]): string {
  if (regrasProibidas.length === 0) return "";
  const grouped: Record<string, string[]> = {};
  for (const r of regrasProibidas) {
    const cat = r.categoria || "geral";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r.regra);
  }
  let block = `# ⛔ PROIBIÇÕES ABSOLUTAS — VIOLAR = FALHA CRÍTICA
As regras abaixo são INVIOLÁVEIS. Quebrá-las é um erro gravíssimo.
INSTRUÇÕES: Estas regras se aplicam A TODAS as situações, incluindo clínicas parceiras, 
indicações, parcerias e qualquer variação ou reformulação. NÃO há exceções.
Se uma regra diz "NÃO fazemos X", você NÃO pode oferecer X de nenhuma forma, 
nem como serviço próprio, nem como parceria, nem como indicação.\n`;
  for (const [cat, rules] of Object.entries(grouped)) {
    block += `\n## ${cat.toUpperCase()}\n`;
    for (const rule of rules) {
      block += `- ❌ ${rule}\n`;
    }
  }
  return block;
}

function buildFirstContactBlock(inboundCount: number): string {
  if (inboundCount > 1) return "";
  return `# PRIMEIRA INTERAÇÃO
- Cumprimente o cliente de forma calorosa e natural (ex: "Oi! Tudo bem? 😊").
- Pergunte como pode ajudá-lo. NÃO assuma o que ele precisa.
- NÃO mencione receita, lentes, agendamento ou qualquer serviço na primeira mensagem.
- Deixe o CLIENTE dizer o que deseja antes de fazer qualquer triagem.
- Exemplo: "Oi! Aqui é o Gael das Óticas Diniz Osasco 😊 Como posso te ajudar hoje?"
- Mantenha a mensagem curta e acolhedora — máximo 2 frases.`;
}

function buildContinuityBlock(inboundCount: number): string {
  if (inboundCount <= 1) return "";
  return `# CONTINUIDADE DE CONVERSA
- Você JÁ conversou com este cliente antes. NÃO se apresente novamente. NÃO diga "Aqui é o Gael" nem "Aqui é o assistente".
- Retome naturalmente, de forma simpática e direta: "Oi [nome], que bom te ver de volta!" ou "E aí, tudo bem? Vamos retomar de onde paramos?"
- Se o cliente retorna após inatividade: reconheça de forma calorosa e retome o contexto da conversa anterior, sem repetir informações já dadas.
- NUNCA repita saudações formais ou apresentações em conversas que já tiveram troca de mensagens.`;
}

function buildRegionalCoverageBlock(): string {
  return `# COBERTURA REGIONAL — ESCADA DE PERSUASÃO
- Você atende APENAS em Osasco e região (Carapicuíba, Barueri, Cotia, Itapevi, Jandira, Santana de Parnaíba, Alphaville).
- NUNCA sugira lojas ou atendimento em cidades fora da nossa cobertura (como Guarulhos, São Paulo capital, ABC, Campinas, etc.).
- Quando o cliente for de fora da nossa região, siga esta ESCADA DE PERSUASÃO:
  1º) Convide com carinho para conhecer nossas lojas em Osasco e região. Mencione diferenciais, promoções exclusivas e atendimento diferenciado. NÃO envie link do Google Maps.
  2º) Se o cliente insistir que é longe ou que prefere outra região, reforce o convite com argumentos de acesso fácil, atendimento personalizado e condições especiais. NÃO envie link do Google Maps.
  3º) SOMENTE se o cliente se mostrar irredutível pela TERCEIRA VEZ: envie o link do Google Maps da loja mais próxima dele (da lista de LOJAS DISPONÍVEIS) e classifique como coluna_pipeline "Perdidos".
- NUNCA envie o link do Google Maps logo na 1ª ou 2ª interação sobre localização.
- Ao enviar o link (3ª tentativa), use coluna_pipeline "Perdidos" para que o card saia do radar comercial.`;
}

function buildNonClientBlock(): string {
  return `# CONTATOS NÃO-CLIENTE
Se a pessoa se identificar como:
- De outra unidade Diniz, franqueado, da Diniz Franchising, gerente de outra loja
- Fornecedor, representante comercial, distribuidor
- Alguém oferecendo produtos/serviços (B2B)
- Alguém buscando parceria comercial ou empresarial

→ NÃO trate como cliente. NÃO ofereça produtos, preços, agendamentos ou orçamentos.
→ Use escalar_consultor com motivo específico: "contato_rede_diniz", "fornecedor_b2b" ou "proposta_parceria".
→ Responda: "Entendido! Vou direcionar para o responsável da nossa equipe."
→ NUNCA tente vender ou fazer triagem de produto para essas pessoas.`;
}

function buildSystemPromptFromCompiled(opts: {
  compiledPrompt: string;
  regrasProibidas: { regra: string; categoria: string }[];
  knowledge: string;
  agendamentoCtx: string;
  receitaCtx: string;
  lojasStr: string;
  sentTopics: string[];
  colunasNomes: string;
  setoresNomes: string;
  inboundCount: number;
  isHibrido: boolean;
  hasKnowledge: boolean;
  escalatedSubject?: string | null;
}): string {
  const s: string[] = [];

  s.push(buildDateContext());

  const firstContactBlock = buildFirstContactBlock(opts.inboundCount);
  if (firstContactBlock) s.push(firstContactBlock);
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) s.push(continuityBlock);
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());

  // Replace slots in compiled prompt
  let prompt = opts.compiledPrompt;
  prompt = prompt.replace("{{PROIBICOES}}", buildProhibitionsBlock(opts.regrasProibidas));
  prompt = prompt.replace("{{CONHECIMENTO}}", opts.hasKnowledge ? opts.knowledge : "");
  prompt = prompt.replace("{{LOJAS}}", opts.lojasStr);
  prompt = prompt.replace("{{AGENDAMENTOS}}", opts.agendamentoCtx);

  s.push(prompt);

  // Inject prohibition block even if slot was missing (safety)
  if (!opts.compiledPrompt.includes("{{PROIBICOES}}") && opts.regrasProibidas.length > 0) {
    s.push(buildProhibitionsBlock(opts.regrasProibidas));
  }

  // Inject prescription context
  if (opts.receitaCtx) {
    s.push(opts.receitaCtx);
  }

  if (opts.sentTopics.length > 0) {
    s.push(`# TÓPICOS JÁ COBERTOS (NÃO REPITA)
${opts.sentTopics.map((t) => `- ❌ ${t}`).join("\n")}
Se cliente perguntar algo já coberto: "Como já mencionei..." + mude para assunto novo.`);
  }

  s.push(`# CLASSIFICAÇÃO
Colunas disponíveis: ${opts.colunasNomes}
Setores: ${opts.setoresNomes || "nenhum"}
Mensagem nº ${opts.inboundCount}.
Classifique na coluna adequada assim que identificar a intenção. Use "Novo Contato" apenas se a intenção ainda não estiver clara.
IMPORTANTE: Use SOMENTE as colunas listadas acima. Nunca classifique em colunas que não aparecem nesta lista.`);

  if (opts.isHibrido) {
    let hibridoBlock = `# MODO HÍBRIDO
Consultor solicitado mas não respondeu. Continue atendendo OUTROS assuntos.
Para mensagens vagas: faça pergunta objetiva ("Sobre qual tema: orçamento, lentes, pedidos, financeiro?").
NUNCA responda com CTA genérico de visita.`;
    if (opts.escalatedSubject) {
      hibridoBlock += `\n\n# ASSUNTO ESCALADO: ${opts.escalatedSubject}
Este assunto foi encaminhado para Consultor especializado. NÃO faça perguntas sobre este tema.
Se o cliente perguntar sobre "${opts.escalatedSubject}", responda APENAS: "Seu Consultor já foi acionado e vai te chamar em breve! 🤝"
Se o cliente iniciar um assunto DIFERENTE, responda normalmente.`;
    }
    s.push(hibridoBlock);
  }

  return s.join("\n\n");
}

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
  escalatedSubject?: string | null;
}): string {
  const s: string[] = [];

  // Date/time context FIRST — so the model always knows the current date
  s.push(buildDateContext());

  const firstContactBlock = buildFirstContactBlock(opts.inboundCount);
  if (firstContactBlock) s.push(firstContactBlock);
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) s.push(continuityBlock);
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());

  s.push(`# IDENTIDADE
Você é o Assistente Virtual da Óticas Diniz. Atendimento rápido, preciso e humano via WhatsApp.

# REGRAS DE ATENDIMENTO
${opts.businessRules}

# TERMINOLOGIA
- Pessoa real = "Consultor especializado". NUNCA "atendente", "operador", "humano".`);

  // Inject prohibited rules FIRST — maximum weight
  const prohibBlock = buildProhibitionsBlock(opts.regrasProibidas);
  if (prohibBlock) s.push(prohibBlock);

  s.push(`# REGRAS DE PRECISÃO
1. NUNCA invente dados. Sem dados → escale para Consultor.
2. NUNCA invente preços, endereços, horários fora do contexto.
3. Máximo 3 frases por resposta.
4. SEMPRE termine com pergunta objetiva OU oferta de ação concreta.
5. Se o cliente mudar de assunto, SIGA imediatamente o novo tema.
6. NUNCA repita informação já dada.

# REGRAS DE AGENDAMENTO
- Quando agendar uma visita, NÃO pergunte se o cliente quer lembrete — o lembrete é AUTOMÁTICO.
- Após o agendamento, apenas confirme os dados (loja, data, hora) e encerre com tom positivo.
- Se o cliente confirmar um agendamento já criado ("confirmado", "ok", "tá bom"), NÃO crie outro agendamento. Apenas confirme que está tudo certo.
- NUNCA diga "Vou te enviar um lembrete" e depois pergunte "Quer que eu envie um lembrete?" — o lembrete já é automático.

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
Classifique na coluna adequada assim que identificar a intenção. Use "Novo Contato" apenas se a intenção ainda não estiver clara.`);

  if (opts.isHibrido) {
    let hibridoBlock = `# MODO HÍBRIDO
Consultor solicitado mas não respondeu. Continue atendendo OUTROS assuntos.
Para mensagens vagas: faça pergunta objetiva ("Sobre qual tema: orçamento, lentes, pedidos, financeiro?").
NUNCA responda com CTA genérico de visita.`;
    if (opts.escalatedSubject) {
      hibridoBlock += `\n\n# ASSUNTO ESCALADO: ${opts.escalatedSubject}
Este assunto foi encaminhado para Consultor especializado. NÃO faça perguntas sobre este tema.
Se o cliente perguntar sobre "${opts.escalatedSubject}", responda APENAS: "Seu Consultor já foi acionado e vai te chamar em breve! 🤝"
Se o cliente iniciar um assunto DIFERENTE, responda normalmente.`;
    }
    s.push(hibridoBlock);
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

// ═══════════════════════════════════════════
// CONTEXTUAL RETRIEVAL v1 — Signal-based prioritization
// ═══════════════════════════════════════════

type Signal = "orcamento" | "agendamento" | "acompanhamento" | "financeiro" | "reclamacao" | "informacoes";

const SIGNAL_PATTERNS: [RegExp, Signal][] = [
  [/or[çc]amento|pre[çc]o|valor|quanto custa|lente|[óo]culos|arma[çc]|comprar/i, "orcamento"],
  [/agend|visita|marcar|hor[áa]rio|reserv|dia|data/i, "agendamento"],
  [/status|pedido|entrega|retirada|retirar|pronto|andamento|acompanhar/i, "acompanhamento"],
  [/pagamento|financeiro|boleto|pix|cart[aã]o|parcel|nota fiscal|nf/i, "financeiro"],
  [/reclama|problema|defeito|insatisf|devolu|troc|quebr|errad/i, "reclamacao"],
  [/informa|d[úu]vida|como funciona|onde fica|telefone|endere|hor[áa]rio/i, "informacoes"],
];

const SIGNAL_TO_CATEGORIES: Record<Signal, string[]> = {
  orcamento: ["orcamento", "produtos", "lentes", "geral", "aprovado", "correcao"],
  agendamento: ["agendamento", "lojas", "geral", "aprovado", "correcao"],
  acompanhamento: ["acompanhamento", "status", "pedidos", "geral", "aprovado", "correcao"],
  financeiro: ["financeiro", "pagamento", "geral", "aprovado", "correcao"],
  reclamacao: ["reclamacao", "atendimento", "geral", "aprovado", "correcao"],
  informacoes: ["informacoes", "lojas", "produtos", "geral", "aprovado", "correcao"],
};

function detectSignals(msg: string): Signal[] {
  const n = norm(msg);
  const signals: Signal[] = [];
  for (const [re, signal] of SIGNAL_PATTERNS) {
    if (re.test(n)) signals.push(signal);
  }
  return signals;
}

function prioritizeExamples(
  exemplos: { categoria: string; pergunta: string; resposta_ideal: string }[],
  signals: Signal[],
  limit: number = 30,
): typeof exemplos {
  if (signals.length === 0 || exemplos.length === 0) return exemplos.slice(0, limit);

  const relevantCats = new Set<string>();
  for (const sig of signals) {
    for (const cat of SIGNAL_TO_CATEGORIES[sig]) relevantCats.add(cat);
  }

  const matched: typeof exemplos = [];
  const rest: typeof exemplos = [];

  for (const ex of exemplos) {
    if (relevantCats.has(ex.categoria.toLowerCase())) {
      matched.push(ex);
    } else {
      rest.push(ex);
    }
  }

  // Prioritized first, then fill remaining slots
  return [...matched, ...rest].slice(0, limit);
}

function prioritizeFeedbacks(
  feedbacks: { motivo: string | null; resposta_corrigida: string | null }[],
  signals: Signal[],
  currentMsg: string,
  limit: number = 10,
): typeof feedbacks {
  if (signals.length === 0 || feedbacks.length === 0) return feedbacks.slice(0, limit);

  const msgNorm = norm(currentMsg);
  // Score each feedback by keyword overlap with current message
  const scored = feedbacks.map((f) => {
    const text = norm((f.motivo || "") + " " + (f.resposta_corrigida || ""));
    const words = msgNorm.split(/\s+/).filter(w => w.length > 3);
    let score = 0;
    for (const w of words) {
      if (text.includes(w)) score++;
    }
    return { f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.f).slice(0, limit);
}

// Deterministic fallback responses
const DETERMINISTIC_FALLBACKS_SUBJECT_CHANGE = "Sem problemas! Me diz sobre o que quer falar agora que eu te ajudo 😊";

const VALIDATOR_FAILED_POOL = [
  "Conta pra mim com mais detalhes o que você precisa que eu te dou um retorno certeiro!",
  "Me explica melhor a sua necessidade que eu busco a melhor solução pra você!",
  "Pra eu te ajudar certinho, preciso entender melhor — pode me dar mais detalhes?",
  "Quero te ajudar da melhor forma! Me conta mais sobre o que está buscando?",
  "Pode me explicar um pouco mais? Assim eu consigo te dar uma resposta precisa!",
];

function pickFallback(recentOutbound: string[]): string | null {
  const recentNorm = recentOutbound.slice(-10).map(norm);
  for (const fb of VALIDATOR_FAILED_POOL) {
    const fbNorm = norm(fb);
    const alreadySent = recentNorm.some((prev) => computeSimilarity(fbNorm, prev) > 0.6);
    if (!alreadySent) return fb;
  }
  // All fallbacks exhausted — return null to escalate
  return null;
}

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

  let atendimentoIdForCleanup: string | null = null;

  try {
    const { atendimento_id, mensagem_texto, contato_id, media, forcar_processamento, motivo_disparo } = await req.json();
    const isTranscribedAudio = media?.is_transcribed_audio === true;
    const forceMode = forcar_processamento === true;
    const isDevolucaoHumanoIA = motivo_disparo === "devolucao_humano_ia";
    atendimentoIdForCleanup = atendimento_id;
    if (!atendimento_id) throw new Error("atendimento_id is required");
    if (forceMode) console.log(`[FORCE] forcar_processamento=true | motivo=${motivo_disparo || "n/a"} — bypassing debounce/locks`);
    if (isDevolucaoHumanoIA) console.log("[DEVOLUCAO] humano→ia handoff — continuity mode active");

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
    const DEBOUNCE_WAIT_MS = 5_000; // wait 5 seconds for more messages

    if (!forceMode && iaLock && (now - iaLock) < LOCK_TTL_MS) {
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

    // Anti-duplicate: check if an outbound was sent in the last 10s (even without lock)
    const { data: veryRecentOut } = await supabase
      .from("mensagens")
      .select("id")
      .eq("atendimento_id", atendimento_id)
      .eq("direcao", "outbound")
      .gte("created_at", new Date(now - 10_000).toISOString())
      .limit(1);

    if (!forceMode && veryRecentOut?.length) {
      console.log("[DEBOUNCE] Outbound sent <10s ago, skipping to prevent duplicate");
      return jsonResponse({ status: "skipped", reason: "debounce — recent outbound <10s" });
    }

    // Set lock
    await supabase.from("atendimentos").update({
      metadata: { ...meta, ia_lock: new Date().toISOString() },
    }).eq("id", atendimento_id);

    const isHibrido = atendimento.modo === "hibrido";
    const contatoId = contato_id || atendimento.contato_id;
    const currentMsg = mensagem_texto || "";

    // ── 1.6. DETECT ESCALATED SUBJECT for hybrid mode ──
    let escalatedSubject: string | null = null;
    if (isHibrido) {
      const { data: escEvent } = await supabase
        .from("eventos_crm")
        .select("metadata")
        .eq("contato_id", contatoId)
        .eq("tipo", "escalonamento_humano")
        .order("created_at", { ascending: false })
        .limit(1);
      if (escEvent?.[0]?.metadata) {
        const escMeta = escEvent[0].metadata as Record<string, any>;
        escalatedSubject = escMeta.motivo || null;
      }
      console.log(`[HYBRID] Escalated subject: ${escalatedSubject || "unknown"}`);
    }

    // ── 2. PRE-LLM ROUTER: keyword escalation ──
    if (matchesEscalation(currentMsg)) {
      console.log("[ROUTER] Escalation keyword detected");
      return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, currentMsg, "keyword");
    }

    // ── 2.5. PRE-LLM ROUTER: contact lens detection → deterministic escalation ──
    const CONTACT_LENS_RE = /lentes?\s*de\s*contato/i;
    if (CONTACT_LENS_RE.test(currentMsg) && !isHibrido) {
      console.log("[ROUTER] Contact lens detected — deterministic escalation");
      const contactLensMsg = "Lentes de contato é com nosso Consultor especializado! Para adiantar seu atendimento, me conta: você já usa lentes de contato? Se sim, qual marca/tipo (diária, mensal, anual) e tem receita atualizada? Vou passar tudo pro Consultor te atender já preparado 🤝";
      return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, contactLensMsg, "lentes_de_contato");
    }

    // ── 2.6. PRE-LLM ROUTER: Rede Diniz / Franchising → escalation + tag ──
    if (matchesRedeDiniz(currentMsg) && !isHibrido) {
      console.log("[ROUTER] Rede Diniz / Franchising detected — escalation");
      const redeDinizMsg = "Entendido! Vou direcionar para o responsável da nossa equipe. Um momento! 🤝";
      
      // Tag contact as rede_diniz
      const { data: ctData } = await supabase.from("contatos").select("tags, metadata").eq("id", contatoId).single();
      const existingTags: string[] = (ctData?.tags || []);
      if (!existingTags.includes("rede_diniz")) {
        await supabase.from("contatos").update({ tags: [...existingTags, "rede_diniz"] }).eq("id", contatoId);
      }

      // Move to Parcerias column
      const { data: parceriasCol } = await supabase.from("pipeline_colunas").select("id").eq("nome", "Parcerias").limit(1).single();
      if (parceriasCol) {
        await supabase.from("contatos").update({ pipeline_coluna_id: parceriasCol.id }).eq("id", contatoId);
      }

      return await handleNonClientEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, redeDinizMsg, "contato_rede_diniz");
    }

    // ── 2.7. PRE-LLM ROUTER: Fornecedor / B2B → escalation + update tipo ──
    if (matchesFornecedorB2B(currentMsg) && !isHibrido) {
      console.log("[ROUTER] Fornecedor / B2B detected — escalation");
      const fornecedorMsg = "Entendido! Vou direcionar para o responsável da nossa equipe. Um momento! 🤝";
      
      // Update contact type to fornecedor
      await supabase.from("contatos").update({ tipo: "fornecedor" }).eq("id", contatoId);

      // Move to Compras column
      const { data: comprasCol } = await supabase.from("pipeline_colunas").select("id").eq("nome", "Compras").limit(1).single();
      if (comprasCol) {
        await supabase.from("contatos").update({ pipeline_coluna_id: comprasCol.id }).eq("id", contatoId);
      }

      return await handleNonClientEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, fornecedorMsg, "fornecedor_b2b");
    }


    if (matchesSubjectChange(currentMsg)) {
      console.log("[ROUTER] Subject change detected — deterministic response");
      await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, DETERMINISTIC_FALLBACKS_SUBJECT_CHANGE);
      await logEvent(supabase, contatoId, atendimento_id, "router_subject_change", currentMsg);
      return jsonResponse({ status: "ok", tools_used: ["router_subject_change"], intencao: "outro", precisa_humano: false, pipeline_coluna_sugerida: "Novo Contato", modo: atendimento.modo });
    }

    // ── 4. LOAD ALL DATA IN PARALLEL ──
    const [promptRes, compiledRes, kbRes, exRes, antiRes, regrasRes, msgsRes, colRes, setRes, lojasRes, agendRes, contatoMetaRes] = await Promise.all([
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_atendimento").single(),
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_compilado").single(),
      supabase.from("conhecimento_ia").select("categoria, titulo, conteudo").eq("ativo", true),
      supabase.from("ia_exemplos").select("categoria, pergunta, resposta_ideal").eq("ativo", true).limit(30),
      supabase.from("ia_feedbacks").select("motivo, resposta_corrigida").in("avaliacao", ["negativo", "corrigido"]).order("created_at", { ascending: false }).limit(10),
      supabase.from("ia_regras_proibidas").select("regra, categoria").eq("ativo", true),
      supabase.from("mensagens").select("direcao, conteudo, remetente_nome, created_at, tipo_conteudo, metadata")
        .eq("atendimento_id", atendimento_id)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("pipeline_colunas").select("id, nome, setor_id").eq("ativo", true).order("ordem"),
      supabase.from("setores").select("id, nome").eq("ativo", true),
      supabase.from("telefones_lojas").select("nome_loja, telefone, endereco, horario_abertura, horario_fechamento, departamento, google_profile_url").eq("ativo", true),
      supabase.from("agendamentos").select("id, loja_nome, data_horario, status, observacoes").eq("contato_id", contatoId).in("status", ["agendado", "confirmado", "no_show", "recuperacao"]).order("data_horario", { ascending: false }).limit(5),
      supabase.from("contatos").select("metadata, tipo").eq("id", contatoId).single(),
    ]);

    const businessRules = promptRes.data?.valor || "Você é um assistente de atendimento.";
    const compiledPrompt = compiledRes.data?.valor || "";
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
    const contatoMeta = (contatoMetaRes.data?.metadata as Record<string, any>) || {};
    const contatoTipo = (contatoMetaRes.data as any)?.tipo || "cliente";

    // ── Normalize receitas: support legacy ultima_receita + new receitas[] ──
    let receitas: any[] = [];
    if (Array.isArray(contatoMeta.receitas) && contatoMeta.receitas.length > 0) {
      receitas = contatoMeta.receitas;
    } else if (contatoMeta.ultima_receita && contatoMeta.ultima_receita.eyes) {
      // Legacy migration: convert single object to array
      receitas = [{ ...contatoMeta.ultima_receita, label: "cliente" }];
    }

    const inboundCount = allMsgs.filter((m: any) => m.direcao === "inbound").length;
    // Recent outbound for anti-repetition (last 10 only)
    const recentOutbound = allMsgs.filter((m: any) => m.direcao === "outbound").slice(-10).map((m: any) => m.conteudo);
    // Compute latestInboundImageIndex RELATIVE to the context window (last 20), not allMsgs
    const contextWindowOffset = Math.max(0, allMsgs.length - 20);
    const latestInboundImageIndex = [...allMsgs]
      .map((m: any, index: number) => ({ m, index }))
      .filter(({ m }) => m.direcao === "inbound" && (m.tipo_conteudo || "text") === "image")
      .slice(-1)[0]?.index ?? -1;
    // Convert to contextWindow-relative index
    const latestImageCtxIndex = latestInboundImageIndex >= contextWindowOffset
      ? latestInboundImageIndex - contextWindowOffset
      : -1;

    // Detect if the CURRENT message (last inbound) is an image
    const inboundMsgs = allMsgs.filter((m: any) => m.direcao === "inbound");
    const lastInbound = inboundMsgs.slice(-1)[0];
    const lastInboundText = String(lastInbound?.conteudo || currentMsg || "");
    // Check if there's an inbound image among the LAST 5 inbound messages (not just the very last)
    // This catches cases where customer sent prescription, then a short text like "Ok" / "ué" / "?"
    const last5Inbound = inboundMsgs.slice(-5);
    const hasRecentUnparsedPrescriptionImage = last5Inbound.some(
      (m: any) => (m.tipo_conteudo || "text") === "image"
    );
    const customerInsistsAlreadySent = /\bj[aá]\s*mandei\b|\bj[aá]\s*enviei\b|\bja foi\b|\bmande[iy]\b.*\breceita\b|\bcad[eê]\b|\bcad[eê].*receita\b/i.test(lastInboundText);
    // Image context = last msg is image OR there's a pending unparsed image in recent history with no interpretation yet
    const lastIsImage = (lastInbound?.tipo_conteudo || "text") === "image"
      || /\[image\]|\[document\]/.test(currentMsg)
      || (media?.inline_base64 && media?.mime_type?.startsWith("image/"));
    const isImageContext = lastIsImage
      || (hasRecentUnparsedPrescriptionImage && receitas.length === 0);

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
        if (l.google_profile_url) parts.push(`Google: ${l.google_profile_url}`);
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

    // ── 5.05 INJECT PRESCRIPTION CONTEXT ──
    let receitaCtx = "";
    if (receitas.length > 0) {
      receitaCtx = "\n\n# RECEITAS JÁ INTERPRETADAS NESTA CONVERSA\n";
      for (let i = 0; i < receitas.length; i++) {
        const rx = receitas[i];
        const label = rx.label || `receita ${i + 1}`;
        const dataLeitura = rx.data_leitura ? new Date(rx.data_leitura).toLocaleDateString("pt-BR") : "—";
        const rxTypeLabel = rx.rx_type === "progressive" ? "Progressiva" : rx.rx_type === "single_vision" ? "Visão simples" : rx.rx_type || "—";
        const conf = typeof rx.confidence === "number" ? `${(rx.confidence * 100).toFixed(0)}%` : "—";
        const od = rx.eyes?.od || {};
        const oe = rx.eyes?.oe || {};
        const formatEye = (eye: any, name: string) => {
          const parts = [`${name}: esf ${eye.sphere ?? "?"} cil ${eye.cylinder ?? "?"} eixo ${eye.axis ?? "?"}`];
          if (typeof eye.add === "number") parts.push(`add +${eye.add}`);
          return parts.join(" ");
        };
        receitaCtx += `\n## Receita ${i + 1} (${label}) — lida em ${dataLeitura}\n`;
        receitaCtx += `Tipo: ${rxTypeLabel} | Confiança: ${conf}\n`;
        receitaCtx += `${formatEye(od, "OD")}\n`;
        receitaCtx += `${formatEye(oe, "OE")}\n`;
      }
      receitaCtx += `\n⚠️ NÃO peça receita novamente. O cliente JÁ enviou. Use consultar_lentes referenciando a receita correta.`;
      if (receitas.length > 1) {
        receitaCtx += `\nQuando o cliente pedir orçamento, pergunte "Para qual receita?" antes de chamar consultar_lentes.`;
      }
      console.log(`[RX-CTX] Injecting ${receitas.length} prescription(s) into context`);
    }

    // ── 5.1 DECIDE: compiled prompt vs legacy ──
    let systemPrompt: string;

    if (compiledPrompt) {
      // USE COMPILED PROMPT with slot replacement
      let lojasStr = "";
      if (lojas.length > 0) {
        lojasStr = "## LOJAS DISPONÍVEIS\n";
        for (const l of lojas) {
          const parts = [`**${l.nome_loja}**`];
          if (l.endereco) parts.push(l.endereco);
          if (l.horario_abertura && l.horario_fechamento) parts.push(`Horário: ${l.horario_abertura}-${l.horario_fechamento}`);
          if (l.telefone) parts.push(`Tel: ${l.telefone}`);
          if (l.departamento && l.departamento !== "geral") parts.push(`Depto: ${l.departamento}`);
          lojasStr += `- ${parts.join(" | ")}\n`;
        }
      }

      // Filter columns by contact type — clients only see sales columns (setor_id = null)
      const ATENDIMENTO_CORPORATIVO_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";
      const isCorporateContact = ["loja", "colaborador"].includes(contatoTipo);
      const promptColunas = isCorporateContact
        ? colunas.filter((c: any) => c.setor_id === ATENDIMENTO_CORPORATIVO_SETOR_ID)
        : colunas.filter((c: any) => c.setor_id === null);

      systemPrompt = buildSystemPromptFromCompiled({
        compiledPrompt,
        regrasProibidas: regrasProibidas as { regra: string; categoria: string }[],
        knowledge: knowledgeStr,
        agendamentoCtx,
        receitaCtx,
        lojasStr,
        sentTopics,
        colunasNomes: promptColunas.map((c: any) => c.nome).join(", "),
        setoresNomes: setores.map((s: any) => s.nome).join(", "),
        inboundCount,
        isHibrido,
        hasKnowledge: conhecimentos.length > 0 || lojas.length > 0,
        escalatedSubject,
      });

      console.log(`[CONTEXT] Using COMPILED prompt (${compiledPrompt.length}ch) with slot replacement`);
    } else {
      // LEGACY: contextual retrieval + separate blocks
      const signals = detectSignals(currentMsg);
      const prioritizedExemplos = prioritizeExamples(exemplos as any[], signals);
      const prioritizedFeedbacks = prioritizeFeedbacks(antiFeedbacks as any[], signals, currentMsg);

      console.log(`[CONTEXT-v1] Signals: ${signals.join(",") || "none"} | Exemplos: ${prioritizedExemplos.length} (${exemplos.length} total) | Feedbacks: ${prioritizedFeedbacks.length} (${antiFeedbacks.length} total)`);

      let examplesStr = "";
      if (prioritizedExemplos.length > 0) {
        examplesStr = prioritizedExemplos.map((e: any) => `[${e.categoria}] P: "${e.pergunta}" → R: "${e.resposta_ideal}"`).join("\n");
      }

      let antiStr = "";
      if (prioritizedFeedbacks.length > 0) {
        antiStr = prioritizedFeedbacks.filter((f: any) => f.motivo).map((f: any) => `- ${f.motivo}${f.resposta_corrigida ? ` → Correto: ${f.resposta_corrigida}` : ""}`).join("\n");
      }

      // Filter columns by contact type for legacy path too
      const ATENDIMENTO_CORPORATIVO_SETOR_ID_LEGACY = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";
      const isCorporateLegacy = ["loja", "colaborador"].includes(contatoTipo);
      const promptColunasLegacy = isCorporateLegacy
        ? colunas.filter((c: any) => c.setor_id === ATENDIMENTO_CORPORATIVO_SETOR_ID_LEGACY)
        : colunas.filter((c: any) => c.setor_id === null);

      systemPrompt = buildSystemPrompt({
        businessRules,
        knowledge: knowledgeStr + agendamentoCtx + receitaCtx,
        examples: examplesStr,
        antiExamples: antiStr,
        regrasProibidas: regrasProibidas as { regra: string; categoria: string }[],
        sentTopics,
        colunasNomes: promptColunasLegacy.map((c: any) => c.nome).join(", "),
        setoresNomes: setores.map((s: any) => s.nome).join(", "),
        inboundCount,
        isHibrido,
        hasKnowledge: conhecimentos.length > 0 || lojas.length > 0,
        escalatedSubject,
      });
    }

    // ── 6. BUILD MESSAGES — use last 20 from the 60 loaded ──
    const contextWindow = allMsgs.slice(-20);

    // Detect pending intent (used for devolução humano→ia, but informative in any case)
    const recentInboundTexts = allMsgs
      .filter((m: any) => m.direcao === "inbound")
      .slice(-5)
      .map((m: any) => String(m.conteudo || ""));
    const pendingIntent = detectPendingIntent(
      recentInboundTexts,
      hasRecentUnparsedPrescriptionImage,
      receitas.length > 0,
    );
    if (isDevolucaoHumanoIA) {
      console.log(`[DEVOLUCAO] pending_intent=${pendingIntent?.intent || "none"}`);
    }

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      {
        role: "system",
        content:
          "INTERPRETAÇÃO DO HISTÓRICO: mensagens com prefixo [HUMANO - Nome] foram enviadas pela equipe humana; [IA], [SISTEMA], [RECUPERAÇÃO] e [BOT LOJAS] são saídas automáticas/assistidas já enviadas ao cliente; mensagens com role user são do cliente. Use isso para continuidade e nunca confunda mensagem humana com mensagem do cliente.",
      },
      ...(isDevolucaoHumanoIA
        ? [{
            role: "system",
            content: `[CONTEXTO: DEVOLUÇÃO HUMANO→IA] O operador humano acabou de devolver esta conversa para você continuar.
- Analise as últimas 10 mensagens e identifique a INTENÇÃO PENDENTE do cliente (ex: agendar, pedir preço, endereço, confirmar horário, dúvida sobre receita).
- Continue NATURALMENTE de onde a conversa parou. NÃO se reapresente. NÃO diga "Quer que eu retome?" nem mensagens genéricas tipo "Sobre o que estávamos falando".
- Aja sobre a intenção pendente: use a tool correta (responder, agendar_cliente, consultar_lentes, interpretar_receita) com base no que o cliente pediu por último.
- Se houver imagem inbound não interpretada nas últimas 5 mensagens, PRIORIZE interpretar_receita.
- NÃO escale para humano novamente, exceto se: (a) surgir reclamação grave NOVA após a devolução, (b) cliente pedir explicitamente "falar com humano" agora, ou (c) bloqueio técnico real (ex: receita ilegível após tentativa). NÃO escale pelo MESMO motivo já tratado pela equipe humana.
- Se as últimas mensagens forem vagas e nenhuma intenção for clara, responda CURTO e contextual ("Voltei pra te ajudar — em que posso continuar?") em vez de escalar.${pendingIntent ? `\n\nINTENÇÃO PENDENTE DETECTADA: ${pendingIntent.intent.toUpperCase()} — ${pendingIntent.hint}` : ""}`,
          }]
        : []),
      ...(hasRecentUnparsedPrescriptionImage && receitas.length === 0
        ? [{
            role: "system",
            content: "[SISTEMA: PRIORIDADE MÁXIMA — RECEITA PENDENTE] O cliente enviou uma imagem (provável receita) nas últimas mensagens e ela AINDA NÃO foi interpretada (RECEITAS JÁ INTERPRETADAS está vazio). REGRAS: 1) Você DEVE chamar a tool interpretar_receita usando a imagem mais recente entregue no histórico, ANTES de qualquer outra ação (não escale, não peça reenvio, não responda genericamente). 2) Se a imagem foi entregue ao modelo, use-a — mesmo que a última mensagem do cliente seja curta ('ok', 'então?', 'cadê'). 3) Só peça reenvio se o sistema avisar explicitamente que a imagem NÃO foi entregue. 4) Só escale para humano se a imagem estiver claramente ilegível APÓS a tentativa de interpretação.]",
          }]
        : []),
    ];

    for (const [i, m] of contextWindow.entries()) {
      const role = m.direcao === "inbound" ? "user" : "assistant";
      if (m.direcao === "internal") continue;

      const mediaUrl = (m.metadata as any)?.media_url;
      const tipo = (m as any).tipo_conteudo || "text";

      if (tipo === "image" && role === "user") {
        const imageCaption = m.conteudo && m.conteudo !== "[image]"
          ? m.conteudo
          : "[Cliente enviou uma imagem/receita]";

        let imageContent: any | null = null;
        try {
          // Use context-window-relative index for inline_base64 matching
          const isCurrentImage = latestImageCtxIndex === i;
          const inlineBase64 = isCurrentImage ? media?.inline_base64 : null;
          const inlineMime = isCurrentImage ? media?.mime_type : null;

          if (inlineBase64 && inlineMime) {
            imageContent = imageContentFromBase64(inlineBase64, inlineMime);
            if (imageContent) console.log(`[MEDIA] Image delivered via inline_base64 (ctx index ${i})`);
          }

          if (!imageContent && mediaUrl) {
            // Retry up to 3x with growing timeout (handles old/orphan images and slow CDN)
            const attempts = [6000, 8000, 10000];
            for (let attempt = 0; attempt < attempts.length && !imageContent; attempt++) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), attempts[attempt]);
                const imgResp = await fetch(mediaUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (imgResp.ok) {
                  const imgBuffer = new Uint8Array(await imgResp.arrayBuffer());
                  const rawMime = String((m.metadata as any)?.mime_type || imgResp.headers.get("content-type") || "image/jpeg")
                    .split(";")[0]
                    .trim()
                    .toLowerCase();
                  const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;

                  if (hasSupportedImageSignature(imgBuffer)) {
                    let binary = "";
                    const chunkSize = 8192;
                    for (let j = 0; j < imgBuffer.length; j += chunkSize) {
                      binary += String.fromCharCode(...imgBuffer.subarray(j, j + chunkSize));
                    }
                    imageContent = imageContentFromBase64(btoa(binary), mimeType);
                    if (imageContent) console.log(`[MEDIA] Image delivered via media_url download (ctx index ${i}, attempt ${attempt + 1})`);
                  } else {
                    console.warn(`[MEDIA] Unsupported image signature (ctx index ${i}, attempt ${attempt + 1})`);
                    break; // signature won't change between retries
                  }
                } else {
                  console.warn(`[MEDIA] media_url returned ${imgResp.status} (ctx index ${i}, attempt ${attempt + 1})`);
                }
              } catch (dlErr) {
                console.warn(`[MEDIA] Download attempt ${attempt + 1} failed for media_url (timeout/error):`, dlErr);
              }
            }
          }

          if (!imageContent) {
            const warnMime = String((m.metadata as any)?.mime_type || media?.mime_type || "unknown");
            console.warn(`[MEDIA] Failed to deliver image to AI: mime=${warnMime}, isCurrentImage=${isCurrentImage}, hasMediaUrl=${!!mediaUrl}`);
          }
        } catch (e) {
          console.warn(`[MEDIA] Failed to prepare image for AI:`, e);
        }

        if (imageContent) {
          const content: any[] = [imageContent];
          if (m.conteudo && m.conteudo !== "[image]") content.push({ type: "text", text: m.conteudo });
          messages.push({ role, content });
        } else {
          // Image could not be delivered to the model. NEVER pretend we read it.
          messages.push({ role, content: imageCaption });
          messages.push({
            role: "system",
            content: "[SISTEMA: ⚠️ Há uma imagem do cliente no histórico que NÃO foi entregue ao modelo (falha de download). NUNCA diga 'recebi sua receita', 'parece ser uma receita' ou similar. NÃO chame interpretar_receita. Peça ao cliente que reenvie a foto da receita com boa iluminação, sem reflexos, segurando firme. Se ele já reclamou que enviou ('já mandei'), peça desculpa pelo problema técnico e oriente o reenvio uma única vez.]",
          });
        }
      } else {
        const sender = String(m.remetente_nome || "").trim();
        const prefixMap: Record<string, string> = {
          "Assistente IA": "[IA] ",
          "Sistema": "[SISTEMA] ",
          "Recuperação": "[RECUPERAÇÃO] ",
          "Bot Lojas": "[BOT LOJAS] ",
        };
        const prefix = role === "assistant"
          ? (prefixMap[sender] ?? (sender ? `[HUMANO - ${sender}] ` : ""))
          : "";
        messages.push({ role, content: prefix + m.conteudo });
      }
    }

    const historyRange = contextWindow.length > 0
      ? `${contextWindow[0]?.created_at} → ${contextWindow[contextWindow.length - 1]?.created_at}`
      : "empty";

    console.log(`[CONTEXT] Prompt:${systemPrompt.length}ch | KB:${conhecimentos.length} | Ex:${exemplos.length} | Anti:${antiFeedbacks.length} | Regras:${regrasProibidas.length} | Modo:${atendimento.modo} | Window:${contextWindow.length}/${allMsgs.length} | Range:${historyRange} | Topics:${sentTopics.join(",") || "none"}`);

    // ── 6.5. PRE-LLM LOOP DETECTOR + FORCED INTENT MAPPING ──
    // Runs BEFORE the LLM call so it can override the prompt and prevent the
    // model from generating yet another semantically-identical response.
    const loopCheck = detectLoop(recentOutbound);
    const forcedIntent = detectForcedToolIntent(
      lastInboundText,
      receitas.length > 0,
      hasRecentUnparsedPrescriptionImage && receitas.length === 0,
    );

    if (loopCheck.detected) {
      console.log(`[LOOP-DETECTOR] Loop detected — similarity=${(loopCheck.similarity * 100).toFixed(0)}%`);
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId, tipo: "loop_ia_detectado_pre_llm",
        descricao: `Loop detectado pré-LLM (similaridade ${(loopCheck.similarity * 100).toFixed(0)}%)`,
        metadata: {
          similarity: loopCheck.similarity,
          forced_intent: forcedIntent?.tool || null,
          last_inbound: lastInboundText.substring(0, 200),
        },
        referencia_tipo: "atendimento", referencia_id: atendimento_id,
      });

      if (forcedIntent) {
        const forceMsg = forcedIntent.tool === "consultar_lentes"
          ? "[SISTEMA: LOOP DETECTADO + INTENT CLARO] Você está repetindo a mesma pergunta. O cliente JÁ pediu orçamento e há receita salva. AÇÃO OBRIGATÓRIA: chame consultar_lentes AGORA com a receita mais recente. NÃO pergunte de novo o que ele quer."
          : forcedIntent.tool === "interpretar_receita"
          ? "[SISTEMA: LOOP DETECTADO + IMAGEM PENDENTE] Você está repetindo a mesma pergunta. O cliente já enviou uma imagem (provável receita) e pediu orçamento. AÇÃO OBRIGATÓRIA: chame interpretar_receita AGORA usando a imagem do histórico. NÃO pergunte se pode analisar — analise."
          : forcedIntent.tool === "agendar_cliente_intent"
          ? "[SISTEMA: LOOP DETECTADO + INTENT AGENDAR] Você está repetindo a mesma pergunta. O cliente quer agendar. Se já tem loja+data+hora, chame agendar_visita. Caso contrário, faça UMA pergunta objetiva pedindo o que falta — sem repetir o prompt anterior."
          : "[SISTEMA: LOOP DETECTADO] Você está repetindo a mesma pergunta. Mude a abordagem — faça uma pergunta diferente OU execute uma ação concreta. NÃO repita a frase anterior.";
        messages.push({ role: "system", content: forceMsg });
        console.log(`[LOOP-DETECTOR] Forcing tool=${forcedIntent.tool} (${forcedIntent.reason})`);
      } else {
        console.log(`[LOOP-DETECTOR] No clear intent — escalating to human`);
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "loop_ia_escalado",
          descricao: `Loop sem intent claro — escalado para humano (similaridade ${(loopCheck.similarity * 100).toFixed(0)}%)`,
          metadata: { similarity: loopCheck.similarity, last_inbound: lastInboundText.substring(0, 200) },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento_id);
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id,
          "Vou chamar alguém da equipe pra te ajudar melhor com isso, tá? 😊");
        return jsonResponse({
          status: "ok", tools_used: ["loop_escalation"], intencao: "outro",
          precisa_humano: true, pipeline_coluna_sugerida: "Novo Contato", modo: "humano",
        });
      }
    } else if (forcedIntent && (forcedIntent.tool === "consultar_lentes" || forcedIntent.tool === "interpretar_receita")) {
      const hint = forcedIntent.tool === "consultar_lentes"
        ? "[SISTEMA: INTENT CLARO] Cliente pediu orçamento e há receita salva. Use consultar_lentes — NÃO pergunte de novo o que ele prefere."
        : "[SISTEMA: INTENT CLARO] Cliente pediu orçamento e há imagem pendente. Use interpretar_receita AGORA — não pergunte se pode analisar.";
      messages.push({ role: "system", content: hint });
      console.log(`[INTENT-FORCE] Hinting ${forcedIntent.tool} (no loop, but clear intent)`);
    }

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
          max_completion_tokens: 2500,
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
        const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext);
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
        // ── ANTI-REESCALATION on humano→ia handoff ──
        // If we just got the conversation back from a human, block escalations that
        // recycle a motive already handled (no new explicit human request, no fresh complaint).
        const motivoStr = String(args.motivo || "").toLowerCase();
        const lastInboundLower = String(lastInbound?.conteudo || currentMsg || "").toLowerCase();
        const explicitHumanRequest = /\b(falar|atend|consult|pessoa|humano|gerente|respons[aá]vel)\b/.test(lastInboundLower) && /\b(humano|pessoa|gente|consultor|atendente|gerente)\b/.test(lastInboundLower);
        const freshComplaint = /\b(reclama[cç][aã]o|p[eé]ssimo|horr[ií]vel|absurdo|cancelar|nunca mais|processar|procon)\b/.test(lastInboundLower);
        if (isDevolucaoHumanoIA && !explicitHumanRequest && !freshComplaint) {
          console.log(`[DEVOLUCAO] Blocking inherited escalation (motivo="${motivoStr}") — forcing continuity`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId, tipo: "ia_escalada_bloqueada_pos_devolucao",
            descricao: `IA tentou escalar pós-devolução com motivo: ${args.motivo}`,
            metadata: { motivo: args.motivo, setor: args.setor, pending_intent: pendingIntent?.intent || null },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          // Skip this tool call — let other tools (or fallback) take over.
          // If this was the only tool call, force a deterministic continuity reply below.
          if (toolCalls.length === 1) {
            const intentText = pendingIntent
              ? (pendingIntent.intent === "scheduling" ? "Voltei pra continuar com você. Quer marcar pra qual loja e qual horário fica melhor?"
                : pendingIntent.intent === "quote" ? "Voltei aqui pra te ajudar com o orçamento. Já tenho sua receita? Se sim, me confirma o que prefere (marca, antirreflexo, fotossensível) que já te passo as opções."
                : pendingIntent.intent === "location" ? "Voltei pra te ajudar! Me diz qual loja você quer saber o endereço que eu te passo."
                : pendingIntent.intent === "prescription_pending" ? "Voltei aqui — vou olhar a receita que você mandou e já te respondo."
                : "Voltei pra te ajudar — em que posso continuar?")
              : "Voltei pra te ajudar — em que posso continuar?";
            resposta = intentText;
            intencao = pendingIntent?.intent || "outro";
            pipeline_coluna = "Novo Contato";
            precisa_humano = false;
            validatorFlags.push("blocked_inherited_escalation");
          }
          continue;
        }

        resposta = args.resposta;
        precisa_humano = true;
        // Keep contact in current column — human intervention is managed via modo='humano' flag
        pipeline_coluna = "Novo Contato"; // Will be ignored since precisa_humano skips column move
        setor_sugerido = args.setor || "";

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "escalonamento_humano",
          descricao: `IA escalou: ${args.motivo}`,
          metadata: { motivo: args.motivo, setor: args.setor, pos_devolucao: isDevolucaoHumanoIA },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

      } else if (fn === "interpretar_receita") {
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";

        // ── QUOTE ENGINE: deterministic post-processing ──
        const od = args.eyes?.od || {};
        const oe = args.eyes?.oe || {};
        const confidence = typeof args.confidence === "number" ? args.confidence : 0.75;

        const addValues = [od.add, oe.add].filter((v: any) => typeof v === "number") as number[];
        const sphereValues = [od.sphere, oe.sphere].filter((v: any) => typeof v === "number") as number[];
        const cylValues = [od.cylinder, oe.cylinder].filter((v: any) => typeof v === "number") as number[];

        const hasAddition = addValues.length > 0;
        const hasMyopia = sphereValues.some((v: number) => v < 0);
        const hasHyperopia = sphereValues.some((v: number) => v > 0);
        const hasAstigmatism = cylValues.some((v: number) => v !== 0);

        let rxType = "unknown";
        if (hasAddition) rxType = "progressive";
        else if (sphereValues.length > 0 || cylValues.length > 0) rxType = "single_vision";

        const needsHumanReview = confidence < 0.80;

        // Build standardized RX data
        const rxData = {
          rx_type: rxType,
          eyes: { od, oe },
          pd: args.pd ?? null,
          issued_at: args.issued_at ?? null,
          summary: { has_myopia: hasMyopia, has_hyperopia: hasHyperopia, has_astigmatism: hasAstigmatism, has_addition: hasAddition, needs_progressive: hasAddition, suggested_category: rxType },
          confidence,
          needs_human_review: needsHumanReview,
          missing_fields: args.missing_fields || [],
          raw_notes: args.raw_notes || [],
          data_leitura: new Date().toISOString(),
        };

        // Save to contact metadata — append to receitas[] array (max 5, FIFO)
        const { data: contatoData } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
        const existingMeta = (contatoData?.metadata as Record<string, any>) || {};
        
        // Normalize existing receitas
        let existingReceitas: any[] = [];
        if (Array.isArray(existingMeta.receitas)) {
          existingReceitas = existingMeta.receitas;
        } else if (existingMeta.ultima_receita && existingMeta.ultima_receita.eyes) {
          existingReceitas = [{ ...existingMeta.ultima_receita, label: "cliente" }];
        }
        
        // Add label from model args or infer
        const rxLabel = args.label || (existingReceitas.length === 0 ? "cliente" : `pessoa_${existingReceitas.length + 1}`);
        const rxWithLabel = { ...rxData, label: rxLabel };
        
        // Append and cap at 5 (FIFO)
        existingReceitas.push(rxWithLabel);
        if (existingReceitas.length > 5) existingReceitas = existingReceitas.slice(-5);
        
        await supabase.from("contatos").update({
          metadata: { ...existingMeta, receitas: existingReceitas, ultima_receita: rxData },
        }).eq("id", contatoId);

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "receita_interpretada",
          descricao: `Receita: OD esf=${od.sphere ?? "?"} cil=${od.cylinder ?? "?"} OE esf=${oe.sphere ?? "?"} cil=${oe.cylinder ?? "?"} — ${rxType} (conf: ${(confidence * 100).toFixed(0)}%)`,
          metadata: rxData, referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

        // DON'T auto-quote — wait for client direction
        // Just confirm the prescription and let the AI ask what the client needs
        if (needsHumanReview) {
          resposta = "Consegui ler boa parte da sua receita, mas quero te passar a opção certinha. Posso te mostrar uma base e confirmar na loja? 😊";
          console.log(`[RX] Low confidence (${(confidence * 100).toFixed(0)}%) — cautious response`);
        } else {
          resposta = args.resposta;
        }
        console.log(`[RX] Prescription saved: ${rxType} conf=${(confidence * 100).toFixed(0)}% — waiting for client direction`);

      } else if (fn === "consultar_lentes") {
        // ── QUOTE ENGINE: triggered by client interest ──
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";

        // Load saved prescriptions from contact metadata
        const { data: contatoRx } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
        const contatoRxMeta = (contatoRx?.metadata as Record<string, any>) || {};
        
        // Resolve which prescription to use
        let allRx: any[] = [];
        if (Array.isArray(contatoRxMeta.receitas) && contatoRxMeta.receitas.length > 0) {
          allRx = contatoRxMeta.receitas;
        } else if (contatoRxMeta.ultima_receita && contatoRxMeta.ultima_receita.eyes) {
          allRx = [{ ...contatoRxMeta.ultima_receita, label: "cliente" }];
        }
        
        // Select by label or use most recent
        let rxMeta: any = null;
        if (allRx.length > 0) {
          if (args.receita_label) {
            rxMeta = allRx.find((r: any) => norm(r.label || "") === norm(args.receita_label)) || allRx[allRx.length - 1];
          } else {
            rxMeta = allRx[allRx.length - 1]; // Most recent
          }
          console.log(`[QUOTE] Using prescription label="${rxMeta?.label}" from ${allRx.length} available`);
        }

        if (!rxMeta || !rxMeta.eyes) {
          resposta = args.resposta_fallback || "Ainda não tenho sua receita. Me envia uma foto da receita que eu já busco as melhores opções pra você! 📸";
          console.log("[QUOTE] No prescription found for contact");
        } else {
          const od = rxMeta.eyes.od || {};
          const oe = rxMeta.eyes.oe || {};
          const rxType = rxMeta.rx_type || "unknown";
          const sphereValues = [od.sphere, oe.sphere].filter((v: any) => typeof v === "number") as number[];
          const cylValues = [od.cylinder, oe.cylinder].filter((v: any) => typeof v === "number") as number[];
          const addValues = [od.add, oe.add].filter((v: any) => typeof v === "number") as number[];

          if (rxType === "unknown" || sphereValues.length === 0) {
            resposta = args.resposta_fallback || "Não consegui identificar o grau completo da receita. Pode me enviar outra foto mais nítida?";
          } else {
            const worstSphere = sphereValues.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0);
            const worstCylinder = cylValues.length > 0 ? cylValues.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0) : 0;
            const maxAdd = addValues.length > 0 ? Math.max(...addValues) : null;
            const hasAddition = addValues.length > 0;

            // Map rxType to compatible DB categories
            const categoryMap: Record<string, string[]> = {
              single_vision: ["single_vision", "single_vision_digital", "single_vision_stock", "single_vision_digital_kids"],
              progressive: ["progressive", "occupational"],
            };
            const categories = categoryMap[rxType] || [rxType];

            let query = supabase
              .from("pricing_table_lentes")
              .select("*")
              .eq("active", true)
              .in("category", categories)
              .gt("price_brl", 0)
              .lte("sphere_min", worstSphere)
              .gte("sphere_max", worstSphere)
              .lte("cylinder_min", worstCylinder)
              .gte("cylinder_max", worstCylinder);

            if (rxType === "progressive" && maxAdd !== null) {
              query = query.lte("add_min", maxAdd).gte("add_max", maxAdd);
            }

            // Apply client preference filters
            if (args.filtro_blue === true) query = query.eq("blue", true);
            if (args.filtro_photo === true) query = query.eq("photo", true);
            if (args.preferencia_marca) query = query.ilike("brand", `%${args.preferencia_marca}%`);

            const { data: lenses } = await query.order("priority", { ascending: true }).order("price_brl", { ascending: true }).limit(20);

            if (lenses && lenses.length > 0) {
              const economy = lenses[0];
              const premium = lenses[lenses.length - 1];
              const midIndex = Math.floor(lenses.length / 2);
              const mid = lenses.length >= 3 ? lenses[midIndex] : null;

              const formatLens = (l: any, label: string) =>
                `${label}: *${l.brand} ${l.family}* | Índice ${l.index_name} | ${l.treatment}${l.blue ? " + Filtro Azul" : ""}${l.photo ? " + Fotossensível" : ""} — *R$ ${Number(l.price_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}*`;

              let quoteMsg = `🔍 *Opções de lentes para o seu grau:*\nOD ${od.sphere ?? "—"}/${od.cylinder ?? "—"} | OE ${oe.sphere ?? "—"}/${oe.cylinder ?? "—"}${hasAddition ? ` | Ad: +${maxAdd}` : ""}\n\n`;
              quoteMsg += formatLens(economy, "💚 Econômica");
              if (mid && mid.id !== economy.id && mid.id !== premium.id) {
                quoteMsg += "\n" + formatLens(mid, "💛 Intermediária");
              }
              if (premium.id !== economy.id) {
                quoteMsg += "\n" + formatLens(premium, "💎 Premium");
              }
              quoteMsg += "\n\nQuer que eu detalhe alguma opção ou prefere agendar uma visita para conhecer nossas armações e fechar presencialmente?";

              resposta = quoteMsg;
              console.log(`[QUOTE] Found ${lenses.length} lenses for ${rxType} sphere=${worstSphere} cyl=${worstCylinder} add=${maxAdd}`);
            } else {
              resposta = args.resposta_fallback || "Para esse grau específico, vou encaminhar para um Consultor que pode detalhar as melhores opções. Posso fazer isso agora?";
              console.log(`[QUOTE] No matching lenses for ${rxType} sphere=${worstSphere} cyl=${worstCylinder} add=${maxAdd}`);
            }
          }
        }
      } else if (fn === "agendar_visita" || fn === "reagendar_visita") {
        resposta = args.resposta;
        intencao = "agendamento";
        pipeline_coluna = "Agendamento";

        // Find loja telephone
        const lojaMatch = lojas.find((l: any) => l.nome_loja.toLowerCase() === (args.loja_nome || "").toLowerCase());

        // ── Build standardized appointment confirmation block (tabulated) ──
        // Strip any raw URLs the LLM may have inserted, then append a clean address block.
        try {
          // Remove URLs and "perfil da loja" trailers from the LLM response
          let cleaned = (resposta || "")
            .replace(/https?:\/\/\S+/gi, "")
            .replace(/aqui está[^.]*?(perfil|localiza[cç][aã]o|link)[^.]*\.?/gi, "")
            .replace(/segue[^.]*?(perfil|link)[^.]*\.?/gi, "")
            .replace(/\s{2,}/g, " ")
            .trim();

          const dt = new Date(args.data_horario);
          const dataFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
          const horaFmt = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

          let bloco = `\n\n📍 *Agendamento confirmado*\n`;
          bloco += `🏬 Loja: ${args.loja_nome}\n`;
          bloco += `📅 Data: ${dataFmt}\n`;
          bloco += `⏰ Horário: ${horaFmt}h`;
          if (lojaMatch?.endereco) {
            bloco += `\n🗺️ Endereço: ${lojaMatch.endereco}`;
          }

          resposta = `${cleaned}${bloco}`;
        } catch (e) {
          console.error("[TOOL] failed to format appointment block:", e);
        }

        // If reagendar, mark old agendamento as reagendado
        if (fn === "reagendar_visita") {
          const oldNoShow = agendamentosAtivos.find((a: any) => a.status === "no_show" || a.status === "recuperacao");
          if (oldNoShow) {
            await supabase.from("agendamentos").update({ status: "reagendado" }).eq("id", oldNoShow.id);
          }
        }

        // Check for duplicate: same contact + same store + same date
        const targetDate = (args.data_horario || "").substring(0, 10);
        const jaExiste = agendamentosAtivos.some((a: any) =>
          a.loja_nome?.toLowerCase() === (args.loja_nome || "").toLowerCase() &&
          (a.data_horario || "").substring(0, 10) === targetDate &&
          (a.status === "agendado" || a.status === "confirmado")
        );

        if (jaExiste) {
          console.log(`[TOOL] Duplicate agendamento detected for ${args.loja_nome} on ${targetDate} — skipping creation`);
        } else {
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
        }

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: fn === "reagendar_visita" ? "reagendamento_visita" : "agendamento_visita",
          descricao: `${fn === "reagendar_visita" ? "Reagendamento" : "Agendamento"}: ${args.loja_nome} em ${args.data_horario}`,
          metadata: args,
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });
      } else if (fn === "agendar_lembrete") {
        resposta = args.resposta;
        intencao = "lembrete";

        try {
          await supabase.from("lembretes").insert({
            contato_id: contatoId,
            atendimento_id,
            mensagem: args.mensagem,
            data_disparo: args.data_disparo,
          });

          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "lembrete_agendado",
            descricao: `Lembrete agendado para ${new Date(args.data_disparo).toLocaleDateString("pt-BR")}`,
            metadata: { mensagem: args.mensagem, data_disparo: args.data_disparo },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });

          console.log(`[TOOL] agendar_lembrete: ${args.data_disparo} — "${args.mensagem.substring(0, 50)}..."`);
        } catch (e) {
          console.error("[TOOL] agendar_lembrete failed:", e);
        }
      }
    }

    // ── 9. POST-LLM VALIDATION (Phase 3) ──
    if (resposta && !precisa_humano) {
      const validation = validateResponse(resposta, recentOutbound);

      if (!validation.valid) {
        console.log(`[VALIDATOR] REJECTED: ${validation.reason} — isImageContext=${isImageContext}`);
        validatorFlags.push(`rejected:${validation.reason}`);

        // IMAGE CONTEXT: NEVER use generic fallback — always use image-specific response
        if (isImageContext) {
          // If AI produced a response about the image but it was rejected for similarity/blacklist,
          // keep it if it mentions receita/imagem, otherwise use image fallback
          const mentionsImage = /receita|imagem|foto|envio|document|lente|grau/i.test(resposta);
          if (mentionsImage && resposta.length > 30) {
            // Append a contextual question
            resposta = resposta.trimEnd().replace(/[.!]$/, "") + ". Quer que eu analise pra você?";
            validatorFlags.push("image_context_appended");
            console.log("[VALIDATOR] Image context — kept AI response with appended question");
          } else {
            resposta = imageContextFallback(recentOutbound);
            intencao = "receita_oftalmologica";
            pipeline_coluna = "Orçamento";
            validatorFlags.push("image_context_fallback");
            console.log("[VALIDATOR] Image context — using dedicated image fallback");
          }
        } else if (validation.reason.includes("no question or action") && resposta.length > 40) {
          const appendPool = [
            "Quer que eu siga por aqui?",
            "Posso te ajudar com mais alguma coisa?",
            "O que acha?",
            "Quer que eu detalhe?",
            "Posso seguir nessa linha?",
          ];
          const appendQ = appendPool[Math.floor(Math.random() * appendPool.length)];
          resposta = resposta.trimEnd().replace(/[.!]$/, "") + ". " + appendQ;
          validatorFlags.push("appended_question");
          console.log("[VALIDATOR] Appended contextual question to response");
        } else {
          // One retry with explicit correction
          const retryResult = await callAI(
            `CORREÇÃO: Sua resposta anterior foi rejeitada porque: ${validation.reason}. Gere uma resposta COMPLETAMENTE DIFERENTE que avance a conversa com uma PERGUNTA OBJETIVA. Considere o CONTEXTO COMPLETO da conversa — o cliente pode estar no meio de um fluxo (agendamento, orçamento, etc). NÃO use frases genéricas como "me conta mais".`
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
              if (retryResposta && retryResposta.length > 30) {
                resposta = retryResposta.trimEnd().replace(/[.!]$/, "") + ". O que precisa?";
                validatorFlags.push("retry_appended_question");
                console.log("[VALIDATOR] Retry response kept with appended question");
              } else {
                const fb = /receita|grau|prescri[cç][aã]o|\[image\]|enviei minha receita|recebeu minha receita/i.test(currentMsg)
                  ? null
                  : pickFallback(recentOutbound);
                if (fb) {
                  resposta = fb;
                  validatorFlags.push("deterministic_fallback");
                  console.log("[VALIDATOR] Using rotating fallback");
                } else {
                  const contextualFallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext);
                  resposta = contextualFallback.resposta;
                  intencao = contextualFallback.intencao;
                  pipeline_coluna = contextualFallback.pipeline_coluna;
                  precisa_humano = contextualFallback.precisa_humano;
                  validatorFlags.push("contextual_deterministic_fallback");
                  console.log("[VALIDATOR] Contextual deterministic fallback applied");
                }
              }
            }
          } else {
            const fb = /receita|grau|prescri[cç][aã]o|\[image\]|enviei minha receita|recebeu minha receita/i.test(currentMsg)
              ? null
              : pickFallback(recentOutbound);
            if (fb) {
              resposta = fb;
              validatorFlags.push("deterministic_fallback");
            } else {
              const contextualFallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext);
              resposta = contextualFallback.resposta;
              intencao = contextualFallback.intencao;
              pipeline_coluna = contextualFallback.pipeline_coluna;
              precisa_humano = contextualFallback.precisa_humano;
              validatorFlags.push("contextual_deterministic_fallback");
            }
          }
        }
      } else {
        validatorFlags.push("passed");
      }
    }

    if (!resposta) {
      // If image context with no response, use dedicated image fallback
      if (isImageContext) {
        resposta = imageContextFallback(recentOutbound);
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";
        validatorFlags.push("empty_response_image_fallback");
      } else {
        const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext);
        resposta = fallback.resposta;
        intencao = fallback.intencao;
        pipeline_coluna = fallback.pipeline_coluna;
        precisa_humano = fallback.precisa_humano;
        validatorFlags.push("empty_response_deterministic");
      }
    }

    // ── 10. SEND RESPONSE ──
    await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, resposta);

    // ── 10.1. AUDIO NUDGE — gently encourage text over audio ──
    if (isTranscribedAudio) {
      // Count how many audio messages this contact has sent in this atendimento
      const { count: audioCount } = await supabase
        .from("mensagens")
        .select("id", { count: "exact", head: true })
        .eq("atendimento_id", atendimento_id)
        .eq("direcao", "inbound")
        .not("metadata->transcribed_from", "is", null);

      const totalAudios = audioCount || 1;
      console.log(`[AUDIO-NUDGE] Contact has sent ${totalAudios} audio(s) in this atendimento`);

      // Nudge on 1st audio, then every 3rd audio
      if (totalAudios === 1 || totalAudios % 3 === 0) {
        const nudges = [
          "💡 Dica: consigo te responder mais rápido quando você digita a mensagem. Mas fique à vontade, vou continuar ouvindo seus áudios também 😊",
          "📝 Só uma dica rápida: por texto eu consigo te ajudar de forma mais ágil. Mas pode mandar áudio se preferir, sem problemas!",
          "✏️ Se puder digitar, consigo te atender ainda mais rápido! Mas não se preocupe, estou ouvindo seus áudios normalmente 😉",
        ];
        const nudge = nudges[Math.floor(Math.random() * nudges.length)];
        // Small delay so it doesn't feel robotic
        await new Promise(r => setTimeout(r, 2000));
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, nudge);
      }
    }

    let newModo: string | null = null;
    if (precisa_humano) {
      // Hard handoff: stop AI completely until a human re-enables IA mode.
      newModo = "humano";
      console.log("[MODE] IA → Humano (hard handoff, IA paused)");
    }

    if (newModo) {
      await supabase.from("atendimentos").update({ modo: newModo }).eq("id", atendimento_id);

      // Auto-generate summary for human agent
      try {
        const sumResp = await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ atendimento_id }),
        });
        if (sumResp.ok) {
          const sumData = await sumResp.json();
          if (sumData?.resumo) {
            const currentMeta2 = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
            await supabase.from("atendimentos").update({ metadata: { ...currentMeta2, resumo_ia: sumData.resumo } }).eq("id", atendimento_id);
            console.log("[SUMMARY] Auto-summary saved for human agent");
          }
        } else {
          console.error("[SUMMARY] Failed:", await sumResp.text());
        }
      } catch (sumErr) {
        console.error("[SUMMARY] Error:", sumErr);
      }
    }

    const contatoUpdates: any = { ultimo_contato_at: new Date().toISOString() };

    if (precisa_humano) {
      // Human escalation: do NOT move the contact to a different column.
      // The contact stays where it is; intervention is managed via atendimentos.modo = 'humano'.
    } else if (pipeline_coluna !== "Novo Contato") {
      // Filter columns by contact type to avoid cross-sector assignment
      const isCorporate = ["loja", "colaborador"].includes(contatoTipo);
      const ATENDIMENTO_CORPORATIVO_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";
      const sectorFilteredCols = isCorporate
        ? colunas.filter((c: any) => c.setor_id === ATENDIMENTO_CORPORATIVO_SETOR_ID)
        : colunas.filter((c: any) => c.setor_id === null);
      const col = sectorFilteredCols.find((c: any) => c.nome === pipeline_coluna)
        || colunas.find((c: any) => c.nome === pipeline_coluna && c.setor_id === null);
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
        is_image_context: isImageContext,
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
      if (atendimentoIdForCleanup) {
        const errMeta = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimentoIdForCleanup).single()).data?.metadata as Record<string, any>) || {};
        delete errMeta.ia_lock;
        await supabase.from("atendimentos").update({ metadata: errMeta }).eq("id", atendimentoIdForCleanup);
      }
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
  // Use custom message for contact lens, default for others
  const resposta = trigger === "lentes_de_contato"
    ? mensagem
    : "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve. Posso te ajudar com algo rápido enquanto isso? 😊";

  await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, resposta);

  // Hard handoff: pause IA completely until operator re-enables it.
  await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimentoId);

  await supabase.from("contatos").update({ ultimo_contato_at: new Date().toISOString() }).eq("id", contatoId);

  // Auto-generate summary for the human operator
  try {
    await fetch(`${supabaseUrl}/functions/v1/summarize-atendimento`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id: atendimentoId }),
    });
  } catch (_) { /* best effort */ }

  await supabase.from("eventos_crm").insert({
    contato_id: contatoId, tipo: "escalonamento_humano",
    descricao: `Escalonamento (${trigger}): cliente pediu Consultor`,
    metadata: { trigger, motivo: trigger, mensagem },
    referencia_tipo: "atendimento", referencia_id: atendimentoId,
  });

  return jsonResponse({
    status: "ok", tools_used: [`escalar_consultor_${trigger}`],
    intencao: "escalonamento", precisa_humano: true,
    pipeline_coluna_sugerida: null, setor_sugerido: "", modo: "humano",
  });
}

async function handleNonClientEscalation(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atendimentoId: string, contatoId: string, mensagem: string, trigger: string
) {
  await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, mensagem);

  // Set modo to humano (not hibrido) — this is NOT a client, operator takes full control
  await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimentoId);

  await supabase.from("contatos").update({ ultimo_contato_at: new Date().toISOString() }).eq("id", contatoId);

  // Auto-generate summary for the operator
  try {
    await fetch(`${supabaseUrl}/functions/v1/summarize-atendimento`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ atendimento_id: atendimentoId }),
    });
  } catch (_) { /* best effort */ }

  await supabase.from("eventos_crm").insert({
    contato_id: contatoId, tipo: "escalonamento_humano",
    descricao: `Escalonamento automático (${trigger}): contato não-cliente detectado`,
    metadata: { trigger, motivo: trigger, tipo_contato: trigger, mensagem },
    referencia_tipo: "atendimento", referencia_id: atendimentoId,
  });

  return jsonResponse({
    status: "ok", tools_used: [`non_client_${trigger}`],
    intencao: trigger, precisa_humano: true,
    pipeline_coluna_sugerida: trigger === "contato_rede_diniz" ? "Parcerias" : "Compras",
    setor_sugerido: "", modo: "humano",
  });
}
