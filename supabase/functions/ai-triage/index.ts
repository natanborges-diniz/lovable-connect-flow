import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// HORÁRIO COMERCIAL — ESCALADA HUMANA
// ═══════════════════════════════════════════
// Seg-Sex 09:00–18:00 / Sáb 08:00–12:00 (America/Sao_Paulo). Domingo fechado.
// Aplica-se SOMENTE no momento da escalada para humano. Gael responde 24/7.

function getNowInSP(): { dow: number; hour: number; minute: number; date: Date } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  const wkMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const dow = wkMap[get("weekday")] ?? 0;
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  return { dow, hour, minute, date: new Date() };
}

function isHorarioHumano(): boolean {
  const { dow, hour, minute } = getNowInSP();
  const t = hour * 60 + minute;
  if (dow >= 1 && dow <= 5) return t >= 9 * 60 && t < 18 * 60;        // Seg-Sex 09-18
  if (dow === 6) return t >= 8 * 60 && t < 12 * 60;                   // Sábado 08-12
  return false;                                                        // Domingo
}

function proximaAberturaHumana(): string {
  const { dow, hour, minute } = getNowInSP();
  const t = hour * 60 + minute;
  // hoje ainda abre?
  if (dow >= 1 && dow <= 5 && t < 9 * 60) return "hoje às 09:00";
  if (dow === 6 && t < 8 * 60) return "hoje às 08:00";
  // próximo dia útil
  // após sábado meio-dia ou domingo → segunda 09:00
  if (dow === 6 || dow === 0) return dow === 0 ? "amanhã às 09:00" : "segunda às 09:00";
  // sexta após 18 → sábado 08:00
  if (dow === 5) return "amanhã às 08:00";
  // seg-qui após 18 → amanhã 09:00
  return "amanhã às 09:00";
}

function mensagemEscaladaForaHorario(nomePrim: string): string {
  const saud = nomePrim ? `, ${nomePrim}` : "";
  return `Vou acionar nossa equipe pra você${saud}! 🙌 Só um detalhe: nosso time humano atende de seg a sex das 09h às 18h e sábado das 08h às 12h. Como estamos fora do horário agora, assim que abrir o próximo expediente (${proximaAberturaHumana()}), eles te respondem por aqui. Pode deixar registrado o que precisa que já encaminho 😉`;
}

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
    const isLC = /\b(lente[s]? de contato|\blc\b|di[aá]ria[s]?|quinzenal|mensal|t[oó]rica[s]?|gelatinosa[s]?)\b/i.test(joined)
      || /\b(esporte|academia|futebol|nata[çc][aã]o|corrida|corre[rd]|treino)\b/i.test(joined);
    return {
      intent: "quote",
      hint: hasReceitas
        ? (isLC
            ? "Cliente quer ORÇAMENTO de LENTES DE CONTATO e já há receita salva. OBRIGATÓRIO: use consultar_lentes_contato AGORA e apresente 2-3 opções com descartes VARIADOS (mín. 2 categorias entre diária + quinzenal + mensal) na MESMA resposta. Se cliente mencionar esporte/academia/corrida/futebol/natação, recomende a DIÁRIA como mais indicada (frase curta, consultiva), MAS sem omitir quinzenal/mensal — o cliente decide. Termine perguntando a região pra indicar a loja. NUNCA encerrar pedindo só marca/tipo se já há receita."
            : "Cliente quer ORÇAMENTO e já há receita salva. Use consultar_lentes para responder com opções.")
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
//
// `fechamento_lc`: cliente em contexto de LENTES DE CONTATO já com receita
// salva escolheu uma marca/modelo OU pediu reservar/fechar o pedido.
// LC NÃO requer visita à loja para "tirar medidas" — a finalização é feita
// por um Consultor humano (que envia link de pagamento e define a loja de
// retirada). Por isso esse intent NÃO mapeia para `agendar_visita`.
const LC_BRAND_REGEX = /\b(acuvue|oasys|biofinity|air\s*optix|solflex|sol[oó]tica|dnz|biomedics|focus|frequency|freshlook|proclear|purevision|softlens|hydron|mioflex|aviator|naturale|colors?)\b/i;
const RESERVE_VERBS_REGEX = /\b(quero\s+(reservar|fechar|pedir|levar|essa|esse|comprar|fechar|essa op[cç][aã]o)|vou\s+(querer|levar|de|com)|fica\s+(com|essa|esse)|pode\s+(reservar|pedir|fechar|mandar)|fechar\s+(pedido|essa|esse|com)|fechar\b|reserva[r]?\b|comprar\s+essa)/i;

// ── Validação de receita ──
// Considera receita válida APENAS quando há esfera/cilindro útil em pelo menos
// um olho E rx_type não é "unknown". Receita salva como `unknown` com olhos
// vazios (caso Jardel) NÃO conta como receita — força nova interpretação.
function isReceitaValida(rx: any): boolean {
  if (!rx || typeof rx !== "object") return false;
  const rxType = String(rx.rx_type || "").toLowerCase();
  if (!rxType || rxType === "unknown") return false;
  const od = rx.eyes?.od || {};
  const oe = rx.eyes?.oe || {};
  const hasUsefulEye = (e: any) =>
    typeof e?.sphere === "number" || typeof e?.cylinder === "number";
  return hasUsefulEye(od) || hasUsefulEye(oe);
}

function hasReceitasValidas(receitas: any[]): boolean {
  return Array.isArray(receitas) && receitas.some(isReceitaValida);
}

function detectForcedToolIntent(
  lastInboundText: string,
  hasReceitas: boolean,
  hasUnparsedImage: boolean,
  isLCContext = false,
  hasLCQuotePresented = false,
): { tool: string; reason: string } | null {
  const t = norm(lastInboundText);
  if (!t) return null;

  // ── FECHAMENTO LC: cliente escolheu marca OU pediu reservar em contexto LC ──
  // Só dispara se: (a) há receita salva, (b) contexto é LC, (c) já apresentamos
  // opções OU o texto é inequívoco (tem marca + verbo de reserva).
  // Guardrail: NUNCA cair em agendar_visita aqui — LC não exige visita à loja.
  if (hasReceitas && isLCContext) {
    const hasBrand = LC_BRAND_REGEX.test(lastInboundText);
    const hasReserveVerb = RESERVE_VERBS_REGEX.test(lastInboundText);
    // Marca + verbo de reserva em qualquer ordem = fechamento.
    // Verbo de reserva isolado também conta se já apresentamos opções.
    // Marca isolada conta se já apresentamos opções (ex.: "Acuvue").
    if (hasBrand && hasReserveVerb) {
      return { tool: "fechamento_lc", reason: "cliente escolheu marca + pediu reservar (LC)" };
    }
    if (hasLCQuotePresented && (hasBrand || hasReserveVerb)) {
      return { tool: "fechamento_lc", reason: hasBrand ? "cliente escolheu marca após orçamento LC" : "cliente pediu reservar após orçamento LC" };
    }
  }

  // Quote / pricing keywords (aceita variações: quanto/quantos/qto/qnto, custa/sai/fica)
  if (/\b(or[cç]amento|or[cç]a|pre[cç]o|valor|quantos?|qto|qnto|custa|sai\s+por|fica\s+por|tabela|lentes? compat[ií]veis|op[cç][oõ]es? de lente|cota[cç][aã]o)\b/.test(t)) {
    const isLC = isLCContext || /\b(lente[s]? de contato|\blc\b|di[aá]ria[s]?|quinzenal|mensal|t[oó]rica[s]?|gelatinosa[s]?|esporte|academia|futebol|nata[çc][aã]o|corrida|treino)\b/.test(t);
    if (hasReceitas) return { tool: isLC ? "consultar_lentes_contato" : "consultar_lentes", reason: `cliente pediu orçamento${isLC ? " de LC" : ""} e há receita salva` };
    if (hasUnparsedImage) return { tool: "interpretar_receita", reason: "cliente pediu orçamento e há imagem pendente" };
    return { tool: "responder_pedindo_receita", reason: "cliente pediu orçamento mas não há receita" };
  }

  // Pergunta sobre marca específica de LC = pedido de preço/disponibilidade implícito.
  // Cobre casos como "quantos está a Biofinity", "tem Acuvue?", "Solflex serve pra mim?".
  // Só dispara em contexto LC + receita salva pra evitar falso positivo em conversas iniciais.
  if (isLCContext && hasReceitas && LC_BRAND_REGEX.test(lastInboundText)) {
    return { tool: "consultar_lentes_contato", reason: "cliente perguntou sobre marca específica de LC" };
  }

  // Análise direta da receita: "analise", "leia", "lê pra mim", "pode ler", "vê pra mim", "dá uma olhada"
  // ou confirmação curta após IA perguntar "quer que eu analise/leia?": "sim", "pode", "manda ver", "é uma receita"
  if (hasUnparsedImage && !hasReceitas) {
    if (/\b(analis[ae]|analisar|le[ia]|ler|l[eê]\b|olha[rd]?|v[eê]\b|d[aá] uma olhada|interpreta[rd]?|verifica[rd]?)\b/.test(t)
        || /\b(sim|pode|claro|isso|manda ver|por favor|pfv|beleza|ok|tá|tudo bem)\b/.test(t)
        || /\b[ée]\s+(uma\s+)?receita\b|^receita$|minha receita/.test(t)) {
      return { tool: "interpretar_receita", reason: "cliente confirmou/pediu análise da receita pendente" };
    }
  }

  // Scheduling keywords
  // ⚠️ Em contexto LC com receita salva, "reservar" = fechar pedido (humano), NÃO agendar visita.
  // Esse caso já é capturado acima como fechamento_lc; aqui ignoramos "reservar" se LC+receita.
  if (/\b(agendar|marcar|hor[aá]rio|amanh[aã]|hoje|essa semana|pode marcar|pode agendar|reservar)\b/.test(t)) {
    if (hasReceitas && isLCContext) {
      // LC + receita: "reservar/marcar" também vira fechamento humano, NUNCA agendamento de visita.
      return { tool: "fechamento_lc", reason: "cliente pediu reservar/marcar em contexto LC com receita" };
    }
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
  // Normaliza espaço entre sinal e número: "- 425" → "-425", "+ 200" → "+200"
  let t = text.toLowerCase().replace(/([+\-])\s+(\d)/g, "$1$2");

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

  // Helper: parse a number como dioptria.
  // - Aceita "-9,25", "+0.50", "0.00".
  // - Normaliza shorthand óptico SEM separador decimal: "400" → 4.00, "425" → 4.25,
  //   "175" → 1.75 (3 dígitos sem ponto/vírgula). 4 dígitos viram 2 casas decimais.
  // - Eixo (0–180) NÃO usa esta normalização — é parseado à parte.
  const parseDiopter = (s: string | undefined): number | null => {
    if (!s) return null;
    const raw = s.replace(/\s/g, "");
    if (/[.,]/.test(raw)) {
      const n = parseFloat(raw.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    const sign = raw.startsWith("-") ? -1 : 1;
    const digits = raw.replace(/^[+\-]/, "");
    if (!/^\d+$/.test(digits)) return null;
    let value: number;
    if (digits.length >= 3) {
      // 3+ dígitos sem decimal → últimos 2 viram fração
      value = parseInt(digits.slice(0, -2), 10) + parseInt(digits.slice(-2), 10) / 100;
    } else {
      value = parseInt(digits, 10);
    }
    return Number.isFinite(value) ? sign * value : null;
  };
  const parseAxis = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 180 ? n : null;
  };

  // Try to extract values per eye. Patterns supported:
  //   "OD 0.00 com -2,25 eixo 180"
  //   "OD: esf -9 cil -2,75 eixo 180 add +2,00"
  //   "LONGE: OD 0.00 com -2,25"  /  "PERTO: -0,25 com -2,00"
  //   "Od -400 / Oe -425"   (shorthand sem decimal)
  const num = "([+-]?\\d+[.,]?\\d*)";
  const buildEye = () => ({ sphere: null as number | null, cylinder: null as number | null, axis: null as number | null, add: null as number | null });
  const od = buildEye();
  const oe = buildEye();

  // Pattern A: "OD <esf> com <cil> [eixo <axis>] [add <add>]"
  const reA = new RegExp(`(od|oe|os)[^\\d+\\-]{0,15}${num}\\s*(?:com|x|\\/)?\\s*${num}?\\s*(?:eixo\\s*${num})?(?:[^\\d]*(?:add?|adi[cç][aã]o)\\s*${num})?`, "gi");
  let m: RegExpExecArray | null;
  while ((m = reA.exec(t)) !== null) {
    const eye = m[1].toLowerCase() === "od" ? od : oe;
    if (eye.sphere == null) eye.sphere = parseDiopter(m[2]);
    if (eye.cylinder == null) eye.cylinder = parseDiopter(m[3]);
    if (eye.axis == null) eye.axis = parseAxis(m[4]);
    if (eye.add == null) eye.add = parseDiopter(m[5]);
  }

  // Pattern B: longe/perto blocks (when client splits longe/perto with single eye line each)
  // "LONGE: OD <s> com <c>" / "PERTO: <s> com <c> eixo <ax>"
  const longeMatch = t.match(/longe[^a-z]*([\s\S]*?)(?=perto|$)/i);
  const pertoMatch = t.match(/perto[^a-z]*([\s\S]*?)$/i);
  const eyeFromBlock = (block: string, eye: any) => {
    const r = new RegExp(`(?:od|oe|os)?\\s*${num}\\s*(?:com|x|\\/)?\\s*${num}?\\s*(?:eixo\\s*${num})?`, "i");
    const mm = block.match(r);
    if (mm) {
      if (eye.sphere == null) eye.sphere = parseDiopter(mm[1]);
      if (eye.cylinder == null) eye.cylinder = parseDiopter(mm[2]);
      if (eye.axis == null) eye.axis = parseAxis(mm[3]);
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

function deterministicIntentFallback(msg: string, inboundCount: number, isHibrido: boolean, recentOutbound?: string[], isImageContext?: boolean, hasReceitas?: boolean, isLCContext?: boolean): {
  resposta: string;
  intencao: string;
  pipeline_coluna: string;
  precisa_humano: boolean;
} {
  const n = norm(msg);

  // Guardrail: receita salva + contexto LC → nunca devolver "dois caminhos"
  if (hasReceitas && isLCContext) {
    return {
      resposta: "Beleza! Já estou montando aqui as opções de lentes de contato com base na sua receita 😊 Em qual região/bairro você está? Assim eu já indico a loja mais próxima.",
      intencao: "orcamento_lc",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  // Guardrail (óculos): receita salva + intent claro de quote → nunca devolver "dois caminhos"
  // Caso Ju (18/04): cliente já tinha receita interpretada, pediu "modelos/orçamento", IA respondeu
  // duas vezes o mesmo bloco de lentes. Aqui forçamos uma transição limpa para a tool de quote.
  if (hasReceitas && /\b(or[cç]amento|or[cç]a|pre[cç]o|valor|quanto|op[cç][oõ]es?|lentes?\s+compat|cota[cç][aã]o|modelos?\s+de\s+lente)\b/i.test(n)) {
    return {
      resposta: "Beleza! Já vou te mandar as opções de lentes compatíveis com a sua receita 😊 Enquanto isso, em qual região você está? Assim já te indico a loja mais próxima pra fechar.",
      intencao: "orcamento",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  // If image context, use dedicated image fallback pool
  // IMPORTANTE: nunca devolver "dois caminhos" — isso virou frase de loop quando o modelo
  // se recusa a chamar interpretar_receita. Sempre indicar que está analisando.
  if (isImageContext || /\[image\]|\[document\]/.test(n)) {
    const recentNorm = (recentOutbound || []).slice(-10).map(norm);
    const receitaPool = [
      "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções certinhas, um instante…",
      "Peguei a imagem da receita aqui 😊 Tô lendo os valores pra montar seu orçamento, só um momento…",
      "Recebi! Tô analisando sua receita pra te mandar as opções compatíveis em seguida 👍",
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
      resposta: "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções compatíveis em seguida, um instante…",
      intencao: "receita_oftalmologica",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  if (/lente|oculos|óculos|arma[çc]|comprar|or[çc]amento|pre[çc]o|valor|barato|caro|mais em conta|econom|quantos?\b|qto|qnto|biofinity|acuvue|oasys|solflex|sol[oó]tica|dnz|air\s*optix|hidrocor/.test(n)) {
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
            description: "Coluna do pipeline para mover o contato. PROIBIDO usar 'Agendamento' aqui — agendamento real exige a tool agendar_visita. Se faltar loja/data/hora, use 'Qualificado' e pergunte o que falta.",
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
      description: "Agenda visita do cliente em uma loja. OBRIGATÓRIO usar SEMPRE que você for confirmar/marcar agendamento — nunca escreva 'agendamento confirmado' ou 'vou reservar' sem chamar esta tool. Requer loja_nome + data_horario completos. Se faltar qualquer um, use 'responder' e pergunte o que falta — NÃO chame esta tool com dados parciais.",
      parameters: {
        type: "object",
        properties: {
          loja_nome: { type: "string", description: "Nome da loja escolhida (precisa estar na lista LOJAS DISPONÍVEIS)." },
          data_horario: { type: "string", description: "Data e hora COMPLETAS no formato ISO 8601 (ex: 2026-03-25T14:00:00-03:00). Sem hora ou sem data, NÃO chame esta tool." },
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
      name: "consultar_lentes_contato",
      description: "Busca opções de LENTES DE CONTATO compatíveis com a receita do cliente e calcula o plano (caixas necessárias, duração, combo 3+1). Use quando o cliente pedir orçamento/preço de LENTES DE CONTATO. Se o cilíndrico for ≥ 0.75 em qualquer olho, filtra automaticamente lentes TÓRICAS (que são SOB ENCOMENDA). Prioriza marca DNZ quando compatível. NÃO use para óculos (use consultar_lentes para óculos).",
      parameters: {
        type: "object",
        properties: {
          receita_label: { type: "string", description: "Label da receita a usar (ex: 'cliente', 'filho'). Default: mais recente." },
          descarte_preferido: { type: "string", enum: ["diario", "quinzenal", "mensal", "qualquer"], description: "Tipo de descarte que o cliente prefere. Default: 'qualquer' (mostra mensais/quinzenais com prioridade)." },
          marca_preferida: { type: "string", description: "Marca preferida se mencionada (DNZ, Acuvue, Biofinity, Air Optix, Solótica, etc)." },
          resposta_fallback: { type: "string", description: "Mensagem caso nenhuma lente compatível seja encontrada." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "registrar_nome_cliente",
      description: "Registra/atualiza o nome do cliente no cadastro APÓS confirmação. Use SEMPRE que o cliente: (a) confirmar que o nome do perfil está correto ('sim, sou eu', 'isso mesmo'), OU (b) informar/corrigir seu nome ('na verdade é Maria', 'meu nome é João'). NÃO use sem confirmação explícita do cliente.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome confirmado do cliente (ex: 'Maria Silva', 'João'). Use o nome que o cliente confirmou ou informou." },
          resposta: { type: "string", description: "Mensagem natural confirmando o registro e dando continuidade (ex: 'Perfeito, Maria! Em que posso te ajudar hoje? 😊')." },
        },
        required: ["nome", "resposta"],
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

function buildFirstContactBlock(inboundCount: number, opts?: { nomeWhatsapp?: string; nomeAtual?: string; nomeConfirmado?: boolean }): string {
  if (inboundCount > 1) return "";
  const nomeWa = (opts?.nomeWhatsapp || "").trim();
  const nomeAtual = (opts?.nomeAtual || "").trim();
  const candidato = nomeWa || nomeAtual;
  const looksReal = !!candidato && /[A-Za-zÀ-ÿ]{2,}/.test(candidato) && !/^\d+$/.test(candidato);

  if (looksReal && !opts?.nomeConfirmado) {
    const primeiroNome = candidato.split(/\s+/)[0];
    return `# PRIMEIRA INTERAÇÃO — CONFIRME O NOME
- Envie EXATAMENTE esta mensagem, sem reformular, sem adicionar frases extras nem segunda pergunta: "Olá! Falo com ${primeiroNome}? 😊 Aqui é o Gael das Óticas Diniz Osasco."
- REGRA ABSOLUTA: apenas UMA pergunta nesta mensagem. PROIBIDO complementar com variações como "como prefere ser chamado?", "pode me dizer seu nome completo?", "qual seu nome?". Nada depois do "."
- Se o cliente CONFIRMAR ('sim', 'isso', 'sou eu') → chame a tool registrar_nome_cliente com nome="${candidato}".
- Se o cliente CORRIGIR ('na verdade é Maria') → chame registrar_nome_cliente com o nome correto informado.
- Só DEPOIS da confirmação, pergunte como pode ajudar. NÃO mencione receita/lentes/agendamento na 1ª mensagem.`;
  }

  return `# PRIMEIRA INTERAÇÃO — PEÇA O NOME
- Envie EXATAMENTE esta mensagem, sem reformular e sem adicionar nada depois: "Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?"
- REGRA ABSOLUTA: a mensagem termina no "?" da pergunta sobre o nome. PROIBIDO adicionar uma SEGUNDA pergunta, parafrasear ou complementar com frases como "Pode me dizer seu nome completo?", "Como prefere ser chamado?", "Qual seu nome?". Apenas UMA pergunta sobre o nome, ponto final.
- PROIBIDO duplicar pontuação ("?.", "??", "?!").
- Quando o cliente responder o nome → chame a tool registrar_nome_cliente com o nome informado.
- NÃO mencione receita, lentes, agendamento ou qualquer serviço antes de ter o nome.`;
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

function buildLentesContatoKnowledgeBlock(): string {
  return `# 👁️ LENTES DE CONTATO — CONHECIMENTO E REGRAS

## Quando usar a tool consultar_lentes_contato
- Cliente pede orçamento/preço de LENTES DE CONTATO (não óculos).
- Para óculos, continue usando consultar_lentes.
- Precisa de receita salva. Se não houver, peça foto da receita uma única vez.

## Tipos de descarte (usar para explicar)
- DIÁRIA: descarta após 1 uso. Caixas de 30/90 unidades. Mais higiênica, sem precisar de soluções/estojo. Combo 3+1 NÃO se aplica.
- QUINZENAL: cada lente dura 15 dias por olho. Caixas geralmente de 6 unidades. Requer solução multiuso e estojo.
- MENSAL: cada lente dura 30 dias por olho. Caixas geralmente de 6 unidades. Requer solução multiuso e estojo.

## COMBO 3+1 (mensais e quinzenais)
- Cada caixa contém N unidades (campo unidades_por_caixa).
- 1 unidade = 1 mês (mensal) ou 15 dias (quinzenal) — POR OLHO.
- MESMA dioptria nos 2 olhos (sph + cyl iguais OD/OE): 1 caixa atende AMBOS os olhos → divide a duração por 2.
  - Ex.: caixa de 6 unidades mensal, mesma dioptria → 1 cx = 3 meses.
- DIOPTRIA DIFERENTE entre OD/OE: 1 caixa por olho (mínimo 2 caixas iniciais).
  - Ex.: caixa de 6 unidades mensal, dioptrias diferentes → 2 cx = 6 meses.
- Comprando 3 caixas, a 4ª vai de cortesia (combo 3+1).
  - Mesma dioptria + 6un/cx mensal: 4 cx = 12 meses (1 ano completo).
  - Dioptria diferente + 6un/cx mensal: 4 cx = 12 meses (1 ano completo).
- DIÁRIAS: combo 3+1 NÃO se aplica.

## TÓRICAS (astigmatismo)
- Cilíndrico ≥ |0.75| em qualquer olho ⇒ OBRIGATORIAMENTE lente TÓRICA (com correção de astigmatismo).
- Tóricas são SEMPRE SOB ENCOMENDA — pagamento confirma o pedido.
- Sempre informe que o prazo de entrega depende da fabricante e que o pagamento garante a reserva.

## Marcas — prioridade comercial
- 1º) DNZ (marca própria, melhor custo-benefício) — sempre que a receita for compatível.
- 2º) Demais marcas conforme compatibilidade técnica e preferência do cliente.

## Apresentação de orçamento
- Sempre apresente: produto, descarte, valor por caixa, plano sugerido (caixas + duração) e o combo 3+1 quando aplicável.
- Para tóricas, deixe claro o aviso de encomenda.
- Termine perguntando a região do cliente para indicar a loja mais próxima — NÃO ofereça visita para "tirar medidas" (LC não exige isso).

## 🚫 FECHAMENTO DE LENTES DE CONTATO — REGRA DURA
- LENTES DE CONTATO **NUNCA** exigem visita à loja para "tirar medidas". A receita do cliente já é suficiente.
- PROIBIDO usar a tool agendar_visita para LC. PROIBIDO escrever "tirar medidas", "posso te receber", "vir até a loja para finalizar", "qual dia/horário" no contexto de LC.
- Quando o cliente escolher uma marca/modelo OU disser "quero reservar/fechar/pedir/levar":
  1. Confirme a escolha em 1 frase (ex.: "Perfeito — anotei a Acuvue 👌").
  2. Se for tórica/multifocal, lembre que é sob encomenda e que o pagamento confirma a reserva.
  3. Encaminhe para o Consultor humano fechar o pedido — a loja de retirada é escolhida no fechamento, NÃO agora.
  4. Não pergunte dia/horário. Não ofereça visita. Não tente agendar nada.`;
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
  nomeWhatsapp?: string;
  nomeAtual?: string;
  nomeConfirmado?: boolean;
}): string {
  const s: string[] = [];

  s.push(buildDateContext());

  const firstContactBlock = buildFirstContactBlock(opts.inboundCount, {
    nomeWhatsapp: opts.nomeWhatsapp,
    nomeAtual: opts.nomeAtual,
    nomeConfirmado: opts.nomeConfirmado,
  });
  if (firstContactBlock) s.push(firstContactBlock);
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) s.push(continuityBlock);
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());
  s.push(buildLentesContatoKnowledgeBlock());

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
  nomeWhatsapp?: string;
  nomeAtual?: string;
  nomeConfirmado?: boolean;
}): string {
  const s: string[] = [];

  // Date/time context FIRST — so the model always knows the current date
  s.push(buildDateContext());

  const firstContactBlock = buildFirstContactBlock(opts.inboundCount, {
    nomeWhatsapp: opts.nomeWhatsapp,
    nomeAtual: opts.nomeAtual,
    nomeConfirmado: opts.nomeConfirmado,
  });
  if (firstContactBlock) s.push(firstContactBlock);
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) s.push(continuityBlock);
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());
  s.push(buildLentesContatoKnowledgeBlock());

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

// Fallback determinístico para contexto de detalhamento/comparação de lentes.
// Usa as marcas detectadas no orçamento anterior + conhecimento embutido para
// montar uma resposta mínima quando o LLM falha. Nunca usa o pool genérico.
function detalhamentoFallback(orcamentoText: string, brands: string[], currentMsg: string): string {
  const knowledge: Record<string, string> = {
    DNZ: "*DNZ* — linha própria Diniz, ótima relação preço × qualidade, antirreflexo (AR Verde/Azul) e fabricação nacional.",
    ESSILOR: "*Essilor* — francesa, líder global. Foco em conforto digital (linha Eyezen) e multifocais Varilux. Tratamento Crizal Prevencia entrega antirreflexo + filtro de luz azul + UV.",
    ZEISS: "*Zeiss* — alemã, engenharia de precisão. Linha SmartLife Individual é personalizada ao seu rosto/armação. DuraVision Platinum UV (antirreflexo top) + BlueGuard (filtro azul integrado ao material da lente, não só camada).",
    HOYA: "*Hoya* — japonesa, premium. Hi-Vision LongLife (antirreflexo durável) e iD MyStyle (multifocais sob medida).",
    KODAK: "*Kodak* — marca licenciada, intermediário-premium acessível com tratamentos CleAR.",
    DMAX: "*DMAX* — linha de custo-benefício, boa qualidade óptica para uso geral.",
    SOLFLEX: "*Solflex* — linha nacional, especialmente forte em tóricas (astigmatismo).",
  };
  const msgLower = currentMsg.toLowerCase();
  const targetBrands = brands.filter(b => msgLower.includes(b.toLowerCase()));
  const finalBrands = targetBrands.length > 0 ? targetBrands : brands;
  const paras = finalBrands
    .map(b => knowledge[b.toUpperCase()] || `*${b}* — boa opção do orçamento que te enviei.`)
    .slice(0, 3);
  if (paras.length === 0) {
    return "Olha as 3 opções que te mandei: a econômica é a *DNZ* (custo-benefício), a intermediária é da *Essilor* (foco em conforto digital com Crizal) e a premium é da *Zeiss* (alemã, BlueGuard integrado e DuraVision Platinum UV). Quer fechar com alguma delas ou agendar uma visita pra ver na loja?";
  }
  const closing = finalBrands.length >= 2
    ? `Quer fechar com a *${finalBrands[0]}*, com a *${finalBrands[1]}*, ou prefere agendar pra ver as armações na loja?`
    : `Quer fechar com a *${finalBrands[0]}* ou prefere agendar pra ver na loja?`;
  return paras.join("\n\n") + "\n\n" + closing;
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
    if (atendimento.modo === "ponte") {
      return jsonResponse({ status: "skipped", reason: "modo ponte (operado via mensageria interna)" });
    }
    // Suppress IA on demand-mirror atendimentos (created by criar-demanda-loja)
    const _atMeta = (atendimento.metadata as Record<string, any>) || {};
    if (_atMeta.suprimir_ia === true || _atMeta.atendimento_demanda === true) {
      console.log(`[ABORT] atendimento ${atendimento_id} marked as suprimir_ia (demanda mirror) — skipping IA`);
      return jsonResponse({ status: "skipped", reason: "atendimento espelho de demanda (suprimir_ia)" });
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

    // ── 2.5. (REMOVIDO) Escalação determinística de lentes de contato ──
    // Agora a IA tem catálogo (pricing_lentes_contato) e usa a tool consultar_lentes_contato.
    // Tóricas: aviso "sob encomenda — pagamento confirma o pedido".

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

    // ── 3.5. PRE-LLM ROUTER: "modelos / armações" → presencial (não listar lentes) ──
    // Cliente pedindo modelos de óculos/armações deve receber convite presencial,
    // nunca uma lista de lentes (catálogo de armações é físico). Determinístico.
    {
      const tArm = norm(currentMsg);
      const isArmacaoIntent =
        /\b(modelo|modelos|armac|armaç|armacao|armação|armações|armacoes)\b/.test(tArm) ||
        /\b(oculos|óculos)\b.*\b(mostrar|enviar|ver|foto|fotos|catalogo|catálogo|modelo|modelos)\b/.test(tArm) ||
        /\b(mostrar|enviar|ver|foto|fotos|catalogo|catálogo|modelo|modelos)\b.*\b(oculos|óculos)\b/.test(tArm);
      const isLentePedido = /\b(lente|lentes|grau|orcamento de lente|orçamento de lente)\b/.test(tArm);
      if (isArmacaoIntent && !isLentePedido) {
        console.log("[ROUTER] Armações/modelos detected — convite presencial determinístico");
        const armMsg =
          "Sobre armações, a gente trabalha com várias marcas e estilos (Ray-Ban, Oakley, Vogue, Carolina Herrera, linha Diniz exclusiva, infantis e esportivas) 😊\n\n" +
          "Como o caimento muda muito de rosto pra rosto, o ideal é provar pessoalmente — separamos várias opções pra você no balcão.\n\n" +
          "Quer agendar uma visita? Temos:\n📍 *Antônio Agú* (centro Osasco)\n📍 *União Osasco* (shopping)\n📍 *SuperShopping* (até 22h)\n\nQual fica melhor pra você?";
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, armMsg);
        // Mark in metadata to avoid loop on next turn
        try {
          const { data: ctMeta } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
          const newMeta = { ...(ctMeta?.metadata || {}), armacoes_orientado: true, armacoes_orientado_at: new Date().toISOString() };
          await supabase.from("contatos").update({ metadata: newMeta }).eq("id", contatoId);
        } catch (e) {
          console.warn("[ROUTER armações] Failed to mark metadata:", e);
        }
        await logEvent(supabase, contatoId, atendimento_id, "router_armacoes_presencial", currentMsg);
        return jsonResponse({ status: "ok", tools_used: ["router_armacoes_presencial"], intencao: "armacoes", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
      }
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
      supabase.from("agendamentos").select("id, loja_nome, data_horario, status, observacoes, metadata").eq("contato_id", contatoId).in("status", ["agendado", "confirmado", "lembrete_enviado", "no_show", "recuperacao"]).order("data_horario", { ascending: false }).limit(5),
      supabase.from("contatos").select("metadata, tipo, nome").eq("id", contatoId).single(),
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
    const contatoNomeAtual = String((contatoMetaRes.data as any)?.nome || "").trim();
    const nomeConfirmado = contatoMeta.nome_confirmado === true;
    const nomePerfilWhatsapp = String(contatoMeta.nome_perfil_whatsapp || "").trim();

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
    // Receita salva mas vazia/`unknown` (caso Jardel) NÃO conta — força nova OCR.
    const hasValidReceitas = hasReceitasValidas(receitas);
    const isImageContext = lastIsImage
      || (hasRecentUnparsedPrescriptionImage && !hasValidReceitas);
    if (receitas.length > 0 && !hasValidReceitas) {
      console.log(`[RX-VALID] Receita salva existe mas é INVÁLIDA (rx_type/eyes vazios) — tratando como sem receita`);
    }

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
        const dataStr = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
        const horaStr = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
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
        nomeWhatsapp: nomePerfilWhatsapp,
        nomeAtual: contatoNomeAtual,
        nomeConfirmado,
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
        nomeWhatsapp: nomePerfilWhatsapp,
        nomeAtual: contatoNomeAtual,
        nomeConfirmado,
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
      hasValidReceitas,
    );
    const isLCContextGlobal = /\b(lente[s]? de contato|\blc\b|di[aá]ria[s]?|quinzenal|mensal|t[oó]rica[s]?|gelatinosa[s]?|esporte|academia|futebol|nata[çc][aã]o|corrida|treino)\b/i.test(recentInboundTexts.join(" | ").toLowerCase());
    if (isDevolucaoHumanoIA) {
      console.log(`[DEVOLUCAO] pending_intent=${pendingIntent?.intent || "none"} | lc_context=${isLCContextGlobal}`);
    }

    // ── DETECTOR: cliente pediu DETALHE/COMPARAÇÃO de lentes já cotadas ──
    // Dispara quando: (a) msg atual contém intent de detalhar/comparar,
    // (b) há orçamento recente nas últimas 3 outbound, (c) cliente menciona
    // pelo menos 1 marca/categoria do orçamento (ou pediu genericamente).
    const detalharIntentRegex = /\b(detalh[ae]r?|detalhe|me\s+explica|explic[ae]r?|diferen[çc]a|compar[ae]r?|compare|qual\s+a\s+melhor|por\s*qu[eê]\s+a|porque\s+a|vantage(m|ns)|prós?\s+e\s+contras?)\b/i;
    const orcamentoOutboundRegex = /(🔍\s*\*Opções|Econômica:|Intermediária:|Premium:|💚|💛|💎)/i;
    const recentOrcamento = (recentOutbound || []).slice(-3).find((t: string) => orcamentoOutboundRegex.test(t || "")) || "";
    let orcamentoBrandsList: string[] = [];
    if (recentOrcamento) {
      // Extrai marcas dos formatos "*BRAND family*" e categorias
      const brandMatches = [...recentOrcamento.matchAll(/\*([A-Z][A-Z0-9 ]{1,12})\b/g)];
      orcamentoBrandsList = [...new Set(brandMatches.map(m => m[1].trim()).filter(b => b.length >= 3))];
    }
    const msgMencionaMarca = orcamentoBrandsList.some(b =>
      new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(currentMsg)
    );

    // ── DETECTOR: oferta proativa de comparativo pendente nas últimas outbound ──
    // Ex: "Posso já deixar separado um comparativo Essilor x ZEISS pra você ver?"
    // Janela ampla (6 outbound) pra sobreviver a rodadas de pergunta de ajuda intermediária.
    const KNOWN_BRANDS_RE = /\b(Essilor|Zeiss|ZEISS|DNZ|Hoya|HOYA|Kodak|KODAK|DMAX|Solflex)\b/gi;
    const ofertaCompRegex = /(comparativ|deixar separado|posso (te |já )?(mostrar|enviar|deixar|preparar|separar|trazer)[^?]{0,80}(diferen|comparativ|opç(ões|ao)|lado a lado)|quer que eu (detalhe|compare|envie|mostre|prepare)[^?]{0,80}(diferen|comparativ|opç))/i;
    let pendingComparativoOffer: { marcas: string[]; rawOffer: string } | null = null;
    for (const out of (recentOutbound || []).slice(-6).reverse()) {
      const t = String(out || "");
      if (!ofertaCompRegex.test(t)) continue;
      const brandHits = [...new Set([...t.matchAll(KNOWN_BRANDS_RE)].map(m => m[1].toUpperCase().replace("ZEISS","Zeiss").replace("HOYA","Hoya").replace("KODAK","Kodak")))];
      if (brandHits.length >= 2) {
        pendingComparativoOffer = { marcas: brandHits.slice(0, 3), rawOffer: t };
        break;
      }
    }

    // ── Normalização da mensagem do cliente (remove pontuação interna + agradecimentos sufixos) ──
    const msgTrim = currentMsg.trim().toLowerCase().replace(/[!.…]+$/,"");
    // msgTrim2: remove pontuação interna e agradecimentos (obg/obrigado/valeu/vlw/tks/thx/brigado)
    const msgTrim2 = msgTrim
      .replace(/[.,!…]+/g, " ")
      .replace(/\b(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Detecta agradecimento puro (ex: "obg", "obrigado", "valeu", "ok obrigado")
    const isThanksOnly = /^(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx|muito obrigad[oa]|ok obrigad[oa]|t[aá] bom obrigad[oa])$/i.test(msgTrim);

    // Resposta curta SIM/NÃO à oferta pendente (usa msgTrim2 para tolerar "Não. Obg.")
    const SHORT_YES_RE = /^(sim|isso|pode|pode sim|claro|claro que sim|por favor|adoraria|vamos|bora|manda|manda ver|quero|quero ver|quero sim|show|massa|beleza|ok|tá|ta|tá bom|ta bom|perfeito|com certeza|👍|👌)$/i;
    const SHORT_NO_RE = /^(n[aã]o|nao precisa|tranquilo|depois|deixa pra l[aá]|t[oô] bem|tudo certo|tudo bem|sem necessidade|n|nn|n[aã]o obrigad[oa]|por enquanto n[aã]o|s[oó] isso|era s[oó] isso|sem mais)$/i;

    // Aceite afirmativo com cauda: "pode deixar o comparativo aqui", "manda o comparativo", "quero ver as opções"
    const LONG_YES_RE = /^(pode|quero|claro|manda|vamos|bora|ok|sim|adoraria|t[aá] bom|beleza)\b.{0,80}\b(comparativ|opç|diferen|ver|aqui|mostra|envia|prepara|deixa|deixar|separa|aceito)/i;
    const isLongYes = !!pendingComparativoOffer && LONG_YES_RE.test(msgTrim2);

    const isShortYes = (!!pendingComparativoOffer && SHORT_YES_RE.test(msgTrim2)) || isLongYes;

    // Detecta agendamento ativo
    const agAtivoRecentEarly = (agendamentosAtivos || []).find((a: any) => ["agendado","confirmado"].includes(a.status)) || (agendamentosAtivos || [])[0];
    const hasAgendamentoAtivo = !!agAtivoRecentEarly?.data_horario;

    // Detecta segunda negativa consecutiva à pergunta canônica "posso ajudar em mais alguma coisa"
    const lastOutboundTxt = String((recentOutbound || []).slice(-1)[0] || "").toLowerCase();
    const askedHelpMore = /posso (te )?ajudar em mais (alguma )?coisa|posso ajudar com mais|mais alguma coisa antes de finalizar/i.test(lastOutboundTxt);

    // isShortNo agora é INDEPENDENTE de pendingComparativoOffer:
    // basta haver oferta pendente OU pergunta de ajuda OU agendamento ativo (cliente está em pós-fechamento).
    const noContextEligible = !!pendingComparativoOffer || askedHelpMore || hasAgendamentoAtivo;
    const isShortNo = noContextEligible && SHORT_NO_RE.test(msgTrim2);

    // Despedida final: já dispensou ajuda E veio nova negativa OU agradecimento puro pós-agendamento
    const isShortNoToHelp = (askedHelpMore && SHORT_NO_RE.test(msgTrim2))
      || (hasAgendamentoAtivo && isThanksOnly && !pendingComparativoOffer);

    // Agradecimento direto ao final, sem "não" antes (ex: cliente diz "Obg" depois do agendamento)
    const isThanksClose = hasAgendamentoAtivo && isThanksOnly && !askedHelpMore;

    const isDetalhamentoContext = (!!recentOrcamento
      && (detalharIntentRegex.test(currentMsg) || msgMencionaMarca)
      && currentMsg.length < 200) || isShortYes;

    // Se é SIM curto à oferta de comparativo, força marcas da oferta
    if (isShortYes && pendingComparativoOffer) {
      orcamentoBrandsList = pendingComparativoOffer.marcas;
      console.log(`[OFERTA-COMP] Cliente confirmou comparativo. Marcas: ${orcamentoBrandsList.join(", ")}`);
    }
    if (isShortNo) {
      console.log(`[OFERTA-COMP] Cliente dispensou comparativo. askedHelpMore=${askedHelpMore} → ${isShortNoToHelp ? "DESPEDIDA" : "OFERECER AJUDA"}`);
    }

    // Dados do agendamento mais recente para fechamento contextual (reusa agAtivoRecentEarly)
    const agAtivoRecent = agAtivoRecentEarly;
    let agendamentoFmt = "";
    if (agAtivoRecent?.data_horario) {
      try {
        const dt = new Date(agAtivoRecent.data_horario);
        const dataFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
        const horaFmt = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
        agendamentoFmt = `${dataFmt} às ${horaFmt} na ${agAtivoRecent.loja_nome || "loja"}`;
      } catch { /* ignore */ }
    }

    // ── LEMBRETE DIA-D: detectar resposta do cliente ──
    // Se o agendamento foi lembrado hoje (metadata.lembrete_dia_d_at < 24h),
    // tratamos confirmação e remarcação de forma determinística.
    let isDiaDConfirm = false;
    let isDiaDReschedule = false;
    let agDiaD: any = null;
    try {
      const horaLimite = Date.now() - 24 * 60 * 60 * 1000;
      agDiaD = (agendamentosAtivos || []).find((a: any) => {
        const ts = a?.metadata?.lembrete_dia_d_at ? new Date(a.metadata.lembrete_dia_d_at).getTime() : 0;
        return ts > horaLimite && ["agendado", "lembrete_enviado", "confirmado"].includes(a.status);
      });
      if (agDiaD) {
        const txt = String(currentMsg || "").toLowerCase().trim();
        const CONFIRM_RE = /\b(sim|confirmo|confirmado|vou|vou sim|t[oô] indo|tou indo|estou indo|estarei|ok|combinado|beleza|pode deixar|fechado|tudo certo|tô a caminho|to a caminho|chegando|👍|👌|✅)\b/i;
        const RESCHED_RE = /\b(remarcar|reagendar|mudar|trocar|outro dia|outro hor[aá]rio|n[aã]o (vou|consigo|posso)|cancelar|adiar|antecipar|imprevisto)\b/i;
        if (RESCHED_RE.test(txt)) isDiaDReschedule = true;
        else if (CONFIRM_RE.test(txt) || /^(sim|s|👍|👌|✅|ok)$/i.test(txt)) isDiaDConfirm = true;
      }
    } catch { /* ignore */ }

    if (isThanksClose || isShortNoToHelp) {
      console.log(`[CLOSE] thanksClose=${isThanksClose} shortNoToHelp=${isShortNoToHelp} → DESPEDIDA forçada`);
    }
    if (isDiaDConfirm || isDiaDReschedule) {
      console.log(`[DIA-D] resposta detectada confirm=${isDiaDConfirm} resched=${isDiaDReschedule} ag=${agDiaD?.id}`);
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
      ...(hasRecentUnparsedPrescriptionImage && !hasValidReceitas
        ? [{
            role: "system",
            content: "[SISTEMA: PRIORIDADE MÁXIMA — RECEITA PENDENTE] O cliente enviou uma imagem (provável receita) nas últimas mensagens e ela AINDA NÃO foi interpretada com sucesso (RECEITAS JÁ INTERPRETADAS está vazio ou inválido). REGRAS: 1) Você DEVE chamar a tool interpretar_receita usando a imagem mais recente entregue no histórico, ANTES de qualquer outra ação (não escale, não peça reenvio, não responda genericamente). 2) Se a imagem foi entregue ao modelo, use-a — mesmo que a última mensagem do cliente seja curta ('ok', 'então?', 'cadê'). 3) Só peça reenvio se o sistema avisar explicitamente que a imagem NÃO foi entregue. 4) Só escale para humano se a imagem estiver claramente ilegível APÓS a tentativa de interpretação.]",
          }]
        : []),
      ...(hasValidReceitas
        ? [{
            role: "system",
            content: isLCContextGlobal
              ? "[SISTEMA: FLUXO PÓS-RECEITA OBRIGATÓRIO — LENTES DE CONTATO] Já existe receita interpretada e o contexto é LENTES DE CONTATO. PROIBIDO responder com 'posso seguir por dois caminhos?', 'quer opções ou orçamento?' ou pedir confirmação genérica. PROIBIDO escalar para humano nesse cenário. AÇÃO OBRIGATÓRIA: 1) chame consultar_lentes_contato AGORA com os valores da receita mais recente (NÃO consultar_lentes — esse é para óculos), 2) apresente 2-3 opções com descartes VARIADOS (mín. 2 categorias entre diária + quinzenal + mensal) na MESMA resposta, priorizando DNZ quando compatível, 3) se cliente mencionou esporte/academia/corrida/futebol/natação, recomende a DIÁRIA como mais indicada (frase curta, consultiva) MAS sem omitir quinzenal/mensal — o cliente decide, 4) finalize perguntando a região/bairro pra indicar a loja mais próxima e sugerir agendamento. NUNCA encerre pedindo só marca/tipo se já há receita."
              : "[SISTEMA: FLUXO PÓS-RECEITA OBRIGATÓRIO] Já existe receita interpretada (ver RECEITAS JÁ INTERPRETADAS). PROIBIDO responder com 'posso te mostrar uma base?', 'quer que eu mostre opções?' ou qualquer pedido de confirmação genérica. AÇÃO OBRIGATÓRIA: 1) chame consultar_lentes AGORA com os valores da receita mais recente, 2) apresente 2-3 opções de orçamento (DNZ entrada / DMAX custo-benefício / HOYA premium) com os valores retornados, 3) pergunte a região/bairro do cliente, 4) sugira agendamento na loja mais próxima. Confirmação dos valores SÓ se a receita estiver marcada com confiança baixa — neste caso mostre 'OD X,XX / OE Y,YY, confere?' explicitamente. NUNCA repita a mesma pergunta de confirmação 2× — isso configura loop e será escalado.",
          }]
        : []),
      ...(isDetalhamentoContext
        ? [{
            role: "system",
            content: `[FLUXO DETALHAMENTO/COMPARAÇÃO DE LENTES] O cliente está pedindo para detalhar/comparar as opções do orçamento que VOCÊ JÁ ENVIOU. NÃO repita "Quer que eu detalhe?", "Já mandei as opções acima", "Me conta mais", "Conta pra mim com mais detalhes" — isso é loop e será rejeitado.

ORÇAMENTO ENVIADO RECENTEMENTE (referência):
${recentOrcamento}

MARCAS A DETALHAR: ${orcamentoBrandsList.join(", ") || "as que o cliente citou"}

CONHECIMENTO DAS MARCAS (use para escrever a comparação):
- DNZ (HDI / Mensal / 1 Day): linha própria Diniz, custo-benefício, AR Verde/Azul, fabricação nacional, ótima relação preço × qualidade.
- ESSILOR: francesa, líder global. Eyezen/Eyezen Boost = foco em fadiga visual digital (celular, tela), zonas de relaxamento. Varilux = referência em multifocais. Crizal Prevencia = antirreflexo + filtro de luz azul nociva + UV. Crizal Sapphire HR = antirreflexo top de transparência.
- ZEISS: alemã, engenharia óptica de precisão. SmartLife = desenhada pro estilo de vida conectado (transições rápidas celular↔mundo). "Individual" = personalizada ao seu rosto/armação, visão periférica perfeita. DuraVision Platinum UV = antirreflexo super resistente + proteção UV total. BlueGuard = filtro de luz azul INTEGRADO ao material da lente (não é só camada — toda a superfície protege).
- HOYA: japonesa, premium, Hi-Vision LongLife (antirreflexo durável), iD MyStyle (multifocais sob medida).
- KODAK: marca licenciada, intermediário-premium acessível, tratamentos CleAR.

REGRAS DE FORMATO:
1) Escreva 1 parágrafo curto por marca solicitada (3–4 linhas), destacando 2–3 diferenciais técnicos/comerciais relevantes. Use **negrito** apenas no nome da família/lente (formato WhatsApp *texto*).
2) Use os DADOS DO ORÇAMENTO acima (índice, tratamento, preço) — não invente valor, não troque marca, não some/desconte.
3) ${agendamentoFmt
  ? `Cliente JÁ AGENDOU visita (${agendamentoFmt}). NÃO pergunte "quer fechar?" nem ofereça novo agendamento. FECHE com algo natural tipo: "Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar." Sem outras perguntas.`
  : `Termine com UMA pergunta clara entre: "fechar com a [marca A]", "ir com a [marca B]", ou "agendar visita pra ver na loja". Sem outras opções genéricas.`}
4) PROIBIDO chamar tool consultar_lentes de novo (já foi feito). Use a tool responder.
5) PROIBIDO escalar para humano por essa pergunta.${isShortYes ? "\n6) O cliente apenas respondeu \"sim\" à SUA oferta de comparativo — vá DIRETO ao comparativo das marcas listadas, sem reapresentar o orçamento e sem perguntar de novo se ele quer." : ""}

EXEMPLO DE TOM (Essilor vs Zeiss):
"A *Essilor Eyezen Boost 0.6* é da francesa Essilor, líder global. Foi desenhada pra quem usa muita tela — tem zonas de relaxamento que reduzem fadiga visual. Vem com Crizal Prevencia: antirreflexo + filtro de luz azul + UV.

A *Zeiss SmartLife Individual 3* é alemã, top de linha. Ela é personalizada ao seu rosto e armação, garantindo visão periférica perfeita. Tem DuraVision Platinum UV (antirreflexo super resistente) + BlueGuard, que é filtro azul integrado no material da lente.

${agendamentoFmt ? `Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.` : "Resumo: Essilor é referência em conforto digital; Zeiss entrega precisão alemã sob medida. Quer fechar com uma delas, ou prefere agendar pra experimentar com armação?"}"`,
          }]
        : []),
      ...((isShortNo || isShortNoToHelp || isThanksClose)
        ? [{
            role: "system",
            content: (isShortNoToHelp || isThanksClose)
              ? `[FLUXO DESPEDIDA PÓS-AGENDAMENTO] Cliente ${isThanksClose ? "agradeceu após o agendamento confirmado" : "já dispensou ajuda adicional"}. ENCERRE o atendimento de forma calorosa e curta, SEM nenhuma pergunta. Use exatamente esta estrutura: "${isThanksClose ? "De nada" : "Combinado"}${contatoNomeAtual ? ", " + contatoNomeAtual.split(" ")[0] : ""}! ${agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui"} 👋 Qualquer dúvida é só me chamar." NÃO pergunte mais nada. NÃO ofereça mais opções. Use a tool responder com proximo_passo vazio.`
              : `[FLUXO DISPENSA COMPARATIVO] Cliente respondeu "não" à sua oferta. NÃO insista, NÃO repita a oferta, NÃO faça mais de uma pergunta. Responda EXATAMENTE: "Tranquilo${contatoNomeAtual ? ", " + contatoNomeAtual.split(" ")[0] : ""}! Posso te ajudar em mais alguma coisa antes de finalizar?". Sem listar opções. Sem segunda pergunta. Use a tool responder.`,
          }]
        : []),
      ...(isDiaDReschedule && agDiaD
        ? [{
            role: "system",
            content: `[FLUXO REAGENDAMENTO PÓS-LEMBRETE-DIA-D] O cliente recebeu o lembrete da visita de hoje e PEDIU PARA REMARCAR. AÇÕES OBRIGATÓRIAS: 1) Reconheça com calor humano ("Sem problema, ${contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : ""}, vamos ajustar"). 2) Ofereça 2-3 opções concretas de dia/horário próximas (próximos 3 dias úteis, em horários comerciais 10h–19h) na MESMA loja (${agDiaD.loja_nome || "a loja já escolhida"}), a menos que o cliente peça outra unidade. 3) Pergunte qual encaixa melhor. NÃO chame agendar_visita ainda — espere a escolha do cliente. Quando ele escolher, AÍ SIM chame agendar_visita (a tool é idempotente, vai atualizar o agendamento existente). PROIBIDO responder "mantemos ou cancelamos?" — ele JÁ DISSE que quer remarcar.`,
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

    // ── 6.4. PRESCRIPTION CORRECTION DETECTOR ──
    // If the customer types prescription values directly (typically to correct
    // an OCR mistake), parse it, replace the latest receita in metadata, and
    // force consultar_lentes with the corrected values. The AI must not ignore
    // a textual correction just because a prior receita exists.
    let correctionApplied = false;
    if (receitas.length > 0) {
      const correction = detectPrescriptionCorrection(lastInboundText);
      if (correction) {
        const idx = receitas.length - 1;
        const old = receitas[idx] || {};
        const merged = {
          ...old,
          eyes: {
            od: { ...(old.eyes?.od || {}), ...Object.fromEntries(Object.entries(correction.od).filter(([_, v]) => v != null)) },
            oe: { ...(old.eyes?.oe || {}), ...Object.fromEntries(Object.entries(correction.oe).filter(([_, v]) => v != null)) },
          },
          rx_type: correction.rx_type,
          summary: {
            ...(old.summary || {}),
            has_addition: correction.has_addition,
            needs_progressive: correction.has_addition,
            suggested_category: correction.rx_type,
          },
          confidence: 0.99,
          data_leitura: new Date().toISOString(),
          source: "client_correction",
          raw_correction: correction.raw,
          needs_human_review: false,
        };
        receitas[idx] = merged;

        // Persist back to contact metadata
        await supabase.from("contatos").update({
          metadata: { ...contatoMeta, receitas },
        }).eq("id", contatoId);

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "receita_corrigida_pelo_cliente",
          descricao: `Cliente corrigiu receita por texto. Tipo recalculado: ${correction.rx_type}`,
          metadata: {
            od: correction.od, oe: correction.oe, rx_type: correction.rx_type,
            raw: correction.raw,
          },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

        // Rebuild receitaCtx so the prompt below sees the corrected values
        // (mutate by re-running the formatter inline)
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
          const sourceTag = rx.source === "client_correction" ? " ⚠️ CORRIGIDA PELO CLIENTE" : "";
          receitaCtx += `\n## Receita ${i + 1} (${label}) — lida em ${dataLeitura}${sourceTag}\n`;
          receitaCtx += `Tipo: ${rxTypeLabel} | Confiança: ${conf}\n`;
          receitaCtx += `${formatEye(od, "OD")}\n`;
          receitaCtx += `${formatEye(oe, "OE")}\n`;
        }
        receitaCtx += `\n⚠️ A última receita foi CORRIGIDA pelo cliente nesta mensagem. Use estes valores como verdade — NÃO mencione os valores antigos.`;

        correctionApplied = true;
        console.log(`[RX-CORRECTION] Applied client correction. New rx_type=${correction.rx_type}, OD.sph=${correction.od.sphere}, OE.sph=${correction.oe.sphere}`);
      }
    }

    // ── 6.5. PRE-LLM LOOP DETECTOR + FORCED INTENT MAPPING ──
    // Runs BEFORE the LLM call so it can override the prompt and prevent the
    // model from generating yet another semantically-identical response.
    const loopCheck = detectLoop(recentOutbound);

    // Detecta se já apresentamos opções de LC nas últimas saídas (sinal "preço/caixa/descarte/marca").
    const hasLCQuotePresented = (recentOutbound || []).some((m: string) =>
      typeof m === "string" && /\b(R\$|caixa[s]?|descarte|di[aá]ria|quinzenal|mensal|t[oó]rica|acuvue|biofinity|dnz|air\s*optix|solflex|sol[oó]tica)\b/i.test(m),
    );

    const forcedIntent = detectForcedToolIntent(
      lastInboundText,
      hasValidReceitas,
      hasRecentUnparsedPrescriptionImage && !hasValidReceitas,
      isLCContextGlobal,
      hasLCQuotePresented,
    );

    // ── 6.5.b. SHORT-CIRCUIT: FECHAMENTO LC → escalar para humano direto ──
    // LC NÃO requer visita à loja. Cliente escolheu marca / pediu reservar:
    // confirmamos a escolha, avisamos que o Consultor humano dá continuidade
    // (e que a loja de retirada é definida no fechamento), e escalamos.
    if (forcedIntent?.tool === "fechamento_lc") {
      console.log(`[FECHAMENTO-LC] ${forcedIntent.reason}`);

      // Tenta extrair marca mencionada para personalizar a confirmação
      const brandMatch = lastInboundText.match(LC_BRAND_REGEX);
      const marcaEcho = brandMatch ? brandMatch[0].replace(/\b\w/g, (c) => c.toUpperCase()) : null;
      const nomePrim = (contatoNomeAtual || "").split(/\s+/)[0] || "";
      const saudacao = nomePrim ? `Perfeito, ${nomePrim}` : "Perfeito";
      const linhaEscolha = marcaEcho
        ? `${saudacao} — anotei sua escolha: *${marcaEcho}* 👌`
        : `${saudacao} — anotei sua escolha 👌`;
      const fechamentoMsg = [
        linhaEscolha,
        "Vou te passar agora pra um Consultor da nossa equipe finalizar o pedido — com ele você confirma o modelo certo da sua receita, escolhe em qual loja prefere retirar e recebe o link de pagamento. Em instantes ele te chama por aqui mesmo 🤝",
      ].join("\n\n");

      await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, fechamentoMsg);

      await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento_id);

      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "fechamento_lc_escalado",
        descricao: `Cliente escolheu LC — encaminhado para fechamento humano${marcaEcho ? ` (marca: ${marcaEcho})` : ""}`,
        metadata: {
          marca_escolhida: marcaEcho,
          last_inbound: lastInboundText.substring(0, 200),
          had_lc_quote_presented: hasLCQuotePresented,
          reason: forcedIntent.reason,
        },
        referencia_tipo: "atendimento",
        referencia_id: atendimento_id,
      });

      // Resumo para o humano
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ atendimento_id }),
        });
      } catch (_) { /* best-effort */ }

      // Limpa lock de debounce
      try {
        const lockMeta = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
        delete lockMeta.ia_lock;
        await supabase.from("atendimentos").update({ metadata: lockMeta }).eq("id", atendimento_id);
      } catch (_) { /* ignore */ }

      return jsonResponse({
        status: "ok",
        tools_used: ["fechamento_lc_escalado"],
        intencao: "fechamento_lc",
        precisa_humano: true,
        pipeline_coluna_sugerida: null,
        modo: "humano",
        validator_flags: ["fechamento_lc_short_circuit"],
      });
    }


    // If a correction was applied, force consultar_lentes regardless of loop state
    if (correctionApplied) {
      messages.push({
        role: "system",
        content: "[SISTEMA: RECEITA CORRIGIDA PELO CLIENTE] O cliente acabou de corrigir os valores da receita por texto. Os novos valores estão na seção RECEITAS (marcada como ⚠️ CORRIGIDA PELO CLIENTE). AÇÃO OBRIGATÓRIA: 1) reconheça brevemente a correção (ex: 'Perfeito, anotado!'); 2) chame consultar_lentes AGORA com os valores novos para refazer o orçamento. NÃO repita valores antigos. NÃO peça nova foto. NÃO peça confirmação adicional — confie no que ele digitou.",
      });
      console.log(`[RX-CORRECTION] Forcing consultar_lentes with corrected prescription`);
    }

    // ── HINT ANTI-DUPLICAÇÃO: agendamento ativo + sem pedido explícito de mudança ──
    {
      const lastInLow = String(lastInbound?.conteudo || currentMsg || "").toLowerCase();
      const explicitChange = /\b(remarcar|reagendar|mudar (a |o )?(hor[aá]rio|dia|data|loja)|trocar (a |o )?(hor[aá]rio|dia|data|loja)|cancelar|outro hor[aá]rio|outro dia|outra loja|antecipar|adiar)\b/.test(lastInLow);
      if (hasAgendamentoAtivo && !explicitChange) {
        messages.push({
          role: "system",
          content: `[AGENDAMENTO ATIVO] O cliente JÁ TEM um agendamento ativo (${agendamentoFmt || "ver AGENDAMENTOS DESTE CLIENTE"}). PROIBIDO chamar agendar_visita ou reagendar_visita — não há pedido explícito de mudança. PROIBIDO perguntar "mantemos ou prefere cancelar?". PROIBIDO oferecer/propor cancelamento. Se o cliente disser "agendar", "manter", "ok", "confirmado", "obg", trate como CONFIRMAÇÃO do existente: apenas reafirme com "Tudo certo, te espero ${agendamentoFmt || "no horário combinado"} 👋" e siga o fluxo de comparativo/encerramento. Só chame reagendar_visita se o cliente pedir EXPLICITAMENTE para remarcar/mudar horário/loja ou cancelar.`
        });
        console.log(`[GUARDRAIL-HINT] Agendamento ativo sem pedido de mudança — injetando hint anti-duplicação`);
      }
    }

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
          : forcedIntent.tool === "consultar_lentes_contato"
          ? "[SISTEMA: LOOP DETECTADO + INTENT CLARO — LENTES DE CONTATO] Você está repetindo a mesma pergunta. O cliente JÁ pediu orçamento de LENTES DE CONTATO e há receita salva. AÇÃO OBRIGATÓRIA: chame consultar_lentes_contato AGORA (NÃO consultar_lentes) com os valores da receita mais recente, apresente 2-3 opções com descartes VARIADOS (mín. 2 categorias: diária + quinzenal/mensal), priorize DNZ quando compatível, e termine perguntando a região pra indicar a loja. PROIBIDO escalar para humano nesse cenário. PROIBIDO repetir 'posso seguir por dois caminhos'."
          : forcedIntent.tool === "interpretar_receita"
          ? "[SISTEMA: LOOP DETECTADO + IMAGEM PENDENTE] Você está repetindo a mesma pergunta. O cliente já enviou uma imagem (provável receita) e pediu orçamento. AÇÃO OBRIGATÓRIA: chame interpretar_receita AGORA usando a imagem do histórico. NÃO pergunte se pode analisar — analise."
          : forcedIntent.tool === "agendar_cliente_intent"
          ? (hasAgendamentoAtivo
              ? `[SISTEMA: LOOP DETECTADO + AGENDAMENTO JÁ ATIVO] O cliente JÁ tem agendamento ativo (${agendamentoFmt || "ver AGENDAMENTOS"}). NÃO chame agendar_visita. Apenas reafirme: "Tudo certo, te espero ${agendamentoFmt || "no horário combinado"} 👋" e siga com comparativo/encerramento.`
              : "[SISTEMA: LOOP DETECTADO + INTENT AGENDAR] Você está repetindo a mesma pergunta. O cliente quer agendar. Se já tem loja+data+hora, chame agendar_visita. Caso contrário, faça UMA pergunta objetiva pedindo o que falta — sem repetir o prompt anterior.")
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
    } else if (forcedIntent && (forcedIntent.tool === "consultar_lentes" || forcedIntent.tool === "consultar_lentes_contato" || forcedIntent.tool === "interpretar_receita")) {
      const hint = forcedIntent.tool === "consultar_lentes"
        ? "[SISTEMA: INTENT CLARO] Cliente pediu orçamento e há receita salva. Use consultar_lentes — NÃO pergunte de novo o que ele prefere."
        : forcedIntent.tool === "consultar_lentes_contato"
        ? "[SISTEMA: INTENT CLARO — LENTES DE CONTATO] Cliente pediu orçamento de LENTES DE CONTATO e há receita salva. Use consultar_lentes_contato AGORA (NÃO consultar_lentes — esse é para óculos), apresente 2-3 opções com descartes VARIADOS (diária + quinzenal/mensal), priorize DNZ, e termine perguntando a região. PROIBIDO repetir 'posso seguir por dois caminhos'. PROIBIDO escalar para humano."
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
        const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext, receitas.length > 0, isLCContextGlobal);
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

        // ── GUARDRAIL: cannot move to Agendamento via `responder` alone ──
        // Real bookings MUST go through agendar_visita / reagendar_visita (which writes to public.agendamentos).
        // Without that record, the trigger on_agendamento_status_change never fires and no reminders go out.
        if (/agendamento/i.test(pipeline_coluna)) {
          console.log("[GUARDRAIL] Blocked move to 'Agendamento' via responder — only agendar_visita can persist a booking. Falling back to 'Qualificado'.");
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "agendamento_fantasma_bloqueado",
            descricao: "IA tentou mover para 'Agendamento' sem chamar agendar_visita — bloqueado.",
            metadata: { resposta: resposta.substring(0, 200), intencao },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          pipeline_coluna = intencao === "agendamento" ? "Qualificado" : pipeline_coluna === "Agendamento" ? "Qualificado" : pipeline_coluna;
          if (pipeline_coluna === "Agendamento") pipeline_coluna = "Qualificado";
        }

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

        // ── AUTO-CHAIN: se a receita ficou válida E há intent claro de orçamento
        // (texto recente do cliente menciona orçamento/preço/lentes), gera o quote
        // imediatamente em vez de só dizer "li sua receita". Caso André 2026-04-27.
        const rxJustValid = isReceitaValida(rxWithLabel);
        const recentInboundJoined = inboundMsgs.slice(-5).map((m: any) => String(m.conteudo || "")).join(" | ").toLowerCase();
        const wantsQuote = /\b(or[cç]amento|or[cç]a|pre[cç]o|valor|quanto|op[cç][oõ]es?|lentes?\s+compat|cota[cç][aã]o|s[oó]\s+preciso\s+das?\s+lentes?)\b/i.test(recentInboundJoined);
        const isLCRecent = /\b(lente[s]?\s+de\s+contato|\blc\b|di[aá]ria|quinzenal|mensal|t[oó]rica|gelatinosa)\b/i.test(recentInboundJoined);

        if (rxJustValid && wantsQuote && !isLCRecent) {
          console.log(`[AUTO-CHAIN] OCR válido + intent orçamento → encadeando consultar_lentes (rxType=${rxType}, conf=${(confidence * 100).toFixed(0)}%)`);
          const quoteResult = await runConsultarLentes(supabase, contatoId, recentOutbound, {});
          resposta = quoteResult.resposta;
          intencao = "orcamento";
          pipeline_coluna = "Orçamento";
          validatorFlags.push("auto_chain_pos_ocr");
        } else if (needsHumanReview) {
          resposta = "Consegui ler boa parte da sua receita, mas quero te passar a opção certinha. Posso te mostrar uma base e confirmar na loja? 😊";
          console.log(`[RX] Low confidence (${(confidence * 100).toFixed(0)}%) — cautious response`);
        } else {
          resposta = args.resposta;
        }
        console.log(`[RX] Prescription saved: ${rxType} conf=${(confidence * 100).toFixed(0)}% — ${rxJustValid && wantsQuote ? "auto-chained" : "waiting for client direction"}`);

      } else if (fn === "consultar_lentes") {
        // ── QUOTE ENGINE: triggered by client interest ──
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
        const quoteResult = await runConsultarLentes(supabase, contatoId, recentOutbound, args);
        resposta = quoteResult.resposta;
      } else if (fn === "agendar_visita" || fn === "reagendar_visita") {
        // ── GUARDRAIL LC: lente de contato NÃO requer visita à loja ──
        // Se o contexto é LC + receita salva, agendar_visita está PROIBIDO
        // (cliente não vai à loja "tirar medidas" — fechamento é com humano,
        // que define a loja de retirada no momento do pagamento).
        if (isLCContextGlobal && receitas.length > 0) {
          console.log(`[GUARDRAIL-LC] Blocked ${fn} in LC context — converting to fechamento_lc`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "lc_agendamento_bloqueado",
            descricao: `IA tentou ${fn} em contexto de lentes de contato — bloqueado e convertido em fechamento humano.`,
            metadata: { tool: fn, args, motivo: "LC não requer visita para tirar medidas" },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          const nomePrim = (contatoNomeAtual || "").split(/\s+/)[0] || "";
          const saudacao = nomePrim ? `Perfeito, ${nomePrim}` : "Perfeito";
          resposta = `${saudacao}! Pra lente de contato você não precisa vir até a loja tirar medidas — sua receita já basta 😉 Vou te passar agora pra um Consultor da nossa equipe finalizar o pedido: com ele você confirma o modelo, escolhe em qual loja prefere retirar e recebe o link de pagamento. Em instantes ele te chama por aqui mesmo 🤝`;
          intencao = "fechamento_lc";
          pipeline_coluna = "Novo Contato"; // mantém na coluna atual
          precisa_humano = true;
          setor_sugerido = "";
          validatorFlags.push("lc_agendamento_bloqueado");
          continue;
        }
        // ── GUARDRAIL ANTI-DUPLICAÇÃO: cliente já tem agendamento ativo ──
        // Se já existe agendamento em "agendado/lembrete_enviado/confirmado" e o cliente
        // NÃO pediu explicitamente remarcar/cancelar/mudar, NÃO criamos novo nem reconfirmamos
        // como se fosse novo. Apenas reafirmamos o existente e seguimos com encerramento.
        const lastInboundLowerForGuard = String(lastInbound?.conteudo || currentMsg || "").toLowerCase();
        const explicitChangeRequest = isDiaDReschedule || /\b(remarcar|reagendar|mudar (a |o )?(hor[aá]rio|dia|data|loja)|trocar (a |o )?(hor[aá]rio|dia|data|loja)|cancelar|outro hor[aá]rio|outro dia|outra loja|antecipar|adiar)\b/.test(lastInboundLowerForGuard);
        const existingActive = (agendamentosAtivos || []).find((a: any) => ["agendado","lembrete_enviado","confirmado"].includes(a.status));
        if (fn === "agendar_visita" && existingActive && !explicitChangeRequest) {
          console.log(`[GUARDRAIL] agendar_visita bloqueado — já existe agendamento ativo ${existingActive.id} sem pedido explícito de mudança`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "agendamento_duplicado_evitado",
            descricao: `IA tentou agendar nova visita sem pedido explícito de mudança — bloqueado.`,
            metadata: { tentativa: args, existente: existingActive, msg: lastInboundLowerForGuard.slice(0, 200) },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          // Reafirma o existente (sem bloco de "Agendamento confirmado" — já foi enviado antes).
          const _nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
          resposta = agendamentoFmt
            ? `Tudo certo${_nomePrim ? ", " + _nomePrim : ""}! Seu agendamento segue mantido — ${agendamentoFmt}. Posso te ajudar em mais alguma coisa antes de finalizar?`
            : `Tudo certo${_nomePrim ? ", " + _nomePrim : ""}! Seu agendamento já está mantido. Posso te ajudar em mais alguma coisa antes de finalizar?`;
          intencao = "agendamento_mantido";
          pipeline_coluna = "Agendamento";
          validatorFlags.push("agendamento_duplicado_bloqueado");
          continue;
        }

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
          const dataFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
          const horaFmt = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

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

        // ── Coerência horário tool ↔ resposta ──
        // Extrai a primeira hora citada na resposta do LLM e compara com a hora de
        // args.data_horario em SP. Se divergir, aborta a criação e pede confirmação.
        let horarioDivergente = false;
        try {
          const dtArg = new Date(args.data_horario);
          const hSP = Number(dtArg.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).match(/\d+/)?.[0] ?? "-1");
          const respText = String(args.resposta || "");
          const m = respText.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{0,2})\b/i);
          if (m) {
            const hResp = Number(m[1]);
            if (Number.isFinite(hResp) && hResp >= 0 && hResp <= 23 && hResp !== hSP) {
              console.error(`[TOOL] Horário divergente: resposta diz ${hResp}h mas data_horario é ${hSP}h. Abortando criação.`);
              await supabase.from("eventos_crm").insert({
                contato_id: contatoId,
                tipo: "agendamento_horario_divergente",
                descricao: `IA tentou agendar ${hSP}h mas mencionou ${hResp}h na resposta. Pedindo confirmação ao cliente.`,
                referencia_tipo: "atendimento",
                referencia_id: atendimento_id,
                metadata: { args, hora_resposta: hResp, hora_arg: hSP },
              });
              resposta = `Só pra eu não confundir: foi às *${hResp}h* ou *${hSP}h*? Me confirma o horário exato que eu já registro 🙏`;
              horarioDivergente = true;
            }
          }
        } catch (e) {
          console.error("[TOOL] coerência horário falhou:", e);
        }

        if (!horarioDivergente) {
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
      } else if (fn === "registrar_nome_cliente") {
        resposta = args.resposta;
        intencao = "registro_nome";
        const novoNome = String(args.nome || "").trim();
        if (novoNome.length >= 2) {
          try {
            // Reload current metadata to merge flag without overwriting other fields
            const { data: ctNome } = await supabase
              .from("contatos")
              .select("metadata")
              .eq("id", contatoId)
              .single();
            const ctMeta = (ctNome?.metadata as Record<string, any>) || {};
            await supabase
              .from("contatos")
              .update({
                nome: novoNome,
                metadata: { ...ctMeta, nome_confirmado: true, nome_origem: "ia_confirmado", nome_atualizado_at: new Date().toISOString() },
              })
              .eq("id", contatoId);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "nome_confirmado",
              descricao: `Nome confirmado: "${novoNome}"`,
              metadata: { nome: novoNome, nome_anterior: contatoNomeAtual || null },
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
            });
            console.log(`[TOOL] registrar_nome_cliente: ${novoNome}`);
          } catch (e) {
            console.error("[TOOL] registrar_nome_cliente failed:", e);
          }
        }
      } else if (fn === "consultar_lentes_contato") {
        intencao = "orcamento_lentes_contato";
        pipeline_coluna = "Orçamento";

        // Load saved prescriptions
        const { data: ctRx } = await supabase
          .from("contatos")
          .select("metadata")
          .eq("id", contatoId)
          .single();
        const ctRxMeta = (ctRx?.metadata as Record<string, any>) || {};

        let allRx: any[] = [];
        if (Array.isArray(ctRxMeta.receitas) && ctRxMeta.receitas.length > 0) {
          allRx = ctRxMeta.receitas;
        } else if (ctRxMeta.ultima_receita?.eyes) {
          allRx = [{ ...ctRxMeta.ultima_receita, label: "cliente" }];
        }

        let rxMeta: any = null;
        if (allRx.length > 0) {
          rxMeta = args.receita_label
            ? allRx.find((r: any) => norm(r.label || "") === norm(args.receita_label)) || allRx[allRx.length - 1]
            : allRx[allRx.length - 1];
        }

        if (!rxMeta?.eyes) {
          resposta = args.resposta_fallback || "Pra te passar as opções de lentes de contato, preciso da sua receita. Pode me enviar uma foto? 📸";
          console.log("[QUOTE-LC] No prescription found");
        } else {
          const od = rxMeta.eyes.od || {};
          const oe = rxMeta.eyes.oe || {};
          const sphODn = typeof od.sphere === "number" ? od.sphere : null;
          const sphOEn = typeof oe.sphere === "number" ? oe.sphere : null;
          const cylODn = typeof od.cylinder === "number" ? od.cylinder : 0;
          const cylOEn = typeof oe.cylinder === "number" ? oe.cylinder : 0;

          const cylAbsMax = Math.max(Math.abs(cylODn || 0), Math.abs(cylOEn || 0));
          const needsToric = cylAbsMax >= 0.75;
          const sphereValues = [sphODn, sphOEn].filter((v) => typeof v === "number") as number[];
          if (sphereValues.length === 0) {
            resposta = args.resposta_fallback || "Não consegui ler o grau esférico da sua receita. Pode me enviar uma foto mais nítida?";
          } else {
            const worstSphere = sphereValues.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b), 0);
            const worstCyl = cylAbsMax > 0 ? (Math.abs(cylODn) > Math.abs(cylOEn) ? cylODn : cylOEn) : 0;

            // Same prescription both eyes?
            const mesmaDioptria =
              sphODn !== null && sphOEn !== null && sphODn === sphOEn && (cylODn || 0) === (cylOEn || 0);

            let q = supabase
              .from("pricing_lentes_contato")
              .select("*")
              .eq("active", true)
              .gt("price_brl", 0)
              .lte("sphere_min", worstSphere)
              .gte("sphere_max", worstSphere);

            if (needsToric) {
              q = q.eq("is_toric", true).lte("cylinder_min", worstCyl).gte("cylinder_max", worstCyl);
            } else {
              q = q.eq("is_toric", false);
            }

            // Discard preference filter (allow any if "qualquer" or undefined)
            const descPref = String(args.descarte_preferido || "qualquer").toLowerCase();
            if (descPref === "diario" || descPref === "diaria") q = q.eq("descarte", "diario");
            else if (descPref === "quinzenal") q = q.eq("descarte", "quinzenal");
            else if (descPref === "mensal") q = q.eq("descarte", "mensal");

            if (args.marca_preferida) {
              q = q.or(`fornecedor.ilike.%${args.marca_preferida}%,produto.ilike.%${args.marca_preferida}%`);
            }

            // Order: DNZ first, then priority, then price
            const { data: lentes } = await q
              .order("is_dnz", { ascending: false })
              .order("priority", { ascending: true })
              .order("price_brl", { ascending: true })
              .limit(15);

            if (!lentes || lentes.length === 0) {
              resposta =
                args.resposta_fallback ||
                (needsToric
                  ? "Pelo seu grau, você precisa de lente TÓRICA (com correção de astigmatismo) — esse modelo é sob encomenda. Vou pedir pra um Consultor te apresentar as opções específicas, tudo bem?"
                  : "Não encontrei lentes de contato compatíveis no nosso estoque. Posso pedir pra um Consultor te ajudar a buscar uma opção sob encomenda?");
              console.log(`[QUOTE-LC] No matches sph=${worstSphere} cyl=${worstCyl} toric=${needsToric}`);
            } else {
              // Pick up to 3: prioritize DNZ + diversify discard
              const pick: any[] = [];
              const seen = new Set<string>();
              for (const l of lentes) {
                const key = `${l.fornecedor}|${l.descarte}`;
                if (!seen.has(key)) {
                  pick.push(l);
                  seen.add(key);
                }
                if (pick.length === 3) break;
              }
              if (pick.length < 3 && lentes.length > pick.length) {
                for (const l of lentes) {
                  if (!pick.includes(l)) pick.push(l);
                  if (pick.length === 3) break;
                }
              }

              const fmtBRL = (n: number) =>
                Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

              let msg = `🔎 *Lentes de contato compatíveis com sua receita:*\nOD ${od.sphere ?? "—"}/${od.cylinder ?? "—"}${od.axis ? `x${od.axis}` : ""} | OE ${oe.sphere ?? "—"}/${oe.cylinder ?? "—"}${oe.axis ? `x${oe.axis}` : ""}\n`;
              if (needsToric) {
                msg += `\n⚠️ *Lente TÓRICA* (astigmatismo ≥ 0.75) — sob encomenda. Pagamento confirma o pedido.\n`;
              }

              for (const l of pick) {
                const unidades = Number(l.unidades_por_caixa) || 6;
                const dias = Number(l.dias_por_unidade) || 30;
                const desc =
                  l.descarte === "diario"
                    ? "diária"
                    : l.descarte === "quinzenal"
                    ? "quinzenal"
                    : l.descarte === "mensal"
                    ? "mensal"
                    : l.descarte;
                const preco = fmtBRL(Number(l.price_brl));

                let plano = "";
                if (l.descarte === "diario") {
                  // diárias: 1 cx por olho geralmente; sem combo
                  const dias_cx_um_olho = unidades; // 1 lente/dia
                  if (mesmaDioptria) {
                    plano = `Plano: 1 caixa atende os 2 olhos por ~${Math.floor(dias_cx_um_olho / 2)} dias.`;
                  } else {
                    plano = `Plano: 1 caixa por olho — ~${dias_cx_um_olho} dias por olho. Combo 3+1 não se aplica a diárias.`;
                  }
                } else {
                  // mensais/quinzenais
                  const dias_por_olho_1cx = unidades * dias; // ex 6*30 = 180 dias = 6 meses
                  const meses_por_olho_1cx = Math.round(dias_por_olho_1cx / 30);
                  if (mesmaDioptria) {
                    const meses1cx = Math.round(meses_por_olho_1cx / 2);
                    const meses4cx = Math.round((4 * unidades * dias) / 30 / 2);
                    plano = `Plano (mesma dioptria): 1 caixa atende os 2 olhos por ~${meses1cx} meses. 🎁 *Combo 3+1*: 4 caixas = ~${meses4cx} meses (1 ano completo!).`;
                  } else {
                    const meses2cx = meses_por_olho_1cx;
                    const meses4cx = Math.round((4 * unidades * dias) / 30 / 2);
                    plano = `Plano (dioptrias diferentes): mín. 2 caixas (1 por olho) = ~${meses2cx} meses. 🎁 *Combo 3+1*: 4 caixas = ~${meses4cx} meses (1 ano completo!).`;
                  }
                }

                msg += `\n${l.is_dnz ? "🌟 " : "👁️ "}*${l.produto}* (${l.fornecedor}) — ${desc}\n💰 R$ ${preco}/caixa\n${plano}`;
              }

              msg += `\n\nQuer que eu reserve a opção que você preferir? Posso te encaminhar pra loja mais próxima fechar o pedido.`;
              resposta = msg;
              console.log(
                `[QUOTE-LC] ${pick.length} options sph=${worstSphere} cyl=${worstCyl} toric=${needsToric} mesma=${mesmaDioptria}`,
              );
            }
          }
        }

        try {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "consulta_lentes_contato",
            descricao: `Orçamento LC consultado`,
            metadata: { args },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
        } catch (_) { /* noop */ }
      }
    }

    // ── 9. POST-LLM VALIDATION (Phase 3) ──
    if (resposta && !precisa_humano) {
      // ── OVERRIDE DETERMINÍSTICO: para fluxos canônicos curtos, ignoramos a saída do LLM
      // e injetamos a frase canônica. O LLM frequentemente adiciona segunda pergunta ou
      // varia o texto além do permitido nesses contextos de encerramento.
      const _nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
      if (isThanksClose && agendamentoFmt) {
        resposta = `De nada${_nomePrim ? ", " + _nomePrim : ""}! Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`;
        intencao = "encerramento_pos_agendamento";
        validatorFlags.push("override_thanks_close");
        console.log("[OVERRIDE] thanks_close → despedida pós-agendamento");
      } else if (isShortNoToHelp) {
        resposta = `Combinado${_nomePrim ? ", " + _nomePrim : ""}! ${agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui"} 👋 Qualquer dúvida é só me chamar.`;
        intencao = "encerramento_pos_agendamento";
        validatorFlags.push("override_short_no_to_help");
        console.log("[OVERRIDE] short_no_to_help → despedida pós-agendamento");
      } else if (isDiaDConfirm && agDiaD) {
        resposta = `Maravilha${_nomePrim ? ", " + _nomePrim : ""}! 🙌 Nosso consultor estará te aguardando! Até daqui a pouco!`;
        intencao = "confirmacao_dia_d";
        validatorFlags.push("override_dia_d_confirm");
        console.log("[OVERRIDE] dia_d_confirm → despedida calorosa");
        try {
          const md = (agDiaD.metadata || {}) as Record<string, any>;
          await supabase.from("agendamentos").update({
            status: "confirmado",
            metadata: { ...md, confirmado_pelo_cliente_at: new Date().toISOString() },
          }).eq("id", agDiaD.id);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "agendamento_confirmado_cliente",
            descricao: "Cliente confirmou presença respondendo ao lembrete dia-D",
            referencia_id: agDiaD.id,
            referencia_tipo: "agendamento",
          });
          // Move o card do contato para a coluna "Confirmado" do pipeline Loja
          await supabase.from("contatos").update({
            pipeline_coluna_id: "d4f84dce-1434-4383-81e6-aae433a0a72a",
            updated_at: new Date().toISOString(),
          }).eq("id", contatoId);
        } catch (e) {
          console.error("[DIA-D] erro ao marcar confirmado:", e);
        }
      } else if (isShortNo && !isDetalhamentoContext) {
        resposta = `Tranquilo${_nomePrim ? ", " + _nomePrim : ""}! Posso te ajudar em mais alguma coisa antes de finalizar?`;
        validatorFlags.push("override_short_no");
        console.log("[OVERRIDE] short_no → dispensa comparativo");
      }

      const validation = validateResponse(resposta, recentOutbound);

      // BYPASS: no contexto de detalhamento, similaridade alta é esperada (reuso de
      // termos técnicos: nomes de marca, "índice", "filtro azul"). Aceita a resposta
      // se for longa o suficiente (>120ch) e contiver pelo menos uma marca do orçamento.
      const detalhamentoBypass = isDetalhamentoContext
        && !validation.valid
        && validation.reason.startsWith("similarity")
        && resposta.length > 120
        && orcamentoBrandsList.some(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(resposta));

      // BYPASS: respostas curtas de dispensa/despedida não devem ser bloqueadas pelo validador
      // (são canônicas e podem repetir termos como nome da loja/data).
      const dispensaBypass = (isShortNo || isShortNoToHelp)
        && !validation.valid
        && resposta.length > 20
        && resposta.length < 240;

      if (detalhamentoBypass || dispensaBypass) {
        console.log(`[VALIDATOR] BYPASS ${detalhamentoBypass ? "detalhamento" : "dispensa-comparativo"}: aceitando resposta apesar de ${validation.reason}`);
        validatorFlags.push(detalhamentoBypass ? "detalhamento_bypass" : "dispensa_bypass");
      } else if (!validation.valid) {
        console.log(`[VALIDATOR] REJECTED: ${validation.reason} — isImageContext=${isImageContext} | isDetalhamento=${isDetalhamentoContext} | isShortNo=${isShortNo}`);
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
              } else if (isShortNoToHelp) {
                const nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
                resposta = `Combinado${nomePrim ? ", " + nomePrim : ""}! ${agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui"} 👋 Qualquer dúvida é só me chamar.`;
                validatorFlags.push("despedida_pos_agendamento_fallback");
                intencao = "encerramento_pos_agendamento";
                console.log("[VALIDATOR] Despedida pós-agendamento fallback");
              } else if (isShortNo) {
                const nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
                resposta = `Tranquilo${nomePrim ? ", " + nomePrim : ""}! Posso te ajudar em mais alguma coisa antes de finalizar?`;
                validatorFlags.push("dispensa_comparativo_fallback");
                console.log("[VALIDATOR] Dispensa comparativo fallback");
              } else if (isDetalhamentoContext) {
                resposta = detalhamentoFallback(recentOrcamento, orcamentoBrandsList, currentMsg);
                validatorFlags.push("detalhamento_deterministic_fallback");
                intencao = "orcamento";
                if (agendamentoFmt) {
                  resposta = resposta.replace(/Quer fechar com.*$/i, `Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`);
                }
                console.log("[VALIDATOR] Using detalhamento deterministic fallback");
              } else {
                const fb = /receita|grau|prescri[cç][aã]o|\[image\]|enviei minha receita|recebeu minha receita/i.test(currentMsg)
                  ? null
                  : pickFallback(recentOutbound);
                if (fb) {
                  resposta = fb;
                  validatorFlags.push("deterministic_fallback");
                  console.log("[VALIDATOR] Using rotating fallback");
                } else {
                  const contextualFallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext, receitas.length > 0, isLCContextGlobal);
                  resposta = contextualFallback.resposta;
                  intencao = contextualFallback.intencao;
                  pipeline_coluna = contextualFallback.pipeline_coluna;
                  precisa_humano = contextualFallback.precisa_humano;
                  validatorFlags.push("contextual_deterministic_fallback");
                  console.log("[VALIDATOR] Contextual deterministic fallback applied");
                }
              }
            }
          } else if (isShortNoToHelp) {
            const nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
            resposta = `Combinado${nomePrim ? ", " + nomePrim : ""}! ${agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui"} 👋 Qualquer dúvida é só me chamar.`;
            validatorFlags.push("despedida_pos_agendamento_fallback");
            intencao = "encerramento_pos_agendamento";
            console.log("[VALIDATOR] Despedida pós-agendamento fallback (no retry)");
          } else if (isShortNo) {
            const nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
            resposta = `Tranquilo${nomePrim ? ", " + nomePrim : ""}! Posso te ajudar em mais alguma coisa antes de finalizar?`;
            validatorFlags.push("dispensa_comparativo_fallback");
            console.log("[VALIDATOR] Dispensa comparativo fallback (no retry)");
          } else if (isDetalhamentoContext) {
            resposta = detalhamentoFallback(recentOrcamento, orcamentoBrandsList, currentMsg);
            if (agendamentoFmt) {
              resposta = resposta.replace(/Quer fechar com.*$/i, `Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`);
            }
            validatorFlags.push("detalhamento_deterministic_fallback");
            intencao = "orcamento";
            console.log("[VALIDATOR] Using detalhamento deterministic fallback (no retry)");
          } else {
            const fb = /receita|grau|prescri[cç][aã]o|\[image\]|enviei minha receita|recebeu minha receita/i.test(currentMsg)
              ? null
              : pickFallback(recentOutbound);
            if (fb) {
              resposta = fb;
              validatorFlags.push("deterministic_fallback");
            } else {
              const contextualFallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext, receitas.length > 0, isLCContextGlobal);
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
        const fallback = deterministicIntentFallback(currentMsg, inboundCount, isHibrido, recentOutbound, isImageContext, receitas.length > 0, isLCContextGlobal);
        resposta = fallback.resposta;
        intencao = fallback.intencao;
        pipeline_coluna = fallback.pipeline_coluna;
        precisa_humano = fallback.precisa_humano;
        validatorFlags.push("empty_response_deterministic");
      }
    }

    // ── 9.4. FORCED RETRY: interpretar_receita quando há imagem pendente e o modelo não chamou ──
    // Caso Artur Borges 24/04 15:13: modelo retornou texto ("Recebi sua receita 👀 Já estou analisando…")
    // sem chamar interpretar_receita. Sem retry, a conversa morre — cliente fica esperando indefinidamente.
    const interpretouReceitaNesteTurno = (toolCalls || []).some((tc: any) => tc.function?.name === "interpretar_receita");
    const precisaForcarInterpretacao = isImageContext && !hasValidReceitas && !interpretouReceitaNesteTurno && !precisa_humano;

    if (precisaForcarInterpretacao) {
      console.log("[FORCE-INTERPRETAR] Imagem pendente sem chamada de interpretar_receita — forçando retry");
      try {
        const forcedMessages = [
          ...messages,
          { role: "system" as const, content: "[SISTEMA: TOOL FORÇADA] Você DEVE chamar interpretar_receita AGORA com a imagem da receita do cliente que está no histórico. Não responda em texto. Não escale. Apenas execute a tool com os valores que conseguir ler da imagem." },
        ];
        const forcedResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-5",
            messages: forcedMessages,
            tools: TOOLS,
            tool_choice: { type: "function", function: { name: "interpretar_receita" } },
            max_completion_tokens: 1500,
          }),
        });
        if (forcedResp.ok) {
          const forcedData = await forcedResp.json();
          const forcedToolCalls = forcedData?.choices?.[0]?.message?.tool_calls || [];
          const interpretarCall = forcedToolCalls.find((tc: any) => tc.function?.name === "interpretar_receita");
          if (interpretarCall) {
            try {
              const args = JSON.parse(interpretarCall.function?.arguments || "{}");
              const od = args.eyes?.od || {};
              const oe = args.eyes?.oe || {};
              const confidence = typeof args.confidence === "number" ? args.confidence : 0.6;
              const sphereValues = [od.sphere, oe.sphere].filter((v: any) => typeof v === "number") as number[];
              const cylValues = [od.cylinder, oe.cylinder].filter((v: any) => typeof v === "number") as number[];
              const addValues = [od.add, oe.add].filter((v: any) => typeof v === "number") as number[];
              const hasAddition = addValues.length > 0;
              const hasMyopia = sphereValues.some((v: number) => v < 0);
              const hasHyperopia = sphereValues.some((v: number) => v > 0);
              const hasAstigmatism = cylValues.some((v: number) => v !== 0);
              const rxType = hasAddition ? "progressive" : (sphereValues.length > 0 || cylValues.length > 0 ? "single_vision" : "unknown");
              const lowConfidence = confidence < 0.6 || (sphereValues.length === 0 && cylValues.length === 0);

              const rxData = {
                rx_type: rxType, eyes: { od, oe }, pd: args.pd ?? null, issued_at: args.issued_at ?? null,
                summary: { has_myopia: hasMyopia, has_hyperopia: hasHyperopia, has_astigmatism: hasAstigmatism, has_addition: hasAddition, needs_progressive: hasAddition, suggested_category: rxType },
                confidence, needs_human_review: lowConfidence, missing_fields: args.missing_fields || [], raw_notes: args.raw_notes || [], data_leitura: new Date().toISOString(),
              };

              if (!lowConfidence) {
                const { data: cData } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
                const eMeta = (cData?.metadata as Record<string, any>) || {};
                let eRec: any[] = Array.isArray(eMeta.receitas) ? eMeta.receitas : [];
                const rxLabel = args.label || (eRec.length === 0 ? "cliente" : `pessoa_${eRec.length + 1}`);
                eRec.push({ ...rxData, label: rxLabel });
                if (eRec.length > 5) eRec = eRec.slice(-5);
                await supabase.from("contatos").update({ metadata: { ...eMeta, receitas: eRec, ultima_receita: rxData } }).eq("id", contatoId);
                await supabase.from("eventos_crm").insert({
                  contato_id: contatoId, tipo: "receita_interpretada",
                  descricao: `Receita interpretada via retry forçado (confidence=${confidence})`,
                  metadata: { rx_data: rxData, forced_retry: true },
                  referencia_tipo: "atendimento", referencia_id: atendimento_id,
                });

                const sphereTxt = (eye: any) => typeof eye?.sphere === "number" ? `esf ${eye.sphere > 0 ? "+" : ""}${eye.sphere.toFixed(2)}` : "";
                const cylTxt = (eye: any) => typeof eye?.cylinder === "number" && eye.cylinder !== 0 ? ` cil ${eye.cylinder.toFixed(2)}` : "";
                const odSummary = `OD ${sphereTxt(od)}${cylTxt(od)}`.trim();
                const oeSummary = `OE ${sphereTxt(oe)}${cylTxt(oe)}`.trim();
                const ctxLC = isLCContextGlobal ? "lentes de contato" : "lentes";

                resposta = `Prontinho, consegui ler sua receita 😊\n${odSummary}\n${oeSummary}\n\nJá vou separar opções de ${ctxLC} compatíveis. Em qual região/bairro você está pra eu indicar a loja mais próxima?`;
                intencao = isLCContextGlobal ? "orcamento_lc" : "orcamento";
                pipeline_coluna = "Orçamento";
                precisa_humano = false;
                validatorFlags.push("forced_interpretar_receita_retry_ok");
                console.log(`[FORCE-INTERPRETAR] Receita salva via retry (lc=${isLCContextGlobal})`);
              } else {
                resposta = "Consegui abrir sua receita, mas não estou conseguindo ler os valores com clareza 😅 Pode me passar por texto: OD esférico/cilíndrico/eixo e OE esférico/cilíndrico/eixo? Assim já te passo as opções certinhas.";
                intencao = "receita_oftalmologica";
                pipeline_coluna = "Orçamento";
                precisa_humano = false;
                validatorFlags.push("forced_interpretar_receita_low_confidence");
                console.log("[FORCE-INTERPRETAR] Confiança baixa — pedindo valores por texto");
              }
            } catch (parseErr) {
              console.error("[FORCE-INTERPRETAR] Erro ao processar args:", parseErr);
            }
          } else {
            console.warn("[FORCE-INTERPRETAR] Modelo não retornou tool call mesmo com tool_choice forçado");
          }
        } else {
          console.warn(`[FORCE-INTERPRETAR] Erro ${forcedResp.status} no retry`);
        }
      } catch (e) {
        console.error("[FORCE-INTERPRETAR] Exception no retry:", e);
      }
    }

    // ── 9.5. GUARDRAIL ANTI-LOOP "dois caminhos" ──
    // Se a resposta contém "dois caminhos" / "te mostrar opções ou montar um orçamento" e a mesma
    // frase já foi enviada antes, descarta e força o caminho correto. Caso Artur Borges (24/04):
    // IA repetiu 5× "Recebi sua receita aqui 😊… dois caminhos" sem nunca chamar interpretar_receita.
    
    const hasDoisCaminhos = /dois caminhos|te mostrar op[cç][oõ]es.*ou montar um or[cç]amento/i.test(resposta || "");
    const doisCaminhosJaEnviado = (recentOutbound || []).some((prev) =>
      /dois caminhos|te mostrar op[cç][oõ]es.*ou montar um or[cç]amento/i.test(prev || "")
    );
    if (hasDoisCaminhos && doisCaminhosJaEnviado) {
      console.log(`[GUARDRAIL-DOIS-CAMINHOS] Detectado loop. hasReceitas=${receitas.length > 0} | isImageContext=${isImageContext} | isLC=${isLCContextGlobal}`);
      validatorFlags.push("anti_loop_dois_caminhos");
      if (receitas.length === 0 && isImageContext) {
        // Imagem pendente sem receita interpretada → analisando
        resposta = "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções compatíveis em seguida, um instante…";
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";
      } else if (receitas.length > 0 && isLCContextGlobal) {
        resposta = "Beleza! Já tô montando aqui as opções de lentes de contato com base na sua receita 😊 Em qual região/bairro você está pra eu indicar a loja mais próxima?";
        intencao = "orcamento_lc";
        pipeline_coluna = "Orçamento";
      } else if (receitas.length > 0) {
        resposta = "Beleza! Já vou te mandar as opções compatíveis com a sua receita 😊 Em qual região você está? Assim já te indico a loja mais próxima.";
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
      } else {
        resposta = "Pra te passar os valores certinhos, me manda a foto da sua receita atualizada por aqui 📸 Se ainda não tiver, posso te orientar também 😉";
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
      }
    }

    // ── 10. SEND RESPONSE ──
    // Guardrail intra-mensagem: na 1ª interação, garantir UMA única pergunta sobre o nome.
    // Se o LLM duplicou ("Posso saber seu nome? Pode me dizer seu nome completo?"),
    // reescreve para a frase modelo determinística.
    if (inboundCount <= 1 && typeof resposta === "string" && resposta.trim().length > 0) {
      const lower = resposta.toLowerCase();
      const questionMarks = (resposta.match(/\?/g) || []).length;
      const nomeMentions = (lower.match(/\bnome\b/g) || []).length;
      const hasDuplicatedPunct = /\?\s*\.|\?\s*\?/.test(resposta);
      const mencionaGael = lower.includes("gael");
      if (mencionaGael && (questionMarks > 1 || nomeMentions > 1 || hasDuplicatedPunct)) {
        const original = resposta;
        resposta = "Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?";
        console.log(`[GUARDRAIL] Saudação duplicada corrigida. Original: "${original}"`);
      }
    }
    // ── 9.99. OVERRIDE: escalada fora do horário comercial humano ──
    // Quando vai escalar para humano e estamos fora do expediente, troca a mensagem
    // pra avisar que o time humano retorna no próximo expediente. Card vai pra fila normalmente.
    if (precisa_humano && !isHorarioHumano()) {
      const _np = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
      resposta = mensagemEscaladaForaHorario(_np);
      validatorFlags.push("escalada_fora_horario");
      console.log("[HORARIO-HUMANO] Escalada fora do expediente — mensagem ajustada");
      try {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "escalada_fora_horario",
          descricao: `Escalada para humano fora do expediente — próxima abertura: ${proximaAberturaHumana()}`,
          metadata: { proxima_abertura: proximaAberturaHumana() },
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });
      } catch (_) { /* noop */ }
    }
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
