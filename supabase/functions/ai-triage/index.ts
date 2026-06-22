// orcamento oculos deterministico 2026-06-10
// modo consultivo
// receita B1 B2 deploy trigger 2026-06-12 (re-deploy pós-merge github)
// deploy trigger 2026-06-15b — safety net _receitasCurrentSession (ebb1522)
// loop receita pos cotacao — deploy trigger 2026-06-21
// receita plano — deploy trigger 2026-06-21
// ocr aceita pdf — deploy trigger 2026-06-21
// cidade escape — deploy trigger 2026-06-21
// escape s2 — deploy trigger 2026-06-21
// loop menu suave — deploy trigger 2026-06-21
// fatia1 direciona loja — merge 9cdd117
// cidades reais botoes — R1+R2 merge fix/cidades-reais-e-botoes
// classificador shadow — merge acde38b
// fatia2 receita escalada vira loja — merge fix/receita-escalada-vira-loja
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Menu de triagem — fonte única de verdade ─────────────────────────────────
// Usado em: fast-path saudação recorrente, registrar_nome_cliente, nome_ok.
// "cashback_ver" já é tratado por routeButtonClick (chama cashback_consultar_saldo).
const MENU_TRIAGEM_ITENS: Array<{ id: string; titulo: string; descricao: string }> = [
  { id: "orcamento",     titulo: "💰 Orçamento",        descricao: "Óculos ou lentes de contato" },
  { id: "agendar",       titulo: "📅 Agendar visita",    descricao: "Marcar um horário na loja" },
  { id: "status_pedido", titulo: "🔍 Status do pedido",  descricao: "Consultar OS / óculos pronto" },
  { id: "duvida",        titulo: "💬 Tirar uma dúvida",  descricao: "Produtos / serviços" },
  { id: "reclamacao",    titulo: "⚠️ Reclamação",        descricao: "Falar com a equipe" },
  { id: "cashback_ver",  titulo: "💳 Meu cashback",      descricao: "Consultar seu saldo" },
];

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

// ── MENSAGENS FIXAS EDITÁVEIS (tabela ia_mensagens_fixas) ──
// Defaults preservados como fallback caso a tabela esteja indisponível.
const _msgFixaDefaults: Record<string, string> = {
  escalada_fora_horario:
    "Vou acionar nossa equipe pra você{nome_saud}! 🙌 Só um detalhe: nosso time humano atende de seg a sex das 09h às 18h e sábado das 08h às 12h. Como estamos fora do horário agora, assim que abrir o próximo expediente ({proxima_abertura}), eles te respondem por aqui. Pode deixar registrado o que precisa que já encaminho 😉",
  pedir_receita_texto:
    "Tô tendo dificuldade de ler os valores na foto 😅 Pode me passar por texto, por favor?\n\nPreciso de:\n• *OD* (olho direito): esférico / cilíndrico / eixo (e adição se tiver)\n• *OE* (olho esquerdo): esférico / cilíndrico / eixo (e adição se tiver)\n\nEx: *OD -2,00 cil -0,75 eixo 180* / *OE -1,75 cil -0,50 eixo 170*\n\nSe preferir, mande outra foto com a receita inteira no enquadramento e boa iluminação 📸",
  pedir_receita_texto_botao:
    "Beleza! Me passa por texto então 😊\n\nPreciso de:\n• *OD* (olho direito): esférico / cilíndrico / eixo (e adição se tiver)\n• *OE* (olho esquerdo): esférico / cilíndrico / eixo (e adição se tiver)\n\nEx: *OD -2,00 cil -0,75 eixo 180* / *OE -1,75 cil -0,50 eixo 170*\n\nSe não tiver cilindro/eixo, manda só o esférico mesmo 👌",
  despedida_explicit_close:
    "Foi um prazer te atender{nome_comma}! 🙏 Obrigado pelo contato{tail}. Qualquer coisa, é só me chamar 👋",
  despedida_thanks:
    "De nada{nome_comma}! {tail} 👋 Qualquer dúvida é só me chamar.",
  despedida_short_no:
    "Combinado{nome_comma}! {tail} 👋 Qualquer dúvida é só me chamar.",
  formas_pagamento:
    "Trabalhamos com várias formas pra facilitar pra você 😊\n\n💳 *Cartão de crédito* — em até *10x sem juros*\n💰 *PIX / dinheiro* — com *desconto à vista*\n🧾 *Boleto* — à vista ou parcelado\n📋 *Crediário próprio Óticas Diniz* — análise na hora, sem cartão\n\nPosso já agendar uma visita na loja mais próxima pra você fechar o pedido? Me conta seu bairro 📍",
  os_nao_iniciada:
    "Oi{nome_comma}! Localizei sua OS *{os}*{produto_parte}. Ainda não foi iniciada a produção — nossa equipe começa em breve. Qualquer novidade te aviso! 😊",
  os_producao_lentes:
    "Oi{nome_comma}! Sua OS *{os}*{produto_parte} está em *produção de lentes*. Assim que ficar pronta te avisamos por aqui! 😊",
  os_producao_montagem:
    "Oi{nome_comma}! Sua OS *{os}*{produto_parte} está em *montagem final*. Tá quase — em breve fica disponível para retirada! 😊",
  os_pronto:
    "Oi{nome_comma}! Sua OS *{os}*{produto_parte} está *pronta para retirada* na {loja}! Pode passar quando quiser 😊",
  os_entregue:
    "Oi{nome_comma}! Sua OS *{os}*{produto_parte} já foi *entregue/retirada*. Se precisar de algo, é só chamar! 😊",
  os_erp_indisponivel:
    "Oi{nome_comma}! Não consegui acessar as informações do pedido agora 😅 Por favor, tente novamente em alguns minutos ou entre em contato com a loja diretamente.",
  os_escala_verificacao:
    "Deixa eu verificar esse pedido com mais cuidado pra você 😊 Vou te conectar com um consultor que confirma tudo certinho, tá? Um instante!",
};
const _msgFixaCache: Record<string, string> = { ..._msgFixaDefaults };
let _msgFixaExpire = 0;
async function loadMensagensFixas(client: any): Promise<void> {
  if (Date.now() < _msgFixaExpire) return;
  try {
    const { data } = await client.from("ia_mensagens_fixas").select("chave, texto, ativo");
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r?.ativo !== false && typeof r?.texto === "string" && r.texto.length > 0) {
          _msgFixaCache[r.chave] = r.texto;
        }
      }
      MSG_PEDIR_RECEITA_TEXTO = _msgFixaCache.pedir_receita_texto || _msgFixaDefaults.pedir_receita_texto;
      MSG_PEDIR_RECEITA_TEXTO_BOTAO = _msgFixaCache.pedir_receita_texto_botao || _msgFixaDefaults.pedir_receita_texto_botao;
    }
  } catch (e) {
    console.warn("[ia_mensagens_fixas] load falhou, usando defaults", (e as Error)?.message);
  }
  _msgFixaExpire = Date.now() + 60_000;
}
function renderMsgFixa(chave: string, vars: Record<string, string> = {}): string {
  let t = _msgFixaCache[chave] || _msgFixaDefaults[chave] || "";
  for (const [k, v] of Object.entries(vars)) {
    t = t.split(`{${k}}`).join(v ?? "");
  }
  return t;
}
function mensagemEscaladaForaHorario(nomePrim: string): string {
  return renderMsgFixa("escalada_fora_horario", {
    nome_saud: nomePrim ? `, ${nomePrim}` : "",
    proxima_abertura: proximaAberturaHumana(),
  });
}

// Mensagem padrão quando OCR falha / receita ilegível. Mutável: ressincronizada
// pelo loader; mantém uso síncrono nos vários pontos do fluxo.
let MSG_PEDIR_RECEITA_TEXTO = _msgFixaDefaults.pedir_receita_texto;
let MSG_PEDIR_RECEITA_TEXTO_BOTAO = _msgFixaDefaults.pedir_receita_texto_botao;


// ═══════════════════════════════════════════
// CONFIRMAÇÃO PÓS-OCR + CTA AGENDAMENTO + ESCOLHA CIDADE → LOJA (Mai/2026)
// ═══════════════════════════════════════════
const MSG_CTA_AGENDAMENTO = "Posso agendar uma visita pra você ver pessoalmente e fechar o pedido? 😊";

// FALLBACK — usar apenas se a tabela lojas_cidades estiver inacessível
const _FALLBACK_MSG_LISTA_CIDADES = "Boa! Atendemos nessas cidades, qual fica melhor pra você visitar?\n\n🏙️ Osasco\n🏙️ Carapicuíba\n🏙️ Itapevi\n🏙️ Barueri";
// FALLBACK — usar apenas se a tabela lojas_cidades estiver inacessível
const _FALLBACK_CIDADE_TO_LOJAS: Record<string, string[]> = {
  osasco: ["DINIZ ANTONIO AGU","DINIZ PRIMITIVA I","DINIZ PRIMITIVA II","DINIZ STO ANTONIO","DINIZ SUPER SHOPPING","DINIZ UNIÃO"],
  carapicuiba: ["DINIZ CARAPICUIBA"],
  itapevi: ["DINIZ ITAPEVI"],
  barueri: ["DINIZ BARUERI"],
};
// FALLBACK — usar apenas se a tabela lojas_cidades estiver inacessível
const _FALLBACK_CIDADE_LABEL: Record<string, string> = {
  osasco: "Osasco",
  carapicuiba: "Carapicuíba",
  itapevi: "Itapevi",
  barueri: "Barueri",
};

// ── Cache de lojas_cidades (TTL 5 min) ─────────────────────────────
type CidadesSnapshot = {
  cidadeToLojas: Record<string, string[]>;
  cidadeLabel: Record<string, string>;
  cidadesOrdenadas: string[]; // chaves normalizadas (osasco, carapicuiba, ...)
};
let cidadesCache: { data: CidadesSnapshot, loadedAt: number } | null = null;
const CIDADES_TTL_MS = 5 * 60 * 1000;

function _cidadeKeyToLabel(key: string): string {
  return _FALLBACK_CIDADE_LABEL[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

async function loadCidadesLojas(): Promise<CidadesSnapshot> {
  const now = Date.now();
  if (cidadesCache && (now - cidadesCache.loadedAt) < CIDADES_TTL_MS) {
    return cidadesCache.data;
  }
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !key) throw new Error("missing supabase env");
    const client = createClient(url, key);
    const { data, error } = await client
      .from("lojas_cidades")
      .select("cidade, loja_nome, regiao, ativo")
      .eq("ativo", true);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty lojas_cidades");

    const cidadeToLojas: Record<string, string[]> = {};
    const cidadeLabel: Record<string, string> = {};
    for (const r of data) {
      const cidade = String((r as any).cidade || "").toLowerCase();
      const nome = String((r as any).loja_nome || "");
      if (!cidade || !nome) continue;
      if (!cidadeToLojas[cidade]) cidadeToLojas[cidade] = [];
      cidadeToLojas[cidade].push(nome);
      if (!cidadeLabel[cidade]) cidadeLabel[cidade] = _cidadeKeyToLabel(cidade);
    }
    const cidadesOrdenadas = Object.keys(cidadeToLojas).sort();
    const snapshot: CidadesSnapshot = { cidadeToLojas, cidadeLabel, cidadesOrdenadas };
    cidadesCache = { data: snapshot, loadedAt: now };
    return snapshot;
  } catch (e) {
    console.warn("[loadCidadesLojas] usando FALLBACK:", (e as Error)?.message);
    const snapshot: CidadesSnapshot = {
      cidadeToLojas: _FALLBACK_CIDADE_TO_LOJAS,
      cidadeLabel: _FALLBACK_CIDADE_LABEL,
      cidadesOrdenadas: ["osasco", "carapicuiba", "itapevi", "barueri"],
    };
    // não persiste cache no fallback — tenta de novo na próxima chamada
    return snapshot;
  }
}

async function getMsgListaCidades(): Promise<string> {
  try {
    const snap = await loadCidadesLojas();
    if (!snap.cidadesOrdenadas.length) return _FALLBACK_MSG_LISTA_CIDADES;
    let out = "Boa! Atendemos nessas cidades, qual fica melhor pra você visitar?\n";
    for (const k of snap.cidadesOrdenadas) {
      out += `\n🏙️ ${snap.cidadeLabel[k] || _cidadeKeyToLabel(k)}`;
    }
    return out;
  } catch {
    return _FALLBACK_MSG_LISTA_CIDADES;
  }
}

function _normTxt(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function detectAceiteVisita(text: string): boolean {
  const t = _normTxt(text);
  if (!t) return false;
  if (/\b(nao|n[ãa]o)\b/.test(t)) return false;
  return /^(sim|claro|quero|topo|topa|pode|pode sim|bora|vamos|gostaria|aceito|com certeza|simm|isso|👍|👌|✅)\b/.test(t);
}

function detectRecusaVisita(text: string): boolean {
  const t = _normTxt(text);
  if (!t) return false;
  return /^(nao|n[ãa]o|agora nao|depois|fica pra depois|so orcamento|so or[çc]amento)\b/.test(t);
}

function detectCidadeEscolhida(text: string): string | null {
  const t = _normTxt(text);
  if (!t) return null;
  // numérico (1=osasco, 2=carapicuiba, 3=itapevi, 4=barueri)
  const numMatch = t.match(/^([1-4])\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]);
    return ["osasco", "carapicuiba", "itapevi", "barueri"][idx - 1] || null;
  }
  if (/\bosasco\b/.test(t)) return "osasco";
  if (/\bcarapicuiba\b/.test(t)) return "carapicuiba";
  if (/\bitapevi\b/.test(t)) return "itapevi";
  if (/\bbarueri\b|\balphaville\b/.test(t)) return "barueri";
  return null;
}

async function formatLojasPorCidade(cidade: string, lojas: any[]): Promise<string> {
  const snap = await loadCidadesLojas();
  const nomes = snap.cidadeToLojas[cidade] || [];
  const label = snap.cidadeLabel[cidade] || _cidadeKeyToLabel(cidade);
  const filtradas = (lojas || []).filter((l: any) =>
    nomes.some((n) => _normTxt(l.nome_loja) === _normTxt(n))
  );
  if (filtradas.length === 0) {
    return `Boa! Pra ${label}, posso te indicar a loja mais próxima — me passa o seu bairro? 😊`;
  }
  const numEmojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣"];
  let out = `Aqui são as lojas em *${label}* — qual fica melhor pra você? 😊\n`;
  filtradas.forEach((l: any, i: number) => {
    const end = l.endereco ? ` — ${l.endereco}` : "";
    out += `\n${numEmojis[i] || `${i+1}.`} *${l.nome_loja}*${end}`;
  });
  return out;
}

async function matchLojaEscolhida(text: string, cidade: string, lojas: any[]): Promise<any | null> {
  const snap = await loadCidadesLojas();
  const nomes = snap.cidadeToLojas[cidade] || [];
  const filtradas = (lojas || []).filter((l: any) =>
    nomes.some((n) => _normTxt(l.nome_loja) === _normTxt(n))
  );
  if (filtradas.length === 0) return null;
  const t = _normTxt(text);
  const numMatch = t.match(/^([1-9])\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (filtradas[idx]) return filtradas[idx];
  }
  // match por palavra-chave do nome (tira "DINIZ ")
  for (const l of filtradas) {
    const nome = _normTxt(l.nome_loja).replace(/^diniz\s+/, "");
    const tokens = nome.split(/\s+/).filter((w) => w.length >= 3);
    if (tokens.some((w) => t.includes(w))) return l;
  }
  return null;
}

function fmtRxLine(eye: any, name: string): { line: string; missing: string[] } {
  // Visão monocular: olho sem lente. Não é "faltando dado" — é declaração do cliente.
  if (eye?.blind === true) {
    return { line: `👁️ *${name}*: _visão monocular (sem lente)_`, missing: [] };
  }
  const esf = (eye?.sphere ?? null);
  const cil = (eye?.cylinder ?? null);
  const eixo = (eye?.axis ?? null);
  const addVal = (typeof eye?.add === "number" && eye.add !== 0) ? eye.add : null;
  const fmtNum = (v: any) => (Number(v) === 0 ? "0,00" : (Number(v) > 0 ? "+" : "") + Number(v).toFixed(2).replace(".", ","));
  const parts: string[] = [];
  const missing: string[] = [];
  if (esf != null) parts.push(`ESF ${fmtNum(esf)}`); else missing.push(`esférico do ${name}`);
  if (cil != null && cil !== 0) {
    parts.push(`CIL ${fmtNum(cil)}`);
    // Eixo só faz sentido se houver cilindro
    if (eixo != null) parts.push(`EIXO ${eixo}°`); else missing.push(`eixo do ${name}`);
  }
  if (addVal != null) parts.push(`ADD +${addVal}`);
  const body = parts.length ? parts.join(" ") : "(não consegui ler)";
  return { line: `👁️ *${name}*: ${body}`, missing };
}

// ── Detecção de visão monocular ──
// Retorna { blind_eye: 'od' | 'oe' | null, signal: boolean }.
// `signal=true` significa que o cliente mencionou monocular/sem visão; quando blind_eye=null
// não conseguimos identificar o lado e precisamos perguntar.
function detectMonocular(text: string): { blind_eye: "od" | "oe" | null; signal: boolean } | null {
  if (!text) return null;
  const t = String(text).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove acentos
  const hasMono = /\bmonocul[ao]r?\b|\bvisao monocul/i.test(t)
    || /\b(uma|so uma|so 1|apenas uma|so um)\s+(lente|olho)\b/.test(t)
    || /\b(olho|vista)\s+(direito|esquerdo|od|oe)\s+(sem\s+visao|nao\s+(enxergo|vejo|ve)|cego|prote(se|tico)|tampado|coberto|fechado)\b/.test(t)
    || /\b(s[oó]\s+enxergo|enxergo\s+s[oó]|s[oó]\s+vejo|vejo\s+s[oó]|enxergo\s+apenas|vejo\s+apenas)\s+(do|com|pelo|no|com o|do olho)?\s*(olho\s+)?(direito|esquerdo|od|oe)\b/.test(t)
    || /\bperdi\s+(a\s+visao|visao)\s+(do|no)\s+(olho\s+)?(direito|esquerdo|od|oe)\b/.test(t);
  if (!hasMono) return null;

  // Determina qual olho ENXERGA → o outro é o blind.
  // 1) "sem visão / não enxergo OX" → blind = OX
  const blindMatch = t.match(/\b(olho|vista)\s+(direito|esquerdo|od|oe)\s+(sem\s+visao|nao\s+(enxergo|vejo|ve)|cego|prote|tampado|coberto|fechado)\b/)
    || t.match(/\b(direito|esquerdo|od|oe)\s+(sem\s+visao|cego)\b/)
    || t.match(/\bperdi\s+(?:a\s+)?visao\s+(?:do|no)\s+(?:olho\s+)?(direito|esquerdo|od|oe)\b/);
  if (blindMatch) {
    const side = blindMatch[2] || blindMatch[1];
    if (/direito|^od$/.test(side)) return { blind_eye: "od", signal: true };
    if (/esquerdo|^oe$/.test(side)) return { blind_eye: "oe", signal: true };
  }
  // 2) "só enxergo do OX" → blind = oposto
  const seeingMatch = t.match(/\b(s[oó]\s+enxergo|enxergo\s+s[oó]|s[oó]\s+vejo|vejo\s+s[oó]|enxergo\s+apenas|vejo\s+apenas)\s+(?:do|com|pelo|no|com\s+o|do\s+olho)?\s*(?:olho\s+)?(direito|esquerdo|od|oe)\b/);
  if (seeingMatch) {
    const side = seeingMatch[2];
    if (/direito|^od$/.test(side)) return { blind_eye: "oe", signal: true };
    if (/esquerdo|^oe$/.test(side)) return { blind_eye: "od", signal: true };
  }
  // Sem lado identificável.
  return { blind_eye: null, signal: true };
}

function buildMsgConfirmarReceita(rx: any, isCorrection: boolean): string {
  const od = rx?.eyes?.od || {};
  const oe = rx?.eyes?.oe || {};
  const head = isCorrection ? "Anotei! Ficou assim:" : "Li sua receita assim, confere? 😊";
  const tail = isCorrection ? "Agora tá certo? ✅" : "Está certinho?";
  const odLine = fmtRxLine(od, "OD");
  const oeLine = fmtRxLine(oe, "OE");
  const missing = [...odLine.missing, ...oeLine.missing];
  let nota = "";
  if (missing.length) {
    nota = `\n\n_Não consegui identificar: ${missing.join(", ")}. Se tiver na receita, me passa por texto que eu completo aqui 🙏_`;
  }
  return `${head}\n${odLine.line}\n${oeLine.line}${nota}\n\n${tail}`;
}

function detectRxConfirmation(text: string): boolean {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (/\b(n[ãa]o|errad|incorret|t[áa]\s+errad|est[áa]\s+errad|nao confere)\b/.test(t)) return false;
  return /^(sim|confere|isso|perfeito|certinho|certo|correto|exato|t[áa]\s+certo|t[áa]\s+certinho|est[áa]\s+certo|est[áa]\s+certinho|est[áa]\s+correto|ok|positivo|👍|👌|✅|tudo certo|isso mesmo)\b/.test(t);
}

function detectRxRejeicao(text: string): boolean {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  return /^(n[ãa]o|errad|incorret|nao confere|t[áa]\s+errad|est[áa]\s+errad|errou|nao\s*[eé]\s+isso|n[ãa]o\s*[eé]\s+isso)\b/.test(t)
    || /\b(t[áa]\s+errad|est[áa]\s+errad|n[ãa]o\s+confere|nao\s*[eé]\s+isso|errou|esses?\s+valores?\s+est[aã]o\s+errad)\b/.test(t);
}

// ÂNCORA COMERCIAL — "a partir de" óculos sem receita (editar aqui para atualizar os pisos)
const ANCORA_OCULOS = { visao_simples: 198, multifocal: 298, armacao: 98 };

// PROTEÇÃO 1 (TTL): pending de receita expira em 24h.
// Evita que cliente que sumiu e voltou dias depois caia em loop de
// "confirme essa receita" referenciando uma leitura velha.
const RECEITA_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
function isReceitaPending(metadata: any): boolean {
  const rc = metadata?.receita_confirmacao;
  if (!rc || rc.pending !== true) return false;
  const ts = rc.asked_at || rc.solicitada_at || rc.set_at;
  if (!ts) return true; // sem timestamp = legado, mantém pending
  const askedAt = Date.parse(String(ts));
  if (Number.isNaN(askedAt)) return true;
  if (Date.now() - askedAt > RECEITA_PENDING_TTL_MS) {
    console.log(`[RX-PENDING-TTL] pending expirado (${Math.round((Date.now()-askedAt)/3600000)}h) — ignorando`);
    return false;
  }
  return true;
}

function detectExpectedReplyAction(expectedReply: unknown, text: string): string | null {
  const stage = String(expectedReply || "").trim();
  const t = norm(String(text || ""));
  if (!stage || !t) return null;

  if (stage === "menu_triagem") {
    if (/\b(orcamento|orçamento|preco|preço|valor|cotacao|cotação|multifocal|lente|lentes|oculos|óculos)\b/.test(t)) return "orcamento";
    if (/\b(agendar|agendamento|marcar|visita|horario|horário)\b/.test(t)) return "agendar";
    if (/\b(status|pedido|os|oculos pronto|óculos pronto|pronto)\b/.test(t)) return "status_pedido";
    if (/\b(reclamacao|reclamação|problema|insatisfeito|insatisfacao|insatisfação)\b/.test(t)) return "reclamacao";
    if (/\b(duvida|dúvida|pergunta|ajuda|explica|explicacao|explicação)\b/.test(t)) return "duvida";
    return null;
  }

  if (stage === "receita_envio") {
    if (/\b(foto|imagem|anexo|pdf|arquivo|mandar foto|enviar foto)\b/.test(t)) return "receita_foto";
    if (/\b(digitar|digitado|escrever|por texto|texto|informar aqui)\b/.test(t)) return "receita_digitar";
    if (/\b(nao tenho|não tenho|sem receita|nao possuo|não possuo|nao tenho receita|não tenho receita)\b/.test(t)) return "receita_sem";
    return null;
  }

  if (stage === "receita_confirmacao") {
    if (detectRxConfirmation(t)) return "receita_ok";
    if (detectRxRejeicao(t)) return "receita_corrigir";
    return null;
  }

  if (stage === "receita_digitada") {
    if (/\b(foto|imagem|anexo|pdf|arquivo|mandar foto|enviar foto)\b/.test(t)) return "receita_foto";
    if (/\b(nao tenho|não tenho|sem receita|nao possuo|não possuo|nao tenho receita|não tenho receita)\b/.test(t)) return "receita_sem";
    if (/\b(orcamento|orçamento|preco|preço|valor|cotacao|cotação|quanto custa|quanto fica)\b/.test(t)) return "receita_digitar";
    return null;
  }

  if (stage === "adicional_lentes") {
    if (/\b(luz azul|filtro azul|anti blue|antiblue|blue cut|azul)\b/.test(t)) return "adicional_azul";
    if (/\b(fotossensivel|fotocromatica|fotocromatico|transitions|escurece no sol)\b/.test(t)) return "adicional_foto";
    if (/\b(sem|nenhum|nao quero|nao precisa|nada|so a lente|so as lentes)\b/.test(t) || t === "nao") return "adicional_nao";
    return null;
  }

  if (stage === "pos_cotacao") {
    if (/\b(mais barato|mais em conta|baratinho|barato|desconto|economica|economico)\b/.test(t)) return "orcamento_mais_barato";
    if (/\b(duvida|duvidas|explica|explicar|entendi|entender|qual a diferenca|qual a diferença)\b/.test(t)) return "orcamento_duvida";
    if (/\b(agendar|agendo|agenda|visita|quero ir|ir na loja|marcar|quero ver na loja|fechar na loja)\b/.test(t)) return "orcamento_agendar";
    return null;
  }

  if (stage === "recuperacao") {
    if (/\b(loja|lojas|endereco|endereco|onde fica|unidade|unidades)\b/.test(t)) return "recupera_loja";
    // Intenção própria do cliente VENCE a cadência de recuperação.
    // "quero fazer óculos" / "quero um orçamento" / "preciso de receita" → não é "sim" genérico.
    // Nota: agendar/marcar NÃO entram aqui — "quero marcar" é resposta legítima à oferta de retomada.
    if (/\b(or[çc]amento|or[çc]ar|pre[çc]o|valor|[oó]culos|lente[s]?|grau\b|receita\b|comprar|compra\b|renovar|refazer|armac[aã]o|pedido\b|status\b)\b/.test(t)) return "recupera_intent_propria";
    if (/^(sim|quero|bora|vamos|pode|claro|gostaria|agendar|marcar|com certeza|por favor|pfv|👍|✅|positivo|topo)\b/.test(t)) return "recupera_sim";
    if (/^(nao|não|agora nao|agora não|depois|outro momento|nao quero|não quero|sem interesse|deixa)\b/.test(t)) return "recupera_nao";
    return null;
  }

  if (stage === "desconto_followup") {
    if (/\b(loja|lojas|endereco|endereco|onde fica|unidade|unidades)\b/.test(t)) return "desconto_loja";
    if (/\b(aceito|fechar|fecho|agendar|agenda|quero|vamos|bora|topo|pode ser|combinado)\b/.test(t)) return "desconto_aceito";
    if (/\b(vou pensar|pensar|depois|mais tarde|agora nao|agora não|nao sei|não sei)\b/.test(t)) return "desconto_pensar";
    return null;
  }

  if (stage === "confirmar_nome") {
    // Cliente respondeu por texto à pergunta "Falo com X?"
    if (/^(sim|isso|sou eu|sou|exato|exatamente|correto|positivo|pode ser|é isso|eh isso|👍|✅)\b/.test(t)) return "nome_ok";
    if (/\b(nao|não|outro|errado|nao sou|não sou|me chamo|meu nome|sou (o |a )?[a-zà-ÿ]+|prefiro)\b/.test(t)) return "nome_outro";
    return null;
  }

  if (stage === "dia_d_lembrete") {
    // Lembrete véspera / 1h antes — cliente digitou em vez de tocar botão
    if (/\b(confirmo|confirmado|confirma|sim|vou sim|estarei|tô indo|to indo|vou|pode confirmar|positivo|👍|✅)\b/.test(t)) return "show_confirma";
    if (/\b(remarcar|remarca|mudar|trocar (o )?horario|trocar (o )?horário|outro (dia|horario|horário)|adiar)\b/.test(t)) return "show_remarcar";
    if (/\b(nao vou|não vou|cancela|cancelar|desmarca|desmarcar|nao consigo|não consigo|nao posso|não posso|nao da|não dá)\b/.test(t)) return "show_nao";
    return null;
  }

  // Cashback: cliente digitou em vez de tocar o botão da pergunta de confirmação
  if (stage === "cashback_confirmacao") {
    if (
      /\b(sim|quero|pode|claro|aham|isso|manda|ver|ok|s|ss)\b/.test(t) ||
      /[👍✅]/.test(text)
    ) return "cashback_ver";
    if (/\b(nao|agora nao|depois|deixa)\b/.test(t)) return "cashback_nao";
    return null;
  }

  if (stage === "os_aguardando_pertencimento") {
    if (/^(sim|isso|é esse|e esse|esse mesmo|eh esse|exato|correto|pode ser|é|e|isso mesmo)\b/.test(t) || /[👍✅]/.test(text)) return "os_pert_sim";
    if (/^(nao|não|errado|outro|outra|nao e|não é|nao eh|diferente|nao é esse|nao e esse)\b/.test(t)) return "os_pert_nao";
    return null;
  }

  return null;
}

function matchLojaByTypedText(lojas: Array<{ id: string; nome_loja?: string | null; endereco?: string | null }>, text: string) {
  const t = norm(String(text || ""));
  if (!t) return null;

  return lojas.find((loja) => {
    const nome = norm(loja.nome_loja || "");
    const endereco = norm(loja.endereco || "");
    if (!nome && !endereco) return false;
    if (nome && (t === nome || t.includes(nome) || nome.includes(t))) return true;
    const tokens = `${nome} ${endereco}`
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .filter((token) => !["oticas", "diniz", "loja", "shopping", "osasco", "centro", "unidade"].includes(token));
    return tokens.some((token) => t.includes(token));
  }) || null;
}

// Detecta escolha do cliente entre múltiplas receitas ("a primeira", "a segunda", "a nova", etc.)
function detectEscolhaReceita(text: string, receitas: any[]): { idx: number; how: string } | null {
  if (!Array.isArray(receitas) || receitas.length < 2) return null;
  const t = String(text || "").toLowerCase().trim();
  if (!t || t.length > 120) return null;
  // Última / nova / mais recente / a de agora / a segunda foto
  if (/\b(a\s+)?(ultima|última|mais\s+recente|nova|recente|de\s+agora|que\s+(eu\s+)?mandei\s+(agora|por\s+ultimo|por\s+último)|essa\s+(de\s+)?(agora|nova|ultima|última)|segunda\s+foto|nova\s+foto)\b/.test(t)) {
    return { idx: receitas.length - 1, how: "ultima" };
  }
  // Primeira / antiga / anterior
  if (/\b(a\s+)?(primeira|1[ªa°]?|antiga|anterior|antiga\s+receita|de\s+antes|que\s+(eu\s+)?mandei\s+(antes|primeiro))\b/.test(t)) {
    return { idx: 0, how: "primeira" };
  }
  // "a segunda", "a 2", "receita 2"
  const mNum = t.match(/\b(?:a\s+|receita\s+)?(\d{1,2})[ªa°]?\b/);
  if (mNum) {
    const n = parseInt(mNum[1], 10);
    if (n >= 1 && n <= receitas.length) return { idx: n - 1, how: `numero_${n}` };
  }
  if (/\bsegunda\b/.test(t) && receitas.length >= 2) return { idx: 1, how: "segunda" };
  if (/\bterceira\b/.test(t) && receitas.length >= 3) return { idx: 2, how: "terceira" };
  return null;
}

function isReceitaForaDaFaixa(rx: any): boolean {
  // Regra de negócio (Mai/2026, revisada): só marca como "lente especial" / fora-da-faixa quando
  // o esférico passa de 16D em qualquer olho — aí escalamos direto pro consultor sem tentar cotar.
  // Faixa 10 < |sph| <= 16 segue cotação normal e ganha flag de revisão humana via
  // requerRevisaoHumanaPosOrcamento (motivo `esferico_faixa_revisao`).
  if (!rx?.eyes) return false;
  const od = rx.eyes.od || {};
  const oe = rx.eyes.oe || {};
  const sphereMax = Math.max(Math.abs(Number(od.sphere) || 0), Math.abs(Number(oe.sphere) || 0));
  if (sphereMax > 16) return true;
  return false;
}

// Receita "complexa porém cotável": IA cota normal, mas sinaliza revisão humana.
// NÃO bloqueia o cliente — só liga uma flag interna pra equipe conferir.
function requerRevisaoHumanaPosOrcamento(rx: any): { precisa: boolean; motivos: string[] } {
  const motivos: string[] = [];
  if (!rx?.eyes) return { precisa: false, motivos };
  const od = rx.eyes.od || {};
  const oe = rx.eyes.oe || {};
  const sphereMax = Math.max(Math.abs(Number(od.sphere) || 0), Math.abs(Number(oe.sphere) || 0));
  const cylMax = Math.max(Math.abs(Number(od.cylinder) || 0), Math.abs(Number(oe.cylinder) || 0));
  const addMax = Math.max(Number(od.add) || 0, Number(oe.add) || 0);
  if (cylMax > 4) motivos.push(`cilindrico_alto:${cylMax}`);
  if (addMax > 3.5) motivos.push(`adicao_alta:${addMax}`);
  if (sphereMax > 8 && sphereMax <= 10) motivos.push(`esferico_faixa_cinza:${sphereMax}`);
  if (sphereMax > 10 && sphereMax <= 16) motivos.push(`esferico_faixa_revisao:${sphereMax}`);
  return { precisa: motivos.length > 0, motivos };
}

const MSG_REVISAO_HUMANA_SUFIXO = "\n\n💡 _Como sua receita tem um detalhe específico, vou pedir uma conferência rápida do nosso consultor pra confirmar prazo e disponibilidade. Pode ir escolhendo a opção que mais te agrada que já adianto 🙌_";

const MSG_ESCALADA_GRAU_FORA_FAIXA = "Obrigado por confirmar! 🙌 Por ser uma *lente especial*, vou te conectar com um Consultor pra montar o orçamento certinho e confirmar prazo 🤝";

// Após 2 tentativas falhas de confirmar a leitura da receita, IA admite a
// dificuldade e escala para Consultor humano em vez de continuar o ciclo.
const MSG_ESCALADA_RECEITA_LEITURA = "Desculpa, tô com dificuldade de bater os valores da sua receita certinho 😅 Vou te encaminhar pra um *Consultor humano* que vai conferir junto com você. Já avisei o time aqui 🙌";
// Fatia 2: impasse de receita → loja (medição presencial) em vez de humano.
const MSG_PONTE_RECEITA_LOJA = "Sem problema! O jeito mais rápido é passar na loja — a equipe mede sua receita na hora e já monta seu orçamento. Posso agendar sua visita? 😊";

// ── Bloqueia escalada/oferta de "grau alto / sob encomenda" sem receita interpretada ──
// Caso Franciana (Mai/2026): IA falou "Encontrei poucas opções automáticas para esse grau alto"
// e ofereceu Consultor antes mesmo da receita ter sido enviada.
function escaladaGrauSemReceitaTexto(texto: string): boolean {
  const t = String(texto || "").toLowerCase();
  if (!t) return false;
  return /(grau\s+(alto|elevado|bem\s+alto)|sob\s+encomenda|sob\s+medida\s+espec[ií]fic|op[cç][oõ]es?\s+sob\s+encomenda|fora\s+da\s+faixa)/i.test(t);
}
const MSG_PEDIR_RECEITA_PARA_GRAU_ALTO = "Pra te passar opções certinhas, preciso primeiro da sua receita 😊 Me manda uma foto que eu já analiso e te respondo com as opções compatíveis.";

function detectCtaAgendamentoYes(text: string): boolean {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  return /^(sim|quero|bora|vamos|pode|claro|gostaria|agendar|marcar|com certeza|por favor|pfv|👍|✅|positivo|topo)\b/.test(t)
    || /\b(quero agendar|pode agendar|pode marcar|quero marcar|vamos agendar)\b/.test(t);
}

function detectCtaAgendamentoNo(text: string): boolean {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  return /^(n[ãa]o|depois|agora n[ãa]o|deixa|vou pensar|talvez)\b/.test(t)
    || /\b(depois eu (te )?falo|outra hora|n[ãa]o quero agendar|n[ãa]o agora)\b/.test(t);
}

function detectLojaEscolhida(text: string, lojaNomes: string[]): string | null {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  // Tokens marcantes de cada loja
  const tokens: Record<string, RegExp[]> = {
    "DINIZ ANTONIO AGU": [/\bant[oô]nio\s+ag[uú]\b/, /\bantonio\s+agu\b/, /\bag[uú]\b/],
    "DINIZ PRIMITIVA I": [/\bprimitiva\s*(1|i|um|uma|primeira)\b/],
    "DINIZ PRIMITIVA II": [/\bprimitiva\s*(2|ii|dois|duas|segunda)\b/],
    "DINIZ STO ANTONIO": [/\bst[oa]\.?\s*ant[oô]nio\b/, /\bsanto\s+ant[oô]nio\b/],
    "DINIZ SUPER SHOPPING": [/\bsuper[\s-]*shopping\b/, /\bsupershopping\b/],
    "DINIZ UNIÃO": [/\buni[ãa]o\b/],
    "DINIZ CARAPICUIBA": [/\bcarapicu[ií]ba\b/],
    "DINIZ ITAPEVI": [/\bitapevi\b/],
    "DINIZ BARUERI": [/\bbarueri\b/, /\bvinte\s*e\s*seis\b/, /\b26\s*de\s*mar[cç]o\b/],
  };
  for (const nome of lojaNomes) {
    const pats = tokens[nome] || [];
    if (pats.some((re) => re.test(t))) return nome;
  }
  return null;
}

function fmtLojaLinha(loja: any): string {
  const nome = loja?.nome_loja || "";
  const end = (loja?.endereco || "").toString().trim();
  return end ? `🏬 *${nome}* — ${end}` : `🏬 *${nome}*`;
}

// Regex para detectar mensagens "estou analisando / recebi sua receita"
const MSG_ANALISANDO_RE = /recebi sua receita|peguei a imagem|t[oôó]\s*lendo|estou analisando|analisando aqui/i;

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

// ── PRE-LLM: Consulta de OS / status do pedido ──
// Detecta perguntas tipo "óculos pronto?", "posso retirar?", "número da OS", "cadê meu pedido"
// Lista padrão; a lista efetiva é carregada de configuracoes_ia.os_intent_keywords (case/accent-insensitive).
const OS_INTENT_DEFAULT_KEYWORDS: string[] = [
  "oculos pronto", "ficou pronto", "esta pronto", "ta pronto",
  "posso retirar", "ja chegou", "chegou meu", "quando fica pronto", "quando chega",
  "cade meu pedido", "cade meu oculos", "onde esta meu pedido",
  "status do pedido", "status da os",
  "minha os", "numero da os", "ordem de servico",
  "previsao de entrega", "pedido ficou pronto", "retirar meu oculos",
];
let _osKeywordsCache: string[] = OS_INTENT_DEFAULT_KEYWORDS;
let _osKeywordsExpire = 0;
async function loadOsKeywords(client: any): Promise<string[]> {
  if (Date.now() < _osKeywordsExpire) return _osKeywordsCache;
  try {
    const { data } = await client.from("configuracoes_ia").select("valor").eq("chave", "os_intent_keywords").maybeSingle();
    if (data?.valor) {
      const parsed = JSON.parse(data.valor);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        _osKeywordsCache = parsed.map((s) => norm(s)).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn("[os-keywords] load falhou, usando defaults", (e as Error)?.message);
  }
  _osKeywordsExpire = Date.now() + 60_000;
  return _osKeywordsCache;
}
// Regex "núcleo" do intent (sempre ativas, independem das keywords editáveis).
// Cobrem paráfrases comuns: "quanto tempo fica pronto", "ia/vou retirar",
// "fiz pedido online esperando", "tô aguardando meu pedido", "pedido atrasado".
// os regex bidirecional
const OS_INTENT_CORE_REGEX: RegExp[] = [
  // "OS 12345" / "OS #45123"
  /\bos\s*[#nº]?\s*\d{3,8}\b/i,
  // tempo/prazo + ficar pronto/demorar/chegar
  /\b(quanto|qual)\s+(o\s+)?(tempo|prazo)\b[\s\S]{0,40}\b(pronto|fica|demora|leva|chega|chegar|entrega|entregar)\b/i,
  // "(meu/minha) pedido/encomenda/compra/os" + status/retirar/aguardando/atrasado
  /\b(meu|minha|o|a)?\s*(pedido|encomenda|compra|os|[oó]culos|len(te|tes))\b[\s\S]{0,40}\b(pronto|chega|chegou|atras|aguardando|esperando|status|previs|retirar|retirada|ficou|fica)\b/i,
  // "ia/vou/queria/gostaria + retirar"
  /\b(ia|vou|queria|gostaria|pretendo|pra|para)\b[\s\S]{0,20}\bretir(ar|ada)\b/i,
  // "fiz/comprei/encomendei + pedido/compra/oculos/lente + online/loja/site/aguardando/esperando/urgência"
  /\b(fiz|comprei|encomendei|pedi)\b[\s\S]{0,40}\b(pedido|compra|[oó]culos|len(te|tes))\b[\s\S]{0,40}\b(online|loja|site|aguardando|esperando|urg[eê]ncia|h[aá] dias|atras)\b/i,
  // "esperando/aguardando + pedido/encomenda/óculos/chegada/entrega"
  /\b(esperando|aguardando|t[oôó]\s+esperando)\b[\s\S]{0,30}\b(pedido|encomenda|[oó]culos|len(te|tes)|chegada|entrega)\b/i,
  // "pedido (está) atrasado/demorando"
  /\b(pedido|encomenda|[oó]culos|compra)\b[\s\S]{0,20}\b(atras(ado|ada)?|demor(a|ando|ou)|n[aã]o chegou|ainda n[aã]o)\b/i,
  // "cad[eê] (meu) pedido/oculos/encomenda"
  /\bcad[eê]\b[\s\S]{0,20}\b(meu|minha|o|a)?\s*(pedido|encomenda|[oó]culos|compra|os)\b/i,
  // INVERSA da RE3 — "status/situação/andamento ... pedido/óculos" (ordem trocada,
  // formulações formais tipo "gostaria de saber o status de outro pedido").
  // Trigger inicial é palavra de CONSULTA (status, situação, andamento, previsão, novidade,
  // posição, atualização, retirada/retirar) — não casa "fazer/quero pedido" (orçamento).
  /\b(status|situa[cç][aã]o|andamento|previs[aã]o|novidade|posi[cç][aã]o|atualiza[cç][aã]o|retirada|retirar)\b[\s\S]{0,40}\b(meu|do|de|outro|outra|esse|este)?\s*(pedido|encomenda|compra|os|[oó]culos|len(te|tes))\b/i,
  // "como (está/anda/tá/fica) (meu/o/esse) pedido/encomenda/óculos" — paráfrase coloquial
  /\bcomo\s+(est[aá]|anda|t[aá]|fica|vai)\b[\s\S]{0,20}\b(meu|o|seu|esse|este)?\s*(pedido|encomenda|compra|os|[oó]culos|len(te|tes))\b/i,
];

function matchesConsultaOs(msg: string, keywords: string[]): boolean {
  if (!msg) return false;
  const n = norm(msg);
  // 1) Regex "núcleo" — paráfrases comuns
  for (const re of OS_INTENT_CORE_REGEX) {
    if (re.test(msg) || re.test(n)) return true;
  }
  // 2) Keywords editáveis pela auditoria (substring case/accent-insensitive)
  return keywords.some((k) => k && n.includes(k));
}

// ── OS: validação de CPF, extração de identificador, mascaramento, consulta bridge ──

function validarCPF(cpf: string): boolean {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === Number(d[10]);
}

function mascararCPF(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return "***";
  return `${d.slice(0, 3)}****${d.slice(7)}`;
}

function extrairIdentificadorOS(texto: string): { tipo: "os" | "cpf" | null; valor: string } {
  // CPF primeiro: 11 dígitos contíguos (com ou sem . - /) que passem na validação
  const cpfRe = /\b\d[\d.\-\/]{9,13}\d\b/g;
  let m: RegExpExecArray | null;
  while ((m = cpfRe.exec(texto)) !== null) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length === 11 && validarCPF(digits)) {
      return { tipo: "cpf", valor: digits };
    }
  }
  // OS: exatamente 5 dígitos isolados (não adjacentes a mais dígitos — evita falso match em CPF/telefone)
  const osRe = /(?<!\d)\d{5}(?!\d)/g;
  while ((m = osRe.exec(texto)) !== null) {
    return { tipo: "os", valor: m[0] };
  }
  return { tipo: null, valor: "" };
}

async function consultarStatusOS(
  supabaseUrl: string,
  serviceKey: string,
  ident: { tipo: "os" | "cpf"; valor: string },
): Promise<{ status: "ok" | "indisponivel"; encontrado?: boolean; resultados?: any[] }> {
  try {
    const body = ident.tipo === "os" ? { os: ident.valor } : { cpf: ident.valor };
    console.log("[os-status] consulta", {
      tipo: ident.tipo,
      valor: ident.tipo === "cpf" ? mascararCPF(ident.valor) : ident.valor,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9_000);
    const resp = await fetch(`${supabaseUrl}/functions/v1/os-status-public`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": Deno.env.get("INTERNAL_SERVICE_SECRET") ?? "",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn("[os-status] bridge retornou", resp.status);
      return { status: "indisponivel" };
    }
    const data = await resp.json();
    return { status: "ok", encontrado: data.encontrado, resultados: data.resultados };
  } catch (e) {
    console.warn("[os-status] erro:", (e as Error)?.message);
    return { status: "indisponivel" };
  }
}

async function responderStatusOS(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimento_id: string,
  contatoId: string,
  nomePrim: string,
  meta: Record<string, any>,
  resultado: any,
): Promise<Response> {
  const pub = (resultado.publico || {}) as Record<string, any>;
  const situacao = String(pub.situacao || "");

  // situacao "escala_humano": caso anômalo — escala sem revelar motivo, sem pedir identificador de novo
  if (situacao === "escala_humano") {
    const nomeComma = nomePrim ? `, ${nomePrim}` : "";
    const osMsgExp = renderMsgFixa("os_escala_verificacao", { nome_comma: nomeComma });
    const osMsg = isHorarioHumano()
      ? osMsgExp
      : `${osMsgExp}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
    await supabase.from("atendimentos").update({
      metadata: { ...meta, intent_consulta_os_at: new Date().toISOString() },
    }).eq("id", atendimento_id);
    await supabase.from("eventos_crm").insert({
      contato_id: contatoId,
      tipo: "consulta_os",
      descricao: "Consulta OS — situação anômala (escala_humano) — escalado para humano",
      metadata: { os: resultado.os, situacao },
      referencia_tipo: "atendimento",
      referencia_id: atendimento_id,
    });
    return await handleNonClientEscalation(supabase, supabaseUrl, serviceKey, atendimento_id, contatoId, osMsg, "consulta_os");
  }

  const SITUACAO_TO_TEMPLATE: Record<string, string> = {
    nao_iniciada:      "os_nao_iniciada",
    producao_lentes:   "os_producao_lentes",
    producao_montagem: "os_producao_montagem",
    pronto:            "os_pronto",
    entregue:          "os_entregue",
  };
  const tmplKey = SITUACAO_TO_TEMPLATE[situacao] || "os_producao_lentes";
  const produtoResumo = String(pub.produtoResumo || "").trim();
  const msg = renderMsgFixa(tmplKey, {
    nome_comma:    nomePrim ? `, ${nomePrim}` : "",
    os:            String(resultado.os || ""),
    produto_parte: produtoResumo ? ` (${produtoResumo})` : "",
    loja:          String(resultado.empresa || ""),
  });

  await sendWhatsApp(supabaseUrl, serviceKey, atendimento_id, msg);

  await supabase.from("atendimentos").update({
    metadata: { ...meta, intent_consulta_os_at: new Date().toISOString() },
  }).eq("id", atendimento_id);

  await supabase.from("eventos_crm").insert({
    contato_id: contatoId,
    tipo: "consulta_os_respondida",
    descricao: `Status OS respondido automaticamente (${situacao})`,
    metadata: { os: resultado.os, situacao },
    referencia_tipo: "atendimento",
    referencia_id: atendimento_id,
  });

  return jsonResponse({
    status: "ok",
    tools_used: ["os_status_auto"],
    intencao: "consulta_os",
    precisa_humano: false,
    modo: "ia",
  });
}

// ── OS Fatia 2a: lê CPF do contato, inicia coleta, trata resultado ──────────

async function getCpfContato(supabase: any, contatoId: string): Promise<string | null> {
  const { data } = await supabase
    .from("contatos")
    .select("documento")
    .eq("id", contatoId)
    .maybeSingle();
  const raw = String(data?.documento || "").replace(/\D/g, "");
  if (raw.length === 11 && validarCPF(raw)) return raw;
  return null;
}

async function iniciarColetaOS(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimento_id: string,
  contatoId: string,
  meta: Record<string, any>,
): Promise<void> {
  const cpf = await getCpfContato(supabase, contatoId);
  if (cpf) {
    await sendInteractive(supabaseUrl, serviceKey, atendimento_id, {
      type: "button",
      texto: "Quer acompanhar qual pedido? 😊",
      botoes: [
        { id: "os_meu_pedido",   titulo: "📦 Meu pedido" },
        { id: "os_outra_pessoa", titulo: "👤 De outra pessoa" },
      ],
    });
    await supabase.from("atendimentos").update({
      metadata: { ...meta, expected_reply: "os_aguardando_escolha", intent_consulta_os_at: new Date().toISOString() },
    }).eq("id", atendimento_id);
  } else {
    await sendWhatsApp(supabaseUrl, serviceKey, atendimento_id, "Pra localizar seu pedido, me passa o número da OS (do comprovante) ou seu CPF 😊");
    await supabase.from("atendimentos").update({
      metadata: { ...meta, expected_reply: "os_aguardando_identificador", intent_consulta_os_at: new Date().toISOString() },
    }).eq("id", atendimento_id);
  }
}

async function tratarResultadoConsultaOS(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atId: string,
  contatoId: string,
  nomePrim: string,
  meta: Record<string, any>,
  r: { status: "ok" | "indisponivel"; encontrado?: boolean; resultados?: any[] },
  ident: { tipo: "os" | "cpf"; valor: string } = { tipo: "os", valor: "" },
): Promise<"handled" | "fallback"> {
  // ── Indisponível ──────────────────────────────────────────────────────────
  if (r.status === "indisponivel") {
    const indispMsg = renderMsgFixa("os_erp_indisponivel", { nome_comma: nomePrim ? `, ${nomePrim}` : "" });
    await sendWhatsApp(supabaseUrl, serviceKey, atId, indispMsg);
    // Guarda identificador pra retry — se cliente disser "tenta de novo" depois,
    // re-consulta com este sem pedir o número novamente. Handler: os_retry_aguardando.
    const retryPayload = ident.valor
      ? { os_retry: { identificador: ident.valor, tipo: ident.tipo, asked_at: new Date().toISOString(), tries: 1 }, expected_reply: "os_retry_aguardando" }
      : {};
    await supabase.from("atendimentos").update({
      metadata: { ...meta, intent_consulta_os_at: new Date().toISOString(), os_tentativas: null, ...retryPayload },
    }).eq("id", atId);
    return "handled";
  }

  // ── Múltiplos resultados → lista interativa das 2 mais recentes ───────────
  if (r.encontrado && Array.isArray(r.resultados) && r.resultados.length > 1) {
    const toSortable = (s: string) => {
      const p = String(s || "").split("/");
      return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
    };
    const sorted = [...r.resultados].sort((a, b) =>
      toSortable(String((b.interno as any)?.dataEmissao || "")).localeCompare(
        toSortable(String((a.interno as any)?.dataEmissao || "")),
      ),
    );
    const top2 = sorted.slice(0, 2);
    const itens = top2.map((res: any) => {
      const emissao = String((res.interno as any)?.dataEmissao || "");
      const ddmm = emissao.length >= 5 ? emissao.slice(0, 5) : emissao;
      const prodResumo = String((res.publico as any)?.produtoResumo || "").trim();
      return {
        id:        `os_qual:${res.os}`,
        titulo:    `OS ${res.os}`,
        descricao: (prodResumo ? `${prodResumo} · ${ddmm}` : ddmm).slice(0, 72),
      };
    });
    await sendInteractive(supabaseUrl, serviceKey, atId, {
      type: "list",
      texto: "Encontrei mais de um pedido 😊 Qual você quer acompanhar?",
      lista: { label: "Ver pedidos", secao: "Seus pedidos", itens },
    });
    await supabase.from("atendimentos").update({
      metadata: {
        ...meta,
        expected_reply: "os_aguardando_qual",
        os_opcoes: top2.map((res: any) => String(res.os)),
        intent_consulta_os_at: new Date().toISOString(),
        os_tentativas: null,
      },
    }).eq("id", atId);
    return "handled";
  }

  // ── Resultado único ───────────────────────────────────────────────────────
  if (r.encontrado && Array.isArray(r.resultados) && r.resultados.length === 1) {
    const res = r.resultados[0] as any;
    // Fluxo de terceiro: pede confirmação de pertencimento antes de exibir
    if (meta.os_fluxo_terceiro) {
      const nomeCliente = String(res.cliente || "");
      const confirmTxt = nomeCliente
        ? `Encontrei um pedido em nome de *${nomeCliente}*. É esse mesmo? 😊`
        : "Encontrei um pedido. É esse mesmo? 😊";
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: confirmTxt,
        botoes: [
          { id: "os_pert_sim", titulo: "✅ Sim, é esse" },
          { id: "os_pert_nao", titulo: "❌ Não" },
        ],
      });
      await supabase.from("atendimentos").update({
        metadata: {
          ...meta,
          expected_reply: "os_aguardando_pertencimento",
          os_pert_resultado: String(res.os),
          os_fluxo_terceiro: null,
          os_tentativas: null,
        },
      }).eq("id", atId);
      return "handled";
    }
    // Fluxo normal (meu pedido / consulta direta): exibe direto
    await responderStatusOS(supabase, supabaseUrl, serviceKey, atId, contatoId, nomePrim, { ...meta, os_tentativas: null }, res);
    return "handled";
  }

  // ── Não encontrado → escada de recuperação ────────────────────────────────
  const tentativas = Number(meta.os_tentativas ?? 0);
  if (tentativas === 0) {
    const msg = ident.tipo === "cpf"
      ? "Não localizei nenhum pedido nesse CPF 🤔 Você tem o número da OS aí? Pelo comprovante a busca é mais certeira 😊"
      : "Não localizei essa OS 🤔 Me confirma o número (5 dígitos do comprovante)? Ou, se preferir, me passa seu CPF 😊";
    await sendWhatsApp(supabaseUrl, serviceKey, atId, msg);
    await supabase.from("atendimentos").update({
      metadata: { ...meta, os_tentativas: 1, expected_reply: "os_aguardando_identificador", intent_consulta_os_at: new Date().toISOString() },
    }).eq("id", atId);
    return "handled";
  }
  if (tentativas === 1) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Ainda não localizei. Me tira uma dúvida: a compra foi feita há pelo menos um dia? Pedidos do mesmo dia entram no sistema a partir do dia seguinte 😊");
    await supabase.from("atendimentos").update({
      metadata: { ...meta, os_tentativas: 2, expected_reply: "os_aguardando_identificador", intent_consulta_os_at: new Date().toISOString() },
    }).eq("id", atId);
    return "handled";
  }
  // tentativas >= 2: esgotou → limpa estado e retorna fallback para o caller escalar
  await supabase.from("atendimentos").update({
    metadata: { ...meta, os_tentativas: null, expected_reply: null, os_fluxo_terceiro: null },
  }).eq("id", atId);
  return "fallback";
}

// ── PRE-LLM: Formas de pagamento ──
// Detecta perguntas tipo "qual a forma de pagamento", "aceita cartão", "parcela em quantas", "somente à vista".
// Responde determinístico (ia_mensagens_fixas.formas_pagamento) sem escalar.
const PAGAMENTO_INTENT_DEFAULT_KEYWORDS: string[] = [
  "forma de pagamento", "formas de pagamento",
  "como pago", "como posso pagar", "como funciona o pagamento",
  "aceita cartao", "aceitam cartao",
  "parcela", "parcelar", "parcelado", "parcelamento",
  "a vista", "somente a vista", "so a vista", "apenas a vista",
  "tem desconto", "desconto a vista",
  "pix", "boleto", "crediario", "credito", "debito",
  "quantas vezes", "em quantas",
];
let _pagamentoKeywordsCache: string[] = PAGAMENTO_INTENT_DEFAULT_KEYWORDS;
let _pagamentoKeywordsExpire = 0;
async function loadPagamentoKeywords(client: any): Promise<string[]> {
  if (Date.now() < _pagamentoKeywordsExpire) return _pagamentoKeywordsCache;
  try {
    const { data } = await client.from("configuracoes_ia").select("valor").eq("chave", "pagamento_intent_keywords").maybeSingle();
    if (data?.valor) {
      const parsed = JSON.parse(data.valor);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        _pagamentoKeywordsCache = parsed.map((s) => norm(s)).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn("[pagamento-keywords] load falhou, usando defaults", (e as Error)?.message);
  }
  _pagamentoKeywordsExpire = Date.now() + 60_000;
  return _pagamentoKeywordsCache;
}
// Regex "núcleo" — paráfrases comuns que não dependem das keywords editáveis.
const PAGAMENTO_INTENT_CORE_REGEX: RegExp[] = [
  /\bcomo\s+(eu\s+)?(posso|pode|faço|fazer|fica)\b[\s\S]{0,20}\b(pag(ar|amento)|paga)\b/i,
  /\bqual(is)?\s+(a|as|sao|são)?\s*(forma|formas|meio|meios|op[cç][aã]o|op[cç][oõ]es)\s*(de)?\s*pag(ar|amento)/i,
  /\b(aceita|aceitam|tem)\b[\s\S]{0,15}\b(cart[aã]o|pix|boleto|crediar|credit|d[eé]bito)\b/i,
  /\b(pode|d[aá]|tem|consigo|posso)\b[\s\S]{0,15}\bparcelar\b/i,
  /\bsomente?\s+(a|à)\s+vista\b/i,
  /\bso\s+(a|à)\s+vista\b/i,
  /\bapenas\s+(a|à)\s+vista\b/i,
  /\bem\s+quantas\s+vezes\b/i,
];
function matchesPagamentoIntent(msg: string, keywords: string[]): boolean {
  if (!msg) return false;
  const n = norm(msg);
  for (const re of PAGAMENTO_INTENT_CORE_REGEX) {
    if (re.test(msg) || re.test(n)) return true;
  }
  return keywords.some((k) => k && n.includes(k));
}

function norm(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Reconhece "cashback / cashdiniz" e variantes tolerantes (pr\u00e9-LLM)
function matchesCashdiniz(texto: string): boolean {
  return /\bca[xs]h?\s?(back|dini[sz])\b/.test(norm(texto));
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

// Entrega PDF ao LLM via content type "file" (GPT-5 vision aceita application/pdf).
// Diferente de imageContentFromBase64: sem verificação de assinatura (PDF não tem magic bytes
// de imagem) e formato de content diferente.
function pdfContentFromBase64(base64String: string, filename = "receita.pdf"): any | null {
  const cleaned = cleanBase64(base64String);
  if (!cleaned) return null;
  return {
    type: "file",
    file: { filename, file_data: `data:application/pdf;base64,${cleaned}` },
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
        : "Cliente quer ORÇAMENTO mas não há receita salva. Se ele já declarou TIPO de lente (multifocal/progressiva/visão simples) E pelo menos o esférico, use IMEDIATAMENTE consultar_lentes_estimativa pra dar uma faixa de preços; só depois peça o que falta (ADD/CIL/AX). Se não declarou tipo nem esférico, peça foto da receita uma única vez.",
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

// ── Loop detector: scans last 5 outbound for >70% similarity between any 2 ──
// Janela ampliada de 3→5 na Onda 1 Fase 1a (mai/2026): casos com inbound
// intermediário entre duas outbounds idênticas escapavam da janela de 3.
// Threshold permanece 0.7 — reavaliação em Fase 1b após dados empíricos.
function detectLoop(recentOutbound: string[]): { detected: boolean; similarity: number } {
  const last5 = recentOutbound.slice(-5).map(norm).filter((s) => s.length > 0);
  if (last5.length < 2) return { detected: false, similarity: 0 };
  let maxSim = 0;
  for (let i = 0; i < last5.length; i++) {
    for (let j = i + 1; j < last5.length; j++) {
      const sim = computeSimilarity(last5[i], last5[j]);
      if (sim > maxSim) maxSim = sim;
    }
  }
  return { detected: maxSim > 0.7, similarity: maxSim };
}

// ── Forced intent → tool mapping ──
// When the customer responds with clear keywords to a previous AI question,
// forces the corresponding tool execution to break out of repetitive prompts.
//
// LC com receita: cliente que escolheu marca/pediu reservar quer fechar — agora
// segue o fluxo padrão `agendar_cliente_intent` (vai à loja retirar/pagar).
// Humano só entra se houver objeção real (sem catálogo compatível, reclamação,
// pedido explícito de humano).

const LC_BRAND_REGEX = /\b(acuvue|oasys|biofinity|air\s*optix|solflex|sol[oó]tica|dnz|biomedics|focus|frequency|freshlook|proclear|purevision|softlens|hydron|mioflex|aviator|naturale|colors?)\b/i;
const RESERVE_VERBS_REGEX = /\b(quero\s+(reservar|fechar|pedir|levar|essa|esse|comprar|fechar|essa op[cç][aã]o)|vou\s+(querer|levar|de|com)|fica\s+(com|essa|esse)|pode\s+(reservar|pedir|fechar|mandar)|fechar\s+(pedido|essa|esse|com)|fechar\b|reserva[r]?\b|comprar\s+essa)/i;
// Detecta intenção de compra/orçamento de óculos sem acionar consultas de localização.
// (?<!onde\s) no Branch A é obrigatório: protege "onde fazer oculos" de virar orçamento
// (loja_local gate NÃO cobre "onde fazer", só "onde fica/tem/queda").
// Aplica sobre t = norm() (lowercase, sem acento).
const OCULOS_COMPRA_RE = /(?<!onde\s)\b(fazer|comprar|trocar|renovar)\b.{0,30}\boculos\b|\bquero\s+(?:um\s+)?oculos\b|\b(fazer|comprar|trocar|renovar)\s+(?:\w+\s+){0,2}lentes?\b/;

// Detecta intenção clara diferente de "escolher cidade" — usada como escape hatch
// nos dois sistemas paralelos de seleção de cidade (S1: routeExpectedTypedReply;
// S2: bloco pos_orcamento). Recebe tNorm = _normTxt(mensagem).
function _isProdutoDuvida(tNorm: string): boolean {
  // Detecta perguntas de produto/dúvida que NÃO são pedidos de ação (cotar/agendar).
  // Usado por _isEscapeIntent (escape de pos_orcamento) e isDuvidaPosOrcamento (modo consultivo).
  // Padrões ambíguos ("especial", "tecnologia") só contam com âncora de produto.
  return (
    // Fortes — standalone, sem falso positivo
    /\b(por\s*qu[eê]|qual\s+a?\s+diferen[cç]a|vale\s+a\s+pena|como\s+funciona|vantage[mn][s]?|detalh[ae]r?|melhor\s+pra|ideal\s+pra|explica|o\s+que\s+[eé])\b/.test(tNorm)
    // "o que [contexto] tem" — lookahead 50 chars cobre "o que essa Varilux XR tem de especial"
    || /\bo\s+que\b.{0,50}\btem\b/.test(tNorm)
    // "especial" só com âncora de produto — não bate em "situação especial", "receita especial"
    || /\b(tem\s+de\s+especial|que\s+tem\s+de\s+especial)\b/.test(tNorm)
    || /\bo\s+que\b.{0,50}\bespecial\b/.test(tNorm)
    || /\bespecial\s+(nessa|nesse|dessa|desse|desta|deste|nela|nele)\b/.test(tNorm)
    // "tecnologia" só com âncora de consulta — não bate em "tecnologia de ponta" genérico
    || /\b(qual\s+a?\s+tecnologia|que\s+tecnologia|tecnologia\s+(dessa|desta|da|do|de)\s+lente[s]?)\b/.test(tNorm)
    // "características" só com âncora de produto
    || /\b(quais?\s+(s[aã]o\s+as?\s+)?caracteristica[s]?|caracteristica[s]?\s+(dess[ao]|nessa|nesse|da\s+lente|do\s+produto))\b/.test(tNorm)
    // Marca + "?" = pergunta sobre produto ("Tem varilux?", "e o zeiss?")
    || (/\b(varilux|essilor|eyezen|crizal|stellest|zeiss|hoya|kodak|dnz|dmax|transitions|antirreflexo|filtro\s+azul|fotossensivel|luz\s+azul)\b/.test(tNorm) && /\?/.test(tNorm))
  );
}

function _isEscapeIntent(tNorm: string): boolean {
  return OCULOS_COMPRA_RE.test(tNorm)
    || /\b(or[cç]ament[oa]|or[cç]ar|pre[cç]o|valor|custa|cotac[aã]o|quanto\s+(custa|fica|sai))\b/.test(tNorm)
    || /\blente[s]?\s+de\s+contato\b/.test(tNorm)
    || _isProdutoDuvida(tNorm);
}

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

// ── Detecta CEP e/ou regiões da Grande SP fora da nossa cobertura ──
// Cobertura: Osasco, Carapicuíba, Barueri, Cotia, Itapevi, Jandira, Santana de Parnaíba, Alphaville.
// Fora disso (Zona Sul/Norte/Leste/Oeste de SP, ABC, capital, etc.) é "fora de área".
function detectClienteLocation(textoAcumulado: string): {
  cep: string | null;
  regiaoTexto: string | null;
  foraDeArea: boolean;
  dentroDeArea: boolean;
} {
  const t = String(textoAcumulado || "").toLowerCase();

  const cepMatch = t.match(/\b(\d{5})-?(\d{3})\b/);
  const cep = cepMatch ? `${cepMatch[1]}-${cepMatch[2]}` : null;

  const foraRegex = /\b(zona\s*(sul|norte|leste|oeste)|s[aã]o\s*paulo\b(?!\s*-\s*osasco)|sp\s*capital|capital paulista|abc\s*paulista|santo\s*andr[eé]|s[aã]o\s*bernardo|s[aã]o\s*caetano|diadema|guarulhos|mau[aá]|tabo[aã]o\s*da\s*serra|embu)\b/i;
  const regiaoForaMatch = t.match(foraRegex);

  const dentroRegex = /\b(osasco|carapicu[ií]ba|barueri|cotia|itapevi|jandira|santana\s+de\s+parna[ií]ba|alphaville)\b/i;
  const regiaoDentroMatch = t.match(dentroRegex);

  // Heurística por CEP: Osasco/região = 06000–06999; capital SP = 01000–05999 e 08000–08999; ABC = 09000–09999.
  let foraPorCep = false;
  let dentroPorCep = false;
  if (cepMatch) {
    const prefix = parseInt(cepMatch[1], 10);
    if (prefix >= 6000 && prefix <= 6999) dentroPorCep = true;
    else if ((prefix >= 1000 && prefix <= 5999) || (prefix >= 8000 && prefix <= 9999)) foraPorCep = true;
  }

  const foraDeArea = (!!regiaoForaMatch || foraPorCep) && !regiaoDentroMatch && !dentroPorCep;
  const dentroDeArea = !!regiaoDentroMatch || dentroPorCep;
  const regiaoTexto = regiaoForaMatch?.[0] || regiaoDentroMatch?.[0] || null;
  return { cep, regiaoTexto, foraDeArea, dentroDeArea };
}

function detectForcedToolIntent(
  lastInboundText: string,
  hasReceitas: boolean,
  hasUnparsedImage: boolean,
  isLCContext = false,
  hasLCQuotePresented = false,
  lastOutboundText = "",
  recentInboundText = "",
): { tool: string; reason: string } | null {
  const t = norm(lastInboundText);
  if (!t) return null;

  // ── REGIÃO PÓS-RECEITA: cliente respondeu região logo após IA prometer orçamento ──
  // Caso Paulo Henrique 2026-04-27: IA leu receita + perguntou região; cliente disse
  // "Osasco centro" → IA escalou para humano em vez de chamar consultar_lentes.
  // Se a última saída da IA pediu região/bairro E há receita válida E o inbound atual
  // contém um indicador de região (cidade, bairro, CEP), forçamos consultar_lentes.
  if (hasReceitas && !isLCContext && lastOutboundText) {
    const askedRegion = /\b(regi[aã]o|bairro|cidade|cep|onde voc[eê] (est[aá]|mora|fica)|qual\s+(bairro|cidade|regi[aã]o))\b/i.test(lastOutboundText);
    const looksLikeRegionAnswer =
      /\b\d{5}-?\d{3}\b/.test(lastInboundText) ||
      /\b(osasco|carapicu[ií]ba|barueri|cotia|itapevi|jandira|santana de parna[ií]ba|alphaville|s[aã]o paulo|sp\b|capital|zona\s+(sul|norte|leste|oeste)|centro|jardim|vila|parque|jd\.?\s|vl\.?\s|pq\.?\s)/i.test(lastInboundText) ||
      // resposta curta tipo "Osasco centro", "Centro", "Vila Yara" — 1 a 4 palavras sem verbos
      (lastInboundText.trim().split(/\s+/).length <= 4 &&
       !/[?!]/.test(lastInboundText) &&
       /^[A-Za-zÀ-ÿ\s]+$/.test(lastInboundText.trim()) &&
       !/\b(sim|n[aã]o|ok|claro|tudo|bom|boa|oi|ol[aá]|obrigado?|valeu)\b/i.test(t));
    if (askedRegion && looksLikeRegionAnswer) {
      return { tool: "consultar_lentes", reason: "cliente respondeu região após IA prometer orçamento" };
    }
  }

  // ── PRIORIDADE MÁXIMA: cliente quer ir à loja ──
  // Frases como "me encaminhe pra loja", "manda pra loja X", "quero ir na loja",
  // "loja mais próxima", "vou aí", "passo aí" SEMPRE viram agendar_cliente_intent,
  // mesmo em contexto LC com receita. Objetivo do assistente é levar pessoas às lojas.
  // Esse bloco precede o tratamento LC para garantir prioridade do agendamento.
  const STORE_VISIT_REGEX = /\b(encaminh[ae]r?|encaminha|me\s+manda|me\s+encaminha|pra\s+loja|para\s+a?\s*loja|na\s+loja|[aà]\s+loja|loja\s+mais\s+pr[oó]xima|unidade\s+mais\s+pr[oó]xima|qual\s+(a\s+)?loja|qual\s+endere[cç]o|onde\s+fica|vou\s+a[ií]|passo\s+a[ií]|posso\s+ir|quero\s+ir|ir\s+(at[eé]\s+)?(a\s+|na\s+|n?[ao]\s+)?loja)\b/i;
  if (STORE_VISIT_REGEX.test(lastInboundText)) {
    return { tool: "agendar_cliente_intent", reason: "cliente quer ir à loja — prioriza agendamento sobre fechamento LC" };
  }

  // ── LC com receita: cliente escolheu marca / pediu reservar ──
  // Política nova: temos catálogo de LC no banco e a IA monta orçamento sozinha.
  // Cliente que escolheu marca ou pediu reservar quer FECHAR — direcionamos para
  // agendamento na loja (retirar/pagar) como qualquer outro pedido. Humano só entra
  // se houver objeção real (sem produto compatível, reclamação, etc.).
  if (hasReceitas && isLCContext) {
    const hasBrand = LC_BRAND_REGEX.test(lastInboundText);
    const hasReserveVerb = RESERVE_VERBS_REGEX.test(lastInboundText);
    if (hasBrand && hasReserveVerb) {
      return { tool: "agendar_cliente_intent", reason: "cliente escolheu marca + pediu reservar (LC) — agendar na loja" };
    }
    if (hasLCQuotePresented && (hasBrand || hasReserveVerb)) {
      return { tool: "agendar_cliente_intent", reason: hasBrand ? "cliente escolheu marca após orçamento LC — agendar na loja" : "cliente pediu reservar após orçamento LC — agendar na loja" };
    }
  }

  // ── REFINAMENTO POR TRATAMENTO/MARCA APÓS RECEITA (ÓCULOS) ──
  // Cliente já tem receita salva e pergunta sobre tratamento/marca específico
  // ("teria transitions?", "tem varilux?", "trabalham com zeiss?", "tem antirreflexo?").
  // É pedido implícito de cotação — força consultar_lentes com filtro adequado.
  // O token vai no `reason` para o hint downstream montar os parâmetros corretos.
  if (hasReceitas && !isLCContext) {
    const TREAT_BRAND_RE = /\b(transitions?|fotossens[ií]ve[il]|fotocrom[áa]?tic[ao]?|antirreflex(?:o|ivo)?|antiriscos?|filtro\s+azul|luz\s+azul|polariz[ao]?d[ao]?|varilux|essilor|eyezen|crizal|stellest|zeiss|hoya|kodak|dnz|dmax)\b/i;
    const ASK_RE = /\?|\b(tem|teria|trabalh(am|a)|consegue|consegu[ei]m|voc[eê]s?\s+t[eê]m|t[eê]m\s+op(?:ç|c)[aã]o|disp[oõ]e[m]?|disponibilidade|trabalham?\s+com|fazem|fa[zç]em)\b/i;
    // Considera última inbound + janela das últimas 3 inbounds — cobre casos
    // tipo "Eu queria transitions" + "?" enviados separados.
    const blob = `${lastInboundText} ${recentInboundText || ""}`;
    const m = blob.match(TREAT_BRAND_RE);
    if (m && ASK_RE.test(blob)) {
      const raw = m[1].toLowerCase();
      let token = "marca";
      if (/transition|fotossens|fotocrom/.test(raw)) token = "photo";
      else if (/blue|azul|antirreflex|antirisco/.test(raw)) token = "blue";
      else if (/polariz/.test(raw)) token = "polar";
      else if (/varilux|essilor|eyezen|crizal|stellest/.test(raw)) token = "essilor";
      else if (/zeiss/.test(raw)) token = "zeiss";
      else if (/hoya/.test(raw)) token = "hoya";
      else if (/kodak/.test(raw)) token = "kodak";
      else if (/dnz/.test(raw)) token = "dnz";
      else if (/dmax/.test(raw)) token = "dmax";
      return { tool: "consultar_lentes", reason: `brand_refinement:${token}:${raw}` };
    }
  }

  // Quote / pricing keywords (aceita variações: quanto/quantos/qto/qnto, custa/sai/fica)
  // OCULOS_COMPRA_RE cobre frases de intenção de compra sem palavra de preço explícita.
  if (/\b(or[cç]amento|or[cç]a|pre[cç]o|valor|quantos?|qto|qnto|custa|sai\s+por|fica\s+por|tabela|lentes? compat[ií]veis|op[cç][oõ]es? de lente|cota[cç][aã]o)\b/.test(t) || OCULOS_COMPRA_RE.test(t)) {
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

  // Scheduling keywords — funciona igual para óculos e LC.
  // (LC agora vai à loja para retirar/pagar como qualquer outro pedido.)
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
  if (!text || text.length < 4) return null;
  // Normaliza espaço entre sinal e número: "- 425" → "-425", "+ 200" → "+200"
  let t = text.toLowerCase().replace(/([+\-])\s+(\d)/g, "$1$2");
  // Remove asteriscos de markdown ("*OD*", "*CIL")
  t = t.replace(/\*/g, " ");
  // Normaliza formas longas/variantes pt-BR para tokens curtos "od"/"oe"
  // (cliente costuma responder "Olho direito/esquerdo" porque o próprio prompt
  // da IA traz "OD (olho direito)").
  t = t.replace(/\bolho\s+direito\b/g, "od");
  t = t.replace(/\bolho\s+esquerdo\b/g, "oe");
  t = t.replace(/\bolho\s+dir(?:eito)?\.?\b/g, "od");
  t = t.replace(/\bolho\s+esq(?:uerdo)?\.?\b/g, "oe");
  t = t.replace(/\bo\.d\.?\b/g, "od");
  t = t.replace(/\bo\.e\.?\b/g, "oe");
  // Convenções ópticas: pl/plano/neutro/zerado/sc → 0.00
  t = t.replace(/-\s*(pl|plano|neutro|zerado|zero)\b/g, "0");
  t = t.replace(/\b(pl|plano|neutro|zerado)\b/g, "0");
  t = t.replace(/\bsc\b/g, "");

  // Strong signals: must contain at least 2 of these markers
  const markers = [
    /\bod\b/, /\boe\b/, /\bos\b/,
    /\blonge\b/, /\bperto\b/,
    /\besf[eé]rico\b|\besf\b/,
    /\bcil[ií]ndrico\b|\bcil\b|\bcyl\b/,
    /\beixo\b|\baxis\b/,
    /\badi[cç][aã]o\b|\badd?\b/,
  ];
  const numericPairs = (t.match(/[+-]?\d+[.,]?\d*/g) || []).length;
  const markerHits = markers.filter((r) => r.test(t)).length;
  const hasOdOe = /\bod\b/.test(t) && /\boe\b/.test(t);
  if (!(markerHits >= 2 && numericPairs >= 1) && !(hasOdOe && numericPairs >= 1)) return null;

  // Helper: parse a number como dioptria.
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

  const buildEye = () => ({ sphere: null as number | null, cylinder: null as number | null, axis: null as number | null, add: null as number | null });
  const od = buildEye();
  const oe = buildEye();

  // ── Extração por BLOCO de olho ──
  // Divide o texto em segmentos começando em "od"/"oe"/"os" e indo até o próximo marcador de olho.
  const eyeBlockRe = /\b(od|oe|os)\b([\s\S]*?)(?=\b(?:od|oe|os)\b|$)/gi;
  let bm: RegExpExecArray | null;
  const extractFromBlock = (raw: string, eye: any) => {
    let block = raw;
    // Axis: "eixo 180" / "axis 180" — captura primeiro e remove
    const axisM = block.match(/(?:eixo|axis)\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*°?/i);
    if (axisM) {
      eye.axis = eye.axis ?? parseAxis(axisM[1]);
      block = block.replace(axisM[0], " ");
    }
    // Add: "add +2,00" / "adição 2"
    const addM = block.match(/(?:add?|adi[cç][aã]o)\s*([+-]?\d+[.,]?\d*)/i);
    if (addM) {
      eye.add = eye.add ?? parseDiopter(addM[1]);
      block = block.replace(addM[0], " ");
    }
    // Restante: pega TODOS os números na ordem (esfera, cilindro, eixo posicional)
    const nums = block.match(/[+-]?\d+[.,]?\d*/g) || [];
    if (nums.length >= 1 && eye.sphere == null) eye.sphere = parseDiopter(nums[0]);
    if (nums.length >= 2 && eye.cylinder == null) eye.cylinder = parseDiopter(nums[1]);
    // 3º número posicional sem keyword = eixo (inteiro 1..180, sem sinal explícito de diopter)
    if (nums.length >= 3 && eye.axis == null) {
      const tok = nums[2];
      const isIntLike = /^-?\d{1,3}$/.test(tok);
      const n = parseInt(tok, 10);
      if (isIntLike && n >= 1 && n <= 180) eye.axis = n;
    }
  };
  while ((bm = eyeBlockRe.exec(t)) !== null) {
    const eye = bm[1].toLowerCase() === "od" ? od : oe;
    extractFromBlock(bm[2], eye);
  }

  // "Adição +2,00" solto (sem OD/OE) → aplica em ambos os olhos
  if (od.add == null && oe.add == null) {
    const addLoose = t.match(/(?:add?|adi[cç][aã]o)\s*([+-]?\d+[.,]?\d*)/i);
    if (addLoose) {
      const a = parseDiopter(addLoose[1]);
      if (a != null) { od.add = a; oe.add = a; }
    }
  }

  // Fallback: blocos longe/perto (cliente separa por distância sem od/oe)
  if (od.sphere == null && oe.sphere == null) {
    const longeMatch = t.match(/longe[^a-z]*([\s\S]*?)(?=perto|$)/i);
    const pertoMatch = t.match(/perto[^a-z]*([\s\S]*?)$/i);
    if (longeMatch) extractFromBlock(longeMatch[1], od);
    if (pertoMatch) extractFromBlock(pertoMatch[1], oe.sphere == null ? oe : od);
  }

  // ── Validação anti-hallucination: todo número persistido tem que existir no texto-fonte ──
  // Constrói "haystack" de números absolutos vistos no texto original normalizado.
  const sourceNumbers = new Set<string>();
  // Aplica as MESMAS normalizações de keyword óptica → 0 que o parser usa em `t`,
  // pra não descartar sphere=0 legítimo vindo de "Plano/pl/neutro/zerado/zero".
  const rawNorm = text.toLowerCase()
    .replace(/([+\-])\s+(\d)/g, "$1$2")
    .replace(/\*/g, " ")
    .replace(/-\s*(pl|plano|neutro|zerado|zero)\b/g, "0")
    .replace(/\b(pl|plano|neutro|zerado|zero)\b/g, "0")
    .replace(/\bsc\b/g, "");
  for (const tok of (rawNorm.match(/[+-]?\d+[.,]?\d*/g) || [])) {
    const parsed = parseDiopter(tok);
    if (parsed != null) sourceNumbers.add(Math.abs(parsed).toFixed(2));
    const axisN = parseAxis(tok);
    if (axisN != null) sourceNumbers.add(axisN.toFixed(0));
  }
  const validateField = (eye: any, field: "sphere" | "cylinder" | "axis" | "add") => {
    const v = eye[field];
    if (v == null) return;
    const key = field === "axis" ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2);
    if (!sourceNumbers.has(key)) {
      console.log(`[RX-VALIDATE] descartando ${field}=${v} (não encontrado no texto-fonte)`);
      eye[field] = null;
    }
  };
  for (const eye of [od, oe]) {
    validateField(eye, "sphere");
    validateField(eye, "cylinder");
    validateField(eye, "axis");
    validateField(eye, "add");
  }

  if (od.sphere == null && oe.sphere == null) return null;

  const has_addition = (od.add != null && od.add !== 0) || (oe.add != null && oe.add !== 0) || /\bperto\b|\badi[cç][aã]o\b|\badd?\b/.test(t);
  const rx_type: "single_vision" | "progressive" = has_addition ? "progressive" : "single_vision";

  return { od, oe, has_addition, rx_type, raw: text.slice(0, 400) };
}

/**
 * Classificador de intenção LLM-based (chamada leve ao gateway).
 * Recebe a última mensagem do cliente + últimas 3 do histórico e devolve
 * { intent, confidence, subtype }. Categorias fechadas. Em caso de erro
 * ou confidence < 0.7, o caller deve usar deterministicIntentFallback().
 */
async function classifyIntent(
  lastMessage: string,
  recentHistory: string[],
): Promise<{ intent: string; confidence: number; subtype: string | null }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { intent: "outro", confidence: 0, subtype: null };
  }

  const systemPrompt =
    "Classifique a intenção desta mensagem em uma das categorias abaixo e retorne SOMENTE um JSON válido com os campos intent, confidence (0 a 1) e subtype. Categorias: orcamento, orcamento_lc, agendamento, status_pedido, reclamacao, duvida_produto, localizacao, pos_venda, saudacao, outro.";

  const histStr = (recentHistory || [])
    .slice(-3)
    .map((m, i) => `(${i + 1}) ${String(m || "").slice(0, 300)}`)
    .join("\n");

  const userContent =
    `HISTÓRICO RECENTE:\n${histStr || "(vazio)"}\n\nÚLTIMA MENSAGEM DO CLIENTE:\n${String(lastMessage || "").slice(0, 500)}`;

  try {
    const t0 = Date.now();
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 120,
      }),
    });
    console.log(`[CLASSIFY-INTENT] gateway=${Date.now() - t0}ms status=${resp.status}`);

    if (!resp.ok) {
      return { intent: "outro", confidence: 0, subtype: null };
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const intent = typeof parsed.intent === "string" ? parsed.intent : "outro";
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    const subtype = parsed.subtype != null ? String(parsed.subtype) : null;
    return { intent, confidence, subtype };
  } catch (err) {
    console.warn("[CLASSIFY-INTENT] erro:", err instanceof Error ? err.message : err);
    return { intent: "outro", confidence: 0, subtype: null };
  }
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
    // Se já mandamos "estou analisando" antes e ainda não há receita válida,
    // troca por pedido de digitação dos valores em vez de repetir "analisando" (que vira loop).
    const jaMandouAnalisando = (recentOutbound || []).some((m) => MSG_ANALISANDO_RE.test(m || ""));
    if (jaMandouAnalisando) {
      return {
        resposta: MSG_PEDIR_RECEITA_TEXTO,
        intencao: "receita_oftalmologica",
        pipeline_coluna: "Orçamento",
        precisa_humano: false,
      };
    }
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
    // Pool esgotado sem receita válida → pede texto
    return {
      resposta: MSG_PEDIR_RECEITA_TEXTO,
      intencao: "receita_oftalmologica",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  // Cliente afirma que ENVIOU a receita (sem imagem detectada agora — pode ter chegado em msg anterior)
  if (/enviei (minha |a )?receita|te mandei (a |minha )?receita|recebeu (minha |a )?receita|mandei a foto|segue (minha |a )?receita|acabei de mandar/.test(n)) {
    return {
      resposta: "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções compatíveis em seguida, um instante…",
      intencao: "receita_oftalmologica",
      pipeline_coluna: "Orçamento",
      precisa_humano: false,
    };
  }

  // Cliente diz que NÃO tem receita / perdeu / precisa refazer exame → indicar clínica parceira
  if (/perdi (a |minha )?receita|sem receita|n[aã]o tenho (a |minha )?receita|refazer (o )?exame|fazer (o )?exame|preciso de (uma |a )?receita|preciso fazer (o )?exame|exame de vista/.test(n)) {
    return {
      resposta: "Sem problema! Posso te indicar uma clínica parceira aqui perto pra refazer o exame — costuma virar desconto na sua compra. Me passa o bairro ou região que você está pra eu te orientar 😊",
      intencao: "indicacao_clinica",
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

  // Distingue PRAZO DE CONFECÇÃO (compra nova) de STATUS DE PEDIDO existente.
  // Confecção: "prazo de entrega/confecção/fabricação", "quanto tempo demora/leva", "quando fica pronto"
  //   SEM menção a "minha OS / meu pedido / já comprei / fiz o pedido".
  const isPrazoConfeccao = /\b(prazo|quanto tempo|quanto demora|quanto leva|em quantos dias|quando fica pronto|tempo de (entrega|confec[cç][aã]o|fabrica[cç][aã]o|produ[cç][aã]o))\b/.test(n)
    && !/\b(minha os|meu pedido|j[aá] comprei|fiz o pedido|comprei (no |dia )|t[aá] pronto|j[aá] chegou|status do (meu )?pedido)\b/.test(n);
  if (isPrazoConfeccao) {
    return {
      resposta: "O prazo de confecção das lentes depende da fabricante e do tipo de tratamento — normalmente entre **7 e 15 dias úteis** após a confirmação do pagamento. Tóricas e lentes especiais podem levar um pouco mais. Quer que eu te direcione pra loja mais próxima pra fechar?",
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

  // For híbrido or generic cases, use rotating pool to avoid repetition.
  // ⚠️ Suprime o pool genérico quando a última outbound já é uma resposta substantiva
  // (orçamento, opções, escalação confirmada) — evita "amnésia" logo após o orçamento.
  const lastOutboundRaw = String((recentOutbound || []).slice(-1)[0] || "");
  const substantiveOutboundRecent = /(🔍\s*\*Opções|Econômica:|Intermediária:|Premium:|💚|💛|💎|prazo de confec|7 e 15 dias|Acionei um Consultor|Consultor.*entra em contato|opções de lentes)/i.test(lastOutboundRaw);

  const genericPool = [
    "Pode me explicar melhor o que precisa? Quero te dar um retorno certeiro!",
    "Me diz com mais detalhes o que tá buscando que eu resolvo pra você 😊",
    "Pra eu te ajudar certinho, preciso entender melhor — pode elaborar?",
    "Me conta: é sobre lentes, agendamento, ou outro assunto?",
  ];

  if (substantiveOutboundRecent) {
    console.log("[FALLBACK-GENERIC] suprimido — última outbound é substantiva:", lastOutboundRaw.slice(0, 80));
    // Devolve null-equivalente: classifica como "outro" sem mensagem nova (caller decide silenciar).
    return {
      resposta: "",
      intencao: "outro",
      pipeline_coluna: "Novo Contato",
      precisa_humano: false,
    };
  }

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

  // All pool exhausted — redirect to agendamento (loja resolve; real escalations go via escalar_consultor)
  return {
    resposta: "Pra isso o ideal é passar na loja — posso agendar sua visita? 😊",
    intencao: "agendamento_loja",
    pipeline_coluna: "Novo Contato",
    precisa_humano: false,
  };
}

// ═══════════════════════════════════════════
// PHASE 3 — POST-LLM VALIDATOR (GUARDRAILS)
// ═══════════════════════════════════════════

// ── SHADOW CLASSIFIER ──────────────────────────────────────────────────────────
// Roda em paralelo com o fluxo principal, NÃO altera roteamento.
// Mede divergência entre classificação LLM-leve e cascata real.
type ShadowResult = { intencao: string; confianca: number; latencia_ms: number };

const _SHADOW_LABELS = [
  "orcamento", "loja_local", "receita", "lentes_contato", "agendamento",
  "consulta_os", "falar_humano", "resposta_campanha", "cliente_reativado",
  "interesse_cashback", "outro",
] as const;

const _SHADOW_SYSTEM_PROMPT = `Classifica a intenção do cliente na conversa. Responda SOMENTE com JSON válido, sem texto adicional:
{"intencao":"<label>","confianca":<0.0-1.0>}

Labels:
- orcamento: quer preço/cotação de óculos ou lentes de grau
- loja_local: endereço, horário, onde fica a loja
- receita: enviou ou quer falar de receita oftalmológica/grau
- lentes_contato: assunto de lentes de contato (não óculos)
- agendamento: quer marcar ou confirmar visita na loja
- consulta_os: quer status de pedido/OS/encomenda
- falar_humano: pediu falar com humano ou gerente explicitamente
- resposta_campanha: respondendo a uma mensagem de campanha/promoção
- cliente_reativado: voltou após longo silêncio sem intenção clara
- interesse_cashback: pergunta sobre cashback ou desconto Diniz
- outro: não encaixa nos acima`;

async function classifyIntentShadow(
  msgs: Array<{ role: "user" | "assistant"; content: string }>,
  lovableApiKey: string,
): Promise<ShadowResult | null> {
  const _t = Date.now();
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [{ role: "system", content: _SHADOW_SYSTEM_PROMPT }, ...msgs],
        max_completion_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || "").trim();
    const parsed = JSON.parse(raw);
    if (!parsed?.intencao || typeof parsed.confianca !== "number") return null;
    if (!(_SHADOW_LABELS as readonly string[]).includes(parsed.intencao)) return null;
    return { intencao: parsed.intencao, confianca: Number(parsed.confianca), latencia_ms: Date.now() - _t };
  } catch {
    return null;
  }
}
// ───────────────────────────────────────────────────────────────────────────────

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
          data_horario: { type: "string", description: "Data e hora COMPLETAS no formato ISO 8601 com TIMEZONE OBRIGATÓRIO (sufixo -03:00 para horário de Brasília). Ex: 2026-03-25T14:00:00-03:00. PROIBIDO enviar sem o offset (ex: '2026-03-25T14:00:00') — será rejeitado. Sem hora ou sem data, NÃO chame esta tool." },
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
      name: "cancelar_visita",
      description: "Cancela DEFINITIVAMENTE o agendamento ativo do cliente. OBRIGATÓRIO usar SEMPRE que for confirmar um cancelamento ao cliente — nunca escreva 'cancelei seu horário' ou 'desmarquei' sem chamar esta tool. Use quando o cliente pedir para desmarcar/cancelar SEM já ter escolhido nova data (se ele já deu nova data, use reagendar_visita).",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Motivo informado pelo cliente (opcional). Ex: 'imprevisto', 'não vou conseguir ir'." },
          resposta: { type: "string", description: "Mensagem confirmando o cancelamento ao cliente. Mantenha curta e calorosa, e ofereça remarcar quando ele quiser. Ex: 'Prontinho, cancelei seu horário. Quando quiser remarcar é só me chamar 👋'." },
        },
        required: ["resposta"],
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
      name: "consultar_lentes_estimativa",
      description: "Devolve uma FAIXA ESTIMADA de preços (econômica/intermediária/premium) para óculos quando o cliente declarou o tipo de lente (multifocal/progressiva/visão simples) e forneceu pelo menos o esférico, MAS ainda falta a ADIÇÃO e/ou o cilindro/eixo. Use ANTES de pedir os dados que faltam — nunca trave o cliente sem dar uma estimativa. NÃO use se já há receita completa salva (use consultar_lentes). NÃO use para lentes de contato.",
      parameters: {
        type: "object",
        properties: {
          rx_type: { type: "string", enum: ["single_vision", "progressive"], description: "Tipo de lente declarado pelo cliente. 'progressive' para multifocal/progressiva; 'single_vision' para visão simples." },
          sphere_od: { type: "number", description: "Esférico do olho direito informado pelo cliente (use sinal: -2.75 para miopia, +1.50 para hipermetropia)." },
          sphere_oe: { type: "number", description: "Esférico do olho esquerdo informado pelo cliente." },
          cylinder_hint: { type: "number", description: "Cilindro se o cliente mencionou um valor (ex: -1.25). Se ele só disse 'tem astigmatismo' sem número, OMITA este campo (a tool presume um cilindro padrão)." },
          filtro_blue: { type: "boolean", description: "Cliente pediu filtro de luz azul." },
          filtro_photo: { type: "boolean", description: "Cliente pediu lente fotossensível/transitions." },
        },
        required: ["rx_type"],
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

function buildFirstContactBlock(inboundCount: number, opts?: { nomeWhatsapp?: string; nomeAtual?: string; nomeConfirmado?: boolean; precisaConfirmar?: boolean }): string {
  const precisaConfirmar = opts?.precisaConfirmar === true && opts?.nomeConfirmado !== true;
  // Dispara na 1ª interação OU sempre que houver flag precisa_confirmar_nome (nome genérico/placeholder).
  if (inboundCount > 1 && !precisaConfirmar) return "";
  const nomeWa = (opts?.nomeWhatsapp || "").trim();
  const nomeAtual = (opts?.nomeAtual || "").trim();
  const candidato = nomeWa || nomeAtual;
  const looksReal = !!candidato
    && /[A-Za-zÀ-ÿ]{2,}/.test(candidato)
    && !/^\+?\d[\d\s()+-]*$/.test(candidato);

  if (looksReal && !opts?.nomeConfirmado) {
    const primeiroNome = candidato.split(/\s+/)[0];
    const cabecalho = inboundCount > 1 ? `# CONFIRMAR NOME (cadastro pendente)` : `# PRIMEIRA INTERAÇÃO — CONFIRMAR NOME`;
    const msg = inboundCount > 1
      ? `Antes de seguir, posso confirmar — falo com ${primeiroNome}? 😊`
      : `Olá! Falo com ${primeiroNome}? 😊 Aqui é o Gael das Óticas Diniz Osasco.`;
    return `${cabecalho}
## MENSAGEM A ENVIAR (copie literalmente o trecho entre aspas, NADA além disso):
"${msg}"

## REGRAS INTERNAS — NÃO COPIE NADA DESTE BLOCO PARA A MENSAGEM:
- Apenas UMA pergunta. Nada depois do ponto final.
- PROIBIDO escrever no texto enviado: "aguardar confirmação", "confirme o nome", "sem reformular", "primeira interação", "tool registrar", "aguarde", instruções de sistema, comentários, parênteses explicativos, listas com "-".
- Se cliente CONFIRMAR ('sim', 'isso', 'sou eu') → chame a tool registrar_nome_cliente com nome="${candidato}".
- Se cliente CORRIGIR ('na verdade é Maria') → chame registrar_nome_cliente com o nome correto.
- Só DEPOIS da confirmação, prossiga. NÃO mencione receita/lentes/agendamento antes de confirmar o nome.`;
  }

  const cabecalho = inboundCount > 1 ? `# CADASTRO INCOMPLETO — PEDIR NOME` : `# PRIMEIRA INTERAÇÃO — PEDIR NOME`;
  const msg = inboundCount > 1
    ? `Antes de seguir, posso saber seu nome, por favor? 😊`
    : `Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?`;
  return `${cabecalho}
## MENSAGEM A ENVIAR (copie literalmente o trecho entre aspas, NADA além disso):
"${msg}"

## REGRAS INTERNAS — NÃO COPIE NADA DESTE BLOCO PARA A MENSAGEM:
- Mensagem termina no "?" da pergunta sobre o nome. Apenas UMA pergunta.
- PROIBIDO escrever no texto enviado: "aguardar", "sem reformular", "primeira interação", "tool registrar", instruções, comentários, parênteses explicativos, listas com "-".
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

function buildOrcamentoParcialBlock(): string {
  return `# ORÇAMENTO COM RECEITA PARCIAL — NUNCA TRAVAR O CLIENTE
- Se o cliente declarou TIPO DE LENTE (multifocal, progressiva, visão simples) e forneceu pelo menos o ESFÉRICO de cada olho, MAS faltam ADIÇÃO/CIL/AX:
  → SEMPRE use a tool *consultar_lentes_estimativa* ANTES de pedir os dados que faltam.
  → Passe rx_type='progressive' para multifocal/progressiva ou 'single_vision' para visão simples; passe sphere_od/sphere_oe com os sinais corretos (negativo p/ miopia, positivo p/ hipermetropia).
  → Se o cliente disse só "tem astigmatismo" sem número, NÃO preencha cylinder_hint (a tool presume um cilindro padrão pra estimativa).
  → A tool devolve 3 faixas (Econômica/Intermediária/Premium) já marcadas como "valores estimativos" — envie a resposta como veio e na MESMA mensagem pergunte os dados que faltam.
- PROIBIDO responder somente "preciso da ADD pra fechar" ou "sem o cilindro não consigo orçar". Sempre dê a faixa primeiro.
- Se o cliente NÃO declarou tipo nem esférico, peça foto da receita uma vez só (não use a tool de estimativa).`;
}

function buildRegionalCoverageBlock(): string {
  // ⚠️ Cidades com loja real: Osasco, Carapicuíba, Barueri, Itapevi.
  // Fonte de verdade: tabela lojas_cidades. Ao abrir/fechar loja em nova cidade, atualizar aqui.
  return `# COBERTURA REGIONAL — ESCADA DE PERSUASÃO
- Você atende APENAS nas lojas de Osasco, Carapicuíba, Barueri e Itapevi. NUNCA mencione outras cidades como tendo loja Óticas Diniz — não temos em Cotia, Jandira, Santana de Parnaíba, Alphaville ou qualquer outra cidade.
- NUNCA sugira lojas ou atendimento em cidades fora da nossa cobertura (como Guarulhos, São Paulo capital, ABC, Campinas, etc.).
- Quando o cliente for de fora da nossa região, siga esta ESCADA DE PERSUASÃO:
  1º) Convide com carinho para conhecer nossas lojas em Osasco, Carapicuíba, Barueri ou Itapevi. Mencione diferenciais, promoções exclusivas e atendimento diferenciado. NÃO envie link do Google Maps.
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
- Termine perguntando a região do cliente para indicar a loja mais próxima e oferecer agendamento de retirada/pagamento.

## ✅ FECHAMENTO DE LENTES DE CONTATO
- LC NÃO exige visita para "tirar medidas" — a receita do cliente já basta.
- MAS o cliente pode (e geralmente quer) ir à loja para retirar o produto, pagar e tirar dúvidas — isso é desejável.
- Quando o cliente escolher uma marca/modelo OU disser "quero reservar/fechar/pedir/levar":
  1. Confirme a escolha em 1 frase (ex.: "Perfeito — anotei a Acuvue 👌").
  2. Se for tórica/multifocal, lembre que é sob encomenda e que o pagamento confirma a reserva.
  3. Pergunte a região para indicar a loja mais próxima e use a tool agendar_visita normalmente para marcar a retirada.
  4. NÃO escreva "tirar medidas" no contexto LC (LC não exige medição). Prefira "retirar", "buscar", "fechar o pedido na loja".
- Escalar para humano só se: (a) sem produto compatível no catálogo, (b) cliente pedir explicitamente, ou (c) reclamação.`;
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
  precisaConfirmar?: boolean;
}): string {
  const s: string[] = [];

  // ── HIERARQUIA DE INSTRUÇÕES (sempre primeiro bloco) ──
  s.push("HIERARQUIA DE INSTRUÇÕES — Em caso de conflito entre os blocos abaixo, siga rigorosamente esta ordem de prioridade: (1) RECEITA PENDENTE — se presente, chame interpretar_receita imediatamente e ignore tudo mais. (2) PÓS-RECEITA OBRIGATÓRIO — se presente, chame consultar_lentes ou consultar_lentes_contato antes de qualquer resposta. (3) DESPEDIDA OU DISPENSA — se o cliente se despediu, encerre com cortesia sem oferecer nada novo. (4) INTENÇÃO DETECTADA — siga o contexto de intenção classificado. (5) PROMPT COMPILADO PRINCIPAL — regras gerais de atendimento. (6) DEMAIS BLOCOS — contexto complementar. Nunca misture instruções de níveis diferentes na mesma resposta.");

  s.push(buildDateContext());

  const ativos: string[] = [];
  const firstContactBlock = buildFirstContactBlock(opts.inboundCount, {
    nomeWhatsapp: opts.nomeWhatsapp,
    nomeAtual: opts.nomeAtual,
    nomeConfirmado: opts.nomeConfirmado,
    precisaConfirmar: opts.precisaConfirmar,
  });
  if (firstContactBlock) { s.push(firstContactBlock); ativos.push("firstContact"); }
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) { s.push(continuityBlock); ativos.push("continuity"); }
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());
  s.push(buildLentesContatoKnowledgeBlock());
  s.push(buildOrcamentoParcialBlock());

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

  // Inject location context (CEP/região do cliente) — alta prioridade contra repetição de pergunta
  if ((opts as any).locationCtx) {
    s.push((opts as any).locationCtx);
    ativos.push("locationCtx");
  }

  // Inject prescription context
  if (opts.receitaCtx) {
    s.push(opts.receitaCtx);
    ativos.push("receitaCtx");
  }

  if (opts.sentTopics.length > 0) {
    s.push(`# TÓPICOS JÁ COBERTOS (NÃO REPITA)
${opts.sentTopics.map((t) => `- ❌ ${t}`).join("\n")}
Se cliente perguntar algo já coberto: "Como já mencionei..." + mude para assunto novo.`);
    ativos.push("sentTopics");
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
      ativos.push("escalatedSubject");
    }
    s.push(hibridoBlock);
    ativos.push("hibrido");
  }

  if (opts.hasKnowledge) ativos.push("knowledge");
  if (opts.agendamentoCtx) ativos.push("agendamentoCtx");

  const { count, ativos: lista } = countActiveBlocks(ativos);
  if (count > 3) {
    console.warn(`[ai-triage] system prompt com ${count} blocos opcionais ativos:`, lista);
  }

  return s.join("\n\n");
}

function countActiveBlocks(ativos: string[]): { count: number; ativos: string[] } {
  return { count: ativos.length, ativos };
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
  precisaConfirmar?: boolean;
}): string {
  const s: string[] = [];

  // Date/time context FIRST — so the model always knows the current date
  s.push(buildDateContext());

  const firstContactBlock = buildFirstContactBlock(opts.inboundCount, {
    nomeWhatsapp: opts.nomeWhatsapp,
    nomeAtual: opts.nomeAtual,
    nomeConfirmado: opts.nomeConfirmado,
    precisaConfirmar: opts.precisaConfirmar,
  });
  if (firstContactBlock) s.push(firstContactBlock);
  const continuityBlock = buildContinuityBlock(opts.inboundCount);
  if (continuityBlock) s.push(continuityBlock);
  s.push(buildRegionalCoverageBlock());
  s.push(buildNonClientBlock());
  s.push(buildLentesContatoKnowledgeBlock());
  s.push(buildOrcamentoParcialBlock());

  s.push(`# IDENTIDADE
Você é o Assistente Virtual da Óticas Diniz. Atendimento rápido, preciso e humano via WhatsApp.

# TOM OBRIGATÓRIO (não-negociável — vale acima de qualquer outra instrução)
- Fale como humano: curto, direto, caloroso. Máx. 2 frases por mensagem (cotações podem ser maiores).
- PROIBIDO usar: "prezado", "informo que", "favor", "aguardar", "verificar", "prosseguir", "dar sequência", "conforme solicitado", "estou à disposição", "atenciosamente", "segue abaixo".
- PROIBIDO descrever o que você VAI fazer ("Vou verificar…", "Estou analisando…", "Aguarde enquanto…"). FAÇA e devolva o resultado.
- PROIBIDO se referir a si mesmo como "IA", "assistente virtual", "sistema", "bot", "modelo", "base de dados".
- PROIBIDO escrever marcadores internos no texto enviado: "[FLUXO ...]", "##", "**REGRA**", "IMPORTANTE:", nomes de tool (agendar_visita, interpretar_receita, etc.) ou nomes de campo (proximo_passo, intencao, coluna_pipeline).
- O campo \`proximo_passo\` é METADADO INTERNO. Se ele NÃO for uma pergunta para o cliente, deixe vazio. NUNCA escreva ali frases como "Confirmar nome", "Aguardar resposta", "Verificar com o cliente" — isso vaza no WhatsApp.

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
Se não souber responder com precisão: peça mais detalhes ao cliente OU sugira agendamento na loja mais próxima pra ver pessoalmente.
PROIBIDO usar frases como "vou encaminhar para um Consultor", "para esse grau específico vou passar pra alguém da equipe" — escalada só via tool escalar_consultor em cenários graves (reclamação, pedido humano explícito, ZERO opções no catálogo).
PROIBIDO mencionar "grau alto", "grau elevado", "sob encomenda", "sob medida específica" ou oferecer Consultor por causa do grau ANTES de ter recebido E interpretado a receita do cliente. Sem receita interpretada = pedir foto da receita primeiro.`);
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
  // ⚠️ Se já mandamos QUALQUER fallback genérico recentemente, escala (retorna null).
  // Caso Paulo Henrique 2026-04-27: 3× "Me explica melhor..." em loop.
  // Caso Cleber 2026-05-06: 2× "Conta pra mim..." idênticas — threshold 0.6 deveria pegar
  // mas algum race fez passar. Reforçamos com checagem ESTRITA de identidade exata
  // contra as últimas 3 outbounds, ANTES da checagem por similaridade.
  const last3Norm = recentNorm.slice(-3);
  const exactRepeatInLast3 = VALIDATOR_FAILED_POOL.some((fb) => {
    const fbNorm = norm(fb);
    return last3Norm.some((prev) => prev === fbNorm);
  });
  if (exactRepeatInLast3) return null;

  const sentAnyFallback = VALIDATOR_FAILED_POOL.some((fb) => {
    const fbNorm = norm(fb);
    return recentNorm.some((prev) => computeSimilarity(fbNorm, prev) > 0.6);
  });
  if (sentAnyFallback) return null;
  // Primeiro fallback: pega o primeiro do pool não usado.
  for (const fb of VALIDATOR_FAILED_POOL) {
    const fbNorm = norm(fb);
    const alreadySent = recentNorm.some((prev) => computeSimilarity(fbNorm, prev) > 0.6);
    if (!alreadySent) return fb;
  }
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
  // Carrega/atualiza mensagens fixas editáveis (cache 60s)
  await loadMensagensFixas(supabase);

  let atendimentoIdForCleanup: string | null = null;

  try {
    const { atendimento_id, mensagem_texto, contato_id, media, forcar_processamento, motivo_disparo, button_id, interactive_reply } = await req.json();
    const isTranscribedAudio = media?.is_transcribed_audio === true;
    const forceMode = forcar_processamento === true;
    const isDevolucaoHumanoIA = motivo_disparo === "devolucao_humano_ia";
    const incomingButtonId: string | null = button_id || interactive_reply?.id || null;
    atendimentoIdForCleanup = atendimento_id;
    if (!atendimento_id) throw new Error("atendimento_id is required");
    if (forceMode) console.log(`[FORCE] forcar_processamento=true | motivo=${motivo_disparo || "n/a"} — bypassing debounce/locks`);
    if (isDevolucaoHumanoIA) console.log("[DEVOLUCAO] humano→ia handoff — continuity mode active");
    if (incomingButtonId) console.log(`[BUTTON ROUTER] received button_id=${incomingButtonId}`);

    // ── 1. LOAD ATENDIMENTO ──
    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, canal_provedor, modo, metadata, inicio_at, ia_lock_at, created_at")
      .eq("id", atendimento_id)
      .single();
    if (atErr || !atendimento) throw new Error("Atendimento not found");

    // ─────────────────────────────────────────────────────────────────────────
    // BUTTON ROUTER — Resposta determinística a cliques de botão/lista WhatsApp
    // Quando o cliente toca em um botão (interactive_reply), o webhook propaga
    // o button_id pra cá. Mapeamos IDs canônicos pra ações concretas, evitando
    // regex/LLM. IDs que começam com "loja:" são tratados como escolha de loja.
    // IDs não mapeados caem no fluxo normal (LLM recebe o título como texto).
    // ─────────────────────────────────────────────────────────────────────────
    if (incomingButtonId && (atendimento.modo === "ia" || atendimento.modo === "hibrido")) {
      try {
        const _atMeta = (atendimento.metadata as Record<string, any>) || {};
        const handled = await routeButtonClick({
          buttonId: incomingButtonId,
          atendimento,
          atendimentoMeta: _atMeta,
          supabase,
          supabaseUrl: SUPABASE_URL,
          serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        });
        if (handled) {
          console.log(`[BUTTON ROUTER] handled id=${incomingButtonId} — bypassing LLM`);
          return jsonResponse({ status: "ok", route: "button_router", button_id: incomingButtonId });
        }
        console.log(`[BUTTON ROUTER] id=${incomingButtonId} not mapped — falling through to normal pipeline`);
      } catch (e) {
        console.error("[BUTTON ROUTER] erro:", e);
      }
    }

    // ── PRE-SKIP: Consulta de OS roda em QUALQUER modo (ia/hibrido/humano/ponte) ──
    // Em humano/ponte: apenas marca flag + evento para o operador ver o contexto. NÃO envia mensagem.
    // Em ia/hibrido: escala completa (flag + mensagem + move card).
    try {
      const _msgPre = (mensagem_texto || "").trim();
      if (_msgPre) {
        const _osKwPre = await loadOsKeywords(supabase);
        if (matchesConsultaOs(_msgPre, _osKwPre)) {
          const _metaPre = (atendimento.metadata as Record<string, any>) || {};
          const _lastFlag = _metaPre.intent_consulta_os_at ? Date.parse(_metaPre.intent_consulta_os_at) : 0;
          const _isFresh = !_lastFlag || (Date.now() - _lastFlag) > 60_000; // não duplica eventos por <1min
          if (atendimento.modo === "humano" || atendimento.modo === "ponte") {
            if (_isFresh) {
              console.log(`[ROUTER] Consulta de OS detectada em modo=${atendimento.modo} — flag + evento (sem auto-mensagem)`);
              await supabase.from("atendimentos").update({
                metadata: { ..._metaPre, intent_consulta_os_at: new Date().toISOString() },
              }).eq("id", atendimento_id);
              await supabase.from("eventos_crm").insert({
                contato_id: atendimento.contato_id,
                tipo: "consulta_os",
                descricao: `Cliente perguntou status do pedido / OS (modo=${atendimento.modo})`,
                metadata: { mensagem_cliente: _msgPre, modo: atendimento.modo },
                referencia_tipo: "atendimento",
                referencia_id: atendimento_id,
              });
            }
            return jsonResponse({ status: "skipped", reason: `modo ${atendimento.modo} (consulta_os registrada)` });
          }
        }
      }
    } catch (e) {
      console.warn("[OS-PRESKIP] falhou:", (e as Error)?.message);
    }

    // ── PRE-ROUTER: Retomar IA quando cliente digita receita após escalada ──
    // Caso Flávia (15/05/2026): IA escalou por OCR ilegível; cliente depois digitou
    // "Esférico OD -0,50 / OE -2,50". Antes, o gate `modo=humano` silenciava IA até
    // consultor abrir. Agora detectamos a receita digitada e devolvemos o atendimento
    // para a IA com pending=true para confirmar antes de cotar.
    if (atendimento.modo === "humano") {
      try {
        const _meta = (atendimento.metadata as Record<string, any>) || {};
        const _motivo: string = String(_meta.revisao_humana_motivo || "");
        const _motivosOk = new Set([
          "receita_escalada_apos_2_rejeicoes",
          "receita_texto_recusada",
          "receita_confirmacao_falhou_2x",
          "rx_ocr_falhou",
          "rx_invalida",
        ]);
        const _motivosArr: string[] = Array.isArray(_meta.revisao_motivos) ? _meta.revisao_motivos : [];
        const _motivoMatches = _motivosOk.has(_motivo) || _motivosArr.some((m) => _motivosOk.has(String(m)));
        const _msgPre = String(mensagem_texto || "").trim();
        const _isImg = !!(media && (media.image_url || media.mime_type?.startsWith?.("image/")));
        const _escAt = _meta.escalado_humano_at ? Date.parse(_meta.escalado_humano_at) : 0;
        const _withinWindow = _escAt > 0 && (Date.now() - _escAt) < 24 * 3600 * 1000;
        const _retomadaAt = _meta.retomada_ia_pos_escalada_at ? Date.parse(_meta.retomada_ia_pos_escalada_at) : 0;
        const _retomadaFresh = _retomadaAt > 0 && (Date.now() - _retomadaAt) < 10 * 60 * 1000;

        if (_motivoMatches && !_isImg && _msgPre && _withinWindow && !_retomadaFresh) {
          const _parsed = detectPrescriptionCorrection(_msgPre);
          if (_parsed) {
            // Verifica se humano enviou outbound após a escalada (consultor já assumiu)
            const { data: _outMsgs } = await supabase
              .from("mensagens")
              .select("id, remetente_nome, created_at")
              .eq("atendimento_id", atendimento_id)
              .eq("direcao", "outbound")
              .gte("created_at", new Date(_escAt).toISOString())
              .limit(20);
            const _bots = new Set(["Assistente IA", "Gael", "Sistema", "Bot Lojas", "Recuperação"]);
            const _humanoAssumiu = Array.isArray(_outMsgs) && _outMsgs.some((m: any) => m.remetente_nome && !_bots.has(String(m.remetente_nome)));

            if (!_humanoAssumiu) {
              // Carrega contato + receitas
              const { data: _cont } = await supabase
                .from("contatos")
                .select("id, metadata")
                .eq("id", atendimento.contato_id)
                .single();
              if (_cont) {
                const _cMeta: any = (_cont.metadata as Record<string, any>) || {};
                const _receitas: any[] = Array.isArray(_cMeta.receitas) ? [..._cMeta.receitas] : [];

                const _merged: any = {
                  eyes: {
                    od: { ...Object.fromEntries(Object.entries(_parsed.od).filter(([_, v]) => v != null)) },
                    oe: { ...Object.fromEntries(Object.entries(_parsed.oe).filter(([_, v]) => v != null)) },
                  },
                  rx_type: _parsed.rx_type,
                  summary: {
                    has_addition: _parsed.has_addition,
                    needs_progressive: _parsed.has_addition,
                    suggested_category: _parsed.rx_type,
                  },
                  confidence: 0.99,
                  data_leitura: new Date().toISOString(),
                  source: "client_typed_first_pos_escalada",
                  raw_correction: _parsed.raw,
                  needs_human_review: false,
                  label: "digitada após escalada",
                  confirmed_by_client_at: null,
                };

                if (isReceitaValida(_merged)) {
                  _receitas.push(_merged);
                  const _idx = _receitas.length - 1;
                  const _maxAbs = Math.max(
                    Math.abs(_parsed.od?.sphere ?? 0),
                    Math.abs(_parsed.oe?.sphere ?? 0),
                  );

                  const _newCMeta = {
                    ..._cMeta,
                    receitas: _receitas,
                    receita_confirmacao: {
                      pending: true,
                      rx_index: _idx,
                      rx_label: _merged.label,
                      asked_at: new Date().toISOString(),
                      correction_count: 0,
                      reason: "retomada_pos_escalada",
                      fora_da_faixa: isReceitaForaDaFaixa(_merged), // C3: alinhado com regra de negócio (>16D)
                    },
                  };
                  await supabase.from("contatos").update({ metadata: _newCMeta }).eq("id", atendimento.contato_id);

                  const _newAtMeta = {
                    ..._meta,
                    revisao_humana_pendente: false,
                    revisao_humana_motivo: null,
                    retomada_ia_pos_escalada_at: new Date().toISOString(),
                    retomada_motivo: "cliente_digitou_receita",
                  };
                  await supabase.from("atendimentos").update({
                    modo: "ia",
                    status: "em_atendimento",
                    updated_at: new Date().toISOString(),
                    metadata: _newAtMeta,
                  }).eq("id", atendimento_id);

                  await supabase.from("eventos_crm").insert({
                    contato_id: atendimento.contato_id,
                    tipo: "ia_retomada_pos_escalada_receita_texto",
                    descricao: `Cliente digitou receita por texto após escalada (motivo anterior: ${_motivo || _motivosArr.join(",") || "n/a"}) — IA retomou pedindo confirmação`,
                    metadata: {
                      previous_motivo: _motivo,
                      previous_motivos: _motivosArr,
                      receita_parsed: { od: _parsed.od, oe: _parsed.oe, rx_type: _parsed.rx_type, raw: _parsed.raw },
                      escalado_ha_minutos: Math.round((Date.now() - _escAt) / 60000),
                    },
                    referencia_tipo: "atendimento",
                    referencia_id: atendimento_id,
                  }).then(() => undefined, () => undefined);

                  await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, buildMsgConfirmarReceita(_merged, false));
                  console.log(`[RX-RETOMADA] Cliente digitou receita pós-escalada (motivo=${_motivo}) — IA retomou`);
                  return jsonResponse({
                    status: "ok",
                    tools_used: ["ia_retomada_pos_escalada_receita"],
                    intencao: "receita_oftalmologica",
                    precisa_humano: false,
                    pipeline_coluna_sugerida: "Orçamento",
                    modo: "ia",
                  });
                }
              }
            } else {
              console.log("[RX-RETOMADA] Humano já assumiu após escalada — não retomar");
            }
          }
        }
      } catch (e) {
        console.warn("[RX-RETOMADA] erro no detector:", (e as Error)?.message);
      }
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
    // Lê o lock da coluna dedicada ia_lock_at (atômica via CAS).
    // O campo meta.ia_lock (legado JSONB) é ignorado — pode existir em registros antigos.
    const iaLock = (atendimento as any).ia_lock_at ? new Date((atendimento as any).ia_lock_at).getTime() : 0;
    const now = Date.now();
    const LOCK_TTL_MS = 30_000; // 30 s — cobre geração pesada (OCR + LLM + pricing)
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

    // ── Set lock — CAS atômico via coluna ia_lock_at ────────────────────────
    // UPDATE … WHERE id=$1 AND (ia_lock_at IS NULL OR ia_lock_at < agora-TTL)
    // é serializado pelo Postgres: só UMA execução concorrente ganha a linha.
    // Se retornou vazio, outra execução tem o lock → aborta imediatamente.
    const lockExpiredBefore = new Date(now - LOCK_TTL_MS).toISOString();
    const { data: lockAcquired } = await supabase
      .from("atendimentos")
      .update({ ia_lock_at: new Date(now).toISOString() })
      .eq("id", atendimento_id)
      .or(`ia_lock_at.is.null,ia_lock_at.lt.${lockExpiredBefore}`)
      .select("id");

    if (!lockAcquired?.length) {
      console.log("[LOCK-CAS] Lock held by concurrent execution — abortando para evitar duplicação");
      return jsonResponse({ status: "skipped", reason: "lock-cas — concurrent execution blocked" });
    }
    console.log("[LOCK-CAS] Lock atômico adquirido");

    const isHibrido = atendimento.modo === "hibrido";
    const contatoId = contato_id || atendimento.contato_id;
    const currentMsg = mensagem_texto || "";

    // Flag: cliente está em fluxo de Consulta de OS (set pelo router pre-LLM).
    // Quando ativa (<30min), bloqueia guards de "receita pendente" — evita IA voltar a pedir receita.
    const _osIntentAt = meta.intent_consulta_os_at ? Date.parse(meta.intent_consulta_os_at) : 0;
    const isConsultaOsActive = _osIntentAt > 0 && (Date.now() - _osIntentAt) < 30 * 60_000;
    if (isConsultaOsActive) console.log("[GUARD] intent_consulta_os ativo — bloqueando guards de receita pendente");

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
      const _np = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
      return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, currentMsg, "keyword", _np);
    }

    // ── 2.5.OS PRE-LLM ROUTER: Consulta de status de OS / óculos pronto ──
    // Se cliente informou OS (5 dígitos) ou CPF válido: consulta bridge e responde por template (mantém modo IA).
    // Fallback (sem identificador / não encontrado / múltiplos resultados): escala para humano (comportamento anterior).
    {
      const osKw = await loadOsKeywords(supabase);
      if (matchesConsultaOs(currentMsg, osKw)) {
        await loadMensagensFixas(supabase);
        const { data: ctOs } = await supabase.from("contatos").select("nome").eq("id", contatoId).maybeSingle();
        const _prim = (ctOs?.nome || "").trim().split(/\s+/)[0] || "";

        // ── Atalho: tem identificador → tenta consulta automática ──────────
        const _osIdent = extrairIdentificadorOS(currentMsg);
        if (_osIdent.tipo !== null) {
          const _osResult = await consultarStatusOS(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, _osIdent);
          if (_osResult.status === "indisponivel") {
            const indispMsg = renderMsgFixa("os_erp_indisponivel", { nome_comma: _prim ? `, ${_prim}` : "" });
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, indispMsg);
            // Guarda identificador pra retry — handler: os_retry_aguardando em routeExpectedTypedReply.
            await supabase.from("atendimentos").update({
              metadata: {
                ...meta,
                intent_consulta_os_at: new Date().toISOString(),
                os_retry: { identificador: _osIdent.valor, tipo: _osIdent.tipo, asked_at: new Date().toISOString(), tries: 1 },
                expected_reply: "os_retry_aguardando",
              },
            }).eq("id", atendimento_id);
            return jsonResponse({
              status: "ok", tools_used: ["os_erp_indisponivel"],
              intencao: "consulta_os", precisa_humano: false, modo: atendimento.modo,
            });
          }
          if (_osResult.encontrado && Array.isArray(_osResult.resultados) && _osResult.resultados.length === 1) {
            return await responderStatusOS(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, _prim, meta, _osResult.resultados[0]);
          }
          console.log(`[ROUTER] OS ident encontrado mas sem resultado único — fallback escalada (encontrado=${_osResult.encontrado}, n=${_osResult.resultados?.length ?? 0})`);
        }

        // ── Sem identificador → inicia coleta (Fatia 2a) ─────────────────────
        if (_osIdent.tipo === null) {
          await iniciarColetaOS(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, meta);
          return jsonResponse({
            status: "ok", tools_used: ["os_iniciar_coleta"],
            intencao: "consulta_os", precisa_humano: false, modo: atendimento.modo,
          });
        }

        // ── Fallback: escalada original (ident presente mas não encontrado / múltiplos) ──
        console.log(`[ROUTER] Consulta de OS detectada (modo=${atendimento.modo}) — escalando para humano`);
        const osMsgExpediente = renderMsgFixa("os_escalada", { nome_comma: _prim ? `, ${_prim}` : "" });
        const osMsg = isHorarioHumano()
          ? osMsgExpediente
          : `${osMsgExpediente}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;

        // Marca flag de intent — bloqueia guards de receita pendente
        await supabase.from("atendimentos").update({
          metadata: { ...meta, intent_consulta_os_at: new Date().toISOString() },
        }).eq("id", atendimento_id);

        // Move card para a coluna "Consulta de OS" do setor Atendimento Corporativo, se existir
        const { data: osCol } = await supabase
          .from("pipeline_colunas")
          .select("id")
          .eq("nome", "Consulta de OS")
          .eq("ativo", true)
          .limit(1)
          .maybeSingle();
        if (osCol?.id) {
          await supabase.from("contatos").update({ pipeline_coluna_id: osCol.id }).eq("id", contatoId);
        }

        // Registra evento dedicado com a mensagem original do cliente
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "consulta_os",
          descricao: "Cliente perguntou status do pedido / OS — escalado para humano",
          metadata: { mensagem_cliente: currentMsg, modo: atendimento.modo },
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
        });

        return await handleNonClientEscalation(
          supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
          atendimento_id, contatoId, osMsg, "consulta_os"
        );
      }
    }

    // ── 2.5.PAG PRE-LLM ROUTER: Formas de pagamento ──
    // Responde determinístico (ia_mensagens_fixas.formas_pagamento), mantém modo IA, sem escalar.
    // Skip se houver template de link de pagamento recente (delega ao fluxo financeiro).
    {
      const pagKw = await loadPagamentoKeywords(supabase);
      if (matchesPagamentoIntent(currentMsg, pagKw)) {
        // Checa últimos 5 outbounds por marker de link de pagamento
        const { data: recentOut } = await supabase
          .from("mensagens")
          .select("conteudo")
          .eq("atendimento_id", atendimento_id)
          .eq("direcao", "outbound")
          .order("created_at", { ascending: false })
          .limit(5);
        const hasLinkPagamento = (recentOut || []).some((m: any) =>
          /\[Template:\s*link_pagamento/i.test(String(m?.conteudo || ""))
        );

        if (hasLinkPagamento) {
          console.log("[ROUTER-PAGAMENTO] link_pagamento ativo — delegando ao fluxo financeiro (skip router)");
        } else {
          console.log("[ROUTER-PAGAMENTO] intent detectado — resposta determinística");
          await loadMensagensFixas(supabase);
          const pagMsg = renderMsgFixa("formas_pagamento");
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, pagMsg);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "duvida_pagamento",
            descricao: "Cliente perguntou sobre formas de pagamento — resposta determinística enviada",
            metadata: { mensagem_cliente: currentMsg, modo: atendimento.modo },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          return jsonResponse({
            status: "ok",
            tools_used: ["router_formas_pagamento"],
            intencao: "duvida_pagamento",
            precisa_humano: false,
            modo: atendimento.modo,
          });
        }
      }
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
      await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "router_subject_change", descricao: currentMsg, referencia_tipo: "atendimento", referencia_id: atendimento_id });
      return jsonResponse({ status: "ok", tools_used: ["router_subject_change"], intencao: "outro", precisa_humano: false, pipeline_coluna_sugerida: "Novo Contato", modo: atendimento.modo });
    }

    // ── 3.5. PRE-LLM ROUTER: "modelos / armações" — movido para DEPOIS das queries paralelas (~linha 1820)
    //         para que possa consultar o agendamento ativo e variar a resposta. ──

    // ── 4. LOAD ALL DATA IN PARALLEL ──
    const _t_load = Date.now();
    const [promptRes, compiledRes, kbRes, exRes, antiRes, regrasRes, msgsRes, colRes, setRes, lojasRes, agendRes, contatoMetaRes] = await Promise.all([
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_atendimento").single(),
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_compilado").single(),
      supabase.from("conhecimento_ia").select("categoria, titulo, conteudo").eq("ativo", true),
      // PERF: 30→12 exemplos (priorização por sinais já filtra os relevantes)
      supabase.from("ia_exemplos").select("categoria, pergunta, resposta_ideal").eq("ativo", true).limit(12),
      supabase.from("ia_feedbacks").select("motivo, resposta_corrigida").in("avaliacao", ["negativo", "corrigido"]).order("created_at", { ascending: false }).limit(8),
      supabase.from("ia_regras_proibidas").select("regra, categoria").eq("ativo", true),
      // PERF: 60→30 mensagens (janela suficiente p/ contexto, prompt encolhe ~40%)
      supabase.from("mensagens").select("direcao, conteudo, remetente_nome, created_at, tipo_conteudo, metadata")
        .eq("atendimento_id", atendimento_id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("pipeline_colunas").select("id, nome, setor_id").eq("ativo", true).order("ordem"),
      supabase.from("setores").select("id, nome").eq("ativo", true),
      supabase.from("telefones_lojas").select("id, nome_loja, telefone, endereco, horario_abertura, horario_fechamento, horarios_semana, departamento, google_profile_url").eq("ativo", true),
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
    let contatoMeta = (contatoMetaRes.data?.metadata as Record<string, any>) || {};
    const contatoTipo = (contatoMetaRes.data as any)?.tipo || "cliente";
    let contatoNomeAtual = String((contatoMetaRes.data as any)?.nome || "").trim();
    console.log(`[PERF] load_all_data=${Date.now() - _t_load}ms`);

    // ── PROTEÇÃO 2: auto-reset de pending órfão entre atendimentos ──
    // Se o pending de receita foi marcado ANTES do início do atendimento atual,
    // significa que sobrou de uma sessão antiga. Limpa silenciosamente.
    try {
      const rc = contatoMeta?.receita_confirmacao;
      const askedAt = rc?.asked_at || rc?.solicitada_at || rc?.set_at;
      const inicioAt = (atendimento as any)?.inicio_at;
      if (rc?.pending === true && askedAt && inicioAt) {
        const askedTs = Date.parse(String(askedAt));
        const inicioTs = Date.parse(String(inicioAt));
        if (!Number.isNaN(askedTs) && !Number.isNaN(inicioTs) && askedTs < inicioTs) {
          const novoMeta = {
            ...contatoMeta,
            receita_confirmacao: { ...rc, pending: false, auto_reset_at: new Date().toISOString(), auto_reset_reason: "atendimento_novo" },
          };
          await supabase.from("contatos").update({ metadata: novoMeta }).eq("id", contatoId);
          contatoMeta = novoMeta;
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_pending_auto_reset",
            descricao: "Pending de receita herdado de atendimento anterior — limpo automaticamente",
            metadata: { asked_at: askedAt, inicio_at: inicioAt },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          console.log("[RX-PENDING-RESET] pending órfão limpo (asked_at < inicio_at)");
        }
      }
    } catch (e) {
      console.warn("[RX-PENDING-RESET] falha:", e);
    }

    // ── PROTEÇÃO 4: watchdog de loop de confirmação de receita ──
    // Se nas últimas 60min mandamos ≥3 mensagens "Li sua receita assim, confere?"
    // ou "Anotei! Ficou assim:" SEM o cliente confirmar, audita em ia_feedbacks
    // e marca flag pra forçar escalada humana neste turno.
    let forcarEscaladaPorLoopReceita = false;
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const recentConfirmPrompts = (allMsgs || []).filter((m: any) => {
        if (m.direcao !== "outbound") return false;
        const ts = Date.parse(String(m.created_at || ""));
        if (Number.isNaN(ts) || ts < oneHourAgo) return false;
        const c = String(m.conteudo || "");
        return /li sua receita assim, confere|anotei! ficou assim/i.test(c);
      });
      if (recentConfirmPrompts.length >= 3 && contatoMeta?.receita_confirmacao?.pending === true) {
        forcarEscaladaPorLoopReceita = true;
        console.warn(`[RX-LOOP-WATCHDOG] ${recentConfirmPrompts.length} prompts de confirmação em 1h sem resolução — forçando escalada`);
        await supabase.from("ia_feedbacks").insert({
          atendimento_id,
          contato_id: contatoId,
          avaliacao: "loop_receita_confirmacao",
          mensagem_ia: recentConfirmPrompts[recentConfirmPrompts.length - 1]?.conteudo?.slice(0, 500) || "",
          comentario: `Watchdog detectou ${recentConfirmPrompts.length} prompts de confirmação em 60min sem cliente confirmar/corrigir`,
          metadata: { prompts_count: recentConfirmPrompts.length, janela_min: 60, receita_confirmacao: contatoMeta.receita_confirmacao },
        }).then(() => {}, (e: any) => console.warn("[RX-LOOP-WATCHDOG] falha audit:", e));
      }
    } catch (e) {
      console.warn("[RX-LOOP-WATCHDOG] falha:", e);
    }

    if (forcarEscaladaPorLoopReceita) {
      // Limpa pending pra próxima sessão começar limpa
      try {
        const novoMeta = {
          ...contatoMeta,
          receita_confirmacao: { ...(contatoMeta.receita_confirmacao || {}), pending: false, encerrado_por_loop_at: new Date().toISOString() },
        };
        await supabase.from("contatos").update({ metadata: novoMeta }).eq("id", contatoId);
      } catch (_) { /* noop */ }
      const msg = "Vou pedir pra um consultor humano olhar sua receita com calma 😊 Já passo aqui rapidinho.";
      return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, msg, "loop_receita_confirmacao");
    }


    const nomeConfirmado = contatoMeta.nome_confirmado === true;
    const precisaConfirmarNome = contatoMeta.precisa_confirmar_nome === true && !nomeConfirmado;
    const nomePerfilWhatsapp = String(contatoMeta.nome_perfil_whatsapp || "").trim();

    // ── Display-name guardrail ─────────────────────────────────────────────
    // Nunca chamar o cliente por telefone, "Cliente #NNNN" sequencial, "WhatsApp User",
    // ou outros placeholders. `_nomeInternoSafe` preserva o valor original para uso
    // INTERNO (logs, prompt como referência); `contatoNomeAtual` passa a ser o nome
    // SEGURO PARA VOCATIVO — vazio quando não temos um nome real confirmado.
    function nomeEhPlaceholder(s: string | null | undefined): boolean {
      const t = String(s || "").trim();
      if (!t) return true;
      const digits = t.replace(/\D/g, "");
      if (digits.length >= 7) return true;                      // telefone (com ou sem máscara)
      if (/^\+?\d[\d\s()+-]*$/.test(t)) return true;            // só dígitos/separadores
      if (/^cliente\s*#?\s*\d+/i.test(t)) return true;          // Cliente #NNNN
      if (/^(whats?app\s*user|contato|cliente|usu[áa]rio)$/i.test(t)) return true;
      if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return true;              // sem letras
      return false;
    }
    const _nomeInternoSafe = contatoNomeAtual || nomePerfilWhatsapp || "";
    if (nomeEhPlaceholder(contatoNomeAtual)) {
      // Se o que está em `contatos.nome` é placeholder, mas há um senderName
      // do WhatsApp que parece nome real, usa-o como vocativo (origem legítima).
      if (!nomeEhPlaceholder(nomePerfilWhatsapp)) {
        contatoNomeAtual = nomePerfilWhatsapp;
      } else {
        contatoNomeAtual = ""; // sem vocativo — templates colapsam ", ${nome}" para ""
      }
    }

    // ── 3.5b. POST-DATA ROUTER: "modelos / armações" → presencial ──
    // Movido pra cá (depois das queries) pra que possa consultar agendamento ativo.
    {
      const tArm = norm(currentMsg);
      // Verbo de pedido/curiosidade obrigatório próximo da palavra armação/modelo.
      const ARM_WORD = /(armac|armaç|armacao|armação|armações|armacoes|modelo|modelos)/;
      const VERBO_PEDIDO = /\b(quero|queria|gostaria|posso|pode(m)?|me\s+(mostr|envi|mand)|mostr(a|ar|em)|envi(a|ar|em)|mand(a|ar|em)|ver|tem|t[eê]m|tens|tens?\s+a[íi]|qual|quais|que\s+(modelo|armac)|catalogo|catálogo|foto|fotos|disponiv|dispon[ií]v|trabalha(m)?\s+com|vende(m)?)\b/;
      const NEGACAO = /\b(n[ãa]o|sem|nem)\b[^.!?]{0,20}(armac|armaç|armacao|armação|armações|armacoes|modelo|modelos|preciso|quero)/;
      const POSSE = /\b(j[áa]\s+tenho|tenho\s+(a|minha|um|o|uma)|levo\s+a\s+minha|uso\s+a\s+minha)\b[^.!?]{0,20}(armac|armaç|armacao|armação|armações|armacoes)/;
      const TEM_RECEITA = /\b(tenho|tenho\s+a|j[áa]\s+tenho|sim,?\s*tenho|com\s+a)\b[^.!?]{0,15}\breceita\b/;

      const inboundsRecentes = allMsgs
        .filter((m: any) => m.direcao === "inbound")
        .slice(-3)
        .map((m: any) => norm(String(m.conteudo || "")));
      const clienteAfirmouReceita = TEM_RECEITA.test(tArm) || inboundsRecentes.some((s: string) => TEM_RECEITA.test(s));
      const jaMandouArmacoes = (contatoMeta?.armacoes_orientado === true);

      const isArmacaoIntent =
        ARM_WORD.test(tArm) && VERBO_PEDIDO.test(tArm) &&
        !NEGACAO.test(tArm) && !POSSE.test(tArm);
      const isLentePedido = /\b(lente|lentes|grau|orcamento de lente|orçamento de lente)\b/.test(tArm);

      // Bypass se cliente afirmou ter receita ou se já mandamos o convite uma vez.
      if (isArmacaoIntent && !isLentePedido && !clienteAfirmouReceita && !jaMandouArmacoes) {
        // Detecta agendamento ativo já registrado (futuro ≤6h tolerância)
        const _NOW_RT = Date.now();
        const _ROUTER_TOL = 6 * 3600 * 1000;
        const _agAtivoRouter = (agendamentosAtivos || [])
          .filter((a: any) => ["agendado", "confirmado", "lembrete_enviado"].includes(a.status) && a.data_horario)
          .filter((a: any) => new Date(a.data_horario).getTime() >= (_NOW_RT - _ROUTER_TOL))
          .sort((x: any, y: any) => new Date(x.data_horario).getTime() - new Date(y.data_horario).getTime())[0];

        let armMsg: string;
        if (_agAtivoRouter) {
          // Já tem agendamento — não oferecer loja de novo, apenas reafirmar e prometer separar.
          const dt = new Date(_agAtivoRouter.data_horario);
          const dataFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
          const horaFmt = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          const _np = contatoNomeAtual ? `, ${contatoNomeAtual.split(" ")[0]}` : "";
          armMsg = `Já está tudo certo${_np}! Te espero ${dataFmt} às ${horaFmt} na ${_agAtivoRouter.loja_nome} — vou separar modelos pra você provar lá no balcão 😉 Qualquer dúvida é só me chamar 👋`;
          console.log("[ROUTER armações] Agendamento ativo — reafirmando sem oferecer nova loja");
        } else {
          armMsg =
            "Sobre armações, a gente trabalha com várias marcas e estilos (Ray-Ban, Oakley, Vogue, Carolina Herrera, linha Diniz exclusiva, infantis e esportivas) 😊\n\n" +
            "Como o caimento muda muito de rosto pra rosto, o ideal é provar pessoalmente — separamos várias opções pra você no balcão.\n\n" +
            "Quer agendar uma visita? Temos:\n📍 *Antônio Agú* (centro Osasco)\n📍 *União Osasco* (shopping)\n📍 *SuperShopping* (até 22h)\n\nQual fica melhor pra você?";
          console.log("[ROUTER armações] Sem agendamento — convite presencial padrão");
        }
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, armMsg);
        try {
          const newMeta = { ...(contatoMeta || {}), armacoes_orientado: true, armacoes_orientado_at: new Date().toISOString() };
          await supabase.from("contatos").update({ metadata: newMeta }).eq("id", contatoId);
        } catch (e) {
          console.warn("[ROUTER armações] Failed to mark metadata:", e);
        }
        await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "router_armacoes_presencial", descricao: currentMsg, referencia_tipo: "atendimento", referencia_id: atendimento_id });
        return jsonResponse({ status: "ok", tools_used: ["router_armacoes_presencial"], intencao: "armacoes", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
      }
    }

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

    const atendimentoMeta = (atendimento.metadata as Record<string, any>) || {};

    // ── PRE-LLM ROUTER: Cashback Diniz (BLOCOs 2 e 3) ──
    // Posicionado antes de routeExpectedTypedReply para preemptar o fast-path de saudação.
    // BLOCO 3: return fora do try — se sendInteractive falhar, ainda retorna cashback (nunca cai no fast-path).
    {
      const _cbMeta   = (atendimento.metadata as Record<string, any>) || {};
      const _fmtBRL   = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const _fmtDia   = (iso: string | null | undefined): string | null => {
        if (!iso) return null;
        const d = String(iso).slice(0, 10);
        return d.slice(8) + "/" + d.slice(5, 7);
      };

      // BLOCO 2 — resposta à confirmação pendente (roda antes do gatilho)
      if (_cbMeta.expected_reply === "cashback_confirmacao" && !isHibrido) {
        try {
          const _cbBtn = incomingButtonId ?? "";
          const _cbN   = norm(currentMsg);
          const isSim  = _cbBtn === "cashback_ver"
            || /\b(sim|quero|pode|claro|aham|isso|manda|ver|ok|s|ss)\b/.test(_cbN)
            || /[👍✅]/.test(currentMsg);
          const isNao  = _cbBtn === "cashback_nao"
            || /\b(nao|agora nao|depois|deixa)\b/.test(_cbN);

          if (isSim) {
            await supabase.from("atendimentos")
              .update({ metadata: { ..._cbMeta, expected_reply: null } })
              .eq("id", atendimento_id);

            const { data: _cbS } = await supabase.rpc("cashback_consultar_saldo", { _contato_id: contatoId });
            const usavel   = Number((_cbS as any)?.saldo_usavel       ?? 0);
            const carencia = Number((_cbS as any)?.saldo_em_carencia  ?? 0);
            const proxVenc = _fmtDia((_cbS as any)?.proximo_vencimento);
            const proxLib  = _fmtDia((_cbS as any)?.proxima_liberacao);

            let _cbMsg: string;
            if (usavel > 0 && carencia === 0) {
              _cbMsg = `Seu cashback de R$ ${_fmtBRL(usavel)} já está liberado pra usar` +
                (proxVenc ? `, e vale até ${proxVenc} 💚` : " 💚");
            } else if (usavel === 0 && carencia > 0) {
              _cbMsg = `Seu cashback de R$ ${_fmtBRL(carencia)} já está garantido e libera dia ${proxLib} 💚`;
            } else if (usavel > 0 && carencia > 0) {
              _cbMsg = `Você tem R$ ${_fmtBRL(usavel)} liberado pra usar e mais R$ ${_fmtBRL(carencia)} que libera dia ${proxLib} 💚`;
            } else {
              _cbMsg = "Você ainda não tem cashback acumulado — mas a cada compra você ganha 15% de volta pra usar na próxima 💚";
            }

            if (usavel > 0 || carencia > 0) {
              await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
                type: "button",
                texto: _cbMsg,
                botoes: [{ id: "cashback_como_funciona", titulo: "💳 Como funciona?" }],
              });
            } else {
              await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, _cbMsg);
            }

            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "cashback_consulta_cliente",
              descricao: "Cliente confirmou e consultou saldo cashback",
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
            });
            return jsonResponse({ status: "ok", tools_used: ["router_cashback_saldo"], intencao: "cashback", precisa_humano: false, modo: atendimento.modo });

          } else if (isNao) {
            await supabase.from("atendimentos")
              .update({ metadata: { ..._cbMeta, expected_reply: null } })
              .eq("id", atendimento_id);
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, "Tranquilo! Qualquer coisa é só chamar 💚");
            return jsonResponse({ status: "ok", tools_used: ["router_cashback_nao"], intencao: "cashback", precisa_humano: false, modo: atendimento.modo });

          } else {
            // Mudou de assunto: limpa expected_reply e segue fluxo normal (NÃO dá return)
            await supabase.from("atendimentos")
              .update({ metadata: { ..._cbMeta, expected_reply: null } })
              .eq("id", atendimento_id);
          }
        } catch (e) {
          console.warn("[ROUTER-CASHBACK-B2] falhou:", (e as Error)?.message);
        }
      }

      // BLOCO 3 — gatilho cashdiniz (passo 1)
      if (matchesCashdiniz(currentMsg) && !isHibrido && _cbMeta.expected_reply !== "cashback_confirmacao") {
        const _cbPrimeiroNome = contatoNomeAtual.split(/\s+/)[0] || "tudo bem";
        try {
          await supabase.from("atendimentos")
            .update({ metadata: { ..._cbMeta, expected_reply: "cashback_confirmacao", cashback_prompt_at: new Date().toISOString() } })
            .eq("id", atendimento_id);
          await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
            type: "button",
            texto: `Oi ${_cbPrimeiroNome}! 💚 Vi que você quer falar do seu cashback Diniz. Posso te mostrar como está?`,
            botoes: [
              { id: "cashback_ver",  titulo: "💳 Ver meu saldo" },
              { id: "cashback_nao",  titulo: "Agora não"        },
            ],
          });
        } catch (e) {
          console.warn("[ROUTER-CASHBACK-B3] falhou:", (e as Error)?.message);
        }
        // Return fora do try: cashdiniz detectado → sempre retorna cashback, nunca cai no fast-path.
        return jsonResponse({ status: "ok", tools_used: ["router_cashback_gatilho"], intencao: "cashback", precisa_humano: false, modo: atendimento.modo });
      }
    }

    // ── PRE-LLM ROUTER: cliente digitou a resposta esperada para uma etapa determinística ──
    try {
      const handledTypedReply = await routeExpectedTypedReply({
        atendimento,
        atendimentoMeta,
        supabase,
        supabaseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        mensagemTexto: String(mensagem_texto || ""),
      });
      if (handledTypedReply) {
        return jsonResponse({
          status: "ok",
          tools_used: ["expected_reply_typed_router"],
          intencao: atendimentoMeta?.intent_detected || "roteamento_deterministico",
          precisa_humano: false,
          modo: atendimento.modo,
        });
      }
    } catch (e) {
      console.warn("[EXPECTED REPLY] fallback digitado falhou:", (e as Error)?.message);
    }

    // ── PRE-LLM ROUTER: Cliente DIGITOU resposta ao prompt "Quer algum adicional?" ──
    // Mantido como compatibilidade para conversas antigas sem expected_reply salvo.
    try {
      const _msgAd = String(mensagem_texto || "").trim().toLowerCase();
      const _lastOut = recentOutbound.slice(-1)[0] || "";
      const _promptAdicional = /quer algum adicional nas lentes\??/i.test(_lastOut);
      if (_msgAd && _promptAdicional && atendimento.modo !== "humano") {
        let _filtros: { filtro_blue?: boolean; filtro_photo?: boolean } | null = null;
        if (/\b(luz azul|filtro azul|anti.?blue|blue.?cut|azul)\b/.test(_msgAd)) {
          _filtros = { filtro_blue: true };
        } else if (/\b(fotossens[ií]vel|fotocrom[aá]tic[ao]|transitions?|escurec[ei])\b/.test(_msgAd)) {
          _filtros = { filtro_photo: true };
        } else if (/\b(sem|nenhum|n[aã]o quero|n[aã]o precisa|nada|s[oó] (a|as) lentes?)\b/.test(_msgAd) || _msgAd === "nao" || _msgAd === "não") {
          _filtros = {};
        }
        if (_filtros !== null) {
          await runQuoteWithFilter(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento, _filtros);
          return jsonResponse({
            status: "ok",
            tools_used: ["adicional_via_texto"],
            intencao: "orcamento",
            precisa_humano: false,
            modo: atendimento.modo,
          });
        }
      }
    } catch (e) {
      console.warn("[PRE-LLM ADICIONAL] fallback texto falhou:", (e as Error)?.message);
    }


    // ── PRE-LLM ROUTER: Cliente reclamou de inversão de preço nas faixas ──
    // Caso Natan 16/05/2026: IA mandou "Econômica R$2.135, Intermediária R$1.199,
    // Premium R$1.699" (inversão). Cliente disse "a econômica está mais cara que
    // a intermediária" e o LLM degradou para "já te mandei as opções acima".
    // Agora: detecta reclamação, re-roda runConsultarLentes (já com fixes de ordenação),
    // envia prefixado e retorna sem passar pelo LLM.
    try {
      const _atMetaPx = (atendimento.metadata as Record<string, any>) || {};
      const _ultCotacao = _atMetaPx?.ultima_cotacao || null;
      const _ultAtMs = _ultCotacao?.at ? Date.parse(_ultCotacao.at) : 0;
      const _ultRecente = _ultAtMs && (Date.now() - _ultAtMs) < 30 * 60 * 1000; // 30min
      const _msgPxRaw = String(mensagem_texto || "").trim();
      const _msgPxLow = _msgPxRaw.toLowerCase();
      const _PRECO_INVERTIDO_RE = /(mais\s+car[oa].*(que|do\s+que))|(econ[ôo]mica.*car)|(premium.*barat)|(invertid[ao])|(t[áa]\s+errad[ao].*pre[çc]o)|(pre[çc]o.*invertid)|(t[áa]\s+invertid)/i;
      const _orcamentoRecente = /(🔍\s*\*?Opções|Econômica:|Intermediária:|Premium:|💚|💛|💎|🟢\s*\*?Econ|🟡\s*\*?Inter)/i.test(
        String((recentOutbound || []).slice(-1)[0] || "")
      );
      if (
        _ultRecente && _orcamentoRecente && _PRECO_INVERTIDO_RE.test(_msgPxLow) &&
        (atendimento.modo === "ia" || atendimento.modo === "hibrido")
      ) {
        console.log("[ROUTER] Reclamação de inversão de preço detectada — re-cotando deterministicamente");
        try {
          const reArgs = {
            preferencia_marca: _ultCotacao?.args?.preferencia_marca || undefined,
            filtro_blue: _ultCotacao?.args?.filtro_blue === true ? true : undefined,
            filtro_photo: _ultCotacao?.args?.filtro_photo === true ? true : undefined,
          };
          const reQuote = await runConsultarLentes(
            supabase, atendimento.contato_id, recentOutbound, reArgs, atendimento_id,
          );
          const prefixo = "Você tem razão, deixa eu refazer as faixas certinho 😊\n\n";
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, prefixo + reQuote.resposta);
          await sendPostQuoteButtons(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id);
          await supabase.from("eventos_crm").insert({
            contato_id: atendimento.contato_id,
            tipo: "cotacao_reexecutada_reclamacao_inversao",
            descricao: "Cliente reclamou de inversão de preço nas faixas — re-cotação determinística disparada",
            metadata: { mensagem_cliente: _msgPxRaw, ultima_cotacao_at: _ultCotacao?.at },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          return jsonResponse({
            status: "ok",
            tools_used: ["consultar_lentes_recotacao_reclamacao"],
            intencao: "orcamento",
            precisa_humano: false,
            modo: atendimento.modo,
          });
        } catch (e) {
          console.warn("[ROUTER] re-cotação por reclamação falhou — caindo para LLM:", (e as Error)?.message);
        }
      }
    } catch (e) {
      console.warn("[ROUTER-INVERSAO] preskip falhou:", (e as Error)?.message);
    }

    // ── PRE-LLM ROUTER: loja_local — "onde fica / endereço / horário" sem LLM ──
    // Só dispara quando não há fluxo ativo (receita/orçamento/expected_reply).
    // Se houver contexto ativo, cai naturalmente no STORE_VISIT_REGEX → agendamento.
    try {
      const _lojaLocalRE = /\b(endere[çc]o|onde fica|onde [eé]|como chegar|fica onde|qual (o )?endere[çc]o|hor[aá]rio|que horas abre|abre quando|funciona(mento)?|google maps|maps)\b/i;
      const _lojaLocalBlocked = !!(
        atendimentoMeta?.expected_reply ||
        atendimentoMeta?.receita_confirmacao?.pending ||
        (contatoMeta as any)?.receita_confirmacao?.pending ||
        (contatoMeta as any)?.pos_orcamento?.etapa
      );
      if (
        _lojaLocalRE.test(String(mensagem_texto || "")) &&
        !_lojaLocalBlocked &&
        (atendimento.modo === "ia" || atendimento.modo === "hibrido")
      ) {
        const _savedCity = atendimentoMeta?.loja_local_cidade as string | undefined;
        if (_savedCity) {
          await sendInfoLojasCidade(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta, _savedCity);
        } else {
          await sendCidadesLojaLocal(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
        }
        console.log(`[LOJA-LOCAL] Despachante determinístico — query: "${String(mensagem_texto || "").substring(0, 60)}" | city: ${_savedCity || "none"}`);
        return jsonResponse({ status: "ok", tools_used: ["loja_local_deterministico"], intencao: "loja_local", precisa_humano: false, modo: atendimento.modo });
      }
    } catch (e) {
      console.warn("[LOJA-LOCAL] fallback para LLM:", (e as Error)?.message);
    }

    // ── SHADOW CLASSIFIER — disparo paralelo (fire-and-forget, não bloqueia) ──
    // Guards: modo humano / 1ª msg / imagem / expected_reply ativo → skip (economiza custo).
    // O resultado é coletado e logado DEPOIS do LLM principal resolver (ver Step 12 abaixo).
    let _shadowP: Promise<ShadowResult | null> | null = null;
    if (
      LOVABLE_API_KEY &&
      (atendimento.modo === "ia" || atendimento.modo === "hibrido") &&
      !atendimentoMeta?.expected_reply &&
      inboundCount > 1 &&
      !((allMsgs.filter((m: any) => m.direcao === "inbound").slice(-1)[0]?.tipo_conteudo || "text") === "image") &&
      !(media?.inline_base64 && media?.mime_type?.startsWith("image/"))
    ) {
      const _shadowMsgs = allMsgs.slice(-8).map((m: any) => ({
        role: (m.direcao === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: String(m.conteudo || "").slice(0, 500),
      }));
      _shadowP = classifyIntentShadow(_shadowMsgs, LOVABLE_API_KEY);
    }

    // ── 3.6. FAST-PATH: SAUDAÇÃO DETERMINÍSTICA + AUTO-PERSISTÊNCIA DE NOME ──
    // Elimina vazamento de prompt (proximo_passo, instruções internas) e reduz latência.
    // Só dispara para texto puro — imagens (receita) seguem o fluxo normal.
    // Quando cliente já respondeu o nome em texto: persiste direto e segue para o LLM (não repete a pergunta).
    // Após 3 tentativas sem reconhecer nome: escala para humano (anti-loop).
    {
      const _lastInboundFP = allMsgs.filter((m: any) => m.direcao === "inbound").slice(-1)[0];
      const _isImageFP = (_lastInboundFP?.tipo_conteudo || "text") === "image"
        || (media?.inline_base64 && media?.mime_type?.startsWith("image/"));
      // Skip total quando o contato já tem nome confirmado no CRM (cliente recorrente).
      // O LLM cumprimenta naturalmente; se for 1º inbound do atendimento, oferecemos
      // direto o menu de triagem.
      const _nomeJaSalvo = nomeConfirmado && !nomeEhPlaceholder(contatoNomeAtual);
      const _greetingEligible =
        !_isImageFP &&
        contatoTipo === "cliente" &&
        !_nomeJaSalvo &&
        (inboundCount === 1 || (precisaConfirmarNome && !nomeConfirmado));

      // Cliente recorrente + 1º inbound deste atendimento → menu de triagem direto.
      if (!_isImageFP && _nomeJaSalvo && inboundCount === 1 && contatoTipo === "cliente") {
        // Preempt: 1ª msg contém intenção clara de menu → roteia direto, pula o menu.
        // Reutiliza o mapeamento texto→ação de detectExpectedReplyAction("menu_triagem")
        // e o handler routeButtonClick — exatamente o que acontece quando o cliente TOCA
        // o item após o menu ser exibido. Vago ("oi", "bom dia") → null → cai no menu.
        // Complemento de cobertura: detectForcedToolIntent captura frases STORE_VISIT
        // ("vou aí", "quero ir na loja"...) que o regex menu_triagem não pega.
        const _msgFP = String(currentMsg || "");
        const _preemptAction = detectExpectedReplyAction("menu_triagem", _msgFP)
          ?? (detectForcedToolIntent(_msgFP, false, false)?.tool === "agendar_cliente_intent" ? "agendar" : null);
        if (_preemptAction) {
          await routeButtonClick({
            buttonId: _preemptAction,
            atendimento,
            atendimentoMeta,
            supabase,
            supabaseUrl: SUPABASE_URL,
            serviceKey: SUPABASE_SERVICE_ROLE_KEY,
          });
          const _precisaHumano = _preemptAction === "reclamacao";
          const _coluna = _preemptAction === "agendar" ? "Agendamento" : _preemptAction === "orcamento" ? "Orçamento" : "Novo Contato";
          return jsonResponse({ status: "ok", tools_used: ["menu_preempt_" + _preemptAction], intencao: _preemptAction, precisa_humano: _precisaHumano, pipeline_coluna_sugerida: _coluna, modo: atendimento.modo });
        }

        const _atMetaMenu = (atendimento.metadata as Record<string, any>) || {};
        if (!_atMetaMenu.menu_triagem_enviado_at) {
          const firstName = contatoNomeAtual.split(" ")[0];
          await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
            type: "list",
            texto: `Oi, ${firstName}! Que bom te ver de novo 🙌 Como posso te ajudar hoje?`,
            lista: {
              label: "Ver opções",
              secao: "Posso te ajudar com",
              itens: MENU_TRIAGEM_ITENS,
            },
          });
          await supabase.from("atendimentos").update({
            metadata: { ..._atMetaMenu, menu_triagem_enviado_at: new Date().toISOString(), expected_reply: "menu_triagem" },
          }).eq("id", atendimento_id);
          await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "menu_triagem_recorrente", descricao: "Cliente já cadastrado — menu direto", referencia_tipo: "atendimento", referencia_id: atendimento_id });
          return jsonResponse({ status: "ok", tools_used: ["menu_triagem_recorrente"], intencao: "saudacao", precisa_humano: false, modo: atendimento.modo });
        }
      }

      if (_greetingEligible) {
        const candidato = (nomePerfilWhatsapp || contatoNomeAtual || "").trim();
        const looksReal = !!candidato
          && /[A-Za-zÀ-ÿ]{2,}/.test(candidato)
          && !/^\+?\d[\d\s()+-]*$/.test(candidato);

        // Heurística: tenta extrair nome do último inbound em texto (apenas quando não é a 1ª interação)
        function extrairNomeDoInbound(raw: string): string | null {
          let t = String(raw || "").trim();
          if (!t || t.length < 2 || t.length > 60) return null;
          if (/[?]\s*$/.test(t)) return null;
          // Remove prefixos comuns
          t = t.replace(/^[.,!\-\s]+/, "");
          t = t.replace(/^(meu\s+nome\s+(é|eh|e)\s+|me\s+chamo\s+|chamo[-\s]me\s+|sou\s+(o|a)\s+|sou\s+|é\s+(o|a)\s+|é\s+|eh\s+)/i, "");
          t = t.replace(/[.!,;:].*$/, "").trim();
          if (!t || t.length < 2 || t.length > 40) return null;
          // Saudações puras / negações / perguntas → não é nome
          if (/^(oi|ol[aá]|opa|hey|hi|hello|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|tudo\s*bom|blz|beleza|ok|sim|n[aã]o|nao|claro|isso|certo|valeu|obrigad[oa]|por\s*favor|prefiro\s*n[aã]o)$/i.test(t)) return null;
          if (/(http|www\.|@|\.com|\.br)/i.test(t)) return null;
          // Precisa ter token alfabético de 2+
          const tokens = t.split(/\s+/).filter(Boolean);
          if (tokens.length === 0 || tokens.length > 4) return null;
          const allAlpha = tokens.every((tk) => /^[A-Za-zÀ-ÿ'’-]{2,}$/.test(tk));
          if (!allAlpha) return null;
          // Capitaliza
          const cap = tokens.map((tk) => tk.charAt(0).toUpperCase() + tk.slice(1).toLowerCase()).join(" ");
          return cap;
        }

        const _ultimoInbound = String(_lastInboundFP?.conteudo || currentMsg || "").trim();
        const _nomeExtraido = (precisaConfirmarNome || inboundCount > 1) ? extrairNomeDoInbound(_ultimoInbound) : null;

        if (_nomeExtraido) {
          // Persiste e segue
          try {
            await supabase
              .from("contatos")
              .update({
                nome: _nomeExtraido,
                metadata: {
                  ...contatoMeta,
                  nome_confirmado: true,
                  precisa_confirmar_nome: false,
                  nome_origem: "ia_fast_path",
                  nome_atualizado_at: new Date().toISOString(),
                  tentativas_pedido_nome: 0,
                },
              })
              .eq("id", contatoId);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "nome_registrado_fast_path",
              descricao: `Nome registrado pelo fast-path: "${_nomeExtraido}"`,
              metadata: { nome: _nomeExtraido, raw: _ultimoInbound },
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
            });
            contatoNomeAtual = _nomeExtraido;
            contatoMeta = { ...contatoMeta, nome_confirmado: true, precisa_confirmar_nome: false, tentativas_pedido_nome: 0 };
            console.log(`[FAST-PATH] nome_persistido_auto="${_nomeExtraido}" — seguindo para LLM`);
          } catch (e) {
            console.error("[FAST-PATH] persist_nome failed:", e);
          }
          // NÃO retorna — deixa o fluxo normal seguir
        } else {
          // Não conseguiu extrair nome
          let greetingMsg: string;
          let escalou = false;
          const tentativas = Number(contatoMeta.tentativas_pedido_nome || 0);

          if (inboundCount > 1 && tentativas >= 2) {
            // Já pedimos 2x e não conseguimos — escala para humano
            console.log(`[FAST-PATH] anti-loop nome: ${tentativas} tentativas — escalando para humano`);
            const _np = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
            try {
              await supabase
                .from("contatos")
                .update({ metadata: { ...contatoMeta, tentativas_pedido_nome: tentativas + 1 } })
                .eq("id", contatoId);
            } catch (_) { /* noop */ }
            return await handleEscalation(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, contatoId, currentMsg, "loop_pedido_nome", _np);
          }

          if (looksReal && !nomeConfirmado) {
            const primeiroNome = candidato.split(/\s+/)[0];
            const introTxt = inboundCount > 1
              ? `Antes de seguir, posso confirmar — falo com *${primeiroNome}*? 😊`
              : `Olá! Aqui é o Gael das Óticas Diniz Osasco 😊 Falo com *${primeiroNome}*?`;
            // Persistência via botões — elimina ambiguidade ("sim/não/é outro").
            await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
              type: "button",
              texto: introTxt,
              botoes: [
                { id: `nome_ok:${primeiroNome}`, titulo: `✅ Sim, sou ${primeiroNome.slice(0, 15)}` },
                { id: "nome_outro", titulo: "✏️ Outro nome" },
              ],
            });
            try {
              await supabase
                .from("contatos")
                .update({ metadata: { ...contatoMeta, tentativas_pedido_nome: tentativas + 1, nome_candidato_botao: primeiroNome } })
                .eq("id", contatoId);
              const _atMetaCN = (atendimento.metadata as Record<string, any>) || {};
              await supabase
                .from("atendimentos")
                .update({ metadata: { ..._atMetaCN, expected_reply: "confirmar_nome" } })
                .eq("id", atendimento_id);
            } catch (_) { /* noop */ }
            console.log(`[FAST-PATH] greeting_buttons_sent candidato="${primeiroNome}" tentativas=${tentativas + 1}`);
            await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "saudacao_botoes_nome", descricao: introTxt, referencia_tipo: "atendimento", referencia_id: atendimento_id });
            return jsonResponse({ status: "ok", tools_used: ["greeting_buttons_nome"], intencao: "saudacao", precisa_humano: false, modo: atendimento.modo });
          }

          // Sem candidato real — pergunta livre (não há perfil WhatsApp para botão)
          greetingMsg = inboundCount > 1
            ? `Antes de seguir, posso saber seu nome, por favor? 😊`
            : `Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?`;

          try {
            await supabase
              .from("contatos")
              .update({ metadata: { ...contatoMeta, tentativas_pedido_nome: tentativas + 1 } })
              .eq("id", contatoId);
          } catch (_) { /* noop */ }

          console.log(`[FAST-PATH] greeting_deterministic_sent inbound=${inboundCount} precisaConf=${precisaConfirmarNome} tentativas=${tentativas + 1}`);
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, greetingMsg);
          await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "saudacao_deterministica", descricao: greetingMsg, referencia_tipo: "atendimento", referencia_id: atendimento_id });
          return jsonResponse({ status: "ok", tools_used: ["greeting_deterministic"], intencao: "saudacao", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
        }
      }
    }

    // ── DETECTA REGIÃO/CEP do cliente nas últimas 5 inbound ──
    const inboundTextsForLoc = allMsgs
      .filter((m: any) => m.direcao === "inbound")
      .slice(-5)
      .map((m: any) => String(m.conteudo || ""))
      .join(" | ");
    const clienteLoc = detectClienteLocation(inboundTextsForLoc + " " + (mensagem_texto || ""));
    if (clienteLoc.cep || clienteLoc.regiaoTexto) {
      console.log(`[REGION] cep=${clienteLoc.cep || "-"} regiao=${clienteLoc.regiaoTexto || "-"} fora=${clienteLoc.foraDeArea} dentro=${clienteLoc.dentroDeArea}`);
    }
    let locationCtx = "";
    if (clienteLoc.foraDeArea) {
      locationCtx = `# 📍 LOCALIZAÇÃO DO CLIENTE — FORA DA ÁREA
O cliente JÁ informou que está em **${clienteLoc.regiaoTexto || "região fora de Osasco"}${clienteLoc.cep ? ` (CEP ${clienteLoc.cep})` : ""}** — fora da nossa cobertura (Osasco e região).
- ⛔ NUNCA pergunte "em qual região/bairro você está?" — você JÁ sabe.
- Aplique a ESCADA DE PERSUASÃO LOCAL:
  1ª) Convide com carinho para uma das lojas em Osasco mencionando diferenciais, atendimento personalizado e condições especiais. NÃO envie link de Maps ainda.
  2ª) Se insistir, reforce acesso fácil (transporte, estacionamento) e benefícios de fechar presencialmente.
  3ª) Se irredutível pela TERCEIRA vez, envie o Google Maps da loja mais próxima e classifique a coluna como "Perdidos".`;
    } else if (clienteLoc.dentroDeArea) {
      locationCtx = `# 📍 LOCALIZAÇÃO DO CLIENTE — DENTRO DA ÁREA
O cliente JÁ informou que está em **${clienteLoc.regiaoTexto || "região atendida"}${clienteLoc.cep ? ` (CEP ${clienteLoc.cep})` : ""}**.
- ⛔ NUNCA pergunte "em qual região/bairro você está?" — você JÁ sabe.
- Indique a loja MAIS PRÓXIMA dessa região (use a lista LOJAS DISPONÍVEIS) e siga para agendamento/fechamento.`;
    }
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
    // lastInboundText = última inbound; recentInboundText = junção das últimas 3 inbound
    // (cobre "?" / "Teria?" como follow-up curto da intenção real anterior).
    const lastInboundText = String(lastInbound?.conteudo || currentMsg || "");
    const recentInboundText = inboundMsgs.slice(-5)
      .map((m: any) => String(m?.conteudo || "")).filter(Boolean).join(" \n ");
    // Check if there's an inbound image among the LAST 5 inbound messages (not just the very last)
    // This catches cases where customer sent prescription, then a short text like "Ok" / "ué" / "?"
    const last5Inbound = inboundMsgs.slice(-5);
    const hasRecentUnparsedPrescriptionImage = last5Inbound.some(
      (m: any) => (m.tipo_conteudo || "text") === "image"
        // PDF de receita tratado como imagem para fins de detecção de OCR pendente
        || ((m.tipo_conteudo || "text") === "document" && (m.metadata as any)?.mime_type === "application/pdf")
    );
    const customerInsistsAlreadySent = /\bj[aá]\s*mandei\b|\bj[aá]\s*enviei\b|\bja foi\b|\bmande[iy]\b.*\breceita\b|\bcad[eê]\b|\bcad[eê].*receita\b/i.test(lastInboundText);
    // Image context = last msg is image/PDF OR there's a pending unparsed image/PDF in recent history
    const lastIsImage = (lastInbound?.tipo_conteudo || "text") === "image"
      || ((lastInbound?.tipo_conteudo || "text") === "document" && (lastInbound?.metadata as any)?.mime_type === "application/pdf")
      || /\[image\]|\[document\]/.test(currentMsg)
      || (media?.inline_base64 && media?.mime_type?.startsWith("image/"))
      || (media?.tipo_conteudo === "document" && media?.mime_type === "application/pdf");
    // Receita salva mas vazia/`unknown` (caso Jardel) NÃO conta — força nova OCR.
    let hasValidReceitas = hasReceitasValidas(receitas);

    // ── Nova receita pendente: imagem inbound mais recente que a última receita salva ──
    // Caso Tati (Mai/2026): cliente já tem receita confirmada, manda foto de receita NOVA;
    // sem este gate, hasValidReceitas=true bloqueia OCR e o LLM cota com receita antiga
    // ou trava no fallback "Recebi sua receita…".
    let lastInboundImageAt = 0;
    for (const m of last5Inbound) {
      if ((m.tipo_conteudo || "text") === "image" && m.created_at) {
        const t = new Date(m.created_at).getTime();
        if (t > lastInboundImageAt) lastInboundImageAt = t;
      }
    }
    let lastReceitaAt = 0;
    for (const r of receitas as any[]) {
      const t = r?.data_leitura ? new Date(r.data_leitura).getTime() : 0;
      if (t > lastReceitaAt) lastReceitaAt = t;
    }
    const last3InboundText = inboundMsgs.slice(-3).map((m: any) => String(m.conteudo || "")).join(" | ").toLowerCase();
    const declaredNewRx = /nova receita|outra receita|receita nova|receita atualizada|receita recente|tenho (uma )?receita/i.test(last3InboundText);
    const hasPendingNewPrescriptionImage = !!(lastInboundImageAt && (
      (lastReceitaAt && lastInboundImageAt > lastReceitaAt) || (declaredNewRx && hasValidReceitas)
    ));

    const isImageContext = lastIsImage
      || (hasRecentUnparsedPrescriptionImage && !hasValidReceitas)
      || hasPendingNewPrescriptionImage;
    if (receitas.length > 0 && !hasValidReceitas) {
      console.log(`[RX-VALID] Receita salva existe mas é INVÁLIDA (rx_type/eyes vazios) — tratando como sem receita`);
    }
    if (hasPendingNewPrescriptionImage) {
      console.log(`[RX-NEW-PENDING] Nova imagem de receita detectada (imageAt=${lastInboundImageAt} > rxAt=${lastReceitaAt}, declaredNew=${declaredNewRx}) — força OCR`);
    }

    // ── Cliente recusou digitar valores após pedido (MSG_PEDIR_RECEITA_TEXTO) → escala humano ──
    // Caso Emerson (12/05/2026): se IA pediu pra digitar OD/OE e cliente responde que
    // não consegue/não sabe/precisa de ajuda, não adianta insistir — chama humano.
    try {
      const _lastOutForRx = String((recentOutbound || []).slice(-1)[0] || "");
      const _iaJustAskedForRxText = !!MSG_PEDIR_RECEITA_TEXTO && !!_lastOutForRx
        && norm(_lastOutForRx).slice(0, 60) === norm(MSG_PEDIR_RECEITA_TEXTO).slice(0, 60);
      const _clienteRecusouDigitar = /n[aã]o (consigo|sei|tenho como|d[aá] pra|da pra) (digitar|passar|ler|enviar|mandar)|t[oôó] sem (a )?receita aqui|n[aã]o entendo (de|nada)|me ajuda|me ajudem|n[aã]o sei (mexer|fazer|como)/i;
      if (_iaJustAskedForRxText && !lastIsImage && _clienteRecusouDigitar.test(lastInboundText)) {
        // Fatia 2: não escala humano — direciona pra loja (medição presencial).
        // sendListaCidades seta expected_reply="cidade_selecao"; próximo turno vai para
        // routeExpectedTypedReply (~3683), ANTES do gate de receita (~4232) → anti-loop garantido.
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "receita_recusa_redirecionada_loja",
          descricao: "Cliente não consegue digitar receita — redirecionado para agendamento na loja",
          metadata: { last_inbound: lastInboundText.slice(0, 200) },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        }).then(() => undefined, () => undefined);

        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, MSG_PONTE_RECEITA_LOJA);
        await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
        console.log("[RX-TEXT-RECUSADA] Cliente recusou digitar receita — redirecionado para loja");
        return jsonResponse({ status: "ok", tools_used: ["receita_recusa_redireciona_loja"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
      }
    } catch (e) {
      console.warn("[RX-TEXT-RECUSADA] erro no detector:", (e as Error)?.message);
    }

    // ── 4.4. GATE DE CONFIRMAÇÃO DE RECEITA (Mai/2026) ──
    // Toda receita lida via OCR fica com metadata.receita_confirmacao.pending=true
    // até o cliente confirmar ("sim", "confere"...) ou corrigir. Enquanto pending,
    // bloqueia cotação/agendamento/escalada normais. Só após "sim":
    //   - dentro da faixa  → libera fluxo (LLM cota normalmente)
    //   - fora da faixa    → escala determinística para Consultor
    if (isReceitaPending(contatoMeta) && !lastIsImage) {
      const rxLabel = contatoMeta.receita_confirmacao?.rx_label || null;
      const foraDaFaixa = contatoMeta.receita_confirmacao?.fora_da_faixa === true;
      const correctionCount = Number(contatoMeta.receita_confirmacao?.correction_count || 0);
      const lastRx = receitas[receitas.length - 1] || null;

      // ── Defesa anti-loop (Mai/2026, caso Wilson): se uma cotação já foi enviada
      // (humano ou IA) cobrindo essa receita, considera receita confirmada
      // implicitamente. Sem isso o pending fica eterno e cada nova msg do
      // cliente re-dispara "Li sua receita assim, confere?" mesmo após orçamento.
      try {
        const outboundJoined = (recentOutbound || []).join(" \n ");
        const temCotacaoEnviada = /(🟢|🟡|💎|🟢\s*Econ[oô]mica|Intermedi[aá]ria|Premium)/i.test(outboundJoined)
          && /R\$\s?\d/.test(outboundJoined);
        if (temCotacaoEnviada && !detectRxConfirmation(lastInboundText) && !detectRxRejeicao(lastInboundText) && !detectPrescriptionCorrection(lastInboundText)) {
          // B3a-FIX: marca confirmed_by_client_at na receita alvo (necessário para que
          // receitaCtx e o gate pós-cotação (~7289) reconheçam confirmação implícita).
          const _implIdx = typeof contatoMeta.receita_confirmacao?.rx_index === "number"
            ? contatoMeta.receita_confirmacao.rx_index
            : (Array.isArray(contatoMeta.receitas) ? contatoMeta.receitas.length - 1 : -1);
          const _implReceitas = Array.isArray(contatoMeta.receitas) ? [...contatoMeta.receitas] : [];
          if (_implIdx >= 0 && _implReceitas[_implIdx]) {
            _implReceitas[_implIdx] = { ..._implReceitas[_implIdx], confirmed_by_client_at: new Date().toISOString() };
          }
          await supabase.from("contatos").update({
            metadata: {
              ...contatoMeta,
              receitas: _implReceitas.length ? _implReceitas : contatoMeta.receitas,
              receita_confirmacao: {
                ...contatoMeta.receita_confirmacao,
                pending: false,
                confirmed_at: new Date().toISOString(),
                confirmed_via: "cotacao_ja_enviada_implicito",
              },
            },
          }).eq("id", contatoId);
          if (_implReceitas.length) { contatoMeta.receitas = _implReceitas; receitas = _implReceitas; }
          contatoMeta.receita_confirmacao = { ...contatoMeta.receita_confirmacao, pending: false, confirmed_at: new Date().toISOString(), confirmed_via: "cotacao_ja_enviada_implicito" };
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_confirmada_implicita_pos_cotacao",
            descricao: "Pending de receita limpo automaticamente — cotação já havia sido enviada",
            metadata: { rx_label: rxLabel },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          }).then(() => undefined, () => undefined);
          console.log("[RX-CONFIRMACAO] Cotação já enviada — limpando pending e liberando fluxo");
          // segue para o LLM tratar a dúvida real do cliente
        }
      } catch (_) { /* noop */ }
    }
    if (isReceitaPending(contatoMeta) && !lastIsImage) {
      const rxLabel = contatoMeta.receita_confirmacao?.rx_label || null;
      const foraDaFaixa = contatoMeta.receita_confirmacao?.fora_da_faixa === true;
      const correctionCount = Number(contatoMeta.receita_confirmacao?.correction_count || 0);
      const lastRx = receitas[receitas.length - 1] || null;

      // ── Defesa: pending corrompida com receita inválida (caso Yuri) ──
      // Se a última receita salva não é válida, NUNCA aceitar "sim" — limpa pending,
      // pede valores por texto e sai. Idempotente para conversas já corrompidas.
      if (lastRx && !isReceitaValida(lastRx)) {
        try {
          await supabase.from("contatos").update({
            metadata: {
              ...contatoMeta,
              receita_confirmacao: {
                ...contatoMeta.receita_confirmacao,
                pending: false,
                invalidada_at: new Date().toISOString(),
              },
            },
          }).eq("id", contatoId);
          contatoMeta.receita_confirmacao = { ...(contatoMeta.receita_confirmacao || {}), pending: false, invalidada_at: new Date().toISOString() };
        } catch (_) { /* noop */ }
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "receita_pending_invalidada",
          descricao: "Pending corrompida (receita sem valores) — limpando e pedindo valores por texto",
          metadata: { rx_label: rxLabel, last_rx_rxtype: lastRx?.rx_type ?? null },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        }).then(() => undefined, () => undefined);
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, MSG_PEDIR_RECEITA_TEXTO);
        console.log("[RX-CONFIRMACAO] Pending corrompida — limpa e pede texto");
        return jsonResponse({ status: "ok", tools_used: ["receita_pending_invalidada"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
      }

      if (detectRxConfirmation(lastInboundText)) {
        try {
          // Marca a receita-alvo (rx_index se houver, senão a última) como confirmada
          const targetIdx = typeof contatoMeta.receita_confirmacao?.rx_index === "number"
            ? contatoMeta.receita_confirmacao.rx_index
            : (Array.isArray(contatoMeta.receitas) ? contatoMeta.receitas.length - 1 : -1);
          const updatedReceitas = Array.isArray(contatoMeta.receitas) ? [...contatoMeta.receitas] : [];
          if (targetIdx >= 0 && updatedReceitas[targetIdx]) {
            updatedReceitas[targetIdx] = { ...updatedReceitas[targetIdx], confirmed_by_client_at: new Date().toISOString() };
          }
          await supabase.from("contatos").update({
            metadata: {
              ...contatoMeta,
              receitas: updatedReceitas.length ? updatedReceitas : contatoMeta.receitas,
              receita_confirmacao: {
                ...contatoMeta.receita_confirmacao,
                pending: false,
                confirmed_at: new Date().toISOString(),
                correction_count: 0,
              },
            },
          }).eq("id", contatoId);
          if (updatedReceitas.length) contatoMeta.receitas = updatedReceitas;
          if (updatedReceitas.length) receitas = updatedReceitas;
        } catch (_) { /* noop */ }
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "receita_confirmada_cliente",
          descricao: `Cliente confirmou receita ${rxLabel || ""}${foraDaFaixa ? " (fora da faixa)" : ""}`,
          metadata: { rx_label: rxLabel, fora_da_faixa: foraDaFaixa, rx: lastRx },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

        if (foraDaFaixa) {
          const _np = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
          const respFinal = isHorarioHumano() ? MSG_ESCALADA_GRAU_FORA_FAIXA : mensagemEscaladaForaHorario(_np);
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, respFinal);
          // Marca flag de revisão humana para o popover "Receita lida" aparecer no detalhe
          {
            const motivosRev: string[] = ["escalada_grau_fora_faixa"];
            const cylRev = Math.max(
              Math.abs(Number(lastRx?.eyes?.od?.cylinder) || 0),
              Math.abs(Number(lastRx?.eyes?.oe?.cylinder) || 0),
            );
            const sphRev = Math.max(
              Math.abs(Number(lastRx?.eyes?.od?.sphere) || 0),
              Math.abs(Number(lastRx?.eyes?.oe?.sphere) || 0),
            );
            if (cylRev > 4) motivosRev.push(`cilindrico_alto:${cylRev}`);
            if (sphRev > 10) motivosRev.push(`esferico_fora_catalogo:${sphRev}`);
            const { data: atFlag } = await supabase
              .from("atendimentos").select("metadata").eq("id", atendimento_id).single();
            const metaFlag = (atFlag?.metadata as Record<string, any>) || {};
            await supabase.from("atendimentos").update({
              modo: "humano",
              metadata: {
                ...metaFlag,
                revisao_humana_pendente: true,
                revisao_motivos: motivosRev,
                revisao_solicitada_at: new Date().toISOString(),
              },
            }).eq("id", atendimento_id);
          }
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "escalada_grau_fora_faixa",
            descricao: `Receita confirmada com grau fora da faixa do catálogo — escalada automática`,
            metadata: {
              rx_label: rxLabel,
              od_sphere: lastRx?.eyes?.od?.sphere ?? null,
              oe_sphere: lastRx?.eyes?.oe?.sphere ?? null,
              od_cyl: lastRx?.eyes?.od?.cylinder ?? null,
              oe_cyl: lastRx?.eyes?.oe?.cylinder ?? null,
              rx_type: lastRx?.rx_type ?? null,
            },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          console.log(`[RX-CONFIRMACAO] Confirmada FORA da faixa — escalando para humano`);
          return jsonResponse({ status: "ok", tools_used: ["escalada_grau_fora_faixa"], intencao: "orcamento", precisa_humano: true, pipeline_coluna_sugerida: "Humano", modo: "humano" });
        }

        console.log(`[RX-CONFIRMACAO] Confirmada DENTRO da faixa — liberando fluxo normal`);
        contatoMeta.receita_confirmacao = { ...contatoMeta.receita_confirmacao, pending: false, confirmed_at: new Date().toISOString() };

        // ── DISPARO DETERMINÍSTICO: cotação óculos imediatamente após confirmação ──
        // Caso Franciana (Mai/2026): após cliente responder "Sim", o LLM voltava a mandar
        // "Recebi sua receita 👀 Já estou analisando…" sem chamar consultar_lentes.
        // Para óculos chamamos runConsultarLentes direto; LC mantém o fluxo via LLM.
        const _recentInboundForLC = inboundMsgs
          .slice(-10)
          .map((m: any) => String(m.conteudo || ""))
          .join(" | ")
          .toLowerCase();
        const _isLCCtx = /\b(lente[s]?\s+de\s+contato|\blc\b|pronta\s+entrega|di[aá]ria[s]?|quinzenal|mensal|t[oó]rica[s]?|gelatinosa[s]?)\b/i.test(_recentInboundForLC);

        if (_isLCCtx && lastRx) {
          try {
            const lcResult = await runConsultarLentesContato(supabase, contatoId, {});
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, lcResult.resposta);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "cotacao_lc_pos_confirmacao_forcada",
              descricao: "Cotação LC disparada deterministicamente após cliente confirmar a receita",
              metadata: { rx_label: rxLabel, source: "post_rx_confirmation_gate", usou_catalogo: lcResult.usou_catalogo, needs_toric: lcResult.needs_toric_sob_encomenda },
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
            });
            console.log("[RX-CONFIRMACAO-LC] Cotação LC determinística enviada após confirmação");
            return jsonResponse({
              status: "ok",
              tools_used: ["consultar_lentes_contato_pos_confirmacao"],
              intencao: "orcamento_lentes_contato",
              precisa_humano: false,
              pipeline_coluna_sugerida: "Orçamento",
              modo: atendimento.modo,
            });
          } catch (e) {
            console.warn("[RX-CONFIRMACAO-LC] runConsultarLentesContato pós-confirmação falhou — caindo para LLM:", e);
          }
        }

        if (!_isLCCtx && lastRx) {
          try {
            const quoteResult = await runConsultarLentes(
              supabase,
              contatoId,
              recentOutbound,
              { receita_label: rxLabel || lastRx?.label || undefined },
              atendimento_id,
            );
            let respCotacao = quoteResult.resposta;
            try {
              const rev = requerRevisaoHumanaPosOrcamento(lastRx);
              if (rev.precisa && respCotacao && !respCotacao.includes(MSG_REVISAO_HUMANA_SUFIXO)) {
                respCotacao = respCotacao + MSG_REVISAO_HUMANA_SUFIXO;
              }
            } catch (_) { /* noop */ }
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, respCotacao);
            await sendPostQuoteButtons(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "cotacao_pos_confirmacao_forcada",
              descricao: "Cotação óculos disparada deterministicamente após cliente confirmar a receita",
              metadata: { rx_label: rxLabel, source: "post_rx_confirmation_gate" },
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
            });
            console.log("[RX-CONFIRMACAO] Cotação determinística enviada após confirmação");
            return jsonResponse({
              status: "ok",
              tools_used: ["consultar_lentes_pos_confirmacao"],
              intencao: "orcamento",
              precisa_humano: false,
              pipeline_coluna_sugerida: "Orçamento",
              modo: atendimento.modo,
            });
          } catch (e) {
            console.warn("[RX-CONFIRMACAO] runConsultarLentes pós-confirmação falhou — caindo para LLM:", e);
          }
        }
      } else if (detectRxRejeicao(lastInboundText)) {
        const newCount = correctionCount + 1;
        try {
          await supabase.from("contatos").update({
            metadata: {
              ...contatoMeta,
              receita_confirmacao: {
                ...contatoMeta.receita_confirmacao,
                correction_count: newCount,
                last_rejected_at: new Date().toISOString(),
              },
            },
          }).eq("id", contatoId);
        } catch (_) { /* noop */ }
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "receita_rejeitada_cliente",
          descricao: `Cliente rejeitou leitura (tentativa ${newCount})`,
          metadata: { rx_label: rxLabel, correction_count: newCount },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });
        // ── Fatia 2: 2 falhas de confirmação → loja (medição presencial) em vez de humano ──
        // pending=false encerra o impasse de receita — anti-loop crítico.
        // sendListaCidades seta expected_reply="cidade_selecao"; routeExpectedTypedReply (~3683)
        // intercepta o próximo turno ANTES do gate de receita (~4232) → sem re-disparo.
        if (newCount >= 2) {
          try {
            // Limpa pending — encerra o impasse de receita (CRÍTICO anti-loop)
            await supabase.from("contatos").update({
              metadata: {
                ...contatoMeta,
                receita_confirmacao: {
                  ...contatoMeta.receita_confirmacao,
                  pending: false,
                  correction_count: newCount,
                  last_rejected_at: new Date().toISOString(),
                  redirecionado_loja_at: new Date().toISOString(),
                },
              },
            }).eq("id", contatoId);
          } catch (_) { /* noop */ }
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_redirecionada_loja_ocr",
            descricao: `Cliente rejeitou leitura ${newCount}x — redirecionado para agendamento na loja`,
            metadata: { rx_label: rxLabel, correction_count: newCount, last_rx: lastRx },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, MSG_PONTE_RECEITA_LOJA);
          await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
          console.log(`[RX-CONFIRMACAO] ${newCount} rejeições OCR — redirecionado para loja`);
          return jsonResponse({ status: "ok", tools_used: ["receita_redireciona_loja_ocr"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
        }
        const respRej = lastRx
          ? buildMsgConfirmarReceita(lastRx, true) + "\n\nSe estiver errado, pode me passar os valores corretos por texto que eu atualizo aqui 😊"
          : "Sem problema! Me passa os valores corretos por texto: OD esférico/cilíndrico/eixo e OE esférico/cilíndrico/eixo? 📝";
        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, respRej);
        console.log(`[RX-CONFIRMACAO] Rejeição ${newCount} — repedindo confirmação/texto`);
        return jsonResponse({ status: "ok", tools_used: ["receita_rejeitada"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
      } else {
        // Pode ser correção por texto — se for, deixa fluxo seguir; senão repete pergunta
        const possibleCorrection = detectPrescriptionCorrection(lastInboundText);
        if (!possibleCorrection) {
          // ── Saída do loop: abandono claro ou intenção nova reconhecida ──
          // Estende o regex de opt-out do gate de SET (mai/2026) + "esquece", "deixa pra lá"
          const isAbandonoClaro = /\b(esquece(r?(\s+(a\s+)?receita)?)?|deixa\s+pr[ao]\s+l[aá]|n[aã]o\s+quero\s+(mais\s+)?(or[cç]amento|receita)|n[aã]o\s+precisa|guarda?r?\s+(a\s+)?receita|depois\s+(eu\s+)?(te\s+)?falo|s[oó]\s+(quero|queria|gostaria)\s+(que\s+)?(voc[eê]\s+)?guarde|s[oó]\s+(uma|tirando)\s+d[uú]vida)\b/i.test(lastInboundText);
          const intentNova = detectForcedToolIntent(lastInboundText, hasValidReceitas, hasRecentUnparsedPrescriptionImage && !hasValidReceitas);
          const isIntencaoNova = intentNova?.tool === "agendar_cliente_intent" || matchesCashdiniz(lastInboundText);

          if (isAbandonoClaro || isIntencaoNova) {
            // Limpa pending no contato
            try {
              await supabase.from("contatos").update({
                metadata: {
                  ...contatoMeta,
                  receita_confirmacao: {
                    ...contatoMeta.receita_confirmacao,
                    pending: false,
                    saiu_por: isAbandonoClaro ? "abandono" : "intencao_nova",
                    saiu_em: new Date().toISOString(),
                  },
                },
              }).eq("id", contatoId);
              contatoMeta.receita_confirmacao = { ...contatoMeta.receita_confirmacao, pending: false };
            } catch (_) { /* noop */ }
            // Limpa receita_pending + expected_reply="receita_confirmacao" no atendimento se setados
            try {
              const { data: atRow } = await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).maybeSingle();
              const atMeta = (atRow?.metadata || {}) as Record<string, any>;
              if (atMeta.receita_pending || atMeta.expected_reply === "receita_confirmacao") {
                await supabase.from("atendimentos").update({
                  metadata: {
                    ...atMeta,
                    receita_pending: null,
                    expected_reply: atMeta.expected_reply === "receita_confirmacao" ? null : atMeta.expected_reply,
                  },
                }).eq("id", atendimento_id);
              }
            } catch (_) { /* noop */ }
            console.log(`[RX-CONFIRMACAO] Saiu do loop — ${isAbandonoClaro ? "abandono" : "intencao_nova:" + intentNova?.tool}`);
            if (isAbandonoClaro && !isIntencaoNova) {
              await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, "Ok, sem problemas! Se precisar de orçamento depois é só chamar 😊");
              return jsonResponse({ status: "ok", tools_used: ["receita_pending_abandonada"], intencao: "outro", precisa_humano: false, pipeline_coluna_sugerida: "Novo", modo: atendimento.modo });
            }
            // Intenção nova: não retorna — pipeline roteia normalmente (ex.: "quero agendar" cai no intercept)
          } else {
            // Input ambíguo — mantém loop
            const respRep = lastRx
              ? buildMsgConfirmarReceita(lastRx, false)
              : "Antes de te passar as opções, preciso que você confirme os valores que li da sua receita. Pode dar uma olhada e me dizer se está certinho? 😊";
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, respRep);
            console.log(`[RX-CONFIRMACAO] Cliente desviou — repedindo confirmação`);
            return jsonResponse({ status: "ok", tools_used: ["receita_aguardando_confirmacao"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
          }
        }
      }
    }

    // ── 4.4a. GATE DE ESCOLHA DE RECEITA NÃO CONFIRMADA (Mai/2026) ──
    // Cenário: cliente já tinha receita 1 confirmada, mandou foto da receita 2,
    // IA pergunta "qual receita usamos?" e cliente responde "a segunda".
    // Antes de cotar, precisa confirmar com o cliente os valores DA segunda receita.
    if (!isReceitaPending(contatoMeta) && Array.isArray(receitas) && receitas.length >= 2 && !lastIsImage) {
      const escolha = detectEscolhaReceita(lastInboundText, receitas);
      if (escolha) {
        const rxEscolhida = receitas[escolha.idx];
        if (rxEscolhida && !rxEscolhida.confirmed_by_client_at) {
          const rxLabelEsc = rxEscolhida.label || `receita_${escolha.idx + 1}`;
          try {
            const novaReceitaConf = {
              pending: true,
              rx_label: rxLabelEsc,
              rx_index: escolha.idx,
              asked_at: new Date().toISOString(),
              correction_count: 0,
              fora_da_faixa: isReceitaForaDaFaixa(rxEscolhida),
            };
            await supabase.from("contatos").update({
              metadata: { ...contatoMeta, receita_confirmacao: novaReceitaConf },
            }).eq("id", contatoId);
            contatoMeta.receita_confirmacao = novaReceitaConf;
          } catch (_) { /* noop */ }
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_escolhida_aguardando_confirmacao",
            descricao: `Cliente escolheu ${escolha.how} (idx=${escolha.idx}) — pedindo confirmação dos valores`,
            metadata: { rx_label: rxLabelEsc, rx_index: escolha.idx, how: escolha.how },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          }).then(() => undefined, () => undefined);
          await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, buildMsgConfirmarReceita(rxEscolhida, false));
          console.log(`[RX-ESCOLHA] Cliente escolheu receita idx=${escolha.idx} ainda não confirmada — pedindo confirmação`);
          return jsonResponse({ status: "ok", tools_used: ["receita_aguardando_confirmacao"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
        }
      }
    }

    // ── 4.4b. MÁQUINA DE ESTADOS PÓS-ORÇAMENTO (Mai/2026) ──
    // Após a IA enviar o orçamento + CTA "quer agendar uma visita?" o fluxo é
    // determinístico: cidade → loja → encaminha pra agendamento.
    {
      const posOrc = (contatoMeta as any).pos_orcamento;
      const _setPosOrc = async (next: any) => {
        try {
          const { data: cur } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
          const m = (cur?.metadata as Record<string, any>) || {};
          if (next === null) delete m.pos_orcamento; else m.pos_orcamento = next;
          await supabase.from("contatos").update({ metadata: m }).eq("id", contatoId);
        } catch (_) { /* noop */ }
      };
      if (posOrc?.etapa && !lastIsImage) {
        if (posOrc.etapa === "aguardando_cta_visita") {
          if (detectAceiteVisita(lastInboundText)) {
            await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
            await _setPosOrc({ ...posOrc, etapa: "aguardando_cidade", atualizado_at: new Date().toISOString() });
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId, tipo: "cta_visita_aceito",
              descricao: "Cliente aceitou visita após orçamento — listando cidades",
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            }).then(() => undefined, () => undefined);
            return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_cidades"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
          }
          if (detectRecusaVisita(lastInboundText)) {
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, "Tranquilo! Quando quiser ver pessoalmente, é só me chamar 😊");
            await _setPosOrc(null);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId, tipo: "cta_visita_recusado",
              descricao: "Cliente recusou visita após orçamento",
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            }).then(() => undefined, () => undefined);
            return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_recusa"], intencao: "orcamento", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
          }
          await _setPosOrc(null);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId, tipo: "pos_orcamento_fallback_llm",
            descricao: `Cliente desviou de aguardando_cta_visita: "${lastInboundText.substring(0,120)}"`,
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          }).then(() => undefined, () => undefined);
        } else if (posOrc.etapa === "aguardando_cidade") {
          const cidade = detectCidadeEscolhida(lastInboundText);
          if (cidade) {
            await _setPosOrc({ ...posOrc, etapa: "aguardando_loja", cidade, atualizado_at: new Date().toISOString() });
            await sendListaLojasDaCidade(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta, cidade, lojas, contatoId);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId, tipo: "cidade_escolhida",
              descricao: `Cliente escolheu cidade ${(await loadCidadesLojas()).cidadeLabel[cidade] || cidade}`,
              metadata: { cidade },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            }).then(() => undefined, () => undefined);
            return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_lojas"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
          }
          // Escape hatch: intenção clara diferente de escolher cidade (mesmo critério do S1).
          // Limpa pos_orcamento + garante expected_reply=null sem usar variável stale.
          // Não retorna — roteamento normal (LLM / cascata) assume abaixo.
          if (_isEscapeIntent(_normTxt(lastInboundText))) {
            await _setPosOrc(null);
            await supabase.from("atendimentos")
              .update({ metadata: { ...atendimentoMeta, expected_reply: null } })
              .eq("id", atendimento_id);
            console.log(`[POS-ORC-ESCAPE] intenção clara, limpando pos_orcamento — "${lastInboundText.slice(0, 80)}"`);
          } else {
            const tries = Number(posOrc.tries_cidade || 0) + 1;
            if (tries < 2) {
              await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta, "Desculpe, não entendi. Qual dessas cidades fica melhor pra você? 😊");
              await _setPosOrc({ ...posOrc, tries_cidade: tries });
              return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_cidades_repete"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
            }
            await _setPosOrc(null);
          }
        } else if (posOrc.etapa === "aguardando_loja") {
          const loja = await matchLojaEscolhida(lastInboundText, posOrc.cidade || "", lojas);
          if (loja) {
            await _setPosOrc({ ...posOrc, etapa: "agendando", loja_nome: loja.nome_loja, atualizado_at: new Date().toISOString() });
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId, tipo: "loja_escolhida",
              descricao: `Cliente escolheu loja ${loja.nome_loja}`,
              metadata: { loja_nome: loja.nome_loja, cidade: posOrc.cidade },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            }).then(() => undefined, () => undefined);
            const ask = `Boa! Vamos marcar na *${loja.nome_loja}* então 😊 Qual dia e horário ficam melhor pra você? Pode ser hoje, amanhã ou outro dia da semana.`;
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, ask);
            return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_loja_definida"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
          }
          // Escape hatch: mesmo critério de aguardando_cidade.
          if (_isEscapeIntent(_normTxt(lastInboundText))) {
            await _setPosOrc(null);
            await supabase.from("atendimentos")
              .update({ metadata: { ...atendimentoMeta, expected_reply: null } })
              .eq("id", atendimento_id);
            console.log(`[POS-ORC-ESCAPE] loja — intenção/dúvida clara, limpando pos_orcamento — "${lastInboundText.slice(0, 80)}"`);
          } else {
            const tries = Number(posOrc.tries_loja || 0) + 1;
            if (tries < 2) {
              await sendListaLojasDaCidade(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta, posOrc.cidade || "osasco", lojas, contatoId);
              await _setPosOrc({ ...posOrc, tries_loja: tries });
              return jsonResponse({ status: "ok", tools_used: ["pos_orcamento_lojas_repete"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
            }
            await _setPosOrc(null);
          }
        }
      }
    }

    // ── 4.5. PRIORIDADE: COMPROVANTE DE PAGAMENTO ──
    // Se a imagem inbound chegou logo após o envio de um link de pagamento,
    // tratar como COMPROVANTE — não como receita ocular. Sem isso, o motor
    // dispara interpretar_receita em comprovantes e a conversa morre.
    // Caso Ivani Mendes Ferreira (06/05): link pago → IA respondeu "Recebi sua receita".
    if (lastIsImage) {
      const PAYMENT_TEMPLATE_RE = /\[Template:\s*link_pagamento[^\]]*\]/i;
      const recentPaymentLink = (recentOutbound || []).slice(-10).some((m: any) => PAYMENT_TEMPLATE_RE.test(String(m || "")));
      let hasOpenPaymentSolicitation = false;
      if (!recentPaymentLink) {
        try {
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          const { data: paySols } = await supabase
            .from("solicitacoes")
            .select("id, metadata, status, created_at")
            .eq("contato_id", contatoId)
            .eq("tipo", "link_pagamento")
            .gte("created_at", since)
            .limit(5);
          hasOpenPaymentSolicitation = (paySols || []).some((s: any) => {
            const meta = s.metadata || {};
            return !meta.comprovante_recebido_at && s.status !== "concluida" && s.status !== "cancelada";
          });
        } catch (e) {
          console.error("[COMPROVANTE] solicitacoes lookup failed:", e);
        }
      }
      const isPaymentReceiptContext = recentPaymentLink || hasOpenPaymentSolicitation;
      if (isPaymentReceiptContext) {
        console.log("[COMPROVANTE] Imagem após link de pagamento — anexa ao card, encerra atendimento e notifica Financeiro");

        // Mensagem fixa editável (fallback hardcoded)
        let respostaComp = "Recebi seu comprovante 🙌 Já encaminhei para o Financeiro conferir. Assim que confirmar, te aviso por aqui. Obrigado!";
        try {
          const { data: fixa } = await supabase
            .from("ia_mensagens_fixas")
            .select("texto, ativo")
            .eq("chave", "comprovante_recebido_cliente")
            .maybeSingle();
          if (fixa?.ativo && fixa?.texto) respostaComp = fixa.texto;
        } catch (_) { /* noop */ }

        await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, respostaComp);

        // Localiza solicitação de pagamento aberta + extrai mídia
        const lastInbound = recentInbound?.[recentInbound.length - 1] as any;
        const anexoUrl = lastInbound?.url || lastInbound?.media_url || lastInbound?.imagem_url || null;
        const anexoMime = lastInbound?.mime_type || lastInbound?.mimeType || "image/jpeg";

        let solPagamento: any = null;
        try {
          const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          const { data: paySols } = await supabase
            .from("solicitacoes")
            .select("id, metadata")
            .eq("contato_id", contatoId)
            .eq("tipo", "link_pagamento")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1);
          solPagamento = paySols?.[0] || null;
          if (solPagamento) {
            const nowIso = new Date().toISOString();
            const newMeta = {
              ...(solPagamento.metadata || {}),
              comprovante_recebido_at: nowIso,
              comprovante_url: anexoUrl,
              comprovante_origem: "cliente_whatsapp",
            };
            await supabase.from("solicitacoes").update({ metadata: newMeta }).eq("id", solPagamento.id);
            // Anexo no card
            if (anexoUrl) {
              await supabase.from("solicitacao_anexos").insert({
                solicitacao_id: solPagamento.id,
                tipo: "comprovante_pagamento_cliente",
                descricao: "Comprovante enviado pelo cliente via WhatsApp",
                url_publica: anexoUrl,
                mime_type: anexoMime,
              }).then(() => undefined, () => undefined);
            }
            // Timeline
            await supabase.from("pipeline_card_eventos").insert({
              entidade: "solicitacao",
              entidade_id: solPagamento.id,
              tipo: "comprovante_cliente_recebido",
              descricao: "Cliente enviou comprovante via WhatsApp",
              metadata: { anexo_url: anexoUrl },
            } as any).then(() => undefined, () => undefined);
            // Espelha em pagamentos_link
            const pli = (solPagamento.metadata as any)?.payment_link_id;
            if (pli) {
              await supabase.from("pagamentos_link")
                .update({ comprovante_recebido_at: nowIso })
                .eq("payment_link_id", pli).then(() => undefined, () => undefined);
            }
          }
        } catch (e) {
          console.error("[COMPROVANTE] failed to attach to solicitacao:", e);
        }

        // Move card CRM para coluna terminal "Encerrados" + marca encerramento_motivo no contato
        try {
          const { data: encerradosCol } = await supabase
            .from("pipeline_colunas")
            .select("id")
            .is("setor_id", null)
            .ilike("nome", "Encerrados")
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();
          if (encerradosCol?.id) {
            const { data: cData } = await supabase
              .from("contatos")
              .select("pipeline_coluna_id, metadata")
              .eq("id", contatoId)
              .maybeSingle();
            const prevCol = cData?.pipeline_coluna_id || null;
            const cMeta = ((cData?.metadata as any) || {}) as Record<string, any>;
            cMeta.encerramento_motivo = "comprovante_recebido";
            if (cMeta.recuperacao_vendas) {
              cMeta.recuperacao_vendas = { ...cMeta.recuperacao_vendas, status: "encerrado_auto" };
            }
            await supabase.from("contatos")
              .update({ pipeline_coluna_id: encerradosCol.id, metadata: cMeta } as any)
              .eq("id", contatoId);
            await supabase.from("pipeline_card_eventos").insert({
              entidade: "contato",
              entidade_id: contatoId,
              tipo: "atendimento_encerrado",
              descricao: "Encerrado automaticamente — comprovante recebido",
              coluna_anterior_id: prevCol,
              coluna_nova_id: encerradosCol.id,
              metadata: { motivo: "comprovante_recebido", automatico: true },
            } as any).then(() => undefined, () => undefined);
          }
        } catch (e) {
          console.error("[COMPROVANTE] failed to move CRM card:", e);
        }

        // Encerra atendimento (modo=ia, status=encerrado) + grava motivo
        try {
          const { data: a } = await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).maybeSingle();
          const aMeta = ((a?.metadata as any) || {}) as Record<string, any>;
          delete aMeta.ia_lock;
          aMeta.encerramento_motivo = "comprovante_recebido";
          aMeta.desfecho = "encerrado";
          await supabase.from("atendimentos").update({
            status: "encerrado",
            modo: "ia",
            fim_at: new Date().toISOString(),
            metadata: aMeta,
          } as any).eq("id", atendimento_id);
        } catch (_) { /* noop */ }

        // Notifica usuários do Financeiro
        try {
          const SETOR_FINANCEIRO = "7cd0d465-bb9d-4097-a1ae-93106fb82d48";
          const { data: roles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("setor_id", SETOR_FINANCEIRO);
          const userIds = Array.from(new Set((roles || []).map((r: any) => r.user_id).filter(Boolean)));
          if (userIds.length > 0 && solPagamento) {
            await supabase.from("notificacoes").insert(userIds.map((uid: string) => ({
              usuario_id: uid,
              tipo: "comprovante_recebido",
              titulo: "Comprovante recebido",
              mensagem: `Cliente enviou comprovante do link de pagamento`.slice(0, 140),
              referencia_id: solPagamento.id,
            })));
          }
        } catch (e) {
          console.error("[COMPROVANTE] failed to notify financeiro:", e);
        }

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "comprovante_pagamento_recebido",
          descricao: "Cliente enviou comprovante após link de pagamento — anexado ao card e Financeiro notificado",
          referencia_tipo: "atendimento",
          referencia_id: atendimento_id,
          metadata: { trigger: recentPaymentLink ? "recent_template" : "open_solicitation", auto_encerrado: true },
        }).then(() => undefined, () => undefined);

        return jsonResponse({
          status: "ok",
          tools_used: ["comprovante_pagamento"],
          intencao: "comprovante_pagamento",
          precisa_humano: false,
          modo: "ia",
          validator_flags: ["payment_receipt_attached_and_closed"],
        });
      }
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

    // ── Pré-calcula grade de status (7 dias) por loja via loja_status_no_dia ──
    // Resultado: lojaStatusGrade[loja_id] = "Hoje (sáb 03/05): 09:00–18:00\n  Amanhã (dom 04/05): FECHADA\n  ..."
    const lojaStatusGrade: Record<string, string> = {};
    try {
      const tz = "America/Sao_Paulo";
      const dayLabels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
      const baseDate = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
      const days: { label: string; iso: string; idx: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + i);
        const iso = d.toISOString().substring(0, 10); // YYYY-MM-DD (suficiente p/ função)
        const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
        const prefix = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : dayLabels[d.getDay()];
        days.push({ label: `${prefix} (${dayLabels[d.getDay()]} ${ddmm})`, iso, idx: i });
      }

      const lojasComId = (lojas || []).filter((l: any) => l.id);
      const calls: Promise<any>[] = [];
      for (const l of lojasComId) {
        for (const d of days) {
          calls.push(
            supabase.rpc("loja_status_no_dia", { _loja_id: l.id, _data: d.iso })
              .then((r: any) => ({ loja_id: l.id, day: d, status: r.data }))
              .catch(() => ({ loja_id: l.id, day: d, status: null }))
          );
        }
      }
      const results = await Promise.all(calls);
      const grouped: Record<string, string[]> = {};
      for (const r of results) {
        if (!grouped[r.loja_id]) grouped[r.loja_id] = [];
        const s = r.status;
        let line: string;
        if (!s) {
          line = `${r.day.label}: —`;
        } else if (s.aberta) {
          line = `${r.day.label}: ${s.abre}–${s.fecha}`;
        } else if (s.motivo === "feriado_nacional_total" || s.motivo === "feriado_loja_fechada" || s.motivo === "feriado_sem_politica" || s.motivo === "feriado_sem_horario_domingo") {
          line = `${r.day.label}: FECHADA (feriado${s.feriado_nome ? " — " + s.feriado_nome : ""})`;
        } else {
          line = `${r.day.label}: FECHADA`;
        }
        grouped[r.loja_id].push(line);
      }
      for (const id in grouped) {
        lojaStatusGrade[id] = grouped[id].join("\n  ");
      }
    } catch (e) {
      console.error("[ai-triage] falha ao montar grade de status das lojas:", e);
    }

    // Inject lojas into knowledge
    if (lojas.length > 0) {
      knowledgeStr += "\n\n## LOJAS DISPONÍVEIS\n";
      knowledgeStr += "⚠️ Use a grade de horário abaixo. NUNCA ofereça horário num dia marcado como FECHADA. Se o cliente pedir um dia fechado, diga que aquela loja não abre nesse dia e ofereça outra data ou outra loja que abra naquele dia.\n\n";
      for (const l of lojas) {
        const parts = [`**${l.nome_loja}**`];
        if (l.endereco) parts.push(l.endereco);
        if (l.telefone) parts.push(`Tel: ${l.telefone}`);
        if (l.departamento && l.departamento !== "geral") parts.push(`Depto: ${l.departamento}`);
        if (l.google_profile_url) parts.push(`Google: ${l.google_profile_url}`);
        knowledgeStr += `- ${parts.join(" | ")}\n`;
        const grade = l.id ? lojaStatusGrade[l.id] : "";
        if (grade) {
          knowledgeStr += `  ${grade}\n`;
        } else if (l.horario_abertura && l.horario_fechamento) {
          knowledgeStr += `  Horário padrão: ${l.horario_abertura}–${l.horario_fechamento}\n`;
        }
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
    // B2.2: filtra receitas por sessão/confirmação antes de injetar no LLM.
    // Receitas não-confirmadas de sessões anteriores são "fantasmas" — não devem
    // disparar FLUXO PÓS-RECEITA nem ser reapresentadas automaticamente.
    // C1-FIX: inicio_at é nullable (só gravado quando operador humano assume).
    // Para atendimentos de IA puro, inicio_at é sempre null → usar created_at (NOT NULL DEFAULT now()) como âncora.
    // Se nem created_at estiver disponível (impossível em produção), _hasInicioAt=false e descartamos
    // receitas antigas em vez de vazar (mais seguro).
    const _atInicioTs =
      Date.parse(String((atendimento as any).inicio_at || "")) ||
      Date.parse(String((atendimento as any).created_at || "")) || 0;
    const _hasInicioAt = _atInicioTs > 0;
    // Receitas do atendimento atual (salvas nesta sessão) — confirmadas ou pendentes.
    const _receitasCurrentSession = (receitas as any[]).filter((r: any) => {
      if (r.superseded_at) return false;
      if (!_hasInicioAt) return false; // sem âncora temporal: descarta em vez de vazar
      const rl = r.data_leitura ? Date.parse(String(r.data_leitura)) : 0;
      return rl > 0 && rl >= _atInicioTs;
    });
    // Receitas confirmadas de sessões anteriores — mostrar com nota de "oferta", não forçar.
    const _receitasConfirmadasAntigas = !_hasInicioAt ? [] : (receitas as any[]).filter((r: any) => {
      if (r.superseded_at) return false;
      if (!r.confirmed_by_client_at) return false;
      const rl = r.data_leitura ? Date.parse(String(r.data_leitura)) : 0;
      return !rl || rl < _atInicioTs;
    });
    // Flag usada na linha FLUXO PÓS-RECEITA: só dispara quando há receita da sessão atual.
    const hasReceitasAtivasCtx = _receitasCurrentSession.some(isReceitaValida);

    let receitaCtx = "";
    if (_receitasCurrentSession.length > 0) {
      receitaCtx = "\n\n# RECEITAS JÁ INTERPRETADAS NESTA CONVERSA\n";
      for (let i = 0; i < _receitasCurrentSession.length; i++) {
        const rx = _receitasCurrentSession[i];
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
        const confirmedTag = rx.confirmed_by_client_at ? " ✅ confirmada pelo cliente" : " ⚠️ AGUARDA confirmação do cliente";
        receitaCtx += `\n## Receita ${i + 1} (${label})${confirmedTag} — lida em ${dataLeitura}\n`;
        receitaCtx += `Tipo: ${rxTypeLabel} | Confiança: ${conf}\n`;
        receitaCtx += `${formatEye(od, "OD")}\n`;
        receitaCtx += `${formatEye(oe, "OE")}\n`;
      }
      receitaCtx += `\n⚠️ NÃO peça receita novamente. O cliente JÁ enviou. Use consultar_lentes referenciando a receita correta.`;
      receitaCtx += `\n⚠️ NUNCA cote uma receita marcada como "AGUARDA confirmação". Se o cliente escolher uma assim, peça que confirme os valores antes (o sistema cuida disso automaticamente).`;
      if (_receitasCurrentSession.length > 1) {
        receitaCtx += `\nQuando o cliente pedir orçamento, pergunte "Para qual receita?" antes de chamar consultar_lentes.`;
      }
      console.log(`[RX-CTX] Injecting ${_receitasCurrentSession.length} current-session prescription(s) into context`);
    }
    // Receitas confirmadas antigas: oferecer SOMENTE quando cliente sinaliza intenção de compra.
    // "Bom dia" puro → sem oferta (intrusivo). "Quero fazer um óculos" → libera a oferta.
    const _INTENT_COMPRA_RE = /\b(or[çc]amento|or[çc]ar|pre[çc]o|valor|quanto\s+(custa|fica|sai)|[oó]culos|lente[s]?|grau\b|receita\b|comprar|compra\b|renovar|refazer|armacao|armação)\b/i;
    const _hasIntentCompra =
      _INTENT_COMPRA_RE.test(lastInboundText) ||
      (recentInboundText ? _INTENT_COMPRA_RE.test(recentInboundText) : false);
    if (_receitasConfirmadasAntigas.length > 0 && _receitasCurrentSession.length === 0 && _hasIntentCompra) {
      const _fmtAnt = (rx: any) => {
        const od = rx.eyes?.od || {}; const oe = rx.eyes?.oe || {};
        const dl = rx.data_leitura ? new Date(rx.data_leitura).toLocaleDateString("pt-BR") : "—";
        return `OD esf ${od.sphere ?? "?"} / OE esf ${oe.sphere ?? "?"} — confirmada em ${dl}`;
      };
      receitaCtx += "\n\n# RECEITA ANTERIOR CONFIRMADA\n";
      receitaCtx += _receitasConfirmadasAntigas.map(_fmtAnt).join("\n") + "\n";
      receitaCtx += `\n⚠️ Esta receita é de um atendimento anterior. PERGUNTE ao cliente se quer usá-la OU se tem receita nova — NÃO chame consultar_lentes sem confirmar. Exemplo: "Vi que você tem uma receita confirmada de [data]. Quer usar ela ou tem uma nova?"`;
      console.log(`[RX-CTX] ${_receitasConfirmadasAntigas.length} old confirmed prescription(s) — offer mode`);
    }

    // ── 5.1 DECIDE: compiled prompt vs legacy ──
    let systemPrompt: string;

    if (compiledPrompt) {
      // USE COMPILED PROMPT with slot replacement
      let lojasStr = "";
      if (lojas.length > 0) {
        lojasStr = "## LOJAS DISPONÍVEIS\n";
        lojasStr += "⚠️ NUNCA liste lojas em texto corrido. A seleção de loja é SEMPRE feita pela lista interativa do WhatsApp enviada automaticamente pelo sistema. Use estes dados SOMENTE para verificar horários, endereços e disponibilidade de datas. Se o cliente perguntar 'qual loja' ou 'onde fica', não liste — a lista interativa será enviada automaticamente.\n";
        lojasStr += "⚠️ Use a grade de horário abaixo. NUNCA ofereça horário num dia marcado como FECHADA. Se o cliente pedir um dia fechado, diga que aquela loja não abre nesse dia e ofereça outra data ou outra loja que abra naquele dia.\n\n";
        for (const l of lojas) {
          const parts = [`**${l.nome_loja}**`];
          if (l.endereco) parts.push(l.endereco);
          if (l.telefone) parts.push(`Tel: ${l.telefone}`);
          if (l.departamento && l.departamento !== "geral") parts.push(`Depto: ${l.departamento}`);
          lojasStr += `- ${parts.join(" | ")}\n`;
          const grade = l.id ? lojaStatusGrade[l.id] : "";
          if (grade) {
            lojasStr += `  ${grade}\n`;
          } else if (l.horario_abertura && l.horario_fechamento) {
            lojasStr += `  Horário padrão: ${l.horario_abertura}–${l.horario_fechamento}\n`;
          }
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
        nomeAtual: _nomeInternoSafe,
        nomeConfirmado,
        precisaConfirmar: precisaConfirmarNome,
        locationCtx,
      } as any);

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
        knowledge: (locationCtx ? locationCtx + "\n\n" : "") + knowledgeStr + agendamentoCtx + receitaCtx,
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
        nomeAtual: _nomeInternoSafe,
        nomeConfirmado,
        precisaConfirmar: precisaConfirmarNome,
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
    // Cobre formatos atuais: "🔍 *Opções", "Econômica:/Intermediária:/Premium:", "💚/💛/💎",
    // e o layout novo de orçamento: "🟢 Mais em conta:" / "🟡 Um passo acima:" / "📌 Temos opções premium"
    const orcamentoOutboundRegex = /(🔍\s*\*Opções|Econômica:|Intermediária:|Premium:|💚|💛|💎|🟢\s*Mais em conta|🟡\s*Um passo acima|📌\s*Temos opções premium)/i;
    const recentOrcamento = (recentOutbound || []).slice(-3).find((t: string) => orcamentoOutboundRegex.test(t || "")) || "";

    // ── MODO CONSULTIVO: dúvida pós-cotação ──
    // _metaIsDuvida: client clicou "Tirar dúvida" → intent setado em turno anterior.
    // _inlineDuvida: client digitou pergunta de produto enquanto expected_reply="pos_cotacao"
    // (sem clicar o botão), detectado inline via _isProdutoDuvida.
    const _metaIsDuvida = (atendimentoMeta as any)?.intent_detected === "duvida_pos_orcamento";
    const _inlineDuvida = !_metaIsDuvida
      && (atendimentoMeta as any)?.expected_reply === "pos_cotacao"
      && _isProdutoDuvida(_normTxt(lastInboundText));
    const isDuvidaPosOrcamento = _metaIsDuvida || _inlineDuvida;
    if (_inlineDuvida) {
      // Persiste modo consultivo + limpa expected_reply para próxima mensagem
      supabase.from("atendimentos")
        .update({ metadata: { ...atendimentoMeta, expected_reply: null, intent_detected: "duvida_pos_orcamento" } })
        .eq("id", atendimento_id)
        .then(() => {}).catch(() => {});
      console.log(`[DUVIDA-INLINE] Pergunta de produto em pos_cotacao — modo consultivo ativo`);
    }

    // B1-FIX: flag true quando cotação já foi enviada nesta sessão (via outbound ou
    // pos_quote_botoes_at). isDuvidaPosOrcamento também garante supressão — se o cliente
    // está em dúvida, cotação já foi enviada por definição.
    const _cotacaoJaFoiEnviada = !!(recentOrcamento || (atendimentoMeta as any)?.pos_quote_botoes_at || isDuvidaPosOrcamento);
    let orcamentoBrandsList: string[] = [];
    if (recentOrcamento) {
      // Extrai marcas dos formatos "*BRAND family*" e categorias
      const brandMatches = [...recentOrcamento.matchAll(/\*([A-Z][A-Z0-9 ]{1,12})\b/g)];
      orcamentoBrandsList = [...new Set(brandMatches.map(m => m[1].trim()).filter(b => b.length >= 3))];
      // B2c-FIX: captura marcas em Title Case (ex: "*Hoya*", "*Essilor*") que a regex
      // acima não pega por exigir ALL_CAPS — o orçamento usa Title Case nessas marcas.
      const _tcBrandMatches = [...recentOrcamento.matchAll(/\*(Hoya|Essilor|Zeiss|Varilux|Kodak|Solflex)\b/g)];
      for (const m of _tcBrandMatches) {
        if (!orcamentoBrandsList.some(b => b.toLowerCase() === m[1].toLowerCase())) {
          orcamentoBrandsList.push(m[1]);
        }
      }
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

    // Detecta agradecimento puro (ex: "obg", "obrigado", "valeu", "ok obrigado", "ok", "beleza")
    // OBS: "ok|okay|blz|beleza|combinado|perfeito|tudo certinho" só viram despedida quando há agendamento ativo
    // (gate isThanksClose = hasAgendamentoAtivo && isThanksOnly && !askedHelpMore).
    const isThanksOnly = /^(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx|muito obrigad[oa]|ok obrigad[oa]|t[aá] bom obrigad[oa]|ok|okay|okey|blz|beleza|combinado|perfeito|tudo certinho|tudo certo ent[aã]o)$/i.test(msgTrim);

    // Detecta pedido EXPLÍCITO de encerramento (ex: "encerrar atendimento", "pode encerrar", "finalizar")
    const EXPLICIT_CLOSE_RE = /^(pode (encerrar|finalizar|fechar)( o)?( atendimento| chat| conversa)?|encerrar( o)?( atendimento| chat| conversa)?|finalizar( o)?( atendimento| chat| conversa)?|fechar( o)?( atendimento| chat| conversa)?|encerra( a[ií])?|encerra ai|pode (fechar|encerrar) por aqui|j[aá] resolveu|era (s[oó] )?isso( mesmo)?,?\s*(obrigad[oa])?)$/i;
    const isExplicitClose = EXPLICIT_CLOSE_RE.test(msgTrim2);

    // Resposta curta SIM/NÃO à oferta pendente (usa msgTrim2 para tolerar "Não. Obg.")
    const SHORT_YES_RE = /^(sim|isso|pode|pode sim|claro|claro que sim|por favor|adoraria|vamos|bora|manda|manda ver|quero|quero ver|quero sim|show|massa|beleza|ok|tá|ta|tá bom|ta bom|perfeito|com certeza|👍|👌)$/i;
    const SHORT_NO_RE = /^(n[aã]o|nao precisa|tranquilo|depois|deixa pra l[aá]|t[oô] bem|tudo certo|tudo bem|sem necessidade|n|nn|n[aã]o obrigad[oa]|por enquanto n[aã]o|s[oó] isso|s[oó] isso mesmo|s[oó] isso ent[aã]o|era isso|era isso mesmo|era s[oó] isso|sem mais|nada mais|nada por enquanto|por agora n[aã]o)$/i;

    // Aceite afirmativo com cauda: "pode deixar o comparativo aqui", "manda o comparativo", "quero ver as opções"
    const LONG_YES_RE = /^(pode|quero|claro|manda|vamos|bora|ok|sim|adoraria|t[aá] bom|beleza)\b.{0,80}\b(comparativ|opç|diferen|ver|aqui|mostra|envia|prepara|deixa|deixar|separa|aceito)/i;
    const isLongYes = !!pendingComparativoOffer && LONG_YES_RE.test(msgTrim2);

    const isShortYes = (!!pendingComparativoOffer && SHORT_YES_RE.test(msgTrim2)) || isLongYes;

    // Detecta agendamento ativo — prioriza FUTURO (mais próximo de agora) e inclui status `lembrete_enviado`.
    // Evita assinar despedida com agendamento passado quando há outro futuro.
    const _NOW_MS_AG = Date.now();
    const _TOLERANCIA_AG_MS = 6 * 3600 * 1000; // 6h: ainda válido se foi hoje cedo
    const _ATIVOS_STATUS = ["agendado", "confirmado", "lembrete_enviado"];
    // Salvaguarda: ignora agendamentos que já foram marcados como cancelados (metadata.cancelado_em)
    // OU cujo último outbound do assistant nos últimos 30 min indicou cancelamento textual.
    const _lastOutForCancelGuard = String((recentOutbound || []).slice(-1)[0] || "").toLowerCase();
    const _assistantSaidCanceled = /\bcancelei (seu |o |teu )?(hor[aá]rio|agendamento|atendimento)\b|\bdesmarquei (seu |o )?(hor[aá]rio|agendamento)\b/i.test(_lastOutForCancelGuard);
    const _agendamentosFuturos = (agendamentosAtivos || [])
      .filter((a: any) => _ATIVOS_STATUS.includes(a.status) && a.data_horario)
      .filter((a: any) => !a?.metadata?.cancelado_em)
      .filter((a: any) => new Date(a.data_horario).getTime() >= (_NOW_MS_AG - _TOLERANCIA_AG_MS))
      .sort((x: any, y: any) => new Date(x.data_horario).getTime() - new Date(y.data_horario).getTime());
    let agAtivoRecentEarly = _agendamentosFuturos[0]
      || (agendamentosAtivos || []).find((a: any) => _ATIVOS_STATUS.includes(a.status) && !a?.metadata?.cancelado_em)
      || (agendamentosAtivos || [])[0];
    if (agAtivoRecentEarly && _assistantSaidCanceled && !agAtivoRecentEarly?.metadata?.cancelado_em) {
      console.log("[FAREWELL] agendamento descartado por evidência textual de cancelamento no último outbound");
      agAtivoRecentEarly = null;
    }
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

    // ── NEGATIVA PÓS-RETOMADA ──
    // Se a última outbound foi um template/mensagem de retomada (recuperacao_vendas ou
    // recuperacao_humano nas últimas 48h, OU assinatura textual da retomada) e o cliente
    // responde negativamente ("não", "não quero", "depois eu vejo", "deixa pra lá",
    // "sem interesse", "agora não", etc), encerramos imediatamente — sem 2ª retomada.
    const NEGATIVA_POS_RETOMADA_RE = /^(n[aã]o( quero| preciso| tenho interesse| obrigad[oa])?|n|nn|sem interesse|depois( eu)? vejo|deixa (pra|para) (depois|l[aá])|fica (pra|para) depois|agora n[aã]o|talvez depois|por enquanto n[aã]o|obrigad[ao],?\s*n[aã]o|n[aã]o, obrigad[oa])\b.*$/i;
    const _recV = (contatoMeta as any)?.recuperacao_vendas || {};
    const _recH = ((atendimento.metadata as Record<string, any>) || {})?.recuperacao_humano || {};
    const _lastTryAt = Math.max(
      _recV?.ultima_tentativa_at ? Date.parse(_recV.ultima_tentativa_at) : 0,
      _recH?.ultima_tentativa_at ? Date.parse(_recH.ultima_tentativa_at) : 0,
    );
    const _retomadaJanelaMs = 48 * 60 * 60 * 1000;
    const _retomadaRecente = _lastTryAt > 0 && (Date.now() - _lastTryAt) < _retomadaJanelaMs;
    const _retomadaTextual = /est[aá]vamos conversando|ficou com alguma d[uú]vida|retomada_contexto|posso te ajudar com mais alguma|continuamos (a |o )?conversa/i.test(lastOutboundTxt);
    const _eligibleRetomada = (_retomadaRecente || _retomadaTextual) && !hasAgendamentoAtivo;
    const isNegativaPosRetomada = _eligibleRetomada && NEGATIVA_POS_RETOMADA_RE.test(msgTrim2);
    if (isNegativaPosRetomada) {
      console.log(`[CLOSE-NEGATIVA-RETOMADA] lastTryAt=${_lastTryAt ? new Date(_lastTryAt).toISOString() : "n/a"} textual=${_retomadaTextual} msg="${msgTrim2.substring(0, 60)}"`);
    }

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

    if (isThanksClose || isShortNoToHelp || isExplicitClose || isNegativaPosRetomada) {
      console.log(`[CLOSE] thanksClose=${isThanksClose} shortNoToHelp=${isShortNoToHelp} explicitClose=${isExplicitClose} negativaPosRetomada=${isNegativaPosRetomada} → DESPEDIDA determinística`);

      // ── DESPEDIDA DETERMINÍSTICA (não passa pelo LLM, evita alucinação de data/loja) ──
      const _firstName = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
      const _commaName = _firstName ? `, ${_firstName}` : "";
      let despedidaMsg: string;
      if (isExplicitClose) {
        const _tail = agendamentoFmt ? ` — te espero ${agendamentoFmt}` : "";
        despedidaMsg = renderMsgFixa("despedida_explicit_close", { nome_comma: _commaName, tail: _tail });
      } else if (isThanksClose) {
        const _tail = agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui";
        despedidaMsg = renderMsgFixa("despedida_thanks", { nome_comma: _commaName, tail: _tail });
      } else if (isNegativaPosRetomada) {
        // Despedida curta, sem oferta de ajuda, para evitar incomodar.
        despedidaMsg = `Tudo bem${_commaName}! Qualquer coisa é só me chamar 👋`;
      } else {
        // isShortNoToHelp
        const _tail = agendamentoFmt ? `Te espero ${agendamentoFmt}` : "Qualquer coisa estou por aqui";
        despedidaMsg = renderMsgFixa("despedida_short_no", { nome_comma: _commaName, tail: _tail });
      }

      // Anti-duplicação: se último outbound já é uma despedida canônica, silencia
      const lastOut = String((recentOutbound || []).slice(-1)[0] || "").toLowerCase();
      const jaDespediu =
        /foi um prazer te atender|qualquer dúvida é só me chamar|qualquer coisa estou por aqui|te espero|te aguardamos|at[eé] j[aá]|at[eé] daqui a pouco|nos vemos/i.test(lastOut)
        && /👋/.test(lastOut);
      if (jaDespediu) {
        console.log("[CLOSE-DEDUP] Despedida canônica já enviada — silenciando reenvio");
        try {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "despedida_duplicada_evitada",
            descricao: "CLOSE-DEDUP: cliente respondeu curto após despedida canônica",
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
            metadata: { last_inbound: msgTrim2.substring(0, 200) },
          });
        } catch { /* ignore */ }
        return jsonResponse({ status: "ok", tools_used: ["close_dedup"], intencao: "despedida", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
      }

      await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, despedidaMsg);
      await supabase.from("eventos_crm").insert({ contato_id: contatoId, tipo: "despedida_deterministica", descricao: `${isExplicitClose ? "explicit" : isThanksClose ? "thanks" : isNegativaPosRetomada ? "negativa_pos_retomada" : "shortNoToHelp"}; agFmt=${agendamentoFmt || "vazio"}`, referencia_tipo: "atendimento", referencia_id: atendimento_id });

      // ── BLOQUEIO DE RETOMADA AUTOMÁTICA ──
      // Cliente pediu para encerrar OU dispensou ajuda após despedida OU recusou retomada.
      // Marca atendimento p/ vendas-recuperacao-cron NÃO disparar retomada_contexto_*.
      // Encerramento explícito e negativa pós-retomada também fecham o atendimento.
      try {
        const _atMd = (atendimento.metadata as Record<string, any>) || {};
        const _motivo = isExplicitClose
          ? "encerramento_explicito"
          : isThanksClose
            ? "agradecimento_pos_agendamento"
            : isNegativaPosRetomada
              ? "negativa_pos_retomada"
              : "dispensou_ajuda";
        const _patchMeta: Record<string, any> = {
          ..._atMd,
          nao_retornar_automaticamente: true,
          encerrado_pelo_cliente_at: new Date().toISOString(),
          encerrado_motivo: _motivo,
        };
        const _update: Record<string, any> = { metadata: _patchMeta, updated_at: new Date().toISOString() };
        if (isExplicitClose || isNegativaPosRetomada) {
          _update.status = "encerrado";
          _update.fim_at = new Date().toISOString();
        }
        await supabase.from("atendimentos").update(_update).eq("id", atendimento_id);

        // Também marca recuperacao_vendas.status = "perdido" no contato p/ cron pular de vez
        if (isNegativaPosRetomada) {
          try {
            const _cm = { ...(contatoMeta as any) };
            _cm.recuperacao_vendas = {
              ...(_cm.recuperacao_vendas || {}),
              status: "perdido",
              encerrado_motivo: "negativa_pos_retomada",
              encerrado_at: new Date().toISOString(),
            };
            await supabase.from("contatos").update({ metadata: _cm }).eq("id", contatoId);
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.warn("[CLOSE] falha ao gravar nao_retornar_automaticamente:", (e as Error)?.message);
      }

      return jsonResponse({ status: "ok", tools_used: ["despedida_deterministica"], intencao: "despedida", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
    }

    // ── SILÊNCIO PÓS-AGENDAMENTO ──
    // Se já há agendamento ativo + último outbound foi despedida canônica
    // + cliente respondeu curto/sem novo intent → não reenvia nada.
    // Só sai desse modo se cliente trouxer novo intent (pergunta, palavra-chave de produto/preço/remarcar, foto, áudio).
    {
      const _lastOut = String((recentOutbound || []).slice(-1)[0] || "").toLowerCase();
      const _despediuJa = (/qualquer dúvida é só me chamar|qualquer coisa estou por aqui|foi um prazer te atender|te espero|te aguardamos|at[eé] j[aá]|at[eé] daqui a pouco|nos vemos/i.test(_lastOut))
        && /👋/.test(_lastOut);
      if (hasAgendamentoAtivo && _despediuJa) {
        const _msgLow = String(currentMsg || "").toLowerCase().trim();
        const _hasQuestion = /\?/.test(_msgLow);
        const NEW_INTENT_RE = /\b(pre[çc]o|valor|or[çc]amento|quanto|remarcar|reagendar|cancelar|mudar|trocar|antecipar|adiar|endere[çc]o|como (chego|chegar|faço)|esperar|vai ter|tem (que|disponível)|estacionament|garagem|metr[ôo]|[ôo]nibus|abre|fecha|funciona|atende|hor[áa]rio|receita|foto|imagem|grau|lente|lentes|lc|contato|multifoc|progress|antirreflex|filtro|transitions|fotossensiv|kodak|essilor|zeiss|hoya|varilux|ray.?ban|oakley|vogue|carolina|infantil|esport)/i;
        const _hasNewIntent = _hasQuestion || NEW_INTENT_RE.test(_msgLow) || isImageContext;
        if (!_hasNewIntent) {
          console.log("[POS-AGENDAMENTO-SILENCIO] Cliente respondeu sem novo intent após despedida — silenciando");
          try {
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "pos_agendamento_silencio",
              descricao: "Silêncio mantido após despedida + agendamento ativo — sem novo intent",
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
              metadata: { last_inbound: _msgLow.substring(0, 200), agendamento_fmt: agendamentoFmt },
            });
          } catch { /* ignore */ }
          return jsonResponse({ status: "ok", tools_used: ["pos_agendamento_silencio"], intencao: "silencio", precisa_humano: false, pipeline_coluna_sugerida: null, modo: atendimento.modo });
        }
        console.log("[POS-AGENDAMENTO-SILENCIO] Cliente trouxe novo intent — seguindo fluxo normal");
      }
    }

    if (isDiaDConfirm || isDiaDReschedule) {
      console.log(`[DIA-D] resposta detectada confirm=${isDiaDConfirm} resched=${isDiaDReschedule} ag=${agDiaD?.id}`);
    }


    // ── Classificador LLM de intenção (leve, antes do array de messages) ──
    const _t_intent = Date.now();
    const recentHistoryForIntent = (contextWindow || [])
      .slice(-3)
      .map((m: any) => String(m?.conteudo || ""));
    let detectedIntent = await classifyIntent(currentMsg, recentHistoryForIntent);
    if (!detectedIntent || detectedIntent.confidence < 0.7) {
      const fb = deterministicIntentFallback(
        currentMsg,
        inboundCount,
        isHibrido,
        recentOutbound,
        isImageContext,
        receitas.length > 0,
        isLCContextGlobal,
      );
      detectedIntent = {
        intent: fb.intencao || "outro",
        confidence: detectedIntent?.confidence ?? 0,
        subtype: null,
      };
      console.log(`[CLASSIFY-INTENT] fallback=${detectedIntent.intent} (LLM conf=${(detectedIntent.confidence ?? 0).toFixed(2)}) total=${Date.now() - _t_intent}ms`);
    } else {
      console.log(`[CLASSIFY-INTENT] llm=${detectedIntent.intent} conf=${detectedIntent.confidence.toFixed(2)} sub=${detectedIntent.subtype ?? "—"} total=${Date.now() - _t_intent}ms`);
    }

    const intentBlock = `INTENÇÃO DETECTADA: ${detectedIntent.intent} (confiança: ${detectedIntent.confidence.toFixed(2)}). Trate esta conversa exclusivamente sob essa ótica até nova mensagem do cliente.`;
    const systemPromptWithIntent = `${intentBlock}\n\n${systemPrompt}`;

    // C1: detecta receita digitada ANTES de montar messages — resultado usado em dois lugares:
    // (a) suprime "PRIORIDADE MÁXIMA" quando o texto atual já foi parseado pelo parser (C1b),
    // (b) reutilizado na seção 6.4 para evitar segunda chamada ao parser (C1c).
    const _earlyRxDetected = !lastIsImage ? detectPrescriptionCorrection(lastInboundText) : null;

    const messages: any[] = [
      { role: "system", content: systemPromptWithIntent },
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
      ...(hasRecentUnparsedPrescriptionImage && !hasValidReceitas && !isConsultaOsActive && !_earlyRxDetected
        ? [{
            role: "system",
            content: "[SISTEMA: PRIORIDADE MÁXIMA — RECEITA PENDENTE] O cliente enviou uma imagem (provável receita) nas últimas mensagens e ela AINDA NÃO foi interpretada com sucesso (RECEITAS JÁ INTERPRETADAS está vazio ou inválido). REGRAS: 1) Você DEVE chamar a tool interpretar_receita usando a imagem mais recente entregue no histórico, ANTES de qualquer outra ação (não escale, não peça reenvio, não responda genericamente). 2) Se a imagem foi entregue ao modelo, use-a — mesmo que a última mensagem do cliente seja curta ('ok', 'então?', 'cadê'). 3) Só peça reenvio se o sistema avisar explicitamente que a imagem NÃO foi entregue. 4) Só escale para humano se a imagem estiver claramente ilegível APÓS a tentativa de interpretação.]",
          }]
        : []),
      ...(hasPendingNewPrescriptionImage && !isConsultaOsActive
        ? [{
            role: "system",
            content: "[SISTEMA: NOVA RECEITA PENDENTE] O cliente declarou ter NOVA RECEITA e enviou uma imagem mais recente que a última receita salva. AÇÃO OBRIGATÓRIA: chame interpretar_receita AGORA com a imagem mais recente do histórico — NÃO use consultar_lentes/consultar_lentes_contato com a receita antiga (ela está desatualizada). Após interpretar, peça confirmação dos novos valores ao cliente antes de cotar. Se a imagem estiver ilegível APÓS a tentativa de OCR, peça reenvio uma única vez.",
          }]
        : []),
      // B2.2: só dispara quando há receita da SESSÃO ATUAL — receitas não-confirmadas de
      // sessões anteriores não causam mais reapresentação automática no "olá".
      // B1-FIX: suprime quando cotação já foi enviada (_cotacaoJaFoiEnviada) para que
      // dúvidas pós-cotação (ex: "Balansis hoya") não re-disparem pedir confirmação.
      ...(hasReceitasAtivasCtx && !hasPendingNewPrescriptionImage && !_cotacaoJaFoiEnviada
        ? [{
            role: "system",
            content: isLCContextGlobal
              ? "[SISTEMA: FLUXO PÓS-RECEITA OBRIGATÓRIO — LENTES DE CONTATO] Já existe receita interpretada e o contexto é LENTES DE CONTATO. PROIBIDO responder com 'posso seguir por dois caminhos?', 'quer opções ou orçamento?' ou pedir confirmação genérica. PROIBIDO escalar para humano nesse cenário. AÇÃO OBRIGATÓRIA: 1) chame consultar_lentes_contato AGORA com os valores da receita mais recente (NÃO consultar_lentes — esse é para óculos), 2) apresente 2-3 opções com descartes VARIADOS (mín. 2 categorias entre diária + quinzenal + mensal) na MESMA resposta, priorizando DNZ quando compatível, 3) se cliente mencionou esporte/academia/corrida/futebol/natação, recomende a DIÁRIA como mais indicada (frase curta, consultiva) MAS sem omitir quinzenal/mensal — o cliente decide, 4) finalize perguntando a região/bairro pra indicar a loja mais próxima e sugerir agendamento. NUNCA encerre pedindo só marca/tipo se já há receita."
              : "[SISTEMA: FLUXO PÓS-RECEITA OBRIGATÓRIO] Já existe receita interpretada (ver RECEITAS JÁ INTERPRETADAS). PROIBIDO responder com 'posso te mostrar uma base?', 'quer que eu mostre opções?' ou qualquer pedido de confirmação genérica. PROIBIDO escalar para humano com frases como 'vou encaminhar para um Consultor', 'para esse grau específico vou passar para alguém da equipe', 'um Consultor pode detalhar melhor' — receita com esférico até ±10 e cilíndrico até ±4 é trivial e tem orçamento automático. Escalar SÓ se: (a) consultar_lentes retornou ZERO opções, (b) cliente pediu humano explicitamente, ou (c) reclamação grave. AÇÃO OBRIGATÓRIA: 1) chame consultar_lentes AGORA com os valores da receita mais recente, 2) apresente 2-3 opções de orçamento (DNZ entrada / DMAX custo-benefício / HOYA premium) com os valores retornados, 3) pergunte a região/bairro do cliente (se ainda não perguntou), 4) sugira agendamento na loja mais próxima. Confirmação dos valores SÓ se a receita estiver marcada com confiança baixa — neste caso mostre 'OD X,XX / OE Y,YY, confere?' explicitamente. NUNCA repita a mesma pergunta de confirmação 2× — isso configura loop e será escalado.",
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
      // ── MODO CONSULTIVO — DÚVIDA PÓS-COTAÇÃO ──
      // Injeta quando o cliente está tirando dúvida sobre produto (não pedindo nova cotação).
      // isDetalhamentoContext já cobre pedidos explícitos de comparativo — esse bloco cobre
      // perguntas de produto mais abertas ("Tem varilux?", "O que tem de especial?", etc.)
      // que não bateram no detector de detalhamento mas estão em contexto de dúvida.
      ...(isDuvidaPosOrcamento && !isDetalhamentoContext
        ? [{
            role: "system",
            content: `[MODO CONSULTIVO — DÚVIDA PÓS-COTAÇÃO] O cliente está tirando dúvida sobre produto/lentes. NÃO repita o orçamento. NÃO chame consultar_lentes de novo. NÃO force agendamento nesta resposta.

RESPONDA A DÚVIDA com base no conhecimento abaixo. Use a tool responder.

CONHECIMENTO DAS MARCAS:
- DNZ (HDI / DMAX): linha própria Diniz, custo-benefício, antirreflexo AR Verde/Azul, fabricação nacional.
- ESSILOR: francesa, líder global. Varilux = referência em progressivos (multifocais). Eyezen/Eyezen Boost = redução de fadiga digital (zonas de relaxamento pra tela). Crizal Prevencia = antirreflexo + filtro de luz azul nociva + UV. Crizal Sapphire HR = antirreflexo premium, máxima transparência.
- ZEISS: alemã, engenharia de precisão. SmartLife Individual = personalizada ao rosto/armação, visão periférica perfeita. DuraVision Platinum UV = antirreflexo super resistente + proteção UV total. BlueGuard = filtro de luz azul INTEGRADO ao material da lente (não é camada superficial — toda a lente protege).
- HOYA: japonesa, premium. Hi-Vision LongLife = antirreflexo durável. iD MyStyle = multifocais sob medida.
- KODAK: intermediário-premium acessível, tratamentos CleAR.

CAMPOS COM EVIDÊNCIA REAL (PODE afirmar com segurança):
- Índice numérico (ex: 1.74): quanto maior o índice, mais fina e leve a lente para o mesmo grau.
- blue=true na lente cotada: PODE dizer "tem filtro de luz azul".
- photo=true na lente cotada: PODE dizer "é fotossensível (escurece com a luz solar)".
- treatment (ex: "Crizal Prevencia", "BlueGuard"): PODE explicar conforme o conhecimento acima.

NÃO INVENTE: NÃO diga "reduz fadiga visual" sem que seja Eyezen/linha digital. NÃO diga "mais confortável que X". NÃO prometa características que não estão nos campos acima.

APÓS RESPONDER: ofereça UMA opção natural de próximo passo — agendar visita OU comparar com outra opção. ${agendamentoFmt ? `Cliente JÁ TEM AGENDAMENTO (${agendamentoFmt}) — NÃO reoferte agendamento, encerre com "Te espero ${agendamentoFmt} 👋".` : "Sem forçar — se o cliente quiser fechar, ótimo; se quiser mais dúvidas, responda."}`,
          }]
        : []),
      ...((isShortNo || isShortNoToHelp || isThanksClose || isExplicitClose)
        ? [{
            role: "system",
            content: isExplicitClose
              ? `[FLUXO ENCERRAMENTO EXPLÍCITO] O cliente PEDIU para encerrar o atendimento. Despeça-se de forma calorosa, AGRADEÇA o contato e NÃO faça nenhuma pergunta. Use EXATAMENTE: "Foi um prazer te atender${contatoNomeAtual ? ", " + contatoNomeAtual.split(" ")[0] : ""}! 🙏 Obrigado pelo contato${agendamentoFmt ? ` — te espero ${agendamentoFmt}` : ""}. Qualquer coisa, é só me chamar 👋". Use a tool responder com proximo_passo vazio.`
              : (isShortNoToHelp || isThanksClose)
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
      } else if (tipo === "document" && (m.metadata as any)?.mime_type === "application/pdf" && role === "user") {
        // ── PDF de receita: entrega ao GPT-5 via content type "file" ──
        // O inlineBase64 do webhook é null para PDFs — sempre baixamos do media_url do bucket.
        // Limite do Lovable gateway: 10 MB. Acima disso, pedimos foto em vez do PDF.
        const pdfCaption = m.conteudo && m.conteudo !== "[document]"
          ? m.conteudo
          : "[Cliente enviou um PDF — provável receita]";

        let pdfContent: any | null = null;
        try {
          if (mediaUrl) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            try {
              const pdfResp = await fetch(mediaUrl, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (pdfResp.ok) {
                const pdfBuffer = await pdfResp.arrayBuffer();
                const pdfBytes = new Uint8Array(pdfBuffer);
                const PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — limite do gateway Lovable
                if (pdfBytes.length > PDF_MAX_BYTES) {
                  console.warn(`[MEDIA-PDF] PDF muito grande (${(pdfBytes.length / 1024 / 1024).toFixed(1)}MB > 10MB) — pedindo foto`);
                  // pdfContent permanece null → fallback abaixo instrui o LLM a pedir foto
                } else {
                  let binary = "";
                  const chunkSize = 8192;
                  for (let j = 0; j < pdfBytes.length; j += chunkSize) {
                    binary += String.fromCharCode(...pdfBytes.subarray(j, j + chunkSize));
                  }
                  const fname = String(m.conteudo || "receita.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "receita.pdf";
                  pdfContent = pdfContentFromBase64(btoa(binary), fname.endsWith(".pdf") ? fname : "receita.pdf");
                  if (pdfContent) console.log(`[MEDIA-PDF] PDF entregue (${(pdfBytes.length / 1024).toFixed(0)}KB, ctx index ${i})`);
                }
              } else {
                console.warn(`[MEDIA-PDF] media_url retornou ${pdfResp.status}`);
              }
            } catch (dlErr) {
              console.warn(`[MEDIA-PDF] Falha no download do PDF:`, dlErr);
            }
          }
        } catch (e) {
          console.warn(`[MEDIA-PDF] Erro ao preparar PDF para IA:`, e);
        }

        if (pdfContent) {
          const content: any[] = [pdfContent];
          if (m.conteudo && m.conteudo !== "[document]") content.push({ type: "text", text: m.conteudo });
          messages.push({ role, content });
        } else {
          messages.push({ role, content: pdfCaption });
          messages.push({
            role: "system",
            content: "[SISTEMA: ⚠️ O cliente enviou um PDF de receita mas não foi possível carregá-lo (arquivo muito grande ou erro de download). Peça ao cliente que tire uma FOTO da receita com o celular e envie como imagem (JPEG/PNG) — é mais fácil de ler do que PDF. NÃO chame interpretar_receita sem ter a imagem. Se ele insistir que já enviou, explique que o formato PDF às vezes tem problema técnico e peça a foto.]",
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

    // ── 6.4. PRESCRIPTION TEXT DETECTOR (first-typed OR correction) ──
    // Aceita receita digitada como PRIMEIRA leitura quando a IA acabou de pedir
    // os valores por texto (OCR falhou) OU como CORREÇÃO quando já existe receita.
    // Caso Bianca (28/04): "Od -4.50 / Oe -pl" foi ignorado porque não havia
    // receita prévia salva. Agora basta a IA ter pedido (MSG_PEDIR_RECEITA_TEXTO)
    // nas últimas 2 outbound para que o parser entre em modo "first".
    let correctionApplied = false;
    let correctionIsFirst = false;

    // ── DETECÇÃO DE VISÃO MONOCULAR ──
    // Cliente declara "olho direito sem visão" / "tenho visão monocular" / "só enxergo do OE".
    // Marca a receita corrente como monocular (price/2 nas cotações; olho cego = { blind: true })
    // e responde com a confirmação determinística antes de ir pro LLM.
    try {
      const mono = detectMonocular(lastInboundText);
      if (mono?.signal) {
        const alreadyMono = !!contatoMeta?.receita_monocular || (receitas.length > 0 && receitas[receitas.length - 1]?.monocular === true);
        if (mono.blind_eye) {
          const eyeUsed = mono.blind_eye === "od" ? "oe" : "od";
          // Atualiza receita pendente (ou cria uma vazia se nada existir ainda).
          let idx = receitas.length - 1;
          if (idx < 0) {
            receitas.push({ eyes: { od: {}, oe: {} }, rx_type: "unknown", confidence: 0.5, data_leitura: new Date().toISOString(), source: "monocular_declared", label: "monocular" });
            idx = 0;
          }
          const rxMono = receitas[idx] || { eyes: { od: {}, oe: {} } };
          rxMono.eyes = rxMono.eyes || { od: {}, oe: {} };
          rxMono.eyes[mono.blind_eye] = { blind: true };
          rxMono.eyes[eyeUsed] = rxMono.eyes[eyeUsed] || {};
          rxMono.monocular = true;
          rxMono.eye_used = eyeUsed;
          rxMono.confirmed_by_client_at = null;
          receitas[idx] = rxMono;

          const newMeta: any = {
            ...contatoMeta,
            receitas,
            receita_monocular: { eye_used: eyeUsed, blind_eye: mono.blind_eye, set_at: new Date().toISOString(), source: "client_typed" },
            receita_confirmacao: {
              pending: true,
              rx_index: idx,
              rx_label: rxMono.label || `receita_${idx + 1}`,
              asked_at: new Date().toISOString(),
              reason: "monocular_confirm",
            },
          };
          await supabase.from("contatos").update({ metadata: newMeta }).eq("id", contatoId);
          contatoMeta = newMeta;

          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_monocular_detectada",
            descricao: `Cliente declarou visão monocular — olho cego: ${mono.blind_eye.toUpperCase()}, olho ativo: ${eyeUsed.toUpperCase()}`,
            metadata: { blind_eye: mono.blind_eye, eye_used: eyeUsed, raw: lastInboundText.slice(0, 200), already_mono: alreadyMono },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });

          // Anti-loop: se as últimas 2 outbounds já são a mesma confirmação, não reenvia.
          const confMsg = buildMsgConfirmarReceita(rxMono, false);
          const recentNorm = (recentOutbound || []).slice(-2).map(norm);
          const jaPediu = recentNorm.some((p) => p && p.includes(norm("visão monocular (sem lente)")) && p.includes(norm("Está certinho?")));
          if (!jaPediu) {
            await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, confMsg);
          }
          return jsonResponse({ status: "ok", tools_used: ["receita_monocular_confirmar"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
        } else if (!alreadyMono) {
          // Ambíguo — pergunta UMA vez qual olho tem visão.
          const askMsg = "Entendi! Pra te passar o orçamento certinho, qual olho você usa pra enxergar — *direito (OD)* ou *esquerdo (OE)*?";
          const recentNorm = (recentOutbound || []).slice(-3).map(norm);
          const jaPerguntou = recentNorm.some((p) => p && p.includes(norm("qual olho você usa")));
          if (!jaPerguntou) {
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, askMsg);
            return jsonResponse({ status: "ok", tools_used: ["receita_monocular_pergunta_lado"], intencao: "receita_oftalmologica", precisa_humano: false, modo: atendimento.modo });
          }
        }
      }
    } catch (e) {
      console.warn("[MONOCULAR] detection failed", e);
    }

    const correction = _earlyRxDetected; // C1c: resultado computado antes de messages (evita dupla chamada)
    if (correction) {
      const iaJustAskedForText = (recentOutbound || []).slice(-2).some((o: any) =>
        typeof o === "string" && /tô tendo dificuldade de ler|me passar por texto|esférico\s*\/\s*cil[ií]ndrico|preciso de:\s*•\s*\*od\*|beleza! me passa por texto/i.test(o)
      );
      const clienteAcabouDeEscolherDigitacao = (inboundMsgs || []).slice(-3).some((m: any) => {
        const txt = String(m?.conteudo || "");
        const tipo = String(m?.tipo_conteudo || "");
        return tipo === "interactive_reply" && /⌨️\s*Digitar valores|✏️\s*Corrigir/i.test(txt);
      });
      // Quando o cliente clicou em "⌨️ Digitar valores" / "✏️ Corrigir", o atendimento
      // fica com expected_reply = "receita_digitada". Nesse caso a digitação é uma
      // RECEITA NOVA standalone — NÃO deve herdar cilindro/eixo/add de uma receita
      // antiga salva no contato (causava hallucination: cliente digita só esférico
      // e IA confirma com CIL/EIXO/ADD herdados — caso Natan 20/05).
      const aguardandoDigitada = atendimentoMeta?.expected_reply === "receita_digitada";
      const treatAsFreshRx = iaJustAskedForText || aguardandoDigitada || clienteAcabouDeEscolherDigitacao;
      const isFirst = receitas.length === 0;
      // Strong signal: pelo menos UM olho com esfera definida E rótulo explícito de olho
      // (OD/OE/OS) no texto — evita padrões isolados como "-2.50" sem contexto, mas aceita
      // receita de um olho só (é vendável e comum). Princípio: aceitar a possibilidade e
      // SEMPRE confirmar com o cliente (confirmed_by_client_at=null + gate de confirmação
      // pós-LLM bloqueia cotação). Nunca decidir/cotar sem o "Sim, confere".
      // Casos: Natan (15/05) receita completa OD+OE; visão monocular (1 olho só).
      const hasEyeLabel = /\b(od|oe|os)\b/i.test(lastInboundText);
      const hasStrongRxSignal = !!correction
        && hasEyeLabel
        && (correction.od?.sphere != null || correction.oe?.sphere != null);
      if (isFirst && !iaJustAskedForText && !hasStrongRxSignal) {
        // Cliente mandou padrão de receita do nada — ignora pra evitar falso positivo.
        console.log(`[RX-FIRST-TYPED] Skipped: no prior request from IA and no strong signal`);
      } else {
        if (isFirst && !iaJustAskedForText && hasStrongRxSignal) {
          console.log(`[RX-FIRST-TYPED] Accepted via strong signal (rótulo OD/OE + esfera em ≥1 olho)`);
        }
        // treatAsFreshRx ⇒ receita standalone (não herda nada de receitas antigas).
        // Caso contrário ⇒ correção da última receita (mantém merge para corrigir
        // só campos enviados, ex.: cliente diz "OD na verdade é -2,25" e mantém OE).
        const useFreshSlot = treatAsFreshRx || isFirst;
        const isStandaloneTyped = useFreshSlot;
        const idx = useFreshSlot ? receitas.length : receitas.length - 1;
        const old: any = useFreshSlot ? {} : (receitas[idx] || {});
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
          source: isStandaloneTyped ? "client_typed_first" : "client_correction",
          raw_correction: correction.raw,
          needs_human_review: false,
          label: old.label || (isStandaloneTyped ? "digitada pelo cliente" : undefined),
        };
        // ── Detecta correção de ALTO IMPACTO ──
        // Só faz sentido em MODO CORREÇÃO (useFreshSlot=false) — receita standalone
        // não tem "anterior" para comparar. isHighImpact usa maxNewAbs>10 para logging;
        // fora_da_faixa usa isReceitaForaDaFaixa (>16D) — C3, alinhado com regra de negócio.
        const oldOdSph = (!useFreshSlot && typeof old?.eyes?.od?.sphere === "number") ? old.eyes.od.sphere : null;
        const oldOeSph = (!useFreshSlot && typeof old?.eyes?.oe?.sphere === "number") ? old.eyes.oe.sphere : null;
        const newOdSph = typeof correction.od?.sphere === "number" ? correction.od.sphere : null;
        const newOeSph = typeof correction.oe?.sphere === "number" ? correction.oe.sphere : null;
        const deltaOd = (oldOdSph != null && newOdSph != null) ? Math.abs(newOdSph - oldOdSph) : 0;
        const deltaOe = (oldOeSph != null && newOeSph != null) ? Math.abs(newOeSph - oldOeSph) : 0;
        const maxNewAbs = Math.max(Math.abs(newOdSph ?? 0), Math.abs(newOeSph ?? 0));
        const isHighImpact = (!useFreshSlot && (deltaOd >= 0.75 || deltaOe >= 0.75)) || maxNewAbs > 10;

        // Marca a receita recém-gravada como NÃO confirmada pelo cliente
        merged.confirmed_by_client_at = null;
        // B2.1: receita nova supersede todas as anteriores não-confirmadas — evitam acúmulo
        // e contaminação de contexto em conversas futuras. Só no modo FRESH (nova receita);
        // modo CORREÇÃO atualiza o slot existente, não precisa superseder nada.
        if (useFreshSlot) {
          const _supAt = new Date().toISOString();
          for (let i = 0; i < receitas.length; i++) {
            if (!receitas[i].confirmed_by_client_at && !receitas[i].superseded_at) {
              receitas[i] = { ...receitas[i], superseded_at: _supAt, superseded_by: "nova_receita_digitada" };
            }
          }
        }
        if (useFreshSlot) receitas.push(merged); else receitas[idx] = merged;


        const newMeta: any = { ...contatoMeta, receitas };
        // B1: fresh mode também define pending=true (habilita o return determinístico abaixo).
        // Antes limpava o pending anterior — substituído: a nova receita cria o próprio pending.
        if (isStandaloneTyped) {
          const _freshIdx = receitas.length - 1;
          newMeta.receita_confirmacao = {
            pending: true,
            rx_index: _freshIdx,
            rx_label: merged.label || `receita_${_freshIdx + 1}`,
            asked_at: new Date().toISOString(),
            correction_count: 0,
            reason: "receita_digitada_fresca",
            fora_da_faixa: isReceitaForaDaFaixa(merged),
          };
        }
        // ── Toda correção textual (qualquer magnitude) marca receita como pendente de confirmação ──
        // Antes só o ramo isHighImpact fazia isso; correções iguais/pequenas caíam no LLM,
        // que frequentemente respondia fallback genérico (caso Eduardo, mai/2026).
        if (!isStandaloneTyped) {
          newMeta.receita_confirmacao = {
            pending: true,
            rx_index: idx,
            rx_label: merged.label || `receita_${idx + 1}`,
            asked_at: new Date().toISOString(),
            correction_count: Number(contatoMeta?.receita_confirmacao?.correction_count || 0) + 1,
            reason: isHighImpact ? "high_impact_correction" : "low_impact_correction",
            fora_da_faixa: isReceitaForaDaFaixa(merged), // C3: alinhado com regra de negócio (>16D)
          };
        }

        await supabase.from("contatos").update({ metadata: newMeta }).eq("id", contatoId);
        contatoMeta = newMeta;

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: isHighImpact
            ? "receita_corrigida_alto_impacto"
            : (isStandaloneTyped ? "receita_digitada_pelo_cliente" : "receita_corrigida_pelo_cliente"),
          descricao: `Cliente ${isStandaloneTyped ? "digitou" : "corrigiu"} receita por texto. Tipo: ${correction.rx_type}${isHighImpact ? ` [ALTO IMPACTO Δ=${Math.max(deltaOd,deltaOe).toFixed(2)} max=${maxNewAbs}]` : ""}`,
          metadata: { od: correction.od, oe: correction.oe, rx_type: correction.rx_type, raw: correction.raw, mode: isStandaloneTyped ? "first" : "correction", high_impact: isHighImpact, delta_od: deltaOd, delta_oe: deltaOe, max_abs: maxNewAbs, confirmacao_enviada: !isStandaloneTyped },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

        // ── Toda correção textual: envia pedido de confirmação determinístico e RETORNA antes do LLM ──
        // Mesmo quando os valores digitados forem idênticos à última leitura, reenviamos a
        // mensagem com os valores (merge) para o cliente confirmar antes de cotar.
        if (!isStandaloneTyped) {
          // Após 3+ correções textuais em sequência sem confirmação, IA admite
          // dificuldade e escala — evita loop "Anotei! / Não / corrige de novo".
          const corrCount = Number(newMeta?.receita_confirmacao?.correction_count || 0);
          // Fatia 2: 3+ correções textuais → loja (medição presencial) em vez de humano.
          // pending=false encerra o impasse de receita — anti-loop crítico.
          if (corrCount >= 3) {
            try {
              const limpoMeta = {
                ...newMeta,
                receita_confirmacao: {
                  ...newMeta.receita_confirmacao,
                  pending: false,
                  redirecionado_loja_at: new Date().toISOString(),
                },
              };
              await supabase.from("contatos").update({ metadata: limpoMeta }).eq("id", contatoId);
              contatoMeta = limpoMeta;
            } catch (_) { /* noop */ }
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "receita_redirecionada_loja_correcao",
              descricao: `Cliente fez ${corrCount} correções textuais consecutivas — redirecionado para agendamento na loja`,
              metadata: { rx_label: merged.label, correction_count: corrCount, last_rx: merged, via: "correcao_textual" },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            });
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, MSG_PONTE_RECEITA_LOJA);
            await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
            console.log(`[RX-CORRECTION] ${corrCount} correções textuais — redirecionado para loja`);
            return jsonResponse({ status: "ok", tools_used: ["receita_redireciona_loja_correcao"], intencao: "agendamento", precisa_humano: false, pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo });
          }

          await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, buildMsgConfirmarReceita(merged, true));
          try {
            const m = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
            delete m.ia_lock;
            await supabase.from("atendimentos").update({ metadata: m }).eq("id", atendimento_id);
          } catch (_) { /* noop */ }
          const _tag = isHighImpact ? "RX-HIGH-IMPACT" : "RX-CORRECTION";
          console.log(`[${_tag}] Pedindo confirmação antes de cotar (Δod=${deltaOd}, Δoe=${deltaOe}, maxAbs=${maxNewAbs}, corrCount=${corrCount}, highImpact=${isHighImpact})`);
          return jsonResponse({ status: "ok", tools_used: [isHighImpact ? "receita_alto_impacto_confirmar" : "receita_corrigida_confirmar"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
        }

        // B1: modo FRESH é determinístico — espelha modo CORREÇÃO, sem LLM.
        // "Li sua receita assim, confere?" com os valores que o parser leu (não os anteriores).
        if (isStandaloneTyped) {
          await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, buildMsgConfirmarReceita(merged, false));
          try {
            const m = ((await supabase.from("atendimentos").select("metadata").eq("id", atendimento_id).single()).data?.metadata as Record<string, any>) || {};
            delete m.ia_lock;
            await supabase.from("atendimentos").update({ metadata: m }).eq("id", atendimento_id);
          } catch (_) { /* noop */ }
          console.log(`[RX-FIRST-TYPED] Determinístico — confirmação enviada sem LLM (OD=${correction.od.sphere}, OE=${correction.oe.sphere})`);
          return jsonResponse({ status: "ok", tools_used: ["receita_digitada_confirmar"], intencao: "receita_oftalmologica", precisa_humano: false, pipeline_coluna_sugerida: "Orçamento", modo: atendimento.modo });
        }

        // Dead code: ambos os ramos acima retornam. Mantido para compilação segura.
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
          const sourceTag = rx.source === "client_correction"
            ? " ⚠️ CORRIGIDA PELO CLIENTE"
            : rx.source === "client_typed_first" ? " ✍️ DIGITADA PELO CLIENTE" : "";
          receitaCtx += `\n## Receita ${i + 1} (${label}) — lida em ${dataLeitura}${sourceTag}\n`;
          receitaCtx += `Tipo: ${rxTypeLabel} | Confiança: ${conf}\n`;
          receitaCtx += `${formatEye(od, "OD")}\n`;
          receitaCtx += `${formatEye(oe, "OE")}\n`;
        }
        receitaCtx += isFirst
          ? `\n⚠️ Esta receita foi DIGITADA pelo cliente AGORA. NÃO peça de novo. Use estes valores e siga DIRETO para consultar_lentes.`
          : `\n⚠️ A última receita foi CORRIGIDA pelo cliente nesta mensagem. Use estes valores como verdade — NÃO mencione os valores antigos.`;

        correctionApplied = true;
        correctionIsFirst = isStandaloneTyped;
        // Atualiza flag para que forcedIntent (calculado logo abaixo) use o estado correto
        // e não force pedido de foto mesmo com receita recém-salva.
        if (isStandaloneTyped) hasValidReceitas = true;
        console.log(`[RX-${isStandaloneTyped ? "FIRST-TYPED" : "CORRECTION"}] rx_type=${correction.rx_type}, OD.sph=${correction.od.sphere}, OE.sph=${correction.oe.sphere}`);
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

    const lastOutboundForIntent = (recentOutbound || []).slice(-1)[0] || "";
    const _forcedIntentRaw = detectForcedToolIntent(
      lastInboundText,
      hasValidReceitas,
      hasRecentUnparsedPrescriptionImage && !hasValidReceitas,
      isLCContextGlobal,
      hasLCQuotePresented,
      lastOutboundForIntent,
      recentInboundText,
    );
    // Modo consultivo: suprime brand_refinement→consultar_lentes quando o cliente está
    // em dúvida pós-cotação. "Tem varilux?" é pergunta de produto, não pedido de re-cotação.
    // Outras razões de forcedIntent (região, store_visit, agendar, etc.) são preservadas.
    const forcedIntent = (isDuvidaPosOrcamento
      && _forcedIntentRaw?.tool === "consultar_lentes"
      && typeof _forcedIntentRaw?.reason === "string"
      && _forcedIntentRaw.reason.startsWith("brand_refinement:"))
      ? (console.log(`[DUVIDA-CONSULTIVA] Suprimindo brand_refinement em modo consultivo — "${lastInboundText.slice(0, 60)}"`), null)
      : _forcedIntentRaw;

    // ── REFERÊNCIA A OPÇÃO DO ORÇAMENTO ANTERIOR ──
    // Caso Paulo Henrique 2026-04-27 16:49: cliente disse "Quero orçamento da 1 e 2 por favor"
    // referenciando opções do orçamento que o operador já enviou. IA não tinha esse contexto
    // como intent → caiu no fallback "vou encaminhar para Consultor". Detecta a referência
    // explícita a número de opção e injeta hint pra IA recapitular SEM rodar consultar_lentes
    // de novo (que poderia trazer opções diferentes).
    const referenciaOpcao = /\b(op[cç][aã]o\s*\d+|n[uú]mero\s*\d+|da\s*\d+(\s*[ee]\s*\d+)?\s+(por favor|pf|pfv)?|a\s+\d+(\s*[ee]\s*\d+)?\b)\b/i;
    const ultimoOutboundComOrcamento = (recentOutbound || []).slice(-3).some((m: string) =>
      typeof m === "string" && /R\$\s*[\d.,]+/i.test(m) && /\b(1\.|2\.|3\.|💚|💛|💎|opç|DNZ|DMAX|HOYA|ESSILOR|ZEISS)/i.test(m)
    );
    // Quando essa detecção dispara, FORÇAMOS tool_choice=responder no gateway.
    // Hint sozinho já se mostrou insuficiente (caso Paulo Henrique 16:49-16:52, IA
    // ignorou e rodou consultar_lentes de novo trazendo Eyezen/ZEISS R$1985-2190
    // em vez de recapitular DNZ/DMAX/HOYA do orçamento humano anterior).
    let forceResponderTool = false;
    let forceConsultarLentesTool = false; // Fase 3: forçar tool_choice quando região responde orçamento prometido
    if (referenciaOpcao.test(lastInboundText) && ultimoOutboundComOrcamento) {
      messages.push({
        role: "system",
        content: "[SISTEMA: REFERÊNCIA A OPÇÃO DO ORÇAMENTO ANTERIOR] O cliente está pedindo detalhes ou confirmação de opções específicas (ex: 'da 1 e 2', 'a opção 2') referenciando um orçamento que JÁ foi enviado nas últimas mensagens (procure por R$ e nomes de marcas como DNZ/DMAX/HOYA/ESSILOR no histórico outbound recente). AÇÃO OBRIGATÓRIA: use a tool *responder* (NÃO consultar_lentes — você está bloqueado de chamar consultar_lentes nesse turno). Recapitule SOMENTE as opções que ele pediu, com nome e valor exatos do que foi enviado antes (NÃO invente novos valores). Pergunte se quer agendar pra ver na loja. PROIBIDO escalar para humano. PROIBIDO ignorar a referência."
      });
      forceResponderTool = true;
      console.log(`[REFERENCIA-OPCAO] Cliente referenciou opção do orçamento anterior — forçando tool_choice=responder`);
    }

    // ── 6.5.b. (removido) — LC não escala mais compulsoriamente para humano.
    // Política nova: catálogo de LC está no banco, IA orça e direciona à loja
    // como qualquer outro pedido. Humano só entra se houver objeção real
    // (sem produto compatível, reclamação, pedido explícito de humano).


    // If a correction was applied, force consultar_lentes regardless of loop state
    if (correctionApplied) {
      messages.push({
        role: "system",
        content: correctionIsFirst
          ? "[SISTEMA: RECEITA DIGITADA PELO CLIENTE] O cliente digitou os valores da receita em texto. Os valores estão na seção RECEITAS (marcada como ⚠️ DIGITADA PELO CLIENTE). AÇÃO OBRIGATÓRIA: 1) confirme os valores brevemente (ex: 'Perfeito, anotei!'); 2) chame consultar_lentes AGORA. NÃO peça foto da receita. NÃO peça confirmação adicional — confie no que ele digitou."
          : "[SISTEMA: RECEITA CORRIGIDA PELO CLIENTE] O cliente acabou de corrigir os valores da receita por texto. Os novos valores estão na seção RECEITAS (marcada como ⚠️ CORRIGIDA PELO CLIENTE). AÇÃO OBRIGATÓRIA: 1) reconheça brevemente a correção (ex: 'Perfeito, anotado!'); 2) chame consultar_lentes AGORA com os valores novos para refazer o orçamento. NÃO repita valores antigos. NÃO peça nova foto. NÃO peça confirmação adicional — confie no que ele digitou.",
      });
      console.log(`[RX-${correctionIsFirst ? "FIRST-TYPED" : "CORRECTION"}] Forcing consultar_lentes`);
    }

    // ── REGRA ANTI-ALUCINAÇÃO DE DATA + TOOL OBRIGATÓRIA (universal) ──
    messages.push({
      role: "system",
      content: `[REGRAS ESTRITAS DE AGENDAMENTO]
1) PROIBIDO citar data/dia da semana/horário/loja de agendamento que NÃO esteja na seção AGENDAMENTOS DESTE CLIENTE acima${agendamentoFmt ? ` (única fonte da verdade: "${agendamentoFmt}")` : " (seção VAZIA — não invente nenhuma data/loja; faça despedida sem data se for o caso)"}.
2) Se for confirmar/marcar/reagendar uma visita (data + hora + loja), você DEVE chamar a tool agendar_visita ou reagendar_visita ANTES de prometer ao cliente — mesmo que pareça redundante. Nunca prometa data/hora sem persistir via tool.
3) PROIBIDO reescrever uma data já confirmada com outra "lembrada" do histórico. Use SEMPRE a data da seção AGENDAMENTOS DESTE CLIENTE.
4) Após a despedida ("Te espero…", "Combinado…", "Foi um prazer…"), NÃO emende novas perguntas (estilo, cor, material, plaquetas, filtro azul, transitions, etc.). A conversa está encerrada.`,
    });

    // ── HINT ANTI-DUPLICAÇÃO: agendamento ativo + sem pedido explícito de mudança ──
    {
      const lastInLow = String(lastInbound?.conteudo || currentMsg || "").toLowerCase();
      const explicitChange = /\b(remarcar|reagendar|mudar (a |o )?(hor[aá]rio|dia|data|loja)|trocar (a |o )?(hor[aá]rio|dia|data|loja)|cancelar|desmarcar|outro hor[aá]rio|outro dia|outra loja|antecipar|adiar)\b/.test(lastInLow);
      // Detecta intenção de cancelar (sem nova data já proposta) — força tool cancelar_visita
      const wantsCancel = /\b(cancelar|desmarcar|n[aã]o (vou|consigo|posso) (ir|comparecer)|n[aã]o (poderei|vou poder) ir)\b/i.test(lastInLow)
        && !/\b(remarcar|reagendar|outro dia|outro hor[aá]rio|amanh[aã]|segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado)\b/i.test(lastInLow);
      // Última oferta do assistant sugeriu cancelamento? ("posso cancelar", "deixar para remarcar depois")
      const _lastOutTxtForCancel = String((recentOutbound || []).slice(-1)[0] || "").toLowerCase();
      const offeredCancel = /\b(cancelar (agora )?seu (hor[aá]rio|agendamento)|posso cancelar|deixar(mos)? para remarcar (depois|mais tarde)|deixamos para remarcar)\b/i.test(_lastOutTxtForCancel);
      const shortYesToCancel = /^(pode|pode sim|sim|isso|ok|tudo bem|por favor|cancela|cancelar|pode cancelar|sim, pode|pode pode)\.?$/i.test(lastInLow.trim());
      if (hasAgendamentoAtivo && (wantsCancel || (offeredCancel && shortYesToCancel))) {
        const _lojaAg = agAtivoRecentEarly?.loja_nome || "";
        messages.push({
          role: "system",
          content: `[CANCELAR AGENDAMENTO] O cliente está ${wantsCancel ? "pedindo para cancelar/desmarcar" : "confirmando o cancelamento que você ofereceu"} o agendamento ativo (${agendamentoFmt || "ver AGENDAMENTOS"}${_lojaAg ? " na " + _lojaAg : ""}). AÇÃO OBRIGATÓRIA: chame a tool *cancelar_visita* AGORA — não responda só com texto. PROIBIDO escrever "cancelei seu horário" sem chamar a tool. Após o cancelamento, ofereça brevemente registrar lembrete pra remarcar (use agendar_lembrete se ele pedir uma data específica) ou deixe em aberto. PROIBIDO assinar mensagens futuras com "Te espero ${agendamentoFmt || "..."}" — esse horário acabou de ser cancelado.`,
        });
        console.log(`[GUARDRAIL-HINT] Cancelamento detectado — forçando tool cancelar_visita (wantsCancel=${wantsCancel}, offeredCancel+shortYes=${offeredCancel && shortYesToCancel})`);
      } else if (hasAgendamentoAtivo && !explicitChange) {
        const _lojaAg = agAtivoRecentEarly?.loja_nome || "";
        // Detecta pedido EXPLÍCITO de preço/orçamento na mensagem atual.
        // Só nesse caso permitimos rodar consultar_lentes/consultar_lentes_contato de novo.
        const explicitPriceAsk = /\b(or[çc]amento|pre[çc]o|valor|quanto (custa|sai|fica|d[áa]|ficar[ií]a)|tem (de )?(quanto|por quanto)|sai por quanto)\b/i.test(lastInLow);
        // Pergunta DIRETA de disponibilidade de tratamento/marca conhecida ("teria transitions?",
        // "tem varilux?", "trabalham com zeiss?") = pedido implícito de cotação. Libera consultar_lentes
        // mesmo com agendamento ativo (mas sem perguntar região — loja já está definida).
        const askTreatBrand = /(\?|\b(tem|teria|trabalh(am|a)|consegue|fazem|fa[zç]em|disp[oõ]e[m]?|disponibilidade|trabalham?\s+com|voc[eê]s?\s+t[eê]m)\b)/i.test(lastInLow)
          && /\b(transitions?|fotossens[ií]ve[il]|fotocrom[áa]?tic[ao]?|antirreflex(?:o|ivo)?|filtro\s+azul|luz\s+azul|polariz[ao]?d[ao]?|varilux|essilor|eyezen|crizal|stellest|zeiss|hoya|kodak|dnz|dmax)\b/i.test(lastInLow);
        messages.push({
          role: "system",
          content: `[AGENDAMENTO ATIVO] O cliente JÁ TEM um agendamento ativo (${agendamentoFmt || "ver AGENDAMENTOS DESTE CLIENTE"}${_lojaAg ? " na " + _lojaAg : ""}). PROIBIDO chamar agendar_visita ou reagendar_visita — não há pedido explícito de mudança. PROIBIDO perguntar "mantemos ou prefere cancelar?". PROIBIDO oferecer/propor cancelamento. Se o cliente disser "agendar", "manter", "ok", "confirmado", "obg", trate como CONFIRMAÇÃO do existente: apenas reafirme com "Tudo certo, te espero ${agendamentoFmt || "no horário combinado"} 👋" e siga o fluxo de comparativo/encerramento. Só chame reagendar_visita se o cliente pedir EXPLICITAMENTE para remarcar/mudar horário/loja, ou cancelar_visita se ele pedir para cancelar.

⛔ PROIBIDO chamar consultar_lentes/consultar_lentes_contato apenas porque o cliente mencionou um tratamento, material, cor, marca ou estilo de PASSAGEM (anotando preferência, ex.: "queria armação tartaruga", "gosto de filtro azul"). Trate como PREFERÊNCIA registrada para a visita — anote brevemente e reafirme o agendamento. ${(explicitPriceAsk || askTreatBrand) ? `EXCEÇÃO: ${askTreatBrand ? "o cliente está PERGUNTANDO se temos um tratamento/marca específico (transitions, varilux, zeiss etc.)" : "o cliente pediu preço/orçamento explicitamente AGORA"} — DEVE rodar consultar_lentes ${askTreatBrand ? "com filtro_photo/filtro_blue/preferencia_marca conforme o que ele perguntou" : ""} para responder com valor/disponibilidade real, SEM perguntar região/bairro/loja (já tem agendamento). PROIBIDO responder 'preciso confirmar na loja' — o catálogo é a fonte da verdade.` : "Só rode consultar_lentes/consultar_lentes_contato se o cliente pedir EXPLICITAMENTE preço/orçamento/quanto custa."}

⛔ PROIBIDO perguntar "em qual região/bairro você está?", "qual a loja mais próxima?", "onde você fica?" — a loja JÁ ESTÁ DEFINIDA no agendamento (${_lojaAg || "ver AGENDAMENTOS"}). PROIBIDO encerrar mensagem com "posso te indicar a loja mais próxima?" ou variantes. PROIBIDO oferecer comparativo / fazer perguntas tipo "após o exame, prefere já olhar armações e lentes ou só retirar a receita?", "quer que eu separe modelos?", "prefere X ou Y?" — não emende NOVAS perguntas depois de uma despedida/confirmação. Sempre fechar reafirmando a visita já marcada, sem perguntas adicionais.`
        });
        console.log(`[GUARDRAIL-HINT] Agendamento ativo sem pedido de mudança — injetando hint anti-duplicação (loja=${_lojaAg}, priceAsk=${explicitPriceAsk})`);
      }
    }

    if (loopCheck.detected && !correctionApplied) {
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
          : forcedIntent.tool === "responder_pedindo_receita"
          ? `[SISTEMA: LOOP DETECTADO + ORÇAMENTO SEM RECEITA UTILIZÁVEL] Cliente pediu orçamento ${isLCContextGlobal ? "de LENTES DE CONTATO" : "de óculos"} mas NÃO há receita válida salva (${receitas.length > 0 ? "última leitura ficou ilegível/incompleta" : "nenhuma foto enviada ainda"}). PROIBIDO escalar para humano. PROIBIDO chamar consultar_lentes/consultar_lentes_contato sem receita. AÇÃO OBRIGATÓRIA: use a tool *responder* com mensagem CURTA pedindo nova foto da receita ${isLCContextGlobal ? "de lentes de contato" : ""} mais nítida (luz boa, receita inteira no enquadramento) E ofereça caminho alternativo: "Se preferir, posso te indicar uma clínica parceira aqui pertinho — o valor do exame vira desconto na compra." NÃO repita orçamento anterior. NÃO diga "tô montando opções" se a receita não está pronta.`
          : forcedIntent.tool === "agendar_cliente_intent"
          ? (hasAgendamentoAtivo
              ? `[SISTEMA: LOOP DETECTADO + AGENDAMENTO JÁ ATIVO] O cliente JÁ tem agendamento ativo (${agendamentoFmt || "ver AGENDAMENTOS"}). NÃO chame agendar_visita. Apenas reafirme: "Tudo certo, te espero ${agendamentoFmt || "no horário combinado"} 👋" e siga com comparativo/encerramento.`
              : "[SISTEMA: LOOP DETECTADO + INTENT AGENDAR] Você está repetindo a mesma pergunta. O cliente quer agendar. Se já tem loja+data+hora, chame agendar_visita. Caso contrário, faça UMA pergunta objetiva pedindo o que falta — sem repetir o prompt anterior.")
          : "[SISTEMA: LOOP DETECTADO] Você está repetindo a mesma pergunta. Mude a abordagem — faça uma pergunta diferente OU execute uma ação concreta. NÃO repita a frase anterior.";
        messages.push({ role: "system", content: forceMsg });
        console.log(`[LOOP-DETECTOR] Forcing tool=${forcedIntent.tool} (${forcedIntent.reason})`);
      } else {
        // ── Antes de escalar: detectar refinamento por marca após orçamento ──
        // Ex.: cliente recebeu DNZ/HOYA e pergunta "Tem Varilux?" → re-consultar com filtro de marca
        const BRAND_REFINEMENT_RE = /\b(varilux|essilor|eyezen|crizal|zeiss|hoya|kodak|dnz|dmax|transitions|stellest)\b/i;
        const brandMatch = lastInboundText.match(BRAND_REFINEMENT_RE);
        const hasOrcamentoOculosRecente = !!recentOrcamento && /(DNZ|DMAX|HOYA|ESSILOR|ZEISS|VARILUX|EYEZEN|KODAK|R\$\s*\d)/i.test(recentOrcamento);
        if (brandMatch && hasValidReceitas && hasOrcamentoOculosRecente) {
          const marca = brandMatch[1].toLowerCase();
          // Map family→brand quando aplicável
          const brandFilter = /varilux|eyezen|crizal|stellest/i.test(marca) ? "ESSILOR"
            : /transitions/i.test(marca) ? "ESSILOR"
            : marca.toUpperCase();
          messages.push({
            role: "system",
            content: `[SISTEMA: REFINAMENTO POR MARCA APÓS ORÇAMENTO] O cliente JÁ recebeu um orçamento de óculos e agora está perguntando se temos a marca "${brandMatch[1]}" (filtro/refinamento — NÃO é loop nem ambiguidade). AÇÃO OBRIGATÓRIA: chame consultar_lentes AGORA passando preferencia_marca="${brandFilter}" e os valores da receita mais recente. Apresente 2-3 opções dessa marca com nome da família (ex: Varilux Comfort, Varilux XR Design) e valores. Se não houver opções compatíveis dessa marca para o grau, diga isso explicitamente e ofereça alternativas equivalentes em outra marca premium. PROIBIDO escalar para humano. PROIBIDO repetir o orçamento anterior.`,
          });
          console.log(`[LOOP-DETECTOR] Brand refinement intercepted (${brandFilter}) — forcing consultar_lentes instead of escalation`);
        } else {
          // Menu suave: se já enviou menu recentemente (< 5min), aí sim escala.
          const _loopMenuAt = (atendimentoMeta as any)?.loop_menu_enviado_at;
          const _loopMenuRecente = _loopMenuAt && (Date.now() - new Date(_loopMenuAt).getTime()) < 5 * 60 * 1000;
          const _np = (contatoNomeAtual || "").split(/\s+/)[0] || "";
          if (_loopMenuRecente) {
            console.log(`[LOOP-DETECTOR] No clear intent + menu já enviado — escalating to human`);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId, tipo: "loop_ia_escalado",
              descricao: `Loop sem intent claro (menu suave ignorado) — escalado para humano (similaridade ${(loopCheck.similarity * 100).toFixed(0)}%)`,
              metadata: { similarity: loopCheck.similarity, last_inbound: lastInboundText.substring(0, 200) },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            });
            await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento_id);
            const escMsg = isHorarioHumano()
              ? "Vou chamar alguém da equipe pra te ajudar melhor com isso, tá? 😊"
              : mensagemEscaladaForaHorario(_np);
            await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, escMsg);
            return jsonResponse({
              status: "ok", tools_used: ["loop_escalation_fallback"], intencao: "outro",
              precisa_humano: true, pipeline_coluna_sugerida: "Novo Contato", modo: "humano",
            });
          }
          console.log(`[LOOP-DETECTOR] No clear intent — enviando menu suave`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId, tipo: "loop_ia_menu_suave",
            descricao: `Loop sem intent claro — menu suave enviado (similaridade ${(loopCheck.similarity * 100).toFixed(0)}%)`,
            metadata: { similarity: loopCheck.similarity, last_inbound: lastInboundText.substring(0, 200) },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
            type: "button",
            texto: "Pode me ajudar a te ajudar melhor? 😊",
            botoes: [
              { id: "loop_menu_orcamento", titulo: "🔎 Orçamento" },
              { id: "loop_menu_agendar",   titulo: "📅 Agendar visita" },
              { id: "loop_menu_humano",    titulo: "💬 Falar com equipe" },
            ],
          });
          await supabase.from("atendimentos").update({
            metadata: { ...atendimentoMeta, loop_menu_enviado_at: new Date().toISOString(), expected_reply: "menu_triagem" },
          }).eq("id", atendimento_id);
          return jsonResponse({
            status: "ok", tools_used: ["loop_menu_suave"], intencao: "outro",
            precisa_humano: false, pipeline_coluna_sugerida: "Novo Contato", modo: atendimento.modo,
          });
        }
      }
    } else if (forcedIntent?.tool === "agendar_cliente_intent"
            && !hasAgendamentoAtivo
            && !atendimentoMeta.agendamento_pending?.loja_nome) {
      // Digitou intenção de agendar, sem loja pré-selecionada → bypassa LLM, envia lista de cidades.
      await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
      return jsonResponse({
        status: "ok", tools_used: ["forced_lista_cidades"],
        intencao: "agendamento", precisa_humano: false,
        pipeline_coluna_sugerida: "Agendamento", modo: atendimento.modo,
      });
    } else if (forcedIntent && (forcedIntent.tool === "consultar_lentes" || forcedIntent.tool === "consultar_lentes_contato" || forcedIntent.tool === "interpretar_receita" || forcedIntent.tool === "responder_pedindo_receita")) {
      const isRegionTrigger = /respondeu regi[aã]o/i.test(forcedIntent.reason || "");
      const brandRefMatch = (forcedIntent.reason || "").match(/^brand_refinement:([a-z]+):(.*)$/i);
      const brandHint: string | null = brandRefMatch ? (() => {
        const tok = brandRefMatch[1];
        const raw = brandRefMatch[2];
        if (tok === "kodak") {
          return `[SISTEMA: REFINAMENTO MARCA — KODAK] Cliente perguntou sobre KODAK. A linha Kodak está disponível no catálogo (Intro, Blue, City em visão simples; Network UHD em progressiva; Precise UHD ocupacional). AÇÃO: chame consultar_lentes com preferencia_marca:"Kodak" para buscar opções compatíveis com a receita do cliente. NÃO escale para humano. NÃO invente preço.`;
        }
        const params: string[] = [];
        let label = raw;
        if (tok === "photo") { params.push("filtro_photo:true"); label = "fotossensível/Transitions"; }
        else if (tok === "blue") { params.push("filtro_blue:true"); label = "filtro azul/antirreflexo"; }
        else if (tok === "polar") { params.push('preferencia_marca:"HOYA"'); label = "polarizado"; }
        else if (tok === "essilor") { params.push('preferencia_marca:"ESSILOR"'); label = `${raw} (família ESSILOR)`; }
        else if (tok === "zeiss") { params.push('preferencia_marca:"ZEISS"'); label = "ZEISS"; }
        else if (tok === "hoya") { params.push('preferencia_marca:"HOYA"'); label = "HOYA"; }
        else if (tok === "dnz") { params.push('preferencia_marca:"DNZ"'); label = "DNZ"; }
        else if (tok === "dmax") { params.push('preferencia_marca:"DMAX"'); label = "DMAX"; }
        return `[SISTEMA: REFINAMENTO POR TRATAMENTO/MARCA] Cliente perguntou se temos ${label}. Há receita salva e o catálogo é a fonte da verdade. AÇÃO OBRIGATÓRIA AGORA: chame consultar_lentes com {${params.join(", ")}} e a receita mais recente. Apresente 2-3 opções compatíveis com nome da família e preço (ex.: "Hoya Sensity Original — R$ X", "DMAX Foto — R$ Y"). Se nenhuma opção compatível, diga isso explicitamente e ofereça alternativa equivalente em outra marca/tratamento. ⛔ PROIBIDO responder "preciso confirmar na loja", "preciso verificar disponibilidade", "vou checar com um especialista" — o catálogo já responde. ⛔ PROIBIDO escalar para humano. ⛔ PROIBIDO perguntar região antes de mostrar as opções.`;
      })() : null;
      const hint = forcedIntent.tool === "consultar_lentes"
        ? (brandHint
            ? brandHint
            : isRegionTrigger
            ? "[SISTEMA: REGIÃO RECEBIDA APÓS ORÇAMENTO PROMETIDO] Cliente acabou de responder a região/bairro que VOCÊ pediu na mensagem anterior, e há receita salva. AÇÃO OBRIGATÓRIA AGORA (NÃO ADIE): chame consultar_lentes IMEDIATAMENTE com a receita mais recente. PROIBIDO mandar 'obrigado pela região, já vou separar', 'preciso confirmar na loja', 'vou verificar com um especialista' ou qualquer mensagem de espera — o orçamento sai NESTE turno, junto com a indicação da loja mais próxima da região informada. PROIBIDO escalar pra humano."
            : "[SISTEMA: INTENT CLARO] Cliente pediu orçamento e há receita salva. Use consultar_lentes — NÃO pergunte de novo o que ele prefere.")
        : forcedIntent.tool === "consultar_lentes_contato"
        ? "[SISTEMA: INTENT CLARO — LENTES DE CONTATO] Cliente pediu orçamento de LENTES DE CONTATO e há receita salva. Use consultar_lentes_contato AGORA (NÃO consultar_lentes — esse é para óculos), apresente 2-3 opções com descartes VARIADOS (diária + quinzenal/mensal), priorize DNZ, e termine perguntando a região. PROIBIDO repetir 'posso seguir por dois caminhos'. PROIBIDO escalar para humano."
        : forcedIntent.tool === "interpretar_receita"
        ? "[SISTEMA: INTENT CLARO] Cliente pediu orçamento e há imagem pendente. Use interpretar_receita AGORA — não pergunte se pode analisar."
        : `[SISTEMA: INTENT CLARO — ORÇAMENTO SEM RECEITA UTILIZÁVEL] Cliente pediu orçamento ${isLCContextGlobal ? "de LENTES DE CONTATO" : ""} mas não há receita válida salva. PROIBIDO escalar. PROIBIDO chamar consultar_lentes/consultar_lentes_contato. AÇÃO: use *responder* pedindo nova foto da receita ${isLCContextGlobal ? "de lentes de contato" : ""} mais nítida E ofereça clínica parceira: "Se preferir, posso indicar uma clínica parceira aqui pertinho — o valor do exame vira desconto." NÃO diga que está montando opções.`;
      messages.push({ role: "system", content: hint });
      console.log(`[INTENT-FORCE] Hinting ${forcedIntent.tool} (no loop, but clear intent)${isRegionTrigger ? " [REGION-TRIGGER]" : ""}`);

      // ── FASE 3: Re-disparar tool após resposta de região ──
      // Quando o trigger é resposta de região, força tool_choice=consultar_lentes no gateway
      // pra impedir o LLM de ignorar o hint e devolver texto puro
      // (ex.: "obrigado pela região, vou separar"). Bloqueia forceResponderTool — preço prevalece.
      if (isRegionTrigger && forcedIntent.tool === "consultar_lentes") {
        forceConsultarLentesTool = true;
        forceResponderTool = false;
        try {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "regiao_pos_orcamento_forcando_tool",
            descricao: "Cliente respondeu região após orçamento prometido — forçando tool_choice=consultar_lentes",
            metadata: {
              tool: "consultar_lentes",
              reason: forcedIntent.reason,
              last_inbound: lastInboundText.substring(0, 200),
              last_outbound: lastOutboundForIntent.substring(0, 200),
            },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
        } catch (e) { console.warn("[REGION-TRIGGER] failed to log event", e); }
        console.log(`[REGION-TRIGGER] Forçando tool_choice=consultar_lentes`);
      }
    }

    // ── 7. CALL LOVABLE AI GATEWAY (gpt-5) ──
    const callAI = async (retryCorrection?: string) => {
      const callMessages = [...messages];
      if (retryCorrection) {
        callMessages.push({ role: "system", content: retryCorrection });
      }

      const _t_ai = Date.now();
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
          tool_choice: forceResponderTool
            ? { type: "function", function: { name: "responder" } }
            : forceConsultarLentesTool
              ? { type: "function", function: { name: "consultar_lentes" } }
              : "required",
          max_completion_tokens: 2500,
        }),
      });
      console.log(`[PERF] ai_gateway_main=${Date.now() - _t_ai}ms status=${aiResponse.status}`);

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
    let direcionarAgendamentoLoja = false;

    const toolCalls = choice.message?.tool_calls || [];
    let rxConfirmGateTriggered = false;
    let rxConfirmGateRx: any = null;
    const semReceitaSalvaTurno = !hasReceitasValidas(receitas);

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
        if (fallback.intencao === "agendamento_loja") direcionarAgendamentoLoja = true;
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
        // ── GUARDA: "grau alto / sob encomenda" SEM receita interpretada ──
        // Caso Franciana (Mai/2026): IA falou em grau alto antes da foto chegar.
        if (semReceitaSalvaTurno && escaladaGrauSemReceitaTexto(args.resposta || "")) {
          console.log(`[GUARDA-GRAU-SEM-RECEITA] responder bloqueado — IA mencionou grau/sob encomenda sem receita salva`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "escalada_grau_sem_receita_bloqueada",
            descricao: `IA mencionou grau alto/sob encomenda sem receita salva (responder)`,
            metadata: { resposta_original: String(args.resposta || "").substring(0, 300) },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          resposta = MSG_PEDIR_RECEITA_PARA_GRAU_ALTO;
          intencao = "receita_oftalmologica";
          pipeline_coluna = "Orçamento";
          precisa_humano = false;
          validatorFlags.push("escalada_grau_sem_receita_bloqueada");
          continue;
        }
        // Merge proximo_passo into resposta APENAS se for pergunta (terminar com '?').
        // proximo_passo descritivo/imperativo ("Confirmar nome", "Aguardar resposta", etc.)
        // é METADADO INTERNO — nunca deve aparecer no texto enviado ao cliente.
        // Se já é pergunta repetida, também descarta.
        resposta = args.resposta || "";
        const _respTail = resposta.slice(-150).trim();
        const _respJaPergunta = /\?\s*$/.test(_respTail);
        const _ppEhPergunta = !!args.proximo_passo && /\?\s*$/.test(String(args.proximo_passo).trim());
        if (
          args.proximo_passo &&
          _ppEhPergunta &&
          !resposta.includes(args.proximo_passo) &&
          !_respJaPergunta
        ) {
          resposta = resposta.trimEnd().replace(/[.!]$/, "") + " " + args.proximo_passo;
        } else if (args.proximo_passo && !_ppEhPergunta) {
          console.log(`[GUARDRAIL] proximo_passo descritivo descartado (não-pergunta): ${JSON.stringify(String(args.proximo_passo).slice(0, 120))}`);
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

        // ── GUARDA: escalada por "grau alto / sob encomenda" SEM receita interpretada ──
        const _motivoTxt = `${args.motivo || ""} ${args.resposta || ""}`;
        if (semReceitaSalvaTurno && escaladaGrauSemReceitaTexto(_motivoTxt)) {
          console.log(`[GUARDA-GRAU-SEM-RECEITA] escalar_consultor bloqueado — sem receita salva`);
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "escalada_grau_sem_receita_bloqueada",
            descricao: `IA tentou escalar com motivo "grau alto/sob encomenda" sem receita salva`,
            metadata: { motivo: args.motivo, resposta: String(args.resposta || "").substring(0, 200) },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          resposta = MSG_PEDIR_RECEITA_PARA_GRAU_ALTO;
          intencao = "receita_oftalmologica";
          pipeline_coluna = "Orçamento";
          precisa_humano = false;
          setor_sugerido = "";
          validatorFlags.push("escalada_grau_sem_receita_bloqueada");
          continue;
        }

        // ── FATIA 1: loja-resolve → agendamento (vs. escalada real) ──
        const grauForaDaFaixa = (receitas as any[]).some((r: any) => isReceitaForaDaFaixa(r));
        const especialistaMotive = /\b(especialista|alto grau|sob encomenda|convers[aã]o.*lc|lc.*convers[aã]o|lente.*especial|fora da faixa)\b/i.test(motivoStr);
        const deveEscalar = explicitHumanRequest || freshComplaint || grauForaDaFaixa || especialistaMotive;
        if (!deveEscalar) {
          const mencionaExame = /\b(exame|cl[ií]nica|mapa de lente|topografia)\b/i.test(motivoStr);
          resposta = mencionaExame
            ? "Pra isso o ideal é passar na loja — posso agendar sua visita? A equipe te atende e, se precisar de exame, indicam a clínica parceira (o valor vira desconto na compra)."
            : "Pra isso o ideal é passar na loja — posso agendar sua visita? 😊";
          direcionarAgendamentoLoja = true;
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId, tipo: "escalonamento_redirecionado_agendamento",
            descricao: `IA redirecionou escalonamento para agendamento (motivo: ${args.motivo})`,
            metadata: { motivo: args.motivo, setor: args.setor },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
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

        // Guard C2: bloqueia alucinação quando interpretar_receita é chamada sem imagem real.
        // correctionApplied=true ⟹ parser já salvou a receita neste turno → cota direto.
        // Condição: msg atual é texto + parser detectou receita + não é nova foto pendente.
        const _rxTextGuardBloqueou = !lastIsImage && !hasPendingNewPrescriptionImage && correctionApplied && !!_earlyRxDetected;
        if (_rxTextGuardBloqueou) {
          console.warn("[RX-TEXT-GUARD] interpretar_receita sem imagem real — parser já leu; cotando direto");
          validatorFlags.push("rx_text_guard_bloqueou_ocr");
          if (receitas.length > 0 && isReceitaValida(receitas[receitas.length - 1])) {
            const _qg = await runConsultarLentes(supabase, contatoId, recentOutbound, {}, atendimento_id);
            resposta = _qg.resposta;
            intencao = "orcamento";
          } else {
            resposta = MSG_PEDIR_RECEITA_TEXTO;
          }
        } else {

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

        // ── HARD GUARD: OCR inútil (foto não-receita / valores vazios) ──
        // Caso Yuri (Mai/2026): foto ambígua → modelo retornou eyes={} mas confidence alta.
        // Sem guarda, ramo final caía em `args.resposta` e LLM hallucinava o template
        // "Li sua receita assim, ESF ? CIL ? EIXO ?". Bloqueia ANTES de salvar e pedir confirmação.
        const _odNumCount = ["sphere","cylinder","axis","add"].filter((k) => typeof (od as any)[k] === "number").length;
        const _oeNumCount = ["sphere","cylinder","axis","add"].filter((k) => typeof (oe as any)[k] === "number").length;
        const _ocrSemValores = (_odNumCount + _oeNumCount) === 0;
        // _ocrSoEsfericoZero REMOVIDO (Jun/2026): confundia sphere=0 (Plano legítimo, LLM leu
        // zero) com sphere=null (LLM não leu). O caso OCR-falho-total (eyes:{}) já é coberto por
        // _ocrSemValores (total de campos numéricos = 0). Receitas com OD/OE Plano puro passam
        // para confirmação ao cliente — se o LLM alucionou zero numa foto ilegível, confidence
        // < 0.80 já marca needsHumanReview e o cliente pode corrigir no fluxo de confirmação.
        const _ocrInutil = _ocrSemValores || rxType === "unknown";

        if (_ocrInutil) {
          // ── CONTADOR DE FALHAS DE OCR (anti-loop) ──
          // Após 2 OCRs inúteis seguidos, escala pra humano em vez de pedir texto de novo.
          const { data: _cFail } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
          const _failMeta = (_cFail?.metadata as Record<string, any>) || {};
          const _falhasAtual = Number(_failMeta.ocr_falhas_count || 0) + 1;
          await supabase.from("contatos").update({
            metadata: { ..._failMeta, ocr_falhas_count: _falhasAtual, ocr_falhas_last_at: new Date().toISOString() },
          }).eq("id", contatoId);

          if (_falhasAtual >= 2) {
            const _np = (contatoNomeAtual || "").split(/\s+/)[0] || "";
            resposta = isHorarioHumano()
              ? `Tô com dificuldade de ler sua receita aqui mesmo nas tentativas, ${_np || "amigo(a)"}. Vou chamar alguém da equipe pra te ajudar com isso, tá? 🙌`
              : mensagemEscaladaForaHorario(_np);
            precisa_humano = true;
            intencao = "receita_oftalmologica";
            pipeline_coluna = "Novo Contato";
            validatorFlags.push("ocr_falhas_escalado_humano");
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "ocr_falhas_escalado",
              descricao: `${_falhasAtual} falhas consecutivas de OCR — escalando pra humano`,
              metadata: { ocr_falhas_count: _falhasAtual, confidence, rxType, odNumCount: _odNumCount, oeNumCount: _oeNumCount },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            });
            console.log(`[RX-GUARD] ${_falhasAtual}× OCR inútil — escalando pra humano`);
          } else {
            resposta = MSG_PEDIR_RECEITA_TEXTO;
            validatorFlags.push("ocr_inutil_pedindo_texto");
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "receita_ocr_inutil",
              descricao: `OCR retornou sem valores úteis (tentativa ${_falhasAtual}, rxType=${rxType}, conf=${(confidence * 100).toFixed(0)}%, odNum=${_odNumCount}, oeNum=${_oeNumCount}) — pedindo valores por texto`,
              metadata: { confidence, rxType, odNumCount: _odNumCount, oeNumCount: _oeNumCount, ocr_falhas_count: _falhasAtual, args_resposta: args.resposta || null },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            });
            console.log(`[RX-GUARD] OCR inútil bloqueado (tentativa ${_falhasAtual}, rxType=${rxType}, conf=${(confidence * 100).toFixed(0)}%) — pede texto`);
          }
          // NÃO salva em receitas[], NÃO marca pending. Cai direto pro sanitizer + sendWhatsApp.
        } else {
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
        const rxWithLabel = { ...rxData, label: rxLabel, confirmed_by_client_at: null };
        
        // Append and cap at 5 (FIFO)
        existingReceitas.push(rxWithLabel);
        if (existingReceitas.length > 5) existingReceitas = existingReceitas.slice(-5);
        
        await supabase.from("contatos").update({
          metadata: { ...existingMeta, receitas: existingReceitas, ultima_receita: rxData, ocr_falhas_count: 0 },
        }).eq("id", contatoId);

        await supabase.from("eventos_crm").insert({
          contato_id: contatoId, tipo: "receita_interpretada",
          descricao: `Receita: OD esf=${od.sphere ?? "?"} cil=${od.cylinder ?? "?"} OE esf=${oe.sphere ?? "?"} cil=${oe.cylinder ?? "?"} — ${rxType} (conf: ${(confidence * 100).toFixed(0)}%)`,
          metadata: rxData, referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });

        // ── CONFIRMAÇÃO PÓS-OCR (Mai/2026) ──
        // Em vez de auto-chain → consultar_lentes, pedimos confirmação explícita
        // ao cliente com os valores lidos. Só após "sim" é que segue pra orçamento.
        // Casos de correção mantêm pending=true e re-perguntam com valores novos.
        const rxJustValid = isReceitaValida(rxWithLabel);
        const recentInboundJoined = inboundMsgs.slice(-5).map((m: any) => String(m.conteudo || "")).join(" | ").toLowerCase();
        const explicitOptOut = /\b(s[oó]\s+(quero|queria|gostaria)\s+(que\s+)?(voc[eê]\s+)?guarde|guarda?r?\s+(a\s+)?receita|depois\s+(eu\s+)?(te\s+)?falo|n[aã]o\s+quero\s+or[cç]amento|s[oó]\s+(uma|tirando)\s+d[uú]vida)\b/i.test(recentInboundJoined);

        if (rxJustValid && !explicitOptOut) {
          // Marca pending_confirmation no metadata e devolve mensagem canônica.
          try {
            const { data: c2 } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
            const m2 = (c2?.metadata as Record<string, any>) || {};
            await supabase.from("contatos").update({
              metadata: {
                ...m2,
                receita_confirmacao: {
                  pending: true,
                  rx_label: rxLabel,
                  asked_at: new Date().toISOString(),
                  correction_count: 0,
                  fora_da_faixa: isReceitaForaDaFaixa(rxWithLabel),
                },
              },
            }).eq("id", contatoId);
          } catch (e) { console.warn("[RX-CONFIRM] failed to mark pending", e); }

          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "receita_confirmacao_solicitada",
            descricao: `Solicitando confirmação cliente. ${rxType} OD esf=${od.sphere} OE esf=${oe.sphere}`,
            metadata: { rx_label: rxLabel, source: "ocr" },
            referencia_tipo: "atendimento", referencia_id: atendimento_id,
          });
          resposta = buildMsgConfirmarReceita(rxWithLabel, false);
          rxConfirmGateTriggered = true;
          rxConfirmGateRx = rxWithLabel;
          validatorFlags.push("receita_confirmacao_solicitada");
          console.log(`[RX-CONFIRM] Pedindo confirmação ao cliente (rxType=${rxType}, conf=${(confidence * 100).toFixed(0)}%)`);
        } else if (needsHumanReview) {
          const totalmenteIlegivel = rxType === "unknown" || (sphereValues.length === 0 && cylValues.length === 0);
          if (totalmenteIlegivel) {
            resposta = MSG_PEDIR_RECEITA_TEXTO;
            validatorFlags.push("ocr_ilegivel_pedindo_texto");
            console.log(`[RX] OCR ilegível (rxType=${rxType}, conf=${(confidence * 100).toFixed(0)}%) — pedindo valores por texto`);
          } else {
            resposta = "Consegui ler boa parte da sua receita, mas quero te passar a opção certinha. Posso te mostrar uma base e confirmar na loja? 😊";
            console.log(`[RX] Low confidence (${(confidence * 100).toFixed(0)}%) — cautious response`);
          }
        } else if (rxJustValid) {
          // Receita válida + cliente optou explicitamente por só guardar — usa resposta do LLM
          resposta = args.resposta;
        } else {
          // Defesa final: receita não-válida sem cair em needsHumanReview (não deveria ocorrer
          // após o guard acima, mas mantém comportamento seguro).
          resposta = MSG_PEDIR_RECEITA_TEXTO;
          validatorFlags.push("ocr_invalido_pedindo_texto");
          console.log(`[RX] Fallback de segurança — receita inválida sem human review`);
        }
        console.log(`[RX] Prescription saved: ${rxType} conf=${(confidence * 100).toFixed(0)}% — ${rxJustValid && !explicitOptOut ? "pending_confirmation" : (explicitOptOut ? "client opted-out" : "no chain")}`);
        }
        } // end guard C2: !_rxTextGuardBloqueou

        // ── SANITIZER pós-LLM: nunca enviar template com placeholders vazios ──
        if (resposta && /ESF\s*\?|CIL\s*\?|EIXO\s*\?°/.test(resposta)) {
          console.warn("[RX-SANITIZE] resposta com placeholders vazios — substituindo por MSG_PEDIR_RECEITA_TEXTO");
          resposta = MSG_PEDIR_RECEITA_TEXTO;
          validatorFlags.push("rx_sanitize_empty_template");
        }

      } else if ((fn === "consultar_lentes" || fn === "consultar_lentes_contato") && hasPendingNewPrescriptionImage) {
        // Bloqueia cotação com receita antiga quando há nova receita pendente de OCR
        console.log(`[QUOTE-BLOCK] ${fn} bloqueada: nova receita pendente de interpretação`);
        validatorFlags.push("quote_blocked_new_rx_pending");
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";
        resposta = "Recebi sua nova receita 👀 Já estou lendo os valores aqui pra te passar o orçamento certinho com base nela, um instante…";
        continue;
      } else if (fn === "consultar_lentes") {
        // ── QUOTE ENGINE: triggered by client interest ──
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
        const quoteResult = await runConsultarLentes(supabase, contatoId, recentOutbound, args, atendimento_id);
        resposta = quoteResult.resposta;
        // Arma máquina pós-orçamento se a resposta contém o CTA padrão
        if (resposta && resposta.includes(MSG_CTA_AGENDAMENTO)) {
          try {
            const { data: cur } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
            const m = (cur?.metadata as Record<string, any>) || {};
            m.pos_orcamento = { etapa: "aguardando_cta_visita", iniciado_at: new Date().toISOString(), origem: "consultar_lentes" };
            await supabase.from("contatos").update({ metadata: m }).eq("id", contatoId);
          } catch (_) { /* noop */ }
        }
      } else if (fn === "consultar_lentes_estimativa") {
        // ── QUOTE ESTIMATE: receita parcial, nunca bloquear orçamento ──
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
        const estResult = await runConsultarLentesEstimativa(supabase, args || {}, contatoId, atendimento_id);
        resposta = estResult.resposta;
      } else if (fn === "agendar_visita" || fn === "reagendar_visita") {
        // (Guardrail antigo "LC não exige visita" foi removido: catálogo de LC está
        // no banco, IA orça e direciona à loja como qualquer outro pedido.
        // Cliente vai à loja para retirar/pagar — fluxo unificado óculos/LC.)

        resposta = args.resposta;
        intencao = "agendamento";
        pipeline_coluna = "Agendamento";

        // Find loja telephone
        const lojaMatch = lojas.find((l: any) => l.nome_loja.toLowerCase() === (args.loja_nome || "").toLowerCase());

        // ── PRÉ-VALIDAÇÃO: a loja abre nesse dia/horário? ──
        // Se a loja estiver fechada na data ou a hora estiver fora do intervalo,
        // bloqueia a criação e devolve mensagem corretiva ao cliente.
        let agendamentoBloqueado = false;
        let bloqueioMotivo: string | null = null;
        try {
          if (lojaMatch?.id && args.data_horario) {
            const dataDia = String(args.data_horario).substring(0, 10);
            const { data: status } = await supabase.rpc("loja_status_no_dia", {
              _loja_id: lojaMatch.id,
              _data: dataDia,
            }) as any;

            const dtBr = new Date(args.data_horario);
            const dataFmtErr = dtBr.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

            if (status?.aberta === false) {
              agendamentoBloqueado = true;
              bloqueioMotivo = status.motivo;
              const feriadoStr = status.feriado_nome ? ` (feriado de ${status.feriado_nome})` : "";
              const lojasAbertas = lojas.filter((l: any) => l.id && lojaStatusGrade[l.id] && !lojaStatusGrade[l.id].split("\n")[0].includes("FECHADA"));
              const sugestao = lojasAbertas.length > 0
                ? `\n\nNesse dia, a unidade de ${lojasAbertas[0].nome_loja} está aberta — quer que eu marque por lá? Ou prefere outro dia na ${args.loja_nome}?`
                : `\n\nQuer escolher outro dia na ${args.loja_nome}?`;
              resposta = `Opa, ${dataFmtErr} a ${args.loja_nome} não abre${feriadoStr}. Me desculpa a confusão!${sugestao}`;
            } else if (status?.aberta === true && status.abre && status.fecha) {
              const horaSP = dtBr.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
              if (horaSP < status.abre || horaSP >= status.fecha) {
                agendamentoBloqueado = true;
                bloqueioMotivo = "fora_do_horario";
                resposta = `Opa, ${dataFmtErr} a ${args.loja_nome} funciona das ${status.abre} às ${status.fecha}. ${horaSP} fica fora desse intervalo. Quer marcar pra outro horário dentro desse período?`;
              }
            }
          }
        } catch (e) {
          console.error("[TOOL agendar] pré-validação de horário falhou:", e);
        }

        if (agendamentoBloqueado) {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "agendamento_recusado_horario",
            descricao: `IA tentou agendar em horário inválido — motivo: ${bloqueioMotivo}. Loja: ${args.loja_nome}, data: ${args.data_horario}`,
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
            metadata: { args, motivo: bloqueioMotivo },
          });
        }

        if (!agendamentoBloqueado) {
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
              const agResp = await fetch(`${SUPABASE_URL}/functions/v1/agendar-cliente`, {
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
              if (agResp.status === 409) {
                // agendar-cliente recusou (loja fechada / fora horário) — sobrescreve resposta
                const errBody = await agResp.json().catch(() => ({}));
                console.warn("[TOOL] agendar-cliente recusou:", errBody);
                const dt = new Date(args.data_horario);
                const dataFmtErr = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
                if (errBody?.error === "loja_fechada_no_dia") {
                  const fer = errBody.feriado_nome ? ` (feriado de ${errBody.feriado_nome})` : "";
                  resposta = `Opa, ${dataFmtErr} a ${args.loja_nome} não abre${fer}. Me desculpa! Quer escolher outro dia ou outra loja?`;
                } else if (errBody?.error === "fora_do_horario") {
                  resposta = `Opa, ${dataFmtErr} a ${args.loja_nome} funciona das ${errBody.abre} às ${errBody.fecha}. Quer marcar pra um horário dentro desse intervalo?`;
                }
              }
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
        } // end if (!agendamentoBloqueado)
      } else if (fn === "cancelar_visita") {
        // ── CANCELAR VISITA: marca agendamento ativo como cancelado ──
        intencao = "cancelamento_agendamento";
        pipeline_coluna = "Qualificado";
        const _firstNm = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
        const _alvo = (agendamentosAtivos || []).find((a: any) =>
          ["agendado", "lembrete_enviado", "confirmado"].includes(a.status)
        ) || agAtivoRecentEarly;

        if (!_alvo?.id) {
          // Não há agendamento ativo — apenas confirma sem persistência
          resposta = args.resposta || `Tudo certo${_firstNm ? ", " + _firstNm : ""}! Quando quiser marcar é só me chamar 👋`;
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "cancelar_visita_sem_alvo",
            descricao: "IA chamou cancelar_visita mas não havia agendamento ativo",
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
            metadata: { args },
          });
        } else if (_alvo.status === "cancelado") {
          // Idempotente
          resposta = args.resposta || `Tudo certo${_firstNm ? ", " + _firstNm : ""}! Seu horário já estava cancelado. Quando quiser remarcar é só me chamar 👋`;
        } else {
          try {
            const novaMeta = {
              ...(_alvo.metadata || {}),
              cancelado_em: new Date().toISOString(),
              cancelado_por: "cliente_via_ia",
              cancelado_motivo: args.motivo || null,
            };
            await supabase
              .from("agendamentos")
              .update({ status: "cancelado", metadata: novaMeta, updated_at: new Date().toISOString() })
              .eq("id", _alvo.id);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "agendamento_cancelado_cliente",
              descricao: `Agendamento ${_alvo.loja_nome} em ${_alvo.data_horario} cancelado via IA${args.motivo ? ` — motivo: ${args.motivo}` : ""}`,
              referencia_tipo: "agendamento",
              referencia_id: _alvo.id,
              metadata: { agendamento_id: _alvo.id, motivo: args.motivo || null },
            });
            console.log(`[TOOL] cancelar_visita: agendamento ${_alvo.id} marcado como cancelado`);
          } catch (e) {
            console.error("[TOOL] cancelar_visita update failed:", e);
          }
          // ── BLOQUEIO DE RETOMADA AUTOMÁTICA PÓS-CANCELAMENTO ──
          // Cliente desmarcou — não dispara retomada_contexto_* enquanto ele não voltar a falar.
          // Evita template "Estávamos conversando sobre as lentes..." horas depois do cancelamento.
          try {
            const _atMdC = (atendimento.metadata as Record<string, any>) || {};
            await supabase.from("atendimentos").update({
              metadata: {
                ..._atMdC,
                nao_retornar_automaticamente: true,
                encerrado_pelo_cliente_at: new Date().toISOString(),
                encerrado_motivo: "cancelamento_cliente",
              },
              updated_at: new Date().toISOString(),
            }).eq("id", atendimento_id);
          } catch (e) {
            console.warn("[CANCEL] falha ao gravar nao_retornar_automaticamente:", (e as Error)?.message);
          }
          resposta = args.resposta || `Prontinho${_firstNm ? ", " + _firstNm : ""} — cancelei seu horário. Quando quiser remarcar é só me chamar 👋`;
        }
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
                metadata: { ...ctMeta, nome_confirmado: true, precisa_confirmar_nome: false, nome_origem: "ia_confirmado", nome_atualizado_at: new Date().toISOString() },
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
            // Logo após confirmar o nome, oferece o menu de triagem por lista interativa.
            // Substitui a pergunta livre "como posso te ajudar" pelo card determinístico.
            const firstName = novoNome.split(" ")[0];
            await sendInteractive(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, {
              type: "list",
              texto: `Prazer, ${firstName}! 🙌 Como posso te ajudar hoje?`,
              lista: {
                label: "Ver opções",
                secao: "Posso te ajudar com",
                itens: MENU_TRIAGEM_ITENS,
              },
            });
            // Marca que o menu inicial foi servido — evita LLM duplicar a pergunta.
            const _curAtMeta = (atendimento.metadata as Record<string, any>) || {};
            await supabase.from("atendimentos").update({
              metadata: { ..._curAtMeta, menu_triagem_enviado_at: new Date().toISOString(), expected_reply: "menu_triagem" },
            }).eq("id", atendimento_id);
            resposta = ""; // não emite texto adicional do LLM nesta rodada
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

              msg += `\n\n${MSG_CTA_AGENDAMENTO}`;
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
        if (resposta && resposta.includes(MSG_CTA_AGENDAMENTO)) {
          try {
            const { data: cur } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
            const m = (cur?.metadata as Record<string, any>) || {};
            m.pos_orcamento = { etapa: "aguardando_cta_visita", iniciado_at: new Date().toISOString(), origem: "consultar_lentes_contato" };
            await supabase.from("contatos").update({ metadata: m }).eq("id", contatoId);
          } catch (_) { /* noop */ }
        }
      }
    }

    // ── GATE PÓS-LOOP: confirmação de receita VENCE qualquer escalada/cotação no mesmo turno ──
    // Caso Franciana (Mai/2026): no mesmo turno em que interpretar_receita marcou pending,
    // o LLM também emitiu escalar_consultor → escalou sem cliente confirmar.
    if (rxConfirmGateTriggered && rxConfirmGateRx) {
      const _toolNomes = (toolCalls || []).map((t: any) => t?.function?.name).filter(Boolean);
      const _outrasTools = _toolNomes.filter((n: string) => n !== "interpretar_receita");
      if (_outrasTools.length > 0 || precisa_humano) {
        console.log(`[RX-GATE] Sobrescrevendo turno: outras tools=${_outrasTools.join(",")} precisa_humano=${precisa_humano} — força confirmação`);
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "escalada_bloqueada_pendente_confirmacao",
          descricao: `Turno teve interpretar_receita + ${_outrasTools.join(",")} — gate de confirmação prevalece`,
          metadata: { tools: _toolNomes, precisa_humano_descartado: precisa_humano, setor_descartado: setor_sugerido },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        });
      }
      resposta = buildMsgConfirmarReceita(rxConfirmGateRx, false);
      precisa_humano = false;
      intencao = "receita_oftalmologica";
      pipeline_coluna = "Orçamento";
      setor_sugerido = "";
      validatorFlags.push("rx_confirm_gate_overrode_turn");
    }

    // ── GATE PÓS-LLM: bloquear orçamento quando há receita não confirmada ──
    // Caso 558488766851 (Mai/2026): cliente escolheu "a segunda" receita; LLM cotou direto.
    // FIX: usa _receitasCurrentSession (mesmo filtro do B2) em vez do array cru receitas[].
    // Receitas não-confirmadas de sessões anteriores NÃO disparam o gate — cliente que pede
    // óculos hoje vai pro orçamento, não pra reapresentação de receita velha.
    if (resposta && !rxConfirmGateTriggered && _receitasCurrentSession.length >= 1) {
      const rxNaoConfirmada = _receitasCurrentSession.find((r: any) => r && !r.confirmed_by_client_at);
      const respondeuComPrecos = /R\$\s*\d|Op[cç][oõ]es?\s+de\s+lentes|Mais\s+em\s+conta|Um\s+passo\s+acima|Premium/i.test(resposta || "");
      const usouQuoteTool = (toolCalls || []).some((t: any) => ["consultar_lentes", "consultar_lentes_contato", "consultar_lentes_estimativa"].includes(t?.function?.name));
      if (rxNaoConfirmada && (respondeuComPrecos || usouQuoteTool)) {
        const rxAlvo = rxNaoConfirmada;
        const idxGlobal = receitas.indexOf(rxAlvo); // índice no array global — para rx_index no metadata
        const rxLabelAlvo = rxAlvo.label || (idxGlobal >= 0 ? `receita_${idxGlobal + 1}` : "receita_1");
        try {
          const novaReceitaConf = {
            pending: true,
            rx_label: rxLabelAlvo,
            rx_index: idxGlobal,
            asked_at: new Date().toISOString(),
            correction_count: 0,
            fora_da_faixa: isReceitaForaDaFaixa(rxAlvo),
          };
          await supabase.from("contatos").update({
            metadata: { ...contatoMeta, receita_confirmacao: novaReceitaConf },
          }).eq("id", contatoId);
        } catch (_) { /* noop */ }
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "bloqueado_orcamento_receita_nao_confirmada",
          descricao: `LLM ia cotar com receita "${rxLabelAlvo}" sem confirmação — sobrescrevendo com pedido de confirmação`,
          metadata: { rx_label: rxLabelAlvo, rx_index: idxGlobal },
          referencia_tipo: "atendimento", referencia_id: atendimento_id,
        }).then(() => undefined, () => undefined);
        resposta = buildMsgConfirmarReceita(rxAlvo, false);
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";
        precisa_humano = false;
        validatorFlags.push("bloqueado_orcamento_receita_nao_confirmada");
        console.log(`[RX-GATE-POSTLLM] Sobrescrevendo cotação — receita "${rxLabelAlvo}" (sessão atual) ainda não confirmada`);
      }
    }

    if (resposta && !precisa_humano) {
      // ── ANTI-DUPLICAÇÃO DE DESPEDIDA: se o último outbound já é a frase canônica
      // de encerramento ("Te espero ... 👋 Qualquer dúvida é só me chamar." ou
      // "Qualquer coisa estou por aqui 👋 Qualquer dúvida é só me chamar."), e o
      // cliente respondeu de novo curto/agradecimento/negativa, NÃO reenvia.
      // Cliente pode mandar "Não" + "Obg" em sequência — uma despedida basta.
      const _lastOut = String((recentOutbound || []).slice(-1)[0] || "");
      const _despedidaJaEnviada = /Qualquer d[úu]vida [ée] s[óo] me chamar|Qualquer coisa,? [ée] s[óo] me chamar/i.test(_lastOut)
        && (/Te espero/i.test(_lastOut) || /Qualquer coisa estou por aqui/i.test(_lastOut) || /Foi um prazer te atender/i.test(_lastOut));
      if (_despedidaJaEnviada && (isThanksClose || isShortNoToHelp || isThanksOnly || isExplicitClose || SHORT_NO_RE.test(msgTrim2))) {
        console.log("[CLOSE-DEDUP] Despedida já enviada no último outbound — silenciando reenvio");
        try {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "despedida_duplicada_evitada",
            descricao: "Cliente respondeu após despedida final; IA suprimiu reenvio",
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
            metadata: { last_outbound: _lastOut.substring(0, 200), inbound: msgTrim2.substring(0, 100) },
          });
        } catch (_) { /* noop */ }
        resposta = "";
      }

      // ── OVERRIDE DETERMINÍSTICO: para fluxos canônicos curtos, ignoramos a saída do LLM
      // e injetamos a frase canônica. O LLM frequentemente adiciona segunda pergunta ou
      // varia o texto além do permitido nesses contextos de encerramento.
      const _nomePrim = contatoNomeAtual ? contatoNomeAtual.split(" ")[0] : "";
      if (resposta && isExplicitClose) {
        resposta = agendamentoFmt
          ? `Foi um prazer te atender${_nomePrim ? ", " + _nomePrim : ""}! 🙏 Obrigado pelo contato — te espero ${agendamentoFmt}. Qualquer coisa, é só me chamar 👋`
          : `Foi um prazer te atender${_nomePrim ? ", " + _nomePrim : ""}! 🙏 Obrigado pelo contato. Qualquer coisa, é só me chamar 👋`;
        intencao = "encerramento_explicito";
        validatorFlags.push("override_explicit_close");
        console.log("[OVERRIDE] explicit_close → despedida + agradecimento");
      } else if (resposta && isThanksClose && agendamentoFmt) {
        resposta = `De nada${_nomePrim ? ", " + _nomePrim : ""}! Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`;
        intencao = "encerramento_pos_agendamento";
        validatorFlags.push("override_thanks_close");
        console.log("[OVERRIDE] thanks_close → despedida pós-agendamento");
      } else if (resposta && isShortNoToHelp) {
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
            metadata: { ...md, confirmado_pelo_cliente_at: new Date().toISOString(), cliente_confirmou_at: new Date().toISOString() },
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
          // Notifica a loja via Atrium Messenger (background)
          fetch(`${SUPABASE_URL}/functions/v1/notificar-loja-agendamento`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ agendamento_id: agDiaD.id }),
          }).catch((e) => console.warn("[ai-triage] notificar-loja-agendamento falhou:", e));
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
                const _rTail = retryResposta.slice(-150).trim();
                const _rJaPergunta = /\?\s*$/.test(_rTail);
                const _rPpPergunta = !!retryArgs.proximo_passo && /\?\s*$/.test(String(retryArgs.proximo_passo).trim());
                if (
                  retryArgs.proximo_passo &&
                  _rPpPergunta &&
                  !retryResposta.includes(retryArgs.proximo_passo) &&
                  !_rJaPergunta
                ) {
                  retryResposta = retryResposta.trimEnd().replace(/[.!]$/, "") + " " + retryArgs.proximo_passo;
                } else if (retryArgs.proximo_passo && !_rPpPergunta) {
                  console.log(`[GUARDRAIL retry] proximo_passo descritivo descartado: ${JSON.stringify(String(retryArgs.proximo_passo).slice(0, 120))}`);
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
                  if (contextualFallback.intencao === "agendamento_loja") direcionarAgendamentoLoja = true;
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
              if (contextualFallback.intencao === "agendamento_loja") direcionarAgendamentoLoja = true;
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
        if (fallback.intencao === "agendamento_loja") direcionarAgendamentoLoja = true;
        validatorFlags.push("empty_response_deterministic");
      }
    }

    // ── 9.4. FORCED RETRY: interpretar_receita quando há imagem pendente e o modelo não chamou ──
    // Caso Artur Borges 24/04 15:13: modelo retornou texto ("Recebi sua receita 👀 Já estou analisando…")
    // sem chamar interpretar_receita. Sem retry, a conversa morre — cliente fica esperando indefinidamente.
    const interpretouReceitaNesteTurno = (toolCalls || []).some((tc: any) => tc.function?.name === "interpretar_receita");
    const precisaForcarInterpretacao = !interpretouReceitaNesteTurno && !precisa_humano && !isConsultaOsActive && (
      (isImageContext && !hasValidReceitas) || hasPendingNewPrescriptionImage
    );

    if (precisaForcarInterpretacao) {
      console.log("[FORCE-INTERPRETAR] Imagem pendente sem chamada de interpretar_receita — forçando retry");
      try {
        const forcedMessages = [
          ...messages,
          { role: "system" as const, content: "[SISTEMA: TOOL FORÇADA] Você DEVE chamar interpretar_receita AGORA com a imagem da receita do cliente que está no histórico. Não responda em texto. Não escale. Apenas execute a tool com os valores que conseguir ler da imagem." },
        ];
        const _t_forced = Date.now();
        const forcedResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            // PERF: gpt-5-mini para retry de OCR — mais rápido e suficiente p/ visão+tool call
            model: "openai/gpt-5-mini",
            messages: forcedMessages,
            tools: TOOLS,
            tool_choice: { type: "function", function: { name: "interpretar_receita" } },
            max_completion_tokens: 1500,
          }),
        });
        console.log(`[PERF] ai_gateway_forced_ocr=${Date.now() - _t_forced}ms status=${forcedResp.status}`);
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
                eRec.push({ ...rxData, label: rxLabel, confirmed_by_client_at: null });
                if (eRec.length > 5) eRec = eRec.slice(-5);
                await supabase.from("contatos").update({ metadata: { ...eMeta, receitas: eRec, ultima_receita: rxData, ocr_falhas_count: 0 } }).eq("id", contatoId);
                await supabase.from("eventos_crm").insert({
                  contato_id: contatoId, tipo: "receita_interpretada",
                  descricao: `Receita interpretada via retry forçado (confidence=${confidence})`,
                  metadata: { rx_data: rxData, forced_retry: true },
                  referencia_tipo: "atendimento", referencia_id: atendimento_id,
                });

                // Espelha caminho normal: pede confirmação ao cliente antes de seguir.
                try {
                  const { data: c3 } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
                  const m3 = (c3?.metadata as Record<string, any>) || {};
                  await supabase.from("contatos").update({
                    metadata: {
                      ...m3,
                      receita_confirmacao: {
                        pending: true,
                        rx_label: rxLabel,
                        asked_at: new Date().toISOString(),
                        correction_count: 0,
                        fora_da_faixa: isReceitaForaDaFaixa({ ...rxData, label: rxLabel }),
                      },
                    },
                  }).eq("id", contatoId);
                } catch (e) { console.warn("[FORCE-INTERPRETAR][RX-CONFIRM] failed to mark pending", e); }

                await supabase.from("eventos_crm").insert({
                  contato_id: contatoId,
                  tipo: "receita_confirmacao_solicitada",
                  descricao: `Solicitando confirmação cliente (forced retry). ${rxType} OD esf=${od.sphere ?? "?"} OE esf=${oe.sphere ?? "?"}`,
                  metadata: { rx_label: rxLabel, source: "ocr_forced_retry" },
                  referencia_tipo: "atendimento", referencia_id: atendimento_id,
                });

                resposta = buildMsgConfirmarReceita({ ...rxData, label: rxLabel }, false);
                rxConfirmGateTriggered = true;
                rxConfirmGateRx = { ...rxData, label: rxLabel };
                intencao = isLCContextGlobal ? "orcamento_lc" : "orcamento";
                pipeline_coluna = "Orçamento";
                precisa_humano = false;
                validatorFlags.push("forced_interpretar_receita_retry_ok");
                validatorFlags.push("receita_confirmacao_solicitada");
                console.log(`[FORCE-INTERPRETAR] Receita salva via retry (lc=${isLCContextGlobal}) — pedindo confirmação`);
              } else {
                // ── CONTADOR DE FALHAS DE OCR (forced retry low-confidence) ──
                const { data: _cFail2 } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
                const _failMeta2 = (_cFail2?.metadata as Record<string, any>) || {};
                const _falhasAtual2 = Number(_failMeta2.ocr_falhas_count || 0) + 1;
                await supabase.from("contatos").update({
                  metadata: { ..._failMeta2, ocr_falhas_count: _falhasAtual2, ocr_falhas_last_at: new Date().toISOString() },
                }).eq("id", contatoId);

                if (_falhasAtual2 >= 2) {
                  const _np2 = (contatoNomeAtual || "").split(/\s+/)[0] || "";
                  resposta = isHorarioHumano()
                    ? `Tô com dificuldade de ler sua receita aqui mesmo nas tentativas, ${_np2 || "amigo(a)"}. Vou chamar alguém da equipe pra te ajudar com isso, tá? 🙌`
                    : mensagemEscaladaForaHorario(_np2);
                  precisa_humano = true;
                  intencao = "receita_oftalmologica";
                  pipeline_coluna = "Novo Contato";
                  validatorFlags.push("forced_interpretar_receita_escalado_humano");
                  await supabase.from("eventos_crm").insert({
                    contato_id: contatoId,
                    tipo: "ocr_falhas_escalado",
                    descricao: `${_falhasAtual2} falhas consecutivas de OCR (forced retry) — escalando pra humano`,
                    metadata: { ocr_falhas_count: _falhasAtual2, confidence, source: "forced_retry_low_conf" },
                    referencia_tipo: "atendimento", referencia_id: atendimento_id,
                  });
                  console.log(`[FORCE-INTERPRETAR] ${_falhasAtual2}× confiança baixa — escalando pra humano`);
                } else {
                  resposta = "Consegui abrir sua receita, mas não estou conseguindo ler os valores com clareza 😅 Pode me passar por texto: OD esférico/cilíndrico/eixo e OE esférico/cilíndrico/eixo? Assim já te passo as opções certinhas.";
                  intencao = "receita_oftalmologica";
                  pipeline_coluna = "Orçamento";
                  precisa_humano = false;
                  validatorFlags.push("forced_interpretar_receita_low_confidence");
                  console.log(`[FORCE-INTERPRETAR] Confiança baixa (tentativa ${_falhasAtual2}) — pedindo valores por texto`);
                }
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

      // ── FAILSAFE: se mesmo após o retry forçado a resposta continua sendo
      // "Recebi sua receita... analisando", troca por MSG_PEDIR_RECEITA_TEXTO.
      // Caso Emerson (12/05/2026): forced retry não retornou tool_call e o
      // cliente ficou esperando indefinidamente. Sem este failsafe, watchdog
      // só dispara retomada_contexto_1 horas depois.
      try {
        if (typeof resposta === "string" && MSG_ANALISANDO_RE.test(resposta)) {
          console.log("[FORCE-INTERPRETAR][FAILSAFE] Retry não salvou receita — substituindo 'analisando' por MSG_PEDIR_RECEITA_TEXTO");
          resposta = MSG_PEDIR_RECEITA_TEXTO;
          intencao = "receita_oftalmologica";
          pipeline_coluna = "Orçamento";
          precisa_humano = false;
          validatorFlags.push("force_interpretar_failed_pedindo_texto");
          // Conta como falha de OCR pra escalar se acontecer 2x
          try {
            const { data: _cFail3 } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
            const _failMeta3 = (_cFail3?.metadata as Record<string, any>) || {};
            const _falhasAtual3 = Number(_failMeta3.ocr_falhas_count || 0) + 1;
            await supabase.from("contatos").update({
              metadata: { ..._failMeta3, ocr_falhas_count: _falhasAtual3, ocr_falhas_last_at: new Date().toISOString() },
            }).eq("id", contatoId);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "receita_ocr_failsafe_pedido_texto",
              descricao: `Forced retry sem sucesso (tentativa ${_falhasAtual3}) — pedindo valores por texto`,
              metadata: { ocr_falhas_count: _falhasAtual3, source: "force_interpretar_failsafe" },
              referencia_tipo: "atendimento", referencia_id: atendimento_id,
            });
            if (_falhasAtual3 >= 2) {
              const _np3 = (contatoNomeAtual || "").split(/\s+/)[0] || "";
              resposta = isHorarioHumano()
                ? `Tô com dificuldade de ler sua receita aqui mesmo nas tentativas, ${_np3 || "amigo(a)"}. Vou chamar alguém da equipe pra te ajudar com isso, tá? 🙌`
                : mensagemEscaladaForaHorario(_np3);
              precisa_humano = true;
              pipeline_coluna = "Novo Contato";
              validatorFlags.push("force_interpretar_failsafe_escalado_humano");
            }
          } catch (_) { /* noop */ }
        }
      } catch (failsafeErr) {
        console.error("[FORCE-INTERPRETAR][FAILSAFE] erro:", failsafeErr);
      }
    }

    // ── 9.4b. FORCED RETRY: consultar_lentes em brand_refinement (transitions/varilux/zeiss/etc.) ──
    // Caso Thais Santiago (12/05/2026): cliente perguntou "Eu queria uma lente transition. Teria?"
    // após orçamento. forcedIntent disparou brand_refinement:photo, mas o modelo respondeu
    // "Encontro as opções fotossensíveis... agora e te aviso na sequência" sem nunca chamar a tool.
    // Mesmo anti-pattern de receita ("Já estou analisando…" sem follow-up). Forçamos a execução.
    try {
      const chamouConsultarLentes = (toolCalls || []).some((tc: any) => tc.function?.name === "consultar_lentes");
      const isBrandRefinement = !!forcedIntent
        && forcedIntent.tool === "consultar_lentes"
        && typeof forcedIntent.reason === "string"
        && forcedIntent.reason.startsWith("brand_refinement:");
      const stallPhraseRe = /\b(encontro|busco|procuro|verifico|confirmo|j[áa] (vou|estou) (buscar|montar|verificar|consultar))\b.*\b(op[cç][oõ]es|fotossens[ií]veis?|lentes|transitions?|varilux|zeiss|hoya|essilor)\b/i;
      const respostaIsStall = typeof resposta === "string" && stallPhraseRe.test(resposta);

      if (isBrandRefinement && receitas.length > 0 && !isLCContextGlobal && !precisa_humano && (!chamouConsultarLentes || respostaIsStall)) {
        const reasonParts = forcedIntent!.reason!.split(":"); // ["brand_refinement", token, raw]
        const token = (reasonParts[1] || "").toLowerCase();
        const params: any = {};
        if (token === "photo") params.filtro_photo = true;
        else if (token === "blue") params.filtro_blue = true;
        else if (token === "varilux" || token === "essilor" || token === "eyezen" || token === "crizal" || token === "stellest") params.preferencia_marca = "ESSILOR";
        else if (token === "zeiss") params.preferencia_marca = "ZEISS";
        else if (token === "hoya") params.preferencia_marca = "HOYA";
        else if (token === "kodak") params.preferencia_marca = "KODAK";
        else if (token === "dnz") params.preferencia_marca = "DNZ";
        else if (token === "dmax") params.preferencia_marca = "DMAX";

        console.log(`[FORCE-CONSULTAR-LENTES] brand_refinement token=${token} params=${JSON.stringify(params)} chamou=${chamouConsultarLentes} stall=${respostaIsStall}`);
        try {
          const qr = await runConsultarLentes(supabase, contatoId, recentOutbound, params, atendimento_id);
          if (qr?.resposta) {
            resposta = qr.resposta;
            intencao = "orcamento";
            pipeline_coluna = "Orçamento";
            precisa_humano = false;
            const flagSuffix = token === "photo" ? "fotossensivel" : token === "blue" ? "filtro_azul" : `marca_${token}`;
            validatorFlags.push(`forced_consultar_lentes_retry_ok_${flagSuffix}`);
            if (/preciso confirmar a disponibilidade/i.test(qr.resposta)) {
              validatorFlags.push("forced_consultar_lentes_zero_results");
            }
            // Espelha pattern do guardrail-analisando: anexa sufixo de revisão humana se aplicável.
            try {
              const _ultimaRx2 = receitas[receitas.length - 1];
              const rev = requerRevisaoHumanaPosOrcamento(_ultimaRx2);
              if (rev.precisa && resposta && !resposta.includes(MSG_REVISAO_HUMANA_SUFIXO)) {
                resposta = resposta + MSG_REVISAO_HUMANA_SUFIXO;
              }
            } catch (_) { /* noop */ }
          }
        } catch (e) {
          console.error("[FORCE-CONSULTAR-LENTES] runConsultarLentes falhou:", e);
        }
      }
    } catch (e) {
      console.error("[FORCE-CONSULTAR-LENTES] exception:", e);
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
      console.log(`[GUARDRAIL-DOIS-CAMINHOS] Detectado loop. hasValidReceitas=${hasValidReceitas} | receitas.length=${receitas.length} | isImageContext=${isImageContext} | isLC=${isLCContextGlobal}`);
      validatorFlags.push("anti_loop_dois_caminhos");
      if (!hasValidReceitas && isImageContext) {
        // Imagem pendente sem receita interpretada → analisando
        resposta = "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções compatíveis em seguida, um instante…";
        intencao = "receita_oftalmologica";
        pipeline_coluna = "Orçamento";
      } else if (hasValidReceitas && isLCContextGlobal) {
        resposta = "Beleza! Já tô montando aqui as opções de lentes de contato com base na sua receita 😊 Em qual região/bairro você está pra eu indicar a loja mais próxima?";
        intencao = "orcamento_lc";
        pipeline_coluna = "Orçamento";
      } else if (hasValidReceitas) {
        resposta = "Beleza! Já vou te mandar as opções compatíveis com a sua receita 😊 Em qual região você está? Assim já te indico a loja mais próxima.";
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
      } else {
        // Sem receita válida (mesmo que receitas.length>0 com unknown/vazia) → pedir foto + oferecer clínica
        resposta = isLCContextGlobal
          ? "Pra te passar os valores certinhos de lentes de contato, preciso de uma foto nítida da sua receita 📸 (com luz boa e a receita inteira). Se ainda não tiver, posso te indicar uma clínica parceira aqui pertinho — o valor do exame vira desconto na compra 😉"
          : "Pra te passar os valores certinhos, me manda a foto da sua receita atualizada por aqui 📸 (precisa estar nítida, com a receita inteira no enquadramento). Se ainda não tiver, posso te indicar uma clínica parceira aqui pertinho — o valor do exame vira desconto 😉";
        intencao = "orcamento";
        pipeline_coluna = "Orçamento";
      }
    }

    // ── 9.6. GUARDRAIL ANTI-"ANALISANDO" PÓS-CONFIRMAÇÃO ──
    // Caso Franciana (Mai/2026): cliente confirmou a receita ("Sim"), o LLM ainda devolveu
    // "Recebi sua receita 👀 Já estou analisando…". Se a última receita já está confirmada
    // pelo cliente, esse texto é uma volta atrás — substituímos por cotação determinística.
    try {
      const _ultimaRx = Array.isArray(receitas) && receitas.length > 0
        ? receitas[receitas.length - 1]
        : null;
      const _rxJaConfirmada = !!_ultimaRx?.confirmed_by_client_at && !isReceitaPending(contatoMeta);
      if (_rxJaConfirmada && typeof resposta === "string" && MSG_ANALISANDO_RE.test(resposta)) {
        console.log("[GUARDRAIL-ANALISANDO-POS-CONF] Substituindo 'analisando' por cotação determinística");
        validatorFlags.push("anti_loop_analisando_pos_confirmacao");
        if (!isLCContextGlobal) {
          try {
            const qr = await runConsultarLentes(
              supabase,
              contatoId,
              recentOutbound,
              { receita_label: _ultimaRx?.label || undefined },
              atendimento_id,
            );
            resposta = qr.resposta;
            const rev = requerRevisaoHumanaPosOrcamento(_ultimaRx);
            if (rev.precisa && resposta && !resposta.includes(MSG_REVISAO_HUMANA_SUFIXO)) {
              resposta = resposta + MSG_REVISAO_HUMANA_SUFIXO;
            }
            intencao = "orcamento";
            pipeline_coluna = "Orçamento";
          } catch (e) {
            console.warn("[GUARDRAIL-ANALISANDO-POS-CONF] runConsultarLentes falhou:", e);
            resposta = "Perfeito! Já vou te mandar as opções compatíveis com a sua receita 😊";
          }
        } else {
          // LC: deixa o caminho determinístico curto (a próxima rodada do LLM apresenta opções LC).
          resposta = "Beleza! Já tô montando aqui as opções de lentes de contato com base na sua receita 😊";
          intencao = "orcamento_lc";
          pipeline_coluna = "Orçamento";
        }
      }
    } catch (e) {
      console.warn("[GUARDRAIL-ANALISANDO-POS-CONF] erro:", e);
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
    if (!resposta || !String(resposta).trim()) {
      console.log("[SEND] resposta vazia — silenciando para evitar mensagem fora de contexto");
      return new Response(JSON.stringify({ success: true, skipped: "empty_response" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── FASE 4: ANTI-LOOP ENDURECIDO PÓS-LLM ──
    // Compara a resposta gerada com a última outbound usando Jaccard de tokens >3 chars.
    // Se sim > 0.80, escala IMEDIATAMENTE pra humano (handoff <30s, sem esperar 5min do watchdog).
    //
    // GUARDRAILS (só dispara quando faz sentido):
    //  G1. Não roda se a resposta veio de tool determinística (consultar_lentes, agendar_visita,
    //      interpretar_receita, despedida) — esses templates podem repetir legitimamente
    //      (ex.: orçamento da MESMA receita).
    //  G2. Não roda se já é uma escalada / fora-horário / mensagem deterministic (já saíram
    //      por outros caminhos antes deste ponto).
    //  G3. Não roda na 1ª interação (inboundCount <= 1) — saudação tem variantes parecidas
    //      e não é loop real.
    //  G4. Já houve retry intra-turno (bypass via metadata.fase4_retry)? Escala direto.
    //  G5. Última outbound humana (não-IA)? Pula — humano pode repetir intencionalmente.
    try {
      const _toolNamesPhase4: string[] = Array.isArray(toolCalls)
        ? toolCalls.map((t: any) => t?.function?.name).filter(Boolean)
        : [];
      const _toolDeterministica = _toolNamesPhase4.some((n) =>
        ["consultar_lentes", "consultar_lentes_contato", "consultar_lentes_estimativa",
         "agendar_visita", "reagendar_visita", "interpretar_receita"].includes(n)
      );
      const _isEscaladaJa = !!precisa_humano || validatorFlags.includes("escalada_fora_horario");
      const lastOutboundPhase4 = (recentOutbound || []).slice(-1)[0] || "";
      const respNormPhase4 = norm(String(resposta || ""));
      const lastOutNormPhase4 = norm(lastOutboundPhase4);
      const podeRodarPhase4 =
        !_toolDeterministica &&
        !_isEscaladaJa &&
        inboundCount > 1 &&
        respNormPhase4.length > 20 &&
        lastOutNormPhase4.length > 20;

      if (podeRodarPhase4) {
        const simPhase4 = computeSimilarity(respNormPhase4, lastOutNormPhase4);
        if (simPhase4 > 0.80) {
          console.log(`[PHASE4-LOOP] Resposta gerada com sim=${(simPhase4 * 100).toFixed(0)}% vs última outbound — escalando imediatamente`);

          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "loop_ia_pos_llm_jaccard",
            descricao: `Anti-loop pós-LLM: resposta nova com similaridade ${(simPhase4 * 100).toFixed(0)}% — handoff imediato`,
            metadata: {
              similarity: simPhase4,
              tools_chamadas: _toolNamesPhase4,
              resposta_proposta: String(resposta || "").substring(0, 300),
              ultima_outbound: lastOutboundPhase4.substring(0, 300),
            },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });

          await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento_id);

          const _np4 = (contatoNomeAtual || "").split(/\s+/)[0] || "";
          const escMsg4 = isHorarioHumano()
            ? "Vou chamar alguém da equipe pra te ajudar melhor com isso, tá? 😊"
            : mensagemEscaladaForaHorario(_np4);
          await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, escMsg4);

          return jsonResponse({
            status: "ok",
            tools_used: ["loop_pos_llm_escalation"],
            intencao: "outro",
            precisa_humano: true,
            pipeline_coluna_sugerida: "Novo Contato",
            modo: "humano",
            similarity: simPhase4,
          });
        }
      }
    } catch (e) {
      console.warn("[PHASE4-LOOP] guardrail falhou — seguindo com envio normal", e);
    }

    if (isReceitaConfirmText(resposta)) {
      await sendReceitaConfirmInteractive(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, resposta);
    } else {
      await sendWhatsApp(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, resposta);
      if (direcionarAgendamentoLoja && !precisa_humano) {
        await sendListaCidades(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id, atendimentoMeta);
      }
      // Follow-up determinístico após cotação de óculos/LC: oferece próximos passos em botões
      try {
        const _toolNamesQ: string[] = Array.isArray(toolCalls) ? toolCalls.map((t: any) => t?.function?.name).filter(Boolean) : [];
        const _quoteFired = _toolNamesQ.some((n) =>
          n === "consultar_lentes" || n === "consultar_lentes_contato" || n === "consultar_lentes_estimativa"
        );
        const _agFired = _toolNamesQ.some((n) => n === "agendar_visita" || n === "reagendar_visita");
        if (_quoteFired && !_agFired) {
          await sendPostQuoteButtons(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimento_id);
        }
      } catch (e) {
        console.warn("[POS-QUOTE-BTN] falha ao enviar botões pós-cotação:", e);
      }
    }

    // ── 10.05. DETECTOR PÓS-LLM: agendamento prometido sem tool disparada ──
    // Se a resposta da IA contém promessa de agendamento (data + hora + loja) mas a tool
    // agendar_visita NÃO foi chamada e não há linha em `agendamentos` cobrindo essa data,
    // dispara `agendar-cliente` em background pra persistir. Idempotente.
    try {
      const _toolNames: string[] = Array.isArray(toolCalls) ? toolCalls.map((t: any) => t?.function?.name).filter(Boolean) : [];
      const _toolFiredAg = _toolNames.includes("agendar_visita") || _toolNames.includes("reagendar_visita");
      const respLow = String(resposta || "").toLowerCase();
      const promessaRe = /(agendamento confirmado|te (esperamos|espero)|ficou (re)?agendado|fica reagendado|ficou marcad[ao]|deixei marcad[ao]|ag(endei|endado) (para|pra)|marquei (para|pra) (voc[eê]|vc))/i;
      const temPromessa = promessaRe.test(respLow);
      if (!_toolFiredAg && temPromessa && Array.isArray(lojas) && lojas.length > 0) {
        // Extrair data DD/MM
        const dateMatch = String(resposta).match(/\b(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/);
        // Extrair hora HH:MM ou HHh ou HHhMM
        const timeMatch = String(resposta).match(/\b(\d{1,2})\s*(?:h(?:oras?)?|:)\s*(\d{0,2})\b/i);
        // Match loja por nome (subset case-insensitive)
        const respUp = String(resposta).toUpperCase();
        const lojaMatch = (lojas as any[]).find((l: any) => {
          const nome = String(l.nome_loja || "").toUpperCase();
          if (!nome) return false;
          // Tokens distintivos: pegar última palavra significativa (>3 chars)
          const tokens = nome.split(/\s+/).filter((t: string) => t.length > 3);
          return tokens.some((t: string) => respUp.includes(t));
        });
        if (dateMatch && timeMatch && lojaMatch) {
          const dd = dateMatch[1].padStart(2, "0");
          const mm = dateMatch[2].padStart(2, "0");
          const yyyyRaw = dateMatch[3];
          const now = new Date();
          let yyyy: number;
          if (yyyyRaw) {
            yyyy = yyyyRaw.length === 2 ? 2000 + Number(yyyyRaw) : Number(yyyyRaw);
          } else {
            // Inferir ano: se data < hoje no ano corrente, é provavelmente do próximo ano
            yyyy = now.getFullYear();
            const tentative = new Date(`${yyyy}-${mm}-${dd}T12:00:00-03:00`).getTime();
            if (tentative < now.getTime() - 24 * 3600 * 1000) yyyy += 1;
          }
          const hh = String(Math.min(23, Math.max(0, Number(timeMatch[1])))).padStart(2, "0");
          const mn = String(timeMatch[2] && timeMatch[2].length > 0 ? Number(timeMatch[2]) : 0).padStart(2, "0");
          const dataIso = `${yyyy}-${mm}-${dd}T${hh}:${mn}:00-03:00`;

          // Anti-duplicação: já existe agendamento para essa loja+data?
          const targetDate = `${yyyy}-${mm}-${dd}`;
          const jaExiste = (agendamentosAtivos || []).some((a: any) =>
            String(a.loja_nome || "").toLowerCase() === String(lojaMatch.nome_loja || "").toLowerCase() &&
            String(a.data_horario || "").substring(0, 10) === targetDate &&
            ["agendado", "confirmado", "lembrete_enviado"].includes(a.status)
          );
          if (!jaExiste) {
            console.log(`[POS-LLM-AGENDA] IA prometeu agendamento sem tool — persistindo: ${lojaMatch.nome_loja} ${dataIso}`);
            // Fire-and-forget (não bloqueia resposta)
            fetch(`${SUPABASE_URL}/functions/v1/agendar-cliente`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                contato_id: contatoId,
                atendimento_id,
                loja_nome: lojaMatch.nome_loja,
                loja_telefone: lojaMatch.telefone || null,
                data_horario: dataIso,
                observacoes: "Agendamento auto-persistido (IA prometeu sem disparar tool)",
              }),
            }).catch((e) => console.error("[POS-LLM-AGENDA] agendar-cliente bg call failed:", e));
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "agendamento_auto_persistido",
              descricao: `Detector pós-LLM disparou agendar-cliente: ${lojaMatch.nome_loja} ${dataIso}`,
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id,
              metadata: { loja_nome: lojaMatch.nome_loja, data_horario: dataIso, source: "post_llm_detector" },
            }).then(() => undefined, () => undefined);
          } else {
            console.log("[POS-LLM-AGENDA] Já existe agendamento para essa data/loja — skip");
          }
        } else {
          console.log(`[POS-LLM-AGENDA] Promessa detectada mas extração incompleta: date=${!!dateMatch} time=${!!timeMatch} loja=${!!lojaMatch}`);
        }
      }
    } catch (e) {
      console.error("[POS-LLM-AGENDA] detector falhou:", e);
    }


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
        tools_used: toolCalls.map((t: any) => t?.function?.name).filter(Boolean),
      },
      referencia_tipo: "atendimento",
      referencia_id: atendimento_id,
    });

    console.log(`[RESULT] tools=${toolCalls.map((t: any) => t.function?.name).join(",") || "text"} | intent=${intencao} | human=${precisa_humano} | col=${pipeline_coluna} | validator=${validatorFlags.join(",")}`);

    // ── SHADOW CLASSIFIER — coleta resultado paralelo e loga (fire-and-forget) ──
    // Por este ponto o mini (~500ms) já resolveu — o gpt-5 principal levou ~2s+.
    // Timeout de 200ms como defesa; falha não afeta o atendimento.
    if (_shadowP) {
      try {
        const _sr = await Promise.race([
          _shadowP,
          new Promise<null>((r) => setTimeout(() => r(null), 200)),
        ]);
        if (_sr) {
          const _rawMsg = String(currentMsg || "").slice(0, 200);
          const _hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(_rawMsg));
          const _msgHash = Array.from(new Uint8Array(_hashBuf)).slice(0, 8)
            .map((b) => b.toString(16).padStart(2, "0")).join("");
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "classifier_shadow",
            descricao: `shadow:${_sr.intencao}(${_sr.confianca.toFixed(2)}) | cascata:${intencao}`,
            metadata: {
              intencao_classificador: _sr.intencao,
              confianca: _sr.confianca,
              rota_cascata_real: intencao,
              latencia_ms: _sr.latencia_ms,
              msg_hash: _msgHash,
            },
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id,
          });
          console.log(`[CLASSIFIER-SHADOW] intent=${_sr.intencao} conf=${_sr.confianca.toFixed(2)} | cascata=${intencao} | lat=${_sr.latencia_ms}ms`);
        }
      } catch (e) {
        console.warn("[CLASSIFIER-SHADOW] log falhou, seguindo normal:", (e as Error)?.message);
      }
    }

    // Clear debounce lock — update simples, sem read-modify-write
    await supabase.from("atendimentos")
      .update({ ia_lock_at: null })
      .eq("id", atendimento_id);

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
    // Clear lock on error too — update simples, sem read-modify-write
    try {
      if (atendimentoIdForCleanup) {
        await supabase.from("atendimentos")
          .update({ ia_lock_at: null })
          .eq("id", atendimentoIdForCleanup);
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

// ── Quote helper: lê receitas do contato, escolhe a melhor compatível com o label
// (preferindo a MAIS RECENTE e VÁLIDA), consulta pricing_table_lentes e formata 2-3 opções.
// Compartilhado por consultar_lentes e auto-chain pós interpretar_receita.
async function runConsultarLentes(
  supabase: any,
  contatoId: string,
  recentOutbound: string[],
  args: any,
  atendimentoId?: string,
): Promise<{ resposta: string }> {
  const { data: contatoRx } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
  const contatoRxMeta = (contatoRx?.metadata as Record<string, any>) || {};

  // Defesa: bloqueia cotação enquanto cliente não confirmou a receita lida via OCR.
  if (isReceitaPending(contatoRxMeta)) {
    const lastRx = Array.isArray(contatoRxMeta.receitas) && contatoRxMeta.receitas.length > 0
      ? contatoRxMeta.receitas[contatoRxMeta.receitas.length - 1]
      : (contatoRxMeta.ultima_receita || null);
    try {
      if (atendimentoId) {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "consultar_lentes_bloqueado_pendente_confirmacao",
          descricao: `Tool consultar_lentes bloqueada — receita aguardando confirmação do cliente`,
          metadata: { tool: "consultar_lentes", rx_label: contatoRxMeta.receita_confirmacao?.rx_label },
          referencia_tipo: "atendimento", referencia_id: atendimentoId,
        });
      }
    } catch (_) { /* noop */ }
    const respPend = lastRx
      ? buildMsgConfirmarReceita(lastRx, false)
      : "Antes de te passar as opções, preciso que você confirme os valores que li da sua receita 😊";
    return { resposta: respPend };
  }

  let allRx: any[] = [];
  if (Array.isArray(contatoRxMeta.receitas) && contatoRxMeta.receitas.length > 0) {
    allRx = contatoRxMeta.receitas;
  } else if (contatoRxMeta.ultima_receita && contatoRxMeta.ultima_receita.eyes) {
    allRx = [{ ...contatoRxMeta.ultima_receita, label: "cliente" }];
  }

  // Seleção robusta: prioriza receita VÁLIDA mais recente.
  // Se label foi pedido, filtra por label antes; entre as do label, pega a válida mais recente.
  // Cai pra última válida geral, e só então pra última receita (mesmo inválida).
  let rxMeta: any = null;
  if (allRx.length > 0) {
    const candidatas = args?.receita_label
      ? allRx.filter((r: any) => norm(r.label || "") === norm(args.receita_label))
      : allRx;
    const pool = candidatas.length > 0 ? candidatas : allRx;
    const validas = pool.filter((r: any) => isReceitaValida(r));
    if (validas.length > 0) {
      rxMeta = validas[validas.length - 1];
    } else {
      rxMeta = pool[pool.length - 1];
    }
    console.log(`[QUOTE] Selected rx label="${rxMeta?.label}" data_leitura=${rxMeta?.data_leitura} valida=${isReceitaValida(rxMeta)} (${validas.length}/${pool.length} válidas no pool)`);
  }

  if (!rxMeta || !rxMeta.eyes) {
    return { resposta: args?.resposta_fallback || "Ainda não tenho sua receita. Me envia uma foto da receita que eu já busco as melhores opções pra você! 📸" };
  }

  const od = rxMeta.eyes.od || {};
  const oe = rxMeta.eyes.oe || {};
  const rxType = rxMeta.rx_type || "unknown";
  const sphereValues = [od.sphere, oe.sphere].filter((v: any) => typeof v === "number") as number[];
  const cylValues = [od.cylinder, oe.cylinder].filter((v: any) => typeof v === "number") as number[];
  const addValues = [od.add, oe.add].filter((v: any) => typeof v === "number") as number[];

  const sphereLooksAbsurd = sphereValues.some((v: number) => Math.abs(v) > 25);
  if (rxType === "unknown" || sphereValues.length === 0 || sphereLooksAbsurd) {
    console.log(`[QUOTE] Prescription incomplete (rxType=${rxType}, sphereCount=${sphereValues.length}, absurd=${sphereLooksAbsurd}) — asking structured values`);
    return { resposta: "Pra montar o orçamento certinho dessa *lente personalizada*, me confirma os valores da receita por texto, por favor?\n• OD: esférico / cilíndrico / eixo\n• OE: esférico / cilíndrico / eixo\n(Se tiver adição pra perto, manda também 😊)" };
  }

  const worstSphere = sphereValues.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0);
  const worstCylinder = cylValues.length > 0 ? cylValues.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0) : 0;
  const maxAdd = addValues.length > 0 ? Math.max(...addValues) : null;
  const hasAddition = addValues.length > 0;

  const categoryMap: Record<string, string[]> = {
    single_vision: ["single_vision", "single_vision_digital", "single_vision_stock", "single_vision_digital_kids", "single", "digital", "visao_simples", "special_myopia", "special_drive", "special_sport", "myopia_control", "especial", "special"],
    progressive: ["progressive", "progressiva", "occupational", "ocupacional"],
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
  if (args?.filtro_blue === true) query = query.eq("blue", true);
  if (args?.filtro_photo === true) query = query.eq("photo", true);
  if (args?.preferencia_marca) query = query.ilike("brand", `%${args.preferencia_marca}%`);

  const { data: lensesRaw } = await query.order("priority", { ascending: true }).order("price_brl", { ascending: true }).limit(60);

  // ── Visão monocular: 1 lente apenas → divide preços por 2 ──
  const isMonocular = rxMeta?.monocular === true;
  const lenses = (lensesRaw || []).map((l: any) => isMonocular ? { ...l, price_brl: Number(l.price_brl) / 2 } : l);

  if (!lenses || lenses.length === 0) {
    const filtrosAplicados = {
      rx_type: rxType,
      sphere: worstSphere,
      cylinder: worstCylinder,
      add: maxAdd,
      filtro_blue: !!args?.filtro_blue,
      filtro_photo: !!args?.filtro_photo,
      preferencia_marca: args?.preferencia_marca || null,
      receita_label: rxMeta?.label || null,
    };
    console.log(`[QUOTE-ZERO] ${JSON.stringify({ tool: "consultar_lentes", contato_id: contatoId, atendimento_id: atendimentoId, ...filtrosAplicados })}`);

    // Loga evento explícito pra auditoria (caso Cleber 2026-05-06 — gap real do catálogo).
    try {
      await supabase.from("eventos_crm").insert({
        contato_id: contatoId,
        tipo: "consultar_lentes_zero_resultados",
        descricao: `consultar_lentes não encontrou lentes para ${rxType} sphere=${worstSphere} cyl=${worstCylinder} add=${maxAdd ?? "—"}`,
        metadata: { tool: "consultar_lentes", ...filtrosAplicados },
        referencia_tipo: atendimentoId ? "atendimento" : null,
        referencia_id: atendimentoId || null,
      });
    } catch (e) { console.warn("[QUOTE] failed to log consultar_lentes_zero_resultados", e); }

    // FALLBACK AUTOMÁTICO PRA ESTIMATIVA — caso Cleber 2026-05-06 (Fase 2 endurecida).
    // Catálogo não cobre a combinação exata? Em vez de empurrar pra loja sem dar valor,
    // tenta a tool de estimativa (faixas econômica/intermediária/premium) com o tipo + esférico.
    //
    // GUARDRAILS (anti-loop / só re-disparar quando faz sentido):
    //  G1. Já mandei a estimativa de gap nas últimas 3 outbounds? → não repete (loop).
    //  G2. Cliente pediu marca específica (preferencia_marca)? → estimativa traria outras marcas e
    //      confundiria ("pedi DMAX e a IA mandou ZEISS"). Pula fallback, vai pra loja.
    //  G3. Filtros opcionais ativos (blue/photo)? Estimativa relaxa esses filtros pra achar faixa,
    //      mas mantemos os mesmos flags pra não enganar o cliente (já passados abaixo).
    //  G4. rxType desconhecido / não suportado? Estimativa só sabe single_vision e progressive.
    const prefixGap = `Pra esse grau específico`;
    const recentNormFb = (recentOutbound || []).slice(-3).map(norm);
    const fallbackJaEnviado = recentNormFb.some((p) => p && p.includes(norm(prefixGap)));
    // BYPASS G1: quando o cliente acabou de confirmar a receita (`confirmed_by_client_at`),
    // a re-emissão da estimativa NÃO é loop — é a cotação determinística obrigatória pós-confirmação.
    // Caso Franciana (Mai/2026): segunda confirmação caía no caminho mudo "região/bairro"
    // sem preços e sem ligar revisao_humana_pendente.
    const rxJaConfirmadaG1 = !!rxMeta?.confirmed_by_client_at;
    const podeFallback =
      (rxType === "progressive" || rxType === "single_vision") &&
      (!fallbackJaEnviado || rxJaConfirmadaG1) &&
      !args?.preferencia_marca;

    if (!podeFallback) {
      const motivo = fallbackJaEnviado
        ? "fallback_ja_enviado_recente"
        : args?.preferencia_marca
          ? "preferencia_marca_definida"
          : `rx_type_nao_suportado:${rxType}`;
      console.log(`[QUOTE] fallback estimativa SKIP (${motivo})`);
      try {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "consultar_lentes_fallback_estimativa_skip",
          descricao: `Fallback estimativa não disparado: ${motivo}`,
          metadata: { motivo, rx_ja_confirmada: rxJaConfirmadaG1, ...filtrosAplicados },
          referencia_tipo: atendimentoId ? "atendimento" : null,
          referencia_id: atendimentoId || null,
        });
      } catch (e) { console.warn("[QUOTE] failed to log fallback_skip", e); }
    } else {
      if (fallbackJaEnviado && rxJaConfirmadaG1) {
        console.log("[QUOTE] G1 bypass: estimativa re-emitida porque receita acabou de ser confirmada");
        try {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "cotacao_estimativa_pos_confirmacao_bypass_g1",
            descricao: "Estimativa re-emitida após confirmação de receita (G1 anti-loop bypassado)",
            metadata: { rx_label: rxMeta?.label, ...filtrosAplicados },
            referencia_tipo: atendimentoId ? "atendimento" : null,
            referencia_id: atendimentoId || null,
          });
        } catch (e) { console.warn("[QUOTE] failed to log bypass_g1", e); }
      }
      try {
        const rxJaConfirmada = rxJaConfirmadaG1;
        const est = await runConsultarLentesEstimativa(supabase, {
          rx_type: rxType,
          sphere_od: typeof od.sphere === "number" ? od.sphere : undefined,
          sphere_oe: typeof oe.sphere === "number" ? oe.sphere : undefined,
          filtro_blue: args?.filtro_blue === true ? true : undefined,
          filtro_photo: args?.filtro_photo === true ? true : undefined,
          rx_ja_confirmada: rxJaConfirmada,
        }, contatoId, atendimentoId);
        if (est?.resposta && !/preciso confirmar a disponibilidade/i.test(est.resposta)) {
          console.log(`[QUOTE] zero-linhas → fallback estimativa OK (rx_confirmada=${rxJaConfirmada})`);
          try {
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: rxJaConfirmada ? "cotacao_estimativa_pos_confirmacao" : "consultar_lentes_fallback_estimativa_acionado",
              descricao: `Fallback acionado: catálogo zerou para ${rxType} sphere=${worstSphere} cyl=${worstCylinder}, estimativa cobriu`,
              metadata: { origem: "consultar_lentes_zero", rx_ja_confirmada: rxJaConfirmada, ...filtrosAplicados },
              referencia_tipo: atendimentoId ? "atendimento" : null,
              referencia_id: atendimentoId || null,
            });
          } catch (e) { console.warn("[QUOTE] failed to log fallback_acionado", e); }
          // Se já enviamos prefixo padrão antes, troca por variante leve pra não parecer cópia carbono.
          const prefix = (fallbackJaEnviado && rxJaConfirmada)
            ? `Conforme te passei, suas opções pra esse grau:\n\n`
            : `${prefixGap} (com cilíndrico mais alto) confirmamos a opção exata na loja, mas já te dou uma referência de preço:\n\n`;
          let respostaFinal = prefix + est.resposta;
          if (rxJaConfirmada) {
            try {
              const rev = requerRevisaoHumanaPosOrcamento(rxMeta);
              if (rev.precisa && !respostaFinal.includes(MSG_REVISAO_HUMANA_SUFIXO)) {
                respostaFinal = respostaFinal + MSG_REVISAO_HUMANA_SUFIXO;
                if (atendimentoId) {
                  try {
                    const { data: atFlag } = await supabase
                      .from("atendimentos").select("metadata").eq("id", atendimentoId).single();
                    const metaFlag = (atFlag?.metadata as Record<string, any>) || {};
                    await supabase.from("atendimentos").update({
                      metadata: {
                        ...metaFlag,
                        revisao_humana_pendente: true,
                        revisao_motivos: rev.motivos,
                        revisao_solicitada_at: new Date().toISOString(),
                      },
                    }).eq("id", atendimentoId);
                    await supabase.from("eventos_crm").insert({
                      contato_id: contatoId,
                      tipo: "revisao_humana_pos_cotacao",
                      descricao: "Revisão humana sinalizada após cotação por estimativa (cyl/add fora da faixa principal)",
                      metadata: { motivos: rev.motivos },
                      referencia_tipo: "atendimento", referencia_id: atendimentoId,
                    });
                  } catch (_) { /* noop */ }
                }
              }
            } catch (_) { /* noop */ }
          }
          const respostaNorm = norm(respostaFinal);
          const isDup = recentNormFb.some((p) => p && (p === respostaNorm || computeSimilarity(p, respostaNorm) > 0.85));
          if (isDup && !rxJaConfirmada) {
            console.log(`[QUOTE] fallback estimativa gerou texto duplicado → escala suave pra loja`);
          } else {
            return { resposta: respostaFinal };
          }
        }
      } catch (e) {
        console.warn("[QUOTE] estimativa fallback falhou", e);
      }
    }

    // Fallback final mudo: se a receita está confirmada e é complexa, ANTES de devolver
    // "região/bairro" liga revisao_humana_pendente + anexa sufixo pra alertar o consultor.
    let respFallbackFinal = args?.resposta_fallback || "Pra esses graus específicos preciso confirmar a disponibilidade direto na loja antes de te passar o valor exato 😊 Em qual região/bairro você está? Já te indico a unidade mais próxima pra você ver as opções pessoalmente.";
    if (rxJaConfirmadaG1 && atendimentoId) {
      try {
        const rev = requerRevisaoHumanaPosOrcamento(rxMeta);
        if (rev.precisa) {
          const { data: atFlag } = await supabase
            .from("atendimentos").select("metadata").eq("id", atendimentoId).single();
          const metaFlag = (atFlag?.metadata as Record<string, any>) || {};
          if (!metaFlag?.revisao_humana_pendente) {
            await supabase.from("atendimentos").update({
              metadata: {
                ...metaFlag,
                revisao_humana_pendente: true,
                revisao_motivos: rev.motivos,
                revisao_solicitada_at: new Date().toISOString(),
              },
            }).eq("id", atendimentoId);
            await supabase.from("eventos_crm").insert({
              contato_id: contatoId,
              tipo: "revisao_humana_pos_cotacao_fallback_mudo",
              descricao: "Revisão humana ligada no fallback final (caminho região/bairro) — receita confirmada e complexa",
              metadata: { motivos: rev.motivos },
              referencia_tipo: "atendimento", referencia_id: atendimentoId,
            });
          }
          if (!respFallbackFinal.includes(MSG_REVISAO_HUMANA_SUFIXO)) {
            respFallbackFinal = respFallbackFinal + MSG_REVISAO_HUMANA_SUFIXO;
          }
        }
      } catch (e) { console.warn("[QUOTE] fallback final revisao humana falhou", e); }
    }
    return { resposta: respFallbackFinal };

  }

  // Display da marca (Title Case) — banco tem "Hoya" e "HOYA" duplicados.
  const brandDisplay = (b: string) => {
    const up = String(b || "").trim().toUpperCase();
    if (["HOYA", "DNZ", "DMAX", "ZEISS"].includes(up)) return up;
    return up.charAt(0) + up.slice(1).toLowerCase();
  };
  const brandKey = (b: string) => String(b || "").trim().toUpperCase();

  const formatLens = (l: any, label: string) =>
    `${label}: *${brandDisplay(l.brand)} ${l.family}* | Índice ${l.index_name} | ${l.treatment}${l.blue ? " + Filtro Azul" : ""}${l.photo ? " + Fotossensível" : ""} — *R$ ${Number(l.price_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}*`;

  const odDisp = od?.blind ? "—" : `${od.sphere ?? "—"}/${od.cylinder ?? "—"}`;
  const oeDisp = oe?.blind ? "—" : `${oe.sphere ?? "—"}/${oe.cylinder ?? "—"}`;
  const monoNota = isMonocular ? `_💡 Valores já considerando apenas 1 lente (visão monocular — ${rxMeta.eye_used === "od" ? "OD" : "OE"})._\n\n` : "";
  let quoteMsg = `🔍 *Opções de lentes para o seu grau:*\nOD ${odDisp} | OE ${oeDisp}${hasAddition ? ` | Ad: +${maxAdd}` : ""}\n\n${monoNota}`;

  // ---- Diversificação por marca + 3 faixas ----
  // Quando o cliente fixou marca, mantém comportamento legado (sem diversificar)
  // PORÉM ordenando por PREÇO ASC (não por priority) — query original ordena por
  // priority+price, o que pode inverter faixas quando há SKUs da mesma marca com
  // priority distinta. Caso Natan 16/05/2026: Liberty+Crizal R$2.135 caía em
  // "Econômica" enquanto Comfort Max R$1.699 caía em "Premium" (inversão grosseira).
  if (args?.preferencia_marca) {
    const sortedByPrice = [...lenses].sort((a, b) => Number(a.price_brl) - Number(b.price_brl));
    const economy = sortedByPrice[0];
    const premium = sortedByPrice[sortedByPrice.length - 1];
    const midIndex = Math.floor(sortedByPrice.length / 2);
    const mid = sortedByPrice.length >= 3 ? sortedByPrice[midIndex] : null;
    quoteMsg += formatLens(economy, "💚 Econômica");
    if (mid && mid.id !== economy.id && mid.id !== premium.id && Number(mid.price_brl) > Number(economy.price_brl)) {
      quoteMsg += "\n" + formatLens(mid, "💛 Intermediária");
    }
    if (premium.id !== economy.id && Number(premium.price_brl) > Number(economy.price_brl)) {
      quoteMsg += "\n" + formatLens(premium, "💎 Premium");
    }
  } else {
    // 1) Agrupa por marca (case-insensitive) e pega a mais barata de cada.
    const cheapestByBrand = new Map<string, any>();
    for (const l of lenses) {
      const k = brandKey(l.brand);
      if (!cheapestByBrand.has(k)) cheapestByBrand.set(k, l);
    }
    // 2) Particiona o catálogo em 3 faixas por percentil (econômica / intermediária / premium).
    const sorted = [...lenses].sort((a, b) => Number(a.price_brl) - Number(b.price_brl));
    const p1 = Number(sorted[Math.floor(sorted.length / 3)]?.price_brl ?? 0);
    const p2 = Number(sorted[Math.floor((2 * sorted.length) / 3)]?.price_brl ?? 0);
    const faixaDe = (preco: number): "eco" | "inter" | "prem" => preco <= p1 ? "eco" : preco <= p2 ? "inter" : "prem";

    // 3) Para cada faixa, pega até 2 entradas com marcas distintas.
    //    Em MULTIFOCAL Premium sem marca pedida, prioriza Varilux/Essilor antes
    //    do loop — regra comercial: Premium multifocal = referência Varilux.
    const isVarilux = (l: any) => /essilor|varilux/i.test(String(l.brand || "")) || /varilux/i.test(String(l.family || ""));
    const pickPorFaixa = (faixa: "eco" | "inter" | "prem"): any[] => {
      let pool = sorted.filter((l) => faixaDe(Number(l.price_brl)) === faixa);
      if (faixa === "prem" && rxType === "progressive") {
        // Ranqueia Varilux primeiro; empate desfaz por preço (sorted já está por preço asc).
        pool = [...pool].sort((a, b) => {
          const va = isVarilux(a) ? 0 : 1;
          const vb = isVarilux(b) ? 0 : 1;
          if (va !== vb) return va - vb;
          return Number(a.price_brl) - Number(b.price_brl);
        });
      }
      const seen = new Set<string>();
      const out: any[] = [];
      for (const l of pool) {
        const k = brandKey(l.brand);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(l);
        if (out.length >= 2) break;
      }
      // Se a faixa só tem uma marca, completa com a 2ª lente da mesma marca (próximo upgrade).
      if (out.length === 1 && pool.length > 1) {
        const next = pool.find((l) => l.id !== out[0].id);
        if (next) out.push(next);
      }
      return out;
    };

    let eco = pickPorFaixa("eco");
    let inter = pickPorFaixa("inter");
    let prem = pickPorFaixa("prem");

    // 4) Garante que marcas presentes no catálogo mas que não entraram em nenhuma faixa
    //    apareçam pelo menos uma vez (priorizando faixa equivalente à mais barata delas).
    const usados = new Set<number>([...eco, ...inter, ...prem].map((l) => l.id));
    for (const [_k, l] of cheapestByBrand.entries()) {
      if (usados.has(l.id)) continue;
      const f = faixaDe(Number(l.price_brl));
      const target = f === "eco" ? eco : f === "inter" ? inter : prem;
      if (target.length < 2) {
        target.push(l);
        usados.add(l.id);
      }
    }

    // 4b) VALIDADOR ANTI-INVERSÃO — garante min(eco) ≤ min(inter) ≤ min(prem).
    //     Caso quebre (cross-contamination por inclusão da etapa 4), descarta diversificação
    //     e re-particiona puramente por preço. Caso Natan 16/05/2026.
    const minPreco = (arr: any[]) => arr.length ? Math.min(...arr.map((l) => Number(l.price_brl))) : Infinity;
    const minEco = minPreco(eco);
    const minInter = minPreco(inter);
    const minPrem = minPreco(prem);
    const inversao = (eco.length && inter.length && minEco > minInter)
                  || (inter.length && prem.length && minInter > minPrem)
                  || (eco.length && prem.length && minEco > minPrem);
    if (inversao) {
      console.warn(`[QUOTE] faixas inconsistentes (eco=${minEco} inter=${minInter} prem=${minPrem}) — re-particionando por preço puro`);
      try {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "cotacao_faixas_inconsistentes",
          descricao: `Inversão de faixas detectada — re-particionado por preço puro`,
          metadata: { eco: eco.map((l: any) => ({ brand: l.brand, family: l.family, price: l.price_brl })),
                      inter: inter.map((l: any) => ({ brand: l.brand, family: l.family, price: l.price_brl })),
                      prem: prem.map((l: any) => ({ brand: l.brand, family: l.family, price: l.price_brl })) },
          referencia_tipo: atendimentoId ? "atendimento" : null,
          referencia_id: atendimentoId || null,
        });
      } catch (_) { /* noop */ }
      // Re-particionamento determinístico por preço
      const n = sorted.length;
      const i1 = Math.max(1, Math.floor(n / 3));
      const i2 = Math.max(i1 + 1, Math.floor((2 * n) / 3));
      eco = sorted.slice(0, i1).slice(0, 2);
      inter = sorted.slice(i1, i2).slice(0, 2);
      prem = sorted.slice(i2).slice(0, 2);
    }

    const renderFaixa = (label: string, itens: any[]) => {
      if (itens.length === 0) return "";
      const linhas = itens
        .sort((a, b) => Number(a.price_brl) - Number(b.price_brl))
        .map((l) => `  • *${brandDisplay(l.brand)} ${l.family}* ${l.index_name} ${l.treatment}${l.blue ? " + Azul" : ""}${l.photo ? " + Foto" : ""} — *R$ ${Number(l.price_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}*`)
        .join("\n");
      return `${label}\n${linhas}\n\n`;
    };

    quoteMsg += renderFaixa("🟢 *Econômica:*", eco);
    quoteMsg += renderFaixa("🟡 *Intermediária:*", inter);
    quoteMsg += renderFaixa("💎 *Premium:*", prem);
    quoteMsg = quoteMsg.replace(/\n{3,}$/, "\n\n").trimEnd();
  }
  quoteMsg += "\n\n" + MSG_CTA_AGENDAMENTO;

  // Receita complexa cotável → sufixo + sinalização interna (não escala atendimento)
  const revisao = requerRevisaoHumanaPosOrcamento(rxMeta);
  if (revisao.precisa) {
    quoteMsg += MSG_REVISAO_HUMANA_SUFIXO;
    try {
      // Idempotência: evita duplicar evento/notificação nos últimos 30min para o mesmo atendimento
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: jaExiste } = atendimentoId
        ? await supabase.from("eventos_crm")
            .select("id")
            .eq("tipo", "orcamento_revisao_humana")
            .eq("referencia_id", atendimentoId)
            .gte("created_at", since)
            .limit(1)
        : { data: null };
      if (!jaExiste || jaExiste.length === 0) {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "orcamento_revisao_humana",
          descricao: `Orçamento gerado com receita complexa (${revisao.motivos.join(", ")}) — revisar prazo/disponibilidade`,
          metadata: {
            motivos: revisao.motivos,
            rx: { od: rxMeta?.eyes?.od, oe: rxMeta?.eyes?.oe, rx_type: rxType },
            lentes_cotadas: lenses.slice(0, 5).map((l: any) => ({ id: l.id, brand: l.brand, family: l.family, price_brl: l.price_brl })),
          },
          referencia_tipo: atendimentoId ? "atendimento" : null,
          referencia_id: atendimentoId || null,
        });
        // Notifica setor do contato (ou nada se sem setor — evento já fica registrado)
        const { data: contatoSetor } = await supabase.from("contatos").select("setor_destino, nome").eq("id", contatoId).single();
        if (contatoSetor?.setor_destino) {
          await supabase.from("notificacoes").insert({
            tipo: "orcamento_revisao",
            titulo: "Orçamento com receita complexa — revisar",
            mensagem: `${contatoSetor.nome || "Cliente"}: ${revisao.motivos.join(", ")}`,
            setor_id: contatoSetor.setor_destino,
            referencia_id: atendimentoId || null,
          });
        }
        // Flag no atendimento pra UI exibir badge
        if (atendimentoId) {
          const { data: at } = await supabase.from("atendimentos").select("metadata").eq("id", atendimentoId).single();
          const meta = (at?.metadata as Record<string, any>) || {};
          await supabase.from("atendimentos").update({
            metadata: { ...meta, revisao_humana_pendente: true, revisao_motivos: revisao.motivos, revisao_solicitada_at: new Date().toISOString() },
          }).eq("id", atendimentoId);
        }
      }
    } catch (e) {
      console.warn("[QUOTE] failed to log orcamento_revisao_humana", e);
    }
  }

  const quoteNorm = norm(quoteMsg);
  const recentNormQuote = (recentOutbound || []).slice(-3).map(norm);
  const isDuplicate = recentNormQuote.some((prev) => {
    if (!prev) return false;
    if (prev === quoteNorm) return true;
    return computeSimilarity(prev, quoteNorm) > 0.9;
  });
  console.log(`[QUOTE] Found ${lenses.length} lenses for ${rxType} sphere=${worstSphere} cyl=${worstCylinder} add=${maxAdd}${isDuplicate ? " (DEDUPED)" : ""}${revisao.precisa ? ` [revisao:${revisao.motivos.join("|")}]` : ""}`);
  if (isDuplicate) {
    return { resposta: "Já te mandei as opções acima 😊 Quer que eu detalhe alguma delas, ou prefere agendar uma visita pra ver as armações pessoalmente?" };
  }
  // Snapshot da última cotação — habilita detector pre-LLM de reclamação de inversão
  // ("a econômica está mais cara que a intermediária") e melhora auditoria.
  if (atendimentoId) {
    try {
      const { data: atSnap } = await supabase.from("atendimentos").select("metadata").eq("id", atendimentoId).single();
      const metaSnap = (atSnap?.metadata as Record<string, any>) || {};
      await supabase.from("atendimentos").update({
        metadata: {
          ...metaSnap,
          ultima_cotacao: {
            at: new Date().toISOString(),
            args: {
              preferencia_marca: args?.preferencia_marca || null,
              filtro_blue: !!args?.filtro_blue,
              filtro_photo: !!args?.filtro_photo,
            },
            rx_type: rxType,
            lentes: (lenses || []).slice(0, 12).map((l: any) => ({ id: l.id, brand: l.brand, family: l.family, price: Number(l.price_brl) })),
          },
        },
      }).eq("id", atendimentoId);
    } catch (e) { console.warn("[QUOTE] snapshot ultima_cotacao falhou", e); }
  }
  return { resposta: quoteMsg };
}

// ── Estimativa multifocal/visão simples com receita PARCIAL ──
// Usado quando o cliente declara o tipo de lente (multifocal/progressiva/visão simples)
// e fornece pelo menos a esfera, mas falta ADD e/ou CIL/AX. Em vez de travar pedindo
// dados, devolve uma faixa estimada (econômica / intermediária / premium) e segue
// pedindo o que falta. NUNCA grava receita — é só uma simulação de mercado.
async function runConsultarLentesEstimativa(
  supabase: any,
  args: {
    rx_type?: "single_vision" | "progressive";
    sphere_od?: number | null;
    sphere_oe?: number | null;
    cylinder_hint?: number | null; // se cliente disse "tem astigmatismo" sem valor, passamos 0.75
    filtro_blue?: boolean;
    filtro_photo?: boolean;
    rx_ja_confirmada?: boolean; // quando true, suprime perguntas finais de "confirmar cilindro/ADD"
  },
  contatoId?: string,
  atendimentoId?: string,
): Promise<{ resposta: string }> {
  // Defesa: bloqueia estimativa enquanto cliente não confirmou a receita lida via OCR.
  if (contatoId) {
    try {
      const { data: cRx } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
      const cMeta = (cRx?.metadata as Record<string, any>) || {};
      if (isReceitaPending(cMeta)) {
        const lastRx = Array.isArray(cMeta.receitas) && cMeta.receitas.length > 0
          ? cMeta.receitas[cMeta.receitas.length - 1]
          : (cMeta.ultima_receita || null);
        if (atendimentoId) {
          await supabase.from("eventos_crm").insert({
            contato_id: contatoId,
            tipo: "consultar_lentes_bloqueado_pendente_confirmacao",
            descricao: `Tool consultar_lentes_estimativa bloqueada — receita aguardando confirmação`,
            metadata: { tool: "consultar_lentes_estimativa" },
            referencia_tipo: "atendimento", referencia_id: atendimentoId,
          });
        }
        const respPend = lastRx
          ? buildMsgConfirmarReceita(lastRx, false)
          : "Antes de te passar as faixas, preciso que você confirme os valores que li da receita 😊";
        return { resposta: respPend };
      }
    } catch (_) { /* noop */ }
  }
  const rxType = args?.rx_type === "progressive" ? "progressive" : "single_vision";
  const sphereCandidates = [args?.sphere_od, args?.sphere_oe].filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v),
  );
  if (sphereCandidates.length === 0) {
    return {
      resposta:
        "Pra estimar pelo menos uma faixa de valores, me confirma o esférico (grau) de cada olho? Pode ser só os números, sem precisar da receita inteira agora 😊",
    };
  }
  const worstSphere = sphereCandidates.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b), 0);
  // Cliente disse "astigmatismo" mas não deu CIL → presume cilindro pequeno (-0.75)
  // pra não excluir lentes tóricas básicas. Se passou um valor, usa-o.
  const worstCyl =
    typeof args?.cylinder_hint === "number" && !Number.isNaN(args.cylinder_hint)
      ? Math.abs(args.cylinder_hint) * -1
      : -0.75;

  const categories =
    rxType === "progressive"
      ? ["progressive", "occupational"]
      : ["single_vision", "single_vision_digital", "single_vision_stock"];

  // Para multifocal varremos 3 ADDs típicas (+1.50 / +2.00 / +2.50) e juntamos resultados;
  // para visão simples, basta uma rodada.
  const addsToTry = rxType === "progressive" ? [1.5, 2.0, 2.5] : [null];
  const collected: any[] = [];
  for (const add of addsToTry) {
    let q = supabase
      .from("pricing_table_lentes")
      .select("brand, family, treatment, index_name, blue, photo, price_brl, priority")
      .eq("active", true)
      .in("category", categories)
      .gt("price_brl", 0)
      .lte("sphere_min", worstSphere)
      .gte("sphere_max", worstSphere)
      .lte("cylinder_min", worstCyl)
      .gte("cylinder_max", worstCyl);
    if (rxType === "progressive" && add !== null) {
      q = q.lte("add_min", add).gte("add_max", add);
    }
    if (args?.filtro_blue === true) q = q.eq("blue", true);
    if (args?.filtro_photo === true) q = q.eq("photo", true);
    const { data } = await q.order("price_brl", { ascending: true }).limit(20);
    if (Array.isArray(data)) collected.push(...data);
  }

  if (collected.length === 0) {
    const filtrosAplicados = {
      rx_type: rxType,
      sphere: worstSphere,
      cylinder: worstCyl,
      adds_tested: addsToTry,
      filtro_blue: !!args?.filtro_blue,
      filtro_photo: !!args?.filtro_photo,
    };
    console.log(`[QUOTE-ZERO] ${JSON.stringify({ tool: "consultar_lentes_estimativa", contato_id: contatoId, atendimento_id: atendimentoId, ...filtrosAplicados })}`);
    if (contatoId) {
      try {
        await supabase.from("eventos_crm").insert({
          contato_id: contatoId,
          tipo: "consultar_lentes_zero_resultados",
          descricao: `consultar_lentes_estimativa não encontrou faixa para ${rxType} sphere=${worstSphere} cyl=${worstCyl}`,
          metadata: { tool: "consultar_lentes_estimativa", ...filtrosAplicados },
          referencia_tipo: atendimentoId ? "atendimento" : null,
          referencia_id: atendimentoId || null,
        });
      } catch (e) { console.warn("[QUOTE-EST] failed to log zero_resultados", e); }
    }
    return {
      resposta:
        "Pra esse grau específico preciso confirmar a disponibilidade direto na loja. Em qual região/bairro você está? Já te indico a unidade mais próxima 😊",
    };
  }

  // Dedup por brand+family+treatment+blue+photo, fica só o menor preço de cada combinação.
  const uniqMap = new Map<string, any>();
  for (const l of collected) {
    const key = `${l.brand}|${l.family}|${l.treatment}|${l.blue ? 1 : 0}|${l.photo ? 1 : 0}`;
    const cur = uniqMap.get(key);
    if (!cur || Number(l.price_brl) < Number(cur.price_brl)) uniqMap.set(key, l);
  }
  const sorted = Array.from(uniqMap.values()).sort(
    (a, b) => Number(a.price_brl) - Number(b.price_brl),
  );
  // ── Seleção das 3 faixas com hierarquia de marcas ──
  const brandMatch = (b: string, names: string[]) =>
    names.some((n) => b.toLowerCase() === n.toLowerCase());
  const isBasicBrand = (b: string) => brandMatch(b, ["dmax", "dnz"]);
  const isMidBrand = (b: string) => brandMatch(b, ["hoya", "essilor"]);
  const isZeiss = (b: string) => b.toLowerCase() === "zeiss";
  const isKodak = (b: string) => b.toLowerCase() === "kodak";

  // BÁSICA: mais barato entre DMax/DNZ; fallback = mais barato excluindo ZEISS e Kodak
  let economy: any = sorted.find((p) => isBasicBrand(p.brand)) ?? null;
  if (!economy) {
    economy = sorted.find((p) => !isZeiss(p.brand) && !isKodak(p.brand)) ?? sorted[0];
    if (economy) console.warn(`[QUOTE-EST] básica fallback para ${economy.brand} (sem DMax/DNZ disponível)`);
  }

  // INTERMEDIÁRIA: mais barato entre Hoya/Essilor que não seja o mesmo produto da básica.
  // Para progressivas, prioriza family contendo "Hoyalux D+" se disponível.
  let mid: any = null;
  const midCandidates = sorted.filter((p) => isMidBrand(p.brand) && p !== economy);
  if (midCandidates.length > 0) {
    if (rxType === "progressive") {
      const hoyaluxDPlus = midCandidates.find((p) =>
        p.family?.toLowerCase().includes("hoyalux d+"),
      );
      mid = hoyaluxDPlus ?? midCandidates[0];
    } else {
      mid = midCandidates[0];
    }
  }
  if (!mid && sorted.length >= 3) {
    mid = sorted[Math.floor(sorted.length / 2)];
    if (mid === economy) mid = null;
    if (mid) console.warn(`[QUOTE-EST] intermediária fallback para ${mid.brand} (sem Hoya/Essilor disponível)`);
  }

  // PREMIUM: mais caro da lista; substitui ZEISS pelo segundo mais caro se houver alternativa.
  let premium: any = sorted[sorted.length - 1];
  if (isZeiss(premium.brand) && sorted.length >= 2) {
    const alt = [...sorted].reverse().find((p) => !isZeiss(p.brand));
    if (alt) {
      console.warn(`[QUOTE-EST] premium ZEISS substituído por ${alt.brand} (proativo bloqueado)`);
      premium = alt;
    }
  }

  // Visão monocular: divide preços por 2 (1 lente).
  let isMonoEst = false;
  if (contatoId) {
    try {
      const { data: cMono } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
      const cMetaMono = (cMono?.metadata as Record<string, any>) || {};
      isMonoEst = !!cMetaMono?.receita_monocular;
    } catch (_) { /* noop */ }
  }
  const priceOf = (l: any) => isMonoEst ? Number(l.price_brl) / 2 : Number(l.price_brl);

  const fmt = (v: number) =>
    `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const tipoLabel = rxType === "progressive" ? "multifocal" : "visão simples";
  const sphereDisp = sphereCandidates.length === 2
    ? `OD ${args?.sphere_od ?? "—"} / OE ${args?.sphere_oe ?? "—"}`
    : `${sphereCandidates[0]}`;

  let msg = `Com o que você passou (${sphereDisp}${typeof args?.cylinder_hint === "number" ? ` + cil ${args.cylinder_hint}` : " com astigmatismo"}), uma estimativa de ${tipoLabel} com antirreflexo:\n\n`;
  if (isMonoEst) msg += `_💡 Valores já considerando apenas 1 lente (visão monocular)._\n\n`;
  msg += `🟢 *Econômica* — ${economy.brand} ${economy.family}: a partir de ${fmt(priceOf(economy))}\n`;
  if (mid && mid !== economy && mid !== premium) {
    msg += `🟡 *Intermediária* — ${mid.brand} ${mid.family}: a partir de ${fmt(priceOf(mid))}\n`;
  }
  if (premium !== economy) {
    msg += `💎 *Premium* — ${premium.brand} ${premium.family}: a partir de ${fmt(priceOf(premium))}\n`;
  }
  msg += `\n_Valores estimativos — com a ${rxType === "progressive" ? "ADIÇÃO e o cilindro/eixo" : "receita"} exatos eu fecho o orçamento certinho._\n\n`;
  if (args?.rx_ja_confirmada) {
    msg += "Posso seguir com uma dessas opções e já te indicar a loja mais próxima pra fechar? Me passa sua região/bairro 😊";
  } else {
    msg += rxType === "progressive"
      ? "Consegue me enviar foto da receita ou os números de ADD e CIL/AX de cada olho?"
      : "Consegue me confirmar o cilindro e eixo de cada olho (ou enviar foto da receita)?";
  }

  console.log(`[QUOTE-EST] ${tipoLabel} sphere=${worstSphere} cyl=${worstCyl} → ${sorted.length} produtos únicos`);
  return { resposta: msg };
}

// ──────────────────────────────────────────────────────────────────────────────
// GUARDRAIL DE TOM E ANTI-VAZAMENTO (4 camadas: prompt → fast-path → sanitizer
// estrutural → validador de tom). Resultado da análise (criticalLeak / motivo)
// é exposto pra `sendWhatsApp` poder auditar em ia_feedbacks.
// ──────────────────────────────────────────────────────────────────────────────

type SanitizeResult = { texto: string; alterado: boolean; criticalLeak: boolean; motivo: string };

const TOOL_NAMES_INTERNOS = [
  "agendar_visita", "agendar_cliente", "agendar_lembrete", "interpretar_receita",
  "consultar_lentes", "consultar_lentes_contato", "consultar_lentes_estimativa",
  "registrar_nome_cliente", "registrar_demanda_b2b", "ajustar_mensagem_fixa",
  "ajustar_cron", "responder", "escalar",
];
const CAMPOS_INTERNOS = ["proximo_passo", "intencao", "coluna_pipeline", "setor_destino", "alvo_ref", "modo_aplicacao"];
const FRASES_ROBO = [
  /\bcomo\s+(assistente|modelo)\s+(virtual|de\s+linguagem)\b/gi,
  /\bsou\s+uma\s+(ia|inteligência\s+artificial|máquina|bot)\b/gi,
  /\bfui\s+treinad[oa]\s+para\b/gi,
  /\bminha\s+base\s+de\s+dados\b/gi,
  /\b(sistema|plataforma)\s+autom[áa]tic[oa]\b/gi,
];
const VERBOS_META_INFINITIVO = /^[\s\-•*]*(confirmar|aguardar|verificar|validar|identificar|solicitar|encaminhar|registrar|prosseguir|seguir|consultar|analisar|processar)\b[^\n?!]*[.!]?\s*$/gim;

function sanitizeLeakedInstructions(texto: string): SanitizeResult {
  if (!texto) return { texto, alterado: false, criticalLeak: false, motivo: "" };

  const original = texto;
  let cleaned = texto;
  let criticalLeak = false;
  const motivos: string[] = [];

  // 1) Padrões clássicos de vazamento de instrução
  const leakPatterns: Array<[RegExp, string]> = [
    [/aguardar?\s+confirma[çc][ãa]o\s+do\s+nome[^\n]*/gi, "instrucao_interna"],
    [/confirme\s+o\s+nome[^\n]*/gi, "instrucao_interna"],
    [/sem\s+reformular[^\n]*/gi, "instrucao_interna"],
    [/primeira\s+intera[çc][ãa]o[^\n]*/gi, "instrucao_interna"],
    [/chame\s+a\s+tool[^\n]*/gi, "tool_interna"],
    [/regra\s+absoluta[^\n]*/gi, "instrucao_interna"],
    [/^\s*proibido[: ][^\n]*/gim, "instrucao_interna"],
    [/^\s*-\s+(envie|regra|se\s+o\s+cliente|s[óo]\s+depois|n[ãa]o\s+mencione)[^\n]*/gim, "bullet_instrucao"],
    [/##?\s+(mensagem\s+a\s+enviar|regras\s+internas|fluxo|identidade|terminologia)[^\n]*/gi, "marcador_bloco"],
    [/#\s+primeira\s+intera[çc][ãa]o[^\n]*/gi, "marcador_bloco"],
    [/\[(FLUXO|GUARDRAIL|REGRA|HINT|CONTEXTO|INSTRU[CÇ][AÃ]O)[^\]]*\][^\n]*/gi, "marcador_bloco"],
    [/\*\*(REGRA|INSTRU[CÇ][AÃ]O|IMPORTANTE|OBS)\*\*[^\n]*/gi, "marcador_bloco"],
    [/^\s*(IMPORTANTE|OBS|NOTA|ATEN[CÇ][AÃ]O)\s*[:\-][^\n]*/gim, "marcador_bloco"],
    // proximo_passo descritivo vazado
    [/confirmar\s+o\s+nome\s+do\s+cliente[^\n]*/gi, "proximo_passo_vazado"],
    [/dar\s+sequ[êe]ncia\s+(no|ao)\s+atendimento[^\n]*/gi, "proximo_passo_vazado"],
    [/\bpara\s+(prosseguir|continuar|seguir|dar\s+sequ[êe]ncia)\b[^\n]*/gi, "proximo_passo_vazado"],
    [/aguardar\s+(resposta|retorno|confirma[çc][ãa]o)\s+do\s+cliente[^\n]*/gi, "proximo_passo_vazado"],
    [/verificar\s+(se|com)\s+o\s+cliente[^\n]*/gi, "proximo_passo_vazado"],
  ];

  for (const [pat, motivo] of leakPatterns) {
    if (pat.test(cleaned)) {
      motivos.push(motivo);
      cleaned = cleaned.replace(pat, "");
    }
  }

  // 2) Nomes de tools/campos internos vazados → CRÍTICO
  for (const tool of TOOL_NAMES_INTERNOS) {
    const re = new RegExp(`\\b${tool}\\b`, "gi");
    if (re.test(cleaned)) { criticalLeak = true; motivos.push(`tool:${tool}`); cleaned = cleaned.replace(re, ""); }
  }
  for (const campo of CAMPOS_INTERNOS) {
    const re = new RegExp(`\\b${campo}\\s*[:=]?`, "gi");
    if (re.test(cleaned)) { criticalLeak = true; motivos.push(`campo:${campo}`); cleaned = cleaned.replace(re, ""); }
  }

  // 3) Frases de "robô" que denunciam IA
  for (const re of FRASES_ROBO) {
    if (re.test(cleaned)) { criticalLeak = true; motivos.push("frase_robo"); cleaned = cleaned.replace(re, ""); }
  }

  // 4) Verbo de meta-ação no infinitivo como frase isolada (linha sozinha)
  if (VERBOS_META_INFINITIVO.test(cleaned)) {
    motivos.push("infinitivo_meta");
    cleaned = cleaned.replace(VERBOS_META_INFINITIVO, "").trim();
  }

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  const alterado = cleaned !== original;

  if (alterado) {
    console.warn(`[GUARDRAIL] Vazamento detectado (${motivos.join(",")}). Original=${JSON.stringify(original.slice(0, 200))} → Limpo=${JSON.stringify(cleaned.slice(0, 200))}`);
  }

  return { texto: cleaned, alterado, criticalLeak, motivo: motivos.join(",") };
}

// Validador estrutural de tom — defesa em profundidade. Não remove conteúdo,
// apenas decide se o texto está apresentável. Retorna `ok=false` se o texto
// for inutilizável após a sanitização (vazio, só caixa-alta, markdown, etc.).
function validarTomHumano(texto: string): { ok: boolean; motivo?: string } {
  if (!texto || texto.trim().length < 3) return { ok: false, motivo: "texto_vazio_pos_sanitize" };
  const t = texto.trim();
  const palavras = t.split(/\s+/);
  if (palavras.length < 2) return { ok: false, motivo: "muito_curto" };
  if (/^[\*\#\_\-•=]/.test(t)) return { ok: false, motivo: "marcador_inicio" };
  if (/(\*\*|__|###|```)/.test(t)) return { ok: false, motivo: "markdown_vazado" };
  // >50% das palavras com >3 letras em CAIXA-ALTA → grito/estrutura
  const grandes = palavras.filter((w) => w.length > 3);
  if (grandes.length >= 4) {
    const caps = grandes.filter((w) => w === w.toUpperCase() && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(w)).length;
    if (caps / grandes.length > 0.5) return { ok: false, motivo: "caixa_alta_excessiva" };
  }
  // Termina com infinitivo solto — sintoma de proximo_passo colado no fim
  if (/\b(confirmar|aguardar|verificar|validar|prosseguir|seguir|registrar|encaminhar)\s*[.!]?\s*$/i.test(t)) {
    return { ok: false, motivo: "infinitivo_no_fim" };
  }
  return { ok: true };
}

// Best-effort audit log (não bloqueia o envio se falhar).
async function auditarVazamento(
  supabaseUrl: string, serviceKey: string,
  atendimentoId: string, original: string, cleaned: string, motivo: string,
) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/ia_feedbacks`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        atendimento_id: atendimentoId,
        avaliacao: "vazamento_guardrail",
        motivo: motivo.slice(0, 500),
        resposta_corrigida: `[ORIGINAL]\n${original.slice(0, 1500)}\n\n[ENVIADO]\n${cleaned.slice(0, 1500)}`,
      }),
    });
  } catch (e) {
    console.warn("[AUDIT] falha ao registrar vazamento:", e instanceof Error ? e.message : String(e));
  }
}

const FALLBACK_HUMANIZADO = "Só um instante que já te respondo direitinho 😊";

async function sendWhatsApp(supabaseUrl: string, serviceKey: string, atendimentoId: string, texto: string) {
  const original = texto;
  const san = sanitizeLeakedInstructions(texto);
  texto = san.texto;

  const tom = validarTomHumano(texto);
  const precisaFallback = san.criticalLeak || !tom.ok;

  if (san.alterado || precisaFallback) {
    // best-effort, sem await crítico
    auditarVazamento(supabaseUrl, serviceKey, atendimentoId, original, precisaFallback ? FALLBACK_HUMANIZADO : texto, [san.motivo, tom.motivo].filter(Boolean).join("|") || "alterado").catch(() => {});
  }

  if (precisaFallback) {
    console.warn(`[GUARDRAIL-TOM] Resposta bloqueada (critical=${san.criticalLeak} tom=${tom.motivo || "ok"}) — enviando fallback humanizado.`);
    texto = FALLBACK_HUMANIZADO;
  }

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

// ── sendInteractive: botões/listas determinísticos (sem texto livre) ──
// Quando dentro da janela 24h envia interactive via send-whatsapp; se Meta rejeitar
// (ou estiver fora 24h), o próprio send-whatsapp já faz fallback para texto puro.
interface InteractiveOut {
  type: "button" | "list";
  texto: string;
  botoes?: Array<{ id: string; titulo: string }>;
  lista?: {
    label: string;
    secao: string;
    itens: Array<{ id: string; titulo: string; descricao?: string }>;
  };
}
async function sendInteractive(supabaseUrl: string, serviceKey: string, atendimentoId: string, interactive: InteractiveOut) {
  console.log(`[INTERACTIVE] sending type=${interactive.type} ids=${interactive.type === "button" ? (interactive.botoes||[]).map(b=>b.id).join(",") : (interactive.lista?.itens||[]).map(i=>i.id).join(",")}`);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        atendimento_id: atendimentoId,
        interactive,
        remetente_nome: "Assistente IA",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[INTERACTIVE] send-whatsapp returned ${res.status}: ${(body || "").slice(0, 200)} — falling back to text`);
      await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, interactive.texto);
    }
  } catch (e) {
    console.warn(`[INTERACTIVE] exception: ${e instanceof Error ? e.message : String(e)} — falling back to text`);
    await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, interactive.texto);
  }
}

// Detecta se um texto é uma confirmação de receita (saída de buildMsgConfirmarReceita)
function isReceitaConfirmText(t: string): boolean {
  const s = String(t || "");
  return /li sua receita assim, confere|anotei! ficou assim/i.test(s);
}

// Envia confirmação de receita com botões OK / Corrigir e marca receita_pending.
// Idempotente: se a última outbound deste atendimento foi outra confirmação de receita
// E não houve inbound entre ela e agora E o gap é < 5min, NÃO reenvia (anti-loop dirigido).
async function sendReceitaConfirmInteractive(
  supabaseClient: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
  texto: string,
) {
  // ── IDEMPOTÊNCIA ── (Onda 1 Fase 1a — caso Lucineide mai/2026)
  try {
    const { data: ultimasMsgs } = await supabaseClient
      .from("mensagens")
      .select("direcao, conteudo, created_at")
      .eq("atendimento_id", atendimentoId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (Array.isArray(ultimasMsgs) && ultimasMsgs.length > 0) {
      const outboundsSemInbound: typeof ultimasMsgs = [];
      for (const m of ultimasMsgs) {
        if (m.direcao === "inbound") break;
        if (m.direcao === "outbound") outboundsSemInbound.push(m);
      }

      const ultConfirmacao = outboundsSemInbound.find((m: any) =>
        isReceitaConfirmText(String(m.conteudo || ""))
      );

      if (ultConfirmacao) {
        const idadeMs = Date.now() - new Date(ultConfirmacao.created_at).getTime();
        if (idadeMs < 5 * 60 * 1000) {
          console.log(
            `[RX-CONFIRM-IDEMP] Supressão: última confirmação há ${Math.round(idadeMs / 1000)}s sem inbound — não reenviando`
          );
          try {
            await supabaseClient.from("eventos_crm").insert({
              contato_id: null,
              tipo: "receita_confirmacao_suprimida_idempotencia",
              descricao: `Reenvio de confirmação de receita suprimido (${Math.round(idadeMs / 1000)}s desde última, sem inbound)`,
              metadata: { idade_seg: Math.round(idadeMs / 1000), origem: "sendReceitaConfirmInteractive" } as any,
              referencia_tipo: "atendimento",
              referencia_id: atendimentoId,
            });
          } catch (_) { /* noop */ }
          return;
        }
      }
    }
  } catch (e) {
    // Falha de leitura não bloqueia envio — segue fluxo normal
    console.warn("[RX-CONFIRM-IDEMP] verificação falhou — seguindo envio normal:", (e as Error)?.message);
  }

  // ── FLUXO NORMAL ──
  // Marca pending antes de enviar para que o clique do botão receita_ok funcione
  try {
    const { data: atRow } = await supabaseClient
      .from("atendimentos")
      .select("metadata")
      .eq("id", atendimentoId)
      .maybeSingle();
    const meta = (atRow?.metadata || {}) as Record<string, any>;
    await supabaseClient
      .from("atendimentos")
      .update({ metadata: { ...meta, receita_pending: true, receita_pending_at: new Date().toISOString(), expected_reply: "receita_confirmacao" } })
      .eq("id", atendimentoId);
  } catch (e) {
    console.warn("[RX-CONFIRM-BTN] falha ao marcar receita_pending:", e);
  }
  await sendInteractive(supabaseUrl, serviceKey, atendimentoId, {
    type: "button",
    texto,
    botoes: [
      { id: "receita_ok", titulo: "✅ Tá certo" },
      { id: "receita_corrigir", titulo: "✏️ Corrigir" },
    ],
  });
}

// Envia botões de follow-up após cotação (orçamento mostrado).
// Idempotente por janela curta via metadata.pos_quote_botoes_at.
async function sendPostQuoteButtons(
  supabaseClient: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
) {
  try {
    const { data: atRow } = await supabaseClient
      .from("atendimentos").select("metadata").eq("id", atendimentoId).maybeSingle();
    const meta = (atRow?.metadata || {}) as Record<string, any>;
    const last = meta.pos_quote_botoes_at ? Date.parse(meta.pos_quote_botoes_at) : 0;
    if (last && Date.now() - last < 5 * 60 * 1000) return; // evita duplicação <5min
    await supabaseClient.from("atendimentos")
      .update({ metadata: { ...meta, pos_quote_botoes_at: new Date().toISOString(), expected_reply: "pos_cotacao" } })
      .eq("id", atendimentoId);
  } catch (_) { /* noop */ }
  await sendInteractive(supabaseUrl, serviceKey, atendimentoId, {
    type: "button",
    texto: "O que prefere fazer agora? 😊",
    botoes: [
      { id: "orcamento_agendar", titulo: "📅 Agendar visita" },
      { id: "orcamento_duvida", titulo: "💬 Tirar dúvida" },
      { id: "orcamento_mais_barato", titulo: "💸 Mais barato?" },
    ],
  });
}

// Envia botões de follow-up após mensagem de recuperação (IA/no-show).
async function sendPostRecoveryButtons(
  supabaseClient: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
) {
  try {
    const { data: atRow } = await supabaseClient
      .from("atendimentos")
      .select("metadata")
      .eq("id", atendimentoId)
      .maybeSingle();
    const meta = (atRow?.metadata || {}) as Record<string, any>;
    await supabaseClient
      .from("atendimentos")
      .update({ metadata: { ...meta, expected_reply: "recuperacao" } })
      .eq("id", atendimentoId);
  } catch (_) { /* noop */ }
  await sendInteractive(supabaseUrl, serviceKey, atendimentoId, {
    type: "button",
    texto: "Quer dar continuidade?",
    botoes: [
      { id: "recupera_sim", titulo: "✅ Quero remarcar" },
      { id: "recupera_loja", titulo: "🏪 Ver endereço" },
      { id: "recupera_nao", titulo: "❌ Agora não" },
    ],
  });
}

// Roda cotação determinística aplicando filtro de adicional escolhido e
// envia resposta + botões de follow-up. Usado tanto pelos botões quanto
// pelo fallback de texto (cliente digita "luz azul", "fotossensível", "sem").
async function runQuoteWithFilter(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimento: any,
  filtros: { filtro_blue?: boolean; filtro_photo?: boolean },
): Promise<void> {
  try {
    const labelAdicional = filtros.filtro_blue
      ? "com filtro de luz azul"
      : filtros.filtro_photo
        ? "com lente fotossensível"
        : "sem adicionais";
    // DEFESA: usuário escolheu adicional → receita JÁ foi confirmada por definição.
    // Força pending=false no contato pra não cair no guard de runConsultarLentes.
    try {
      const { data: cRow } = await supabase.from("contatos").select("metadata").eq("id", atendimento.contato_id).maybeSingle();
      const cMeta = (cRow?.metadata || {}) as Record<string, any>;
      if (cMeta?.receita_confirmacao?.pending === true) {
        // B3b-FIX: marca confirmed_by_client_at na receita alvo.
        const _addIdx = typeof cMeta.receita_confirmacao?.rx_index === "number"
          ? cMeta.receita_confirmacao.rx_index
          : (Array.isArray(cMeta.receitas) ? cMeta.receitas.length - 1 : -1);
        if (_addIdx >= 0 && Array.isArray(cMeta.receitas) && cMeta.receitas[_addIdx]) {
          const _addReceitas = [...cMeta.receitas];
          _addReceitas[_addIdx] = { ..._addReceitas[_addIdx], confirmed_by_client_at: new Date().toISOString() };
          cMeta.receitas = _addReceitas;
        }
        cMeta.receita_confirmacao = { ...cMeta.receita_confirmacao, pending: false, confirmed_at: new Date().toISOString(), confirmed_via: "adicional_botao" };
        await supabase.from("contatos").update({ metadata: cMeta }).eq("id", atendimento.contato_id);
      }
    } catch (_) { /* noop */ }
    const quote = await runConsultarLentes(
      supabase,
      atendimento.contato_id,
      [],
      filtros,
      atendimento.id,
    );
    const prefixo = `Perfeito, atualizei as opções ${labelAdicional} 😊\n\n`;
    await sendWhatsApp(supabaseUrl, serviceKey, atendimento.id, prefixo + quote.resposta);
    await sendPostQuoteButtons(supabase, supabaseUrl, serviceKey, atendimento.id);
    await supabase.from("eventos_crm").insert({
      contato_id: atendimento.contato_id,
      tipo: "cotacao_apos_adicional_botao",
      descricao: `Cotação re-executada após escolha de adicional: ${labelAdicional}`,
      metadata: { filtros },
      referencia_tipo: "atendimento",
      referencia_id: atendimento.id,
    });
  } catch (e) {
    console.error("[ADICIONAL] runQuoteWithFilter falhou:", e);
    await sendWhatsApp(
      supabaseUrl, serviceKey, atendimento.id,
      "Anotei sua escolha! 🙌 Em qual loja prefere ser atendido? Posso te enviar a lista 😊",
    );
  }
}

async function routeExpectedTypedReply(args: {
  atendimento: any;
  atendimentoMeta: Record<string, any>;
  supabase: any;
  supabaseUrl: string;
  serviceKey: string;
  mensagemTexto: string;
}): Promise<boolean> {
  const { atendimento, atendimentoMeta, supabase, supabaseUrl, serviceKey, mensagemTexto } = args;
  const expectedReply = atendimentoMeta?.expected_reply;
  const atId = atendimento.id;
  const replyAction = detectExpectedReplyAction(expectedReply, mensagemTexto);

  const patchMeta = async (patch: Record<string, any>) => {
    await supabase.from("atendimentos")
      .update({ metadata: { ...atendimentoMeta, ...patch } })
      .eq("id", atId);
  };

  // Fallback de texto: cliente digitou a cidade em vez de tocar na lista.
  if (expectedReply === "cidade_selecao") {
    const cidade = detectCidadeEscolhida(mensagemTexto);
    if (!cidade) {
      // Não reconheceu cidade real — responder deterministicamente, NUNCA cair no LLM.
      const tNorm = _normTxt(mensagemTexto);

      // Escape hatch: cliente expressa intenção clara diferente de escolher cidade.
      // Exemplo: "quero fazer óculos" (orçamento) chega enquanto expected_reply="cidade_selecao"
      // ainda está ativo de turno anterior. Sem este escape, o branch tratava como cidade
      // ambígua e relançava os botões, prendendo o cliente no loop.
      // Limpa expected_reply e retorna false → cascata/LLM assume normalmente.
      // Só dispara quando detectCidadeEscolhida retornou null (cidades reais passam acima).
      if (_isEscapeIntent(tNorm)) {
        await patchMeta({ expected_reply: null });
        console.log(`[CIDADE-ESCAPE] intenção clara detectada, clearing expected_reply — "${mensagemTexto.slice(0, 80)}"`);
        return false;
      }

      // Recusa explícita ("não obrigada", "tchau", "não vou precisar") → encerramento educado.
      const isRecusaExplicita = /\bnao\b.{0,15}\b(obrigad|precis|quero|interess|vai\s+dar|vou)\b|\b(tchau|ate\s+logo|falou|encerr|cancela)\b/.test(tNorm)
        && !/\b(osasco|carapicuiba|itapevi|barueri|alphaville)\b/.test(tNorm);
      if (isRecusaExplicita) {
        await sendWhatsApp(supabaseUrl, serviceKey, atId, "Tudo bem! Qualquer coisa estou por aqui 😊 Até mais!");
        await patchMeta({ expected_reply: null });
        return true;
      }
      // Mencionou cidade sem loja → informa limite + relança botões.
      const mencionaCidadeForaDeCob = /\b(cotia|jandira|santana|sao\s*paulo|guarulhos|santo\s*andre|campinas)\b/.test(tNorm);
      if (mencionaCidadeForaDeCob) {
        await sendWhatsApp(supabaseUrl, serviceKey, atId,
          "No momento nosso atendimento é nas lojas de Osasco, Carapicuíba, Barueri e Itapevi 😊");
        await sendListaCidades(supabase, supabaseUrl, serviceKey, atId, atendimentoMeta,
          "Gostaria de ser atendido em uma dessas cidades? 😊");
      } else {
        // Entrada ambígua → relança botões sem explicação extra.
        await sendListaCidades(supabase, supabaseUrl, serviceKey, atId, atendimentoMeta,
          "Pode escolher uma das opções abaixo 😊");
      }
      return true;
    }
    const { data: lojas } = await supabase
      .from("telefones_lojas").select("id, nome_loja, endereco")
      .eq("tipo", "loja").eq("ativo", true).order("nome_loja");
    try {
      const { data: ctRow } = await supabase.from("contatos")
        .select("metadata").eq("id", atendimento.contato_id).maybeSingle();
      const ctMeta = (ctRow?.metadata || {}) as Record<string, any>;
      if (ctMeta.pos_orcamento?.etapa === "aguardando_cidade") {
        await supabase.from("contatos").update({
          metadata: { ...ctMeta, pos_orcamento: {
            ...ctMeta.pos_orcamento, etapa: "aguardando_loja", cidade,
            atualizado_at: new Date().toISOString(),
          }},
        }).eq("id", atendimento.contato_id);
      }
    } catch (_) { /* noop */ }
    await sendListaLojasDaCidade(
      supabase, supabaseUrl, serviceKey, atId, atendimentoMeta, cidade, lojas || [], atendimento.contato_id,
    );
    return true;
  }

  // Fallback de texto: cliente digitou a cidade para consulta de informações (loja_local).
  if (expectedReply === "loja_local_cidade") {
    const cidade = detectCidadeEscolhida(mensagemTexto);
    if (!cidade) return false;
    await sendInfoLojasCidade(supabase, supabaseUrl, serviceKey, atId, atendimentoMeta, cidade);
    console.log(`[LOJA-LOCAL] Cidade digitada: ${cidade}`);
    return true;
  }

  // Fallback de texto: cliente digitou o nome da loja em vez de tocar na lista.
  if (expectedReply === "loja_selecao") {
    const { data: lojas } = await supabase
      .from("telefones_lojas")
      .select("id, nome_loja, endereco")
      .eq("tipo", "loja")
      .eq("ativo", true)
      .order("nome_loja", { ascending: true });

    const lojaMatch = matchLojaByTypedText(lojas || [], mensagemTexto);
    if (!lojaMatch) return false;

    await patchMeta({
      expected_reply: "agendamento_data_horario",
      agendamento_pending: {
        ...(atendimentoMeta.agendamento_pending || {}),
        loja_id: lojaMatch.id,
        loja_nome: lojaMatch.nome_loja,
      },
      ultimo_typed_expected_reply_at: new Date().toISOString(),
    });
    // Limpa pos_orcamento para próxima mensagem (dia/hora) não re-disparar handler de loja.
    try {
      const { data: ctRow } = await supabase.from("contatos")
        .select("metadata").eq("id", atendimento.contato_id).maybeSingle();
      const ctMeta = (ctRow?.metadata || {}) as Record<string, any>;
      if (ctMeta.pos_orcamento) {
        const { pos_orcamento: _p, ...rest } = ctMeta;
        await supabase.from("contatos").update({ metadata: rest }).eq("id", atendimento.contato_id);
      }
    } catch (_) { /* noop */ }
    await sendWhatsApp(
      supabaseUrl,
      serviceKey,
      atId,
      `Perfeito! Loja escolhida: *${lojaMatch.nome_loja}*.
Qual dia e horário ficaria melhor pra você? 😊`,
    );
    return true;
  }

  // ── OS: cliente digitou em vez de tocar os botões de pertencimento ──────────
  // sim/não já foram mapeados em detectExpectedReplyAction → os_pert_sim/os_pert_nao
  // Só chega aqui quando o texto não foi reconhecido como sim nem não → reprompt.
  if (expectedReply === "os_aguardando_pertencimento") {
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Toca em *Sim, é esse* ou *Não* pra eu te ajudar 😊");
    return true;
  }

  // ── OS: cliente digitou o nº da OS ao invés de tocar na lista ─────────────
  if (expectedReply === "os_aguardando_qual") {
    const identQ = extrairIdentificadorOS(mensagemTexto);
    if (identQ.tipo !== null) {
      await patchMeta({ expected_reply: null, os_opcoes: null });
      const { data: ctOsQ } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
      const _primQ = (ctOsQ?.nome || "").trim().split(/\s+/)[0] || "";
      await loadMensagensFixas(supabase);
      const rQ = await consultarStatusOS(supabaseUrl, serviceKey, identQ);
      const handledQ = await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primQ, { ...atendimentoMeta, expected_reply: null, os_opcoes: null }, rQ, identQ,
      );
      if (handledQ === "fallback") {
        const escMsg = renderMsgFixa("os_escala_verificacao", { nome_comma: _primQ ? `, ${_primQ}` : "" });
        const osMsgQ = isHorarioHumano()
          ? escMsg
          : `${escMsg}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
        await sendWhatsApp(supabaseUrl, serviceKey, atId, osMsgQ);
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento.id);
        await supabase.from("eventos_crm").insert({
          contato_id: atendimento.contato_id,
          tipo: "consulta_os",
          descricao: "Consulta OS digitada após lista — sem resultado único — escalado para humano",
          metadata: { modo: atendimento.modo },
          referencia_tipo: "atendimento",
          referencia_id: atId,
        });
      }
      return true;
    }
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Pode tocar em uma das opções acima ou digitar o número da OS (5 dígitos)? 😊");
    return true;
  }

  // ── OS: cliente digitou no meio do fluxo de coleta de identificador ──────
  if (expectedReply === "os_aguardando_escolha" || expectedReply === "os_aguardando_identificador") {
    const ident = extrairIdentificadorOS(mensagemTexto);
    if (ident.tipo !== null) {
      await patchMeta({ expected_reply: null });
      const { data: ctOsR } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
      const _primR = (ctOsR?.nome || "").trim().split(/\s+/)[0] || "";
      await loadMensagensFixas(supabase);
      const rR = await consultarStatusOS(supabaseUrl, serviceKey, ident);
      const handledR = await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primR, { ...atendimentoMeta, expected_reply: null }, rR, ident,
      );
      if (handledR === "fallback") {
        const escMsg = renderMsgFixa("os_escala_verificacao", { nome_comma: _primR ? `, ${_primR}` : "" });
        const osMsgR = isHorarioHumano()
          ? escMsg
          : `${escMsg}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
        await sendWhatsApp(supabaseUrl, serviceKey, atId, osMsgR);
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atendimento.id);
        await supabase.from("eventos_crm").insert({
          contato_id: atendimento.contato_id,
          tipo: "consulta_os",
          descricao: "Consulta OS via typed reply — sem resultado único — escalado para humano",
          metadata: { modo: atendimento.modo },
          referencia_tipo: "atendimento",
          referencia_id: atId,
        });
      }
      return true;
    }
    // Não identificou OS nem CPF — reprompt gentil, transição para aguardando_identificador
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Pode me passar o número da OS (5 dígitos do comprovante) ou seu CPF? 😊");
    await patchMeta({ expected_reply: "os_aguardando_identificador" });
    return true;
  }

  // ── OS RETRY: cliente esperando o ERP voltar após "os_erp_indisponivel" ─────
  // Setado pelos blocos "indisponível" no router (~L3309) e em tratarResultadoConsultaOS (~L1000).
  // Guarda { identificador, tipo, asked_at, tries } em meta.os_retry. Aqui:
  //  - "tenta de novo / consulta agora / voltou? / etc." → re-dispara com o identificador guardado
  //  - cliente digitou OUTRO identificador → re-dispara com o novo
  //  - mudou de assunto → limpa retry, devolve false (LLM segue normal)
  //  - expirou (>30min) → limpa, peça o número de novo
  if (expectedReply === "os_retry_aguardando") {
    const retry = (atendimentoMeta as any)?.os_retry as
      | { identificador?: string; tipo?: "os" | "cpf"; asked_at?: string; tries?: number }
      | undefined;
    const RETRY_TTL_MS = 30 * 60 * 1000;
    const expired = retry?.asked_at ? (Date.now() - new Date(retry.asked_at).getTime() > RETRY_TTL_MS) : true;
    const hasGuardado = !!retry?.identificador && !!retry?.tipo && !expired;

    // Sem identificador guardado válido — limpa e segue fluxo normal
    if (!hasGuardado) {
      await patchMeta({ expected_reply: null, os_retry: null });
      return false;
    }

    const { data: ctRet } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
    const _primRet = (ctRet?.nome || "").trim().split(/\s+/)[0] || "";

    // Cliente forneceu OUTRO identificador (trocou OS/CPF) → usa o novo
    const novoIdent = extrairIdentificadorOS(mensagemTexto);
    if (novoIdent.tipo !== null) {
      await loadMensagensFixas(supabase);
      const rN = await consultarStatusOS(supabaseUrl, serviceKey, novoIdent);
      await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primRet, { ...atendimentoMeta, expected_reply: null, os_retry: null }, rN, novoIdent,
      );
      return true;
    }

    // Sinal de retry ("tenta de novo / consulta agora / voltou?") OU repetição da pergunta
    const RETRY_REGEX = /\b(tenta(r)?\s+(de\s+)?(novo|denovo|outra\s+vez|mais\s+uma|agora)|tenta\s+a[ií]|consulta(r)?\s+(agora|de\s+novo|denovo|novamente)|j[aá]\s+(pode|p[oô]de|tentou|consultou|voltou)|e\s+agora\??|voltou\s+(o\s+)?sistema|alguma\s+novidade|tem\s+novidade|conseguiu|d[aá]\s+pra\s+(tenta|consulta)r?)\b/i;
    const nMsg = norm(mensagemTexto);
    const osKwRet = await loadOsKeywords(supabase);
    const sinalRetry = RETRY_REGEX.test(mensagemTexto) || RETRY_REGEX.test(nMsg) || matchesConsultaOs(mensagemTexto, osKwRet);

    if (sinalRetry) {
      const identGuardado: { tipo: "os" | "cpf"; valor: string } = { tipo: retry!.tipo!, valor: retry!.identificador! };
      await loadMensagensFixas(supabase);
      const rG = await consultarStatusOS(supabaseUrl, serviceKey, identGuardado);
      if (rG.status === "indisponivel") {
        const newTries = (retry!.tries || 1) + 1;
        const msg = newTries >= 3
          ? "Ainda sem acesso ao sistema 😅 Já tentei algumas vezes. Posso te conectar com a equipe da loja pra confirmar pessoalmente?"
          : "Ainda não consegui agora 😅 Me avisa em alguns minutos pra eu tentar de novo.";
        await sendWhatsApp(supabaseUrl, serviceKey, atId, msg);
        await patchMeta({
          expected_reply: "os_retry_aguardando",
          os_retry: { ...retry!, tries: newTries, asked_at: new Date().toISOString() },
        });
        return true;
      }
      // Sucesso (ou outro resultado): trata normalmente, limpa retry
      await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primRet, { ...atendimentoMeta, expected_reply: null, os_retry: null }, rG, identGuardado,
      );
      return true;
    }

    // Mudança de assunto: limpa e deixa o fluxo normal continuar
    await patchMeta({ expected_reply: null, os_retry: null });
    return false;
  }

  // B2b-FIX: texto digitado após "Tirar dúvida" cai aqui. Limpa expected_reply e devolve
  // false para que o LLM responda normalmente — o _cotacaoJaFoiEnviada já suprimiu o
  // [PÓS-RECEITA OBRIGATÓRIO], então não há risco de re-pedido de confirmação.
  if (expectedReply === "duvida_pos_cotacao") {
    await patchMeta({ expected_reply: null });
    return false;
  }

  if (!replyAction) return false;

  console.log(`[EXPECTED REPLY] stage=${expectedReply} typed_action=${replyAction}`);
  return await routeButtonClick({
    buttonId: replyAction,
    atendimento,
    atendimentoMeta,
    supabase,
    supabaseUrl,
    serviceKey,
  });
}

// Estimativa de LC descartável: usa o produto DNZ esférico não-tórico mais barato
// do catálogo (pricing_lentes_contato) como ponto de partida. NÃO substitui a cotação
// real (que exige receita), mas mantém o cliente engajado quando ele não tem receita,
// não sabe o tipo, ou tem receita só de óculos fora do horário comercial.
async function sendOrcamentoEstimativaLCDescartavel(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
  ctx: { motivo: "tipo_indefinido" | "cliente_nao_sabe" | "sem_receita_lc" | "receita_oculos_fora_horario" },
): Promise<void> {
  let preco = "R$ 204,99/caixa"; // fallback (DNZ Mensal — atualizado Mai/2026)
  let produto = "DNZ Mensal";
  let unidadesCx = 6;
  try {
    const { data } = await supabase
      .from("pricing_lentes_contato")
      .select("produto, price_brl, unidades_por_caixa, descarte")
      .eq("is_dnz", true)
      .eq("is_toric", false)
      .eq("active", true)
      .order("price_brl", { ascending: true })
      .limit(1);
    if (Array.isArray(data) && data.length > 0) {
      const it = data[0];
      const v = typeof it.price_brl === "number" ? it.price_brl : Number(it.price_brl);
      if (Number.isFinite(v)) {
        preco = `R$ ${v.toFixed(2).replace(".", ",")}/caixa`;
        produto = String(it.produto || produto);
        unidadesCx = Number(it.unidades_por_caixa || unidadesCx);
      }
    }
  } catch (e) {
    console.warn("[EST-LC] falha ao consultar pricing_lentes_contato — usando fallback:", (e as Error)?.message);
  }

  const intro =
    ctx.motivo === "receita_oculos_fora_horario"
      ? "Pra LC com receita de óculos, o consultor especializado faz a conversão certinha — ele te atende assim que o expediente abrir 🙌\n\nEnquanto isso, te dou um *ponto de partida* de valor pra você ir se planejando:"
      : ctx.motivo === "cliente_nao_sabe"
      ? "Sem stress! Te passo um *ponto de partida* de valor com a opção mais em conta da casa:"
      : ctx.motivo === "sem_receita_lc"
      ? "Sem a receita não consigo fechar o valor exato, mas te dou um *ponto de partida* com a opção mais em conta:"
      : "Te passo um *ponto de partida* de valor com a opção mais em conta de LC descartável:";

  const corpo = `\n\n👁️ *${produto}* — a partir de *${preco}* (${unidadesCx} lentes por caixa)`;

  const fechamento =
    ctx.motivo === "receita_oculos_fora_horario"
      ? "\n\n_Esse é o valor base. O produto em si quase não muda de preço entre as opções de descartável, mas a confirmação só sai com a receita certa em mãos — o consultor já te ajuda com isso assim que o expediente abrir._ 😊"
      : "\n\n_Esse é o valor base. O produto quase não muda de preço entre as opções de descartável, mas a confirmação só sai com a receita de LC em mãos (curvatura e material podem mudar a indicação)._\n\nQuer agendar uma visita pra fechar com a receita certa? 😊";

  try {
    await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, intro + corpo + fechamento);
    await supabase.from("eventos_crm").insert({
      tipo: "orcamento_lc_estimativa_dnz",
      descricao: `Estimativa LC descartável enviada (${ctx.motivo}) — ${produto} ${preco}`,
      metadata: { motivo: ctx.motivo, produto, preco },
      referencia_tipo: "atendimento",
      referencia_id: atendimentoId,
    });
  } catch (e) {
    console.error("[EST-LC] falha ao enviar estimativa:", e);
  }
}

async function sendOrcamentoEstimativaOculosSemReceita(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  atendimentoId: string,
): Promise<void> {
  const vs = ANCORA_OCULOS.visao_simples;
  const mf = ANCORA_OCULOS.multifocal;
  const ar = ANCORA_OCULOS.armacao;

  const msg =
    "Sem problema! Sem a receita não consigo fechar o valor exato, mas te passo os *valores de referência* pra você já ir se planejando 😊\n\n" +
    `👓 *Visão simples* (com antirreflexo) — a partir de *R$ ${vs}*\n` +
    `🔭 *Multifocal/progressiva* (com antirreflexo) — a partir de *R$ ${mf}*\n` +
    `🕶️ *Armação* — a partir de *R$ ${ar}*\n\n` +
    "_Esses são os valores base. O preço final depende do seu grau, tratamentos e a armação escolhida — a receita fecha a conta certinha._";

  try {
    await sendWhatsApp(supabaseUrl, serviceKey, atendimentoId, msg);
    await sendInteractive(supabaseUrl, serviceKey, atendimentoId, {
      type: "button",
      texto: "Como prefere continuar? 😊",
      botoes: [
        { id: "receita_foto",    titulo: "📷 Enviar receita" },
        { id: "orcamento_agendar", titulo: "📅 Agendar visita" },
        { id: "ver_menu",        titulo: "🏠 Outro assunto" },
      ],
    });
    await supabase.from("eventos_crm").insert({
      tipo: "orcamento_oculos_estimativa_ancora",
      descricao: `Estimativa óculos sem receita (âncora) — VS R$${vs} / MF R$${mf} / ARM R$${ar}`,
      metadata: { ancora: ANCORA_OCULOS },
      referencia_tipo: "atendimento",
      referencia_id: atendimentoId,
    });
  } catch (e) {
    console.error("[EST-OCULOS] falha ao enviar estimativa:", e);
  }
}

async function routeButtonClick(args: {
  buttonId: string;
  atendimento: any;
  atendimentoMeta: Record<string, any>;
  supabase: any;
  supabaseUrl: string;
  serviceKey: string;
}): Promise<boolean> {
  const { buttonId, atendimento, atendimentoMeta, supabase, supabaseUrl, serviceKey } = args;
  const atId = atendimento.id;

  const patchMeta = async (patch: Record<string, any>) => {
    await supabase.from("atendimentos")
      .update({ metadata: { ...atendimentoMeta, ...patch, ultimo_button_id: buttonId, ultimo_button_at: new Date().toISOString() } })
      .eq("id", atId);
  };

  // ── Confirmação de nome via botão ──
  if (buttonId.startsWith("nome_ok:") || buttonId === "nome_ok") {
    const nomeBotao = buttonId.startsWith("nome_ok:") ? buttonId.slice(8).trim() : "";
    const { data: ct } = await supabase
      .from("contatos").select("id, nome, metadata").eq("id", atendimento.contato_id).maybeSingle();
    const ctMeta = (ct?.metadata as Record<string, any>) || {};
    const nomeFinal = nomeBotao || ctMeta.nome_candidato_botao || ctMeta.nome_perfil_whatsapp || ct?.nome || "";
    if (nomeFinal && nomeFinal.length >= 2) {
      await supabase.from("contatos").update({
        nome: nomeFinal,
        metadata: {
          ...ctMeta,
          nome_confirmado: true,
          precisa_confirmar_nome: false,
          nome_origem: "botao_confirmacao",
          nome_atualizado_at: new Date().toISOString(),
          tentativas_pedido_nome: 0,
          nome_candidato_botao: null,
        },
      }).eq("id", atendimento.contato_id);
      await supabase.from("eventos_crm").insert({
        contato_id: atendimento.contato_id,
        tipo: "nome_confirmado_botao",
        descricao: `Nome confirmado via botão: "${nomeFinal}"`,
        referencia_tipo: "atendimento",
        referencia_id: atId,
      });
    }
    const firstName = (nomeFinal || "").split(" ")[0] || "";
    const saudacao = firstName ? `Prazer, ${firstName}! 🙌 Como posso te ajudar hoje?` : "Como posso te ajudar hoje? 😊";
    await sendInteractive(supabaseUrl, serviceKey, atId, {
      type: "list",
      texto: saudacao,
      lista: {
        label: "Ver opções",
        secao: "Posso te ajudar com",
        itens: MENU_TRIAGEM_ITENS,
      },
    });
    await patchMeta({ menu_triagem_enviado_at: new Date().toISOString(), expected_reply: "menu_triagem" });
    return true;
  }

  if (buttonId === "nome_outro") {
    const { data: ct } = await supabase
      .from("contatos").select("metadata").eq("id", atendimento.contato_id).maybeSingle();
    const ctMeta = (ct?.metadata as Record<string, any>) || {};
    await supabase.from("contatos").update({
      metadata: {
        ...ctMeta,
        precisa_confirmar_nome: true,
        nome_confirmado: false,
        nome_candidato_botao: null,
      },
    }).eq("id", atendimento.contato_id);
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sem problema! Como prefere ser chamado(a)? ✍️");
    return true;
  }

  // Seleção de cidade → envia lista de lojas dessa cidade.
  if (buttonId.startsWith("os_qual:")) {
    const osNum = buttonId.slice(8);
    await patchMeta({ expected_reply: null, os_opcoes: null });
    const { data: ctOsQ } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
    const _primOsQ = (ctOsQ?.nome || "").trim().split(/\s+/)[0] || "";
    await loadMensagensFixas(supabase);
    const rOsQ = await consultarStatusOS(supabaseUrl, serviceKey, { tipo: "os", valor: osNum });
    const handledOsQ = await tratarResultadoConsultaOS(
      supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
      _primOsQ, { ...atendimentoMeta, expected_reply: null, os_opcoes: null }, rOsQ, { tipo: "os", valor: osNum },
    );
    if (handledOsQ === "fallback") {
      const escMsg = renderMsgFixa("os_escala_verificacao", { nome_comma: _primOsQ ? `, ${_primOsQ}` : "" });
      const osMsgQ = isHorarioHumano()
        ? escMsg
        : `${escMsg}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
      await sendWhatsApp(supabaseUrl, serviceKey, atId, osMsgQ);
      await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
      await supabase.from("eventos_crm").insert({
        contato_id: atendimento.contato_id,
        tipo: "consulta_os",
        descricao: "Consulta OS via lista — sem resultado único — escalado para humano",
        metadata: { os: osNum, modo: atendimento.modo },
        referencia_tipo: "atendimento",
        referencia_id: atId,
      });
    }
    return true;
  }

  if (buttonId.startsWith("cidade:")) {
    const cidadeSlug = buttonId.slice(7);
    const { data: lojas } = await supabase
      .from("telefones_lojas").select("id, nome_loja, endereco")
      .eq("tipo", "loja").eq("ativo", true).order("nome_loja");
    // Avança pos_orcamento para que digitação de loja (fallback texto) funcione.
    try {
      const { data: ctRow } = await supabase.from("contatos")
        .select("metadata").eq("id", atendimento.contato_id).maybeSingle();
      const ctMeta = (ctRow?.metadata || {}) as Record<string, any>;
      if (ctMeta.pos_orcamento?.etapa === "aguardando_cidade") {
        await supabase.from("contatos").update({
          metadata: { ...ctMeta, pos_orcamento: {
            ...ctMeta.pos_orcamento, etapa: "aguardando_loja", cidade: cidadeSlug,
            atualizado_at: new Date().toISOString(),
          }},
        }).eq("id", atendimento.contato_id);
      }
    } catch (_) { /* noop */ }
    await sendListaLojasDaCidade(
      supabase, supabaseUrl, serviceKey, atId, atendimentoMeta, cidadeSlug, lojas || [], atendimento.contato_id,
    );
    return true;
  }

  // Botão de cidade no fluxo loja_local (info, sem agendamento).
  if (buttonId.startsWith("loja_info:")) {
    const cidadeSlug = buttonId.slice(10);
    await sendInfoLojasCidade(supabase, supabaseUrl, serviceKey, atId, atendimentoMeta, cidadeSlug);
    console.log(`[LOJA-LOCAL] Botão cidade: ${cidadeSlug}`);
    return true;
  }

  if (buttonId.startsWith("loja:")) {
    const lojaId = buttonId.slice(5);
    const { data: loja } = await supabase
      .from("telefones_lojas").select("id, nome_loja, endereco").eq("id", lojaId).maybeSingle();
    if (loja) {
      await patchMeta({
        expected_reply: "agendamento_data_horario",
        agendamento_pending: { ...(atendimentoMeta.agendamento_pending || {}), loja_id: loja.id, loja_nome: loja.nome_loja },
      });
      // Limpa pos_orcamento: próxima mensagem (dia/hora) não deve re-disparar handler de loja.
      try {
        const { data: ctRow } = await supabase.from("contatos")
          .select("metadata").eq("id", atendimento.contato_id).maybeSingle();
        const ctMeta = (ctRow?.metadata || {}) as Record<string, any>;
        if (ctMeta.pos_orcamento) {
          const { pos_orcamento: _p, ...rest } = ctMeta;
          await supabase.from("contatos").update({ metadata: rest }).eq("id", atendimento.contato_id);
        }
      } catch (_) { /* noop */ }
      await sendWhatsApp(supabaseUrl, serviceKey, atId,
        `Perfeito! Loja escolhida: *${loja.nome_loja}*.\nQual dia e horário ficaria melhor pra você? 😊`);
      return true;
    }
  }

  switch (buttonId) {
    // ── Botões do menu suave do loop detector ──
    case "loop_menu_orcamento":
      // Limpa o estado de menu e delega ao mesmo fluxo do botão "orcamento" do menu de triagem.
      await patchMeta({ loop_menu_enviado_at: undefined, expected_reply: null });
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Beleza! O orçamento é pra qual tipo de lente? 😊",
        botoes: [
          { id: "orcamento_oculos", titulo: "👓 Óculos" },
          { id: "orcamento_lc", titulo: "👁️ Lentes de contato" },
          { id: "orcamento_indef", titulo: "🤔 Ainda não sei" },
        ],
      });
      await patchMeta({ intent_detected: "orcamento", expected_reply: "orcamento_tipo" });
      return true;
    case "loop_menu_agendar":
      await patchMeta({ loop_menu_enviado_at: undefined, expected_reply: null });
      await sendListaCidades(supabase, supabaseUrl, serviceKey, atId, atendimentoMeta);
      return true;
    case "loop_menu_humano": {
      await patchMeta({ loop_menu_enviado_at: undefined, expected_reply: null });
      const _npLM = (atendimento.contato_id || "");
      const { data: _ctLM } = await supabase.from("contatos").select("nome").eq("id", _npLM).maybeSingle();
      const _nomeLM = ((_ctLM?.nome || "").split(/\s+/)[0]) || "";
      const escMsgLM = isHorarioHumano()
        ? "Claro! Vou chamar alguém da equipe pra te ajudar. Um momento 😊"
        : mensagemEscaladaForaHorario(_nomeLM);
      await sendWhatsApp(supabaseUrl, serviceKey, atId, escMsgLM);
      await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
      await supabase.from("eventos_crm").insert({
        contato_id: atendimento.contato_id, tipo: "loop_ia_escalado",
        descricao: "Loop: cliente optou por falar com a equipe via menu suave",
        referencia_tipo: "atendimento", referencia_id: atId,
      });
      try {
        await fetch(`${supabaseUrl}/functions/v1/summarize-atendimento`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ atendimento_id: atId }),
        });
      } catch (_) { /* best effort */ }
      return true;
    }
    case "orcamento":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Beleza! O orçamento é pra qual tipo de lente? 😊",
        botoes: [
          { id: "orcamento_oculos", titulo: "👓 Óculos" },
          { id: "orcamento_lc", titulo: "👁️ Lentes de contato" },
          { id: "orcamento_indef", titulo: "🤔 Ainda não sei" },
        ],
      });
      await patchMeta({ intent_detected: "orcamento", expected_reply: "orcamento_tipo" });
      return true;
    case "orcamento_oculos":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Pra te passar um orçamento de óculos certinho, preciso da sua receita 😊 Como prefere enviar?",
        botoes: [
          { id: "receita_foto", titulo: "📷 Enviar foto" },
          { id: "receita_digitar", titulo: "⌨️ Digitar valores" },
          { id: "receita_sem", titulo: "📄 Não tenho" },
        ],
      });
      await patchMeta({ intent_detected: "orcamento", contexto_lc: false, expected_reply: "receita_envio" });
      return true;
    case "orcamento_lc":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Pra LC, uma dúvida antes 😊 Sua receita atual é de óculos ou já é específica de lentes de contato?",
        botoes: [
          { id: "lc_rx_lc", titulo: "👁️ É de LC" },
          { id: "lc_rx_oculos", titulo: "👓 É de óculos" },
          { id: "lc_rx_naosei", titulo: "🤔 Não sei" },
        ],
      });
      await patchMeta({ intent_detected: "orcamento_lentes_contato", contexto_lc: true, expected_reply: "lc_tipo_receita" });
      return true;
    case "orcamento_indef":
      await sendOrcamentoEstimativaLCDescartavel(supabase, supabaseUrl, serviceKey, atId, { motivo: "tipo_indefinido" });
      await patchMeta({ intent_detected: "orcamento_indef", expected_reply: null });
      return true;
    case "lc_rx_lc":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Perfeito! Pra te passar o orçamento certinho de lentes de contato, me manda a receita 😊",
        botoes: [
          { id: "receita_foto", titulo: "📷 Enviar foto" },
          { id: "receita_digitar", titulo: "⌨️ Digitar valores" },
          { id: "receita_sem", titulo: "📄 Não tenho" },
        ],
      });
      await patchMeta({ intent_detected: "orcamento_lentes_contato", contexto_lc: true, expected_reply: "receita_envio" });
      return true;
    case "lc_rx_oculos": {
      // Receita de óculos → consultor especializado converte. Fora do horário, estimativa.
      if (isHorarioHumano()) {
        await sendWhatsApp(
          supabaseUrl, serviceKey, atId,
          "Pra LC com receita de óculos, vou te conectar com um consultor especializado pra fazer a conversão direitinho 🙌 Só um instante!",
        );
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
        await supabase.from("eventos_crm").insert({
          contato_id: atendimento.contato_id,
          tipo: "lc_conversao_receita_oculos",
          descricao: "Cliente quer LC mas só tem receita de óculos — escalado para conversor especializado",
          referencia_tipo: "atendimento", referencia_id: atId,
        });
      } else {
        await sendOrcamentoEstimativaLCDescartavel(supabase, supabaseUrl, serviceKey, atId, { motivo: "receita_oculos_fora_horario" });
      }
      await patchMeta({ intent_detected: "orcamento_lentes_contato", contexto_lc: true, expected_reply: null });
      return true;
    }
    case "lc_rx_naosei":
      await sendOrcamentoEstimativaLCDescartavel(supabase, supabaseUrl, serviceKey, atId, { motivo: "cliente_nao_sabe" });
      await patchMeta({ intent_detected: "orcamento_lentes_contato", contexto_lc: true, expected_reply: null });
      return true;
    case "status_pedido": {
      await loadMensagensFixas(supabase);
      await iniciarColetaOS(supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id, atendimentoMeta);
      return true;
    }
    case "os_meu_pedido": {
      const cpfMp = await getCpfContato(supabase, atendimento.contato_id);
      if (!cpfMp) {
        await sendWhatsApp(supabaseUrl, serviceKey, atId, "Pra localizar seu pedido, me passa o número da OS ou seu CPF 😊");
        await patchMeta({ expected_reply: "os_aguardando_identificador" });
        return true;
      }
      await patchMeta({ expected_reply: null });
      const { data: ctMp } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
      const _primMp = (ctMp?.nome || "").trim().split(/\s+/)[0] || "";
      await loadMensagensFixas(supabase);
      const rMp = await consultarStatusOS(supabaseUrl, serviceKey, { tipo: "cpf", valor: cpfMp });
      const handledMp = await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primMp, { ...atendimentoMeta, expected_reply: null, os_fluxo_terceiro: null }, rMp, { tipo: "cpf", valor: cpfMp },
      );
      if (handledMp === "fallback") {
        const escMsg = renderMsgFixa("os_escala_verificacao", { nome_comma: _primMp ? `, ${_primMp}` : "" });
        const osMsgMp = isHorarioHumano()
          ? escMsg
          : `${escMsg}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
        await sendWhatsApp(supabaseUrl, serviceKey, atId, osMsgMp);
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
        await supabase.from("eventos_crm").insert({
          contato_id: atendimento.contato_id,
          tipo: "consulta_os",
          descricao: "Consulta OS via CPF cadastrado — sem resultado único — escalado para humano",
          metadata: { modo: atendimento.modo },
          referencia_tipo: "atendimento",
          referencia_id: atId,
        });
      }
      return true;
    }
    case "os_outra_pessoa": {
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sem problema! Me passa o número da OS ou o CPF da pessoa 😊");
      await patchMeta({ expected_reply: "os_aguardando_identificador", os_fluxo_terceiro: true });
      return true;
    }
    case "os_pert_sim": {
      const osNumPs = String(atendimentoMeta.os_pert_resultado || "");
      if (!osNumPs) {
        await sendWhatsApp(supabaseUrl, serviceKey, atId, "Não consegui localizar o pedido para confirmar. Me passa o número da OS ou CPF 😊");
        await patchMeta({ expected_reply: "os_aguardando_identificador", os_pert_resultado: null });
        return true;
      }
      await patchMeta({ expected_reply: null, os_pert_resultado: null });
      const { data: ctPs } = await supabase.from("contatos").select("nome").eq("id", atendimento.contato_id).maybeSingle();
      const _primPs = (ctPs?.nome || "").trim().split(/\s+/)[0] || "";
      await loadMensagensFixas(supabase);
      const rPs = await consultarStatusOS(supabaseUrl, serviceKey, { tipo: "os", valor: osNumPs });
      const handledPs = await tratarResultadoConsultaOS(
        supabase, supabaseUrl, serviceKey, atId, atendimento.contato_id,
        _primPs, { ...atendimentoMeta, expected_reply: null, os_pert_resultado: null, os_fluxo_terceiro: null }, rPs, { tipo: "os", valor: osNumPs },
      );
      if (handledPs === "fallback") {
        const escMsg = renderMsgFixa("os_escala_verificacao", { nome_comma: _primPs ? `, ${_primPs}` : "" });
        const osMsgPs = isHorarioHumano()
          ? escMsg
          : `${escMsg}\n\n⏰ Estamos fora do horário de atendimento humano agora. Assim que reabrirmos (${proximaAberturaHumana()}), um consultor confirma o status do seu pedido.`;
        await sendWhatsApp(supabaseUrl, serviceKey, atId, osMsgPs);
        await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
        await supabase.from("eventos_crm").insert({
          contato_id: atendimento.contato_id,
          tipo: "consulta_os",
          descricao: "Consulta OS pertencimento confirmado — sem resultado único — escalado para humano",
          metadata: { os: osNumPs, modo: atendimento.modo },
          referencia_tipo: "atendimento",
          referencia_id: atId,
        });
      }
      return true;
    }
    case "os_pert_nao": {
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sem problema! Me passa o número da OS ou o CPF correto 😊");
      await patchMeta({ expected_reply: "os_aguardando_identificador", os_pert_resultado: null, os_fluxo_terceiro: null });
      return true;
    }
    case "duvida":
      await patchMeta({ intent_detected: "duvida_livre", expected_reply: null });
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Pode me contar sua dúvida por aqui 😊");
      return true;
    case "reclamacao":
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sinto muito que algo não saiu como esperado 😟 Já estou chamando um responsável pra te atender.");
      await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", atId);
      await supabase.from("eventos_crm").insert({ contato_id: atendimento.contato_id, tipo: "reclamacao_cliente", descricao: "Botão Reclamação — escalado", referencia_tipo: "atendimento", referencia_id: atId });
      return true;
    case "agendar":
      await sendListaLojas(supabase, supabaseUrl, serviceKey, atId);
      return true;
    case "receita_foto":
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Beleza! Me manda a foto da receita por aqui que eu já analiso 📷");
      await patchMeta({ aguardando_receita_foto: true, expected_reply: "receita_foto" });
      return true;
    case "receita_digitar":
    case "receita_corrigir": {
      const origem = buttonId === "receita_corrigir" ? "botao_receita_corrigir" : "botao_receita_digitar";
      await sendWhatsApp(supabaseUrl, serviceKey, atId, MSG_PEDIR_RECEITA_TEXTO_BOTAO);
      await patchMeta({ receita_pending: null, expected_reply: "receita_digitada" });
      try {
        const { data: cRow } = await supabase.from("contatos").select("metadata").eq("id", atendimento.contato_id).maybeSingle();
        const cMeta = (cRow?.metadata || {}) as Record<string, any>;
        if (cMeta?.receita_confirmacao?.pending === true) {
          cMeta.receita_confirmacao = {
            ...cMeta.receita_confirmacao,
            pending: false,
            superseded_at: new Date().toISOString(),
            superseded_by: origem,
          };
          await supabase.from("contatos").update({ metadata: cMeta }).eq("id", atendimento.contato_id);
        }
      } catch (e) {
        console.warn(`[${origem}] falha ao limpar pending no contato:`, e);
      }
      return true;
    }
    case "receita_sem": {
      // Sem receita + contexto LC → vai direto pra estimativa DNZ mensal.
      if (atendimentoMeta?.contexto_lc === true) {
        await sendOrcamentoEstimativaLCDescartavel(supabase, supabaseUrl, serviceKey, atId, { motivo: "sem_receita_lc" });
        await patchMeta({ intent_detected: "orcamento_lentes_contato", expected_reply: null });
        return true;
      }

      // Óculos sem receita — 3 salvaguardas antes de disparar âncora comercial.
      const { data: ctSemRx } = await supabase.from("contatos").select("metadata").eq("id", atendimento.contato_id).maybeSingle();
      const ctMetaSemRx = (ctSemRx?.metadata as Record<string, any>) || {};

      // Salvaguarda 1: receita pendente de confirmação OCR → pede confirmação antes de qualquer preço
      if (isReceitaPending(ctMetaSemRx)) {
        const lastRx = Array.isArray(ctMetaSemRx.receitas) && ctMetaSemRx.receitas.length > 0
          ? ctMetaSemRx.receitas[ctMetaSemRx.receitas.length - 1]
          : (ctMetaSemRx.ultima_receita || null);
        const msgPend = lastRx
          ? buildMsgConfirmarReceita(lastRx, false)
          : "Antes de continuar, preciso que você confirme os valores que li da sua receita 😊";
        await sendReceitaConfirmInteractive(supabase, supabaseUrl, serviceKey, atId, msgPend);
        return true;
      }

      // Salvaguarda 2: receita válida já confirmada → LLM usa consultar_lentes (preço exato)
      const receitasSemRx: any[] = Array.isArray(ctMetaSemRx.receitas) && ctMetaSemRx.receitas.length > 0
        ? ctMetaSemRx.receitas
        : (ctMetaSemRx.ultima_receita?.eyes ? [ctMetaSemRx.ultima_receita] : []);
      if (receitasSemRx.some((r: any) => isReceitaValida(r))) {
        return false; // LLM assume com receita em contexto
      }

      // Salvaguarda 3: esférico declarado no atendimento → LLM usa consultar_lentes_estimativa (faixas)
      // Em geral não ocorre no fluxo de botões (esférico vem de texto), mas defensivo.
      if (atendimentoMeta.sphere_od != null || atendimentoMeta.sphere_oe != null) {
        return false;
      }

      // Caso "zero": óculos, sem receita salva, sem grau declarado → âncora comercial determinística
      await sendOrcamentoEstimativaOculosSemReceita(supabase, supabaseUrl, serviceKey, atId);
      await patchMeta({ intent_detected: "orcamento_oculos_ancora", expected_reply: null });
      return true;
    }
    case "receita_ok": {
      if (atendimentoMeta.receita_pending) {
        await patchMeta({ receita_pending: null, receita_confirmada_at: new Date().toISOString(), expected_reply: "adicional_lentes" });
        // CRÍTICO: também limpa pending no contato (isReceitaPending checa lá),
        // senão a cotação subsequente devolve "Li sua receita assim, confere?".
        try {
          const { data: cRow } = await supabase.from("contatos").select("metadata").eq("id", atendimento.contato_id).maybeSingle();
          const cMeta = (cRow?.metadata || {}) as Record<string, any>;
          // B3c-FIX: marca confirmed_by_client_at na receita alvo.
          const _okIdx = typeof cMeta.receita_confirmacao?.rx_index === "number"
            ? cMeta.receita_confirmacao.rx_index
            : (Array.isArray(cMeta.receitas) ? cMeta.receitas.length - 1 : -1);
          if (_okIdx >= 0 && Array.isArray(cMeta.receitas) && cMeta.receitas[_okIdx]) {
            const _okReceitas = [...cMeta.receitas];
            _okReceitas[_okIdx] = { ..._okReceitas[_okIdx], confirmed_by_client_at: new Date().toISOString() };
            cMeta.receitas = _okReceitas;
          }
          cMeta.receita_confirmacao = { ...(cMeta.receita_confirmacao || {}), pending: false, confirmed_at: new Date().toISOString(), confirmed_via: "botao_receita_ok" };
          await supabase.from("contatos").update({ metadata: cMeta }).eq("id", atendimento.contato_id);
        } catch (e) {
          console.warn("[RECEITA_OK] falha ao limpar pending no contato:", e);
        }
        await sendInteractive(supabaseUrl, serviceKey, atId, {
          type: "button",
          texto: "Receita confirmada 🙌 Quer algum adicional nas lentes?",
          botoes: [
            { id: "adicional_azul", titulo: "💙 Luz azul" },
            { id: "adicional_foto", titulo: "☀️ Fotossensível" },
            { id: "adicional_nao", titulo: "➡️ Sem adicionais" },
          ],
        });
        return true;
      }
      return false;
    }
    case "adicional_azul":
      await patchMeta({ adicionais_pending: { filtro_blue: true }, expected_reply: null });
      await runQuoteWithFilter(supabase, supabaseUrl, serviceKey, atendimento, { filtro_blue: true });
      return true;
    case "adicional_foto":
      await patchMeta({ adicionais_pending: { filtro_photo: true }, expected_reply: null });
      await runQuoteWithFilter(supabase, supabaseUrl, serviceKey, atendimento, { filtro_photo: true });
      return true;
    case "adicional_nao":
      await patchMeta({ adicionais_pending: {}, expected_reply: null });
      await runQuoteWithFilter(supabase, supabaseUrl, serviceKey, atendimento, {});
      return true;
    case "orcamento_agendar":
      await sendListaLojas(supabase, supabaseUrl, serviceKey, atId);
      return true;
    case "orcamento_duvida":
      // B2a-FIX: seta expected_reply="duvida_pos_cotacao" em vez de null — garante que a
      // próxima msg do cliente passe por routeExpectedTypedReply e chegue ao LLM SEM o
      // [PÓS-RECEITA OBRIGATÓRIO], que antes forçava re-confirmação de receita.
      await patchMeta({ expected_reply: "duvida_pos_cotacao", intent_detected: "duvida_pos_orcamento" });
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Claro! Me diz qual ponto da cotação você quer que eu explique melhor 😊");
      return true;
    case "orcamento_mais_barato":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: "Posso te oferecer 20% de desconto nas lentes se fechar hoje 🤝 O que acha?",
        botoes: [
          { id: "desconto_aceito", titulo: "✅ Aceito, agendar" },
          { id: "desconto_loja", titulo: "🏪 Ver na loja" },
          { id: "desconto_pensar", titulo: "⏳ Vou pensar" },
        ],
      });
      await patchMeta({ desconto_oferecido_at: new Date().toISOString(), expected_reply: "desconto_followup" });
      return true;
    case "desconto_aceito":
      await sendListaLojas(supabase, supabaseUrl, serviceKey, atId);
      return true;
    case "desconto_loja":
      await sendEnderecosLojas(supabase, supabaseUrl, serviceKey, atId);
      await patchMeta({ expected_reply: null });
      return true;
    case "desconto_pensar":
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sem problema! Quando quiser dar continuidade, é só me chamar 😊");
      await patchMeta({ expected_reply: null });
      return true;
    case "ver_menu":
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "list",
        texto: "Claro! Sobre o que quer falar? 😊",
        lista: {
          label: "Ver opções",
          secao: "Posso te ajudar com",
          itens: MENU_TRIAGEM_ITENS,
        },
      });
      await patchMeta({ expected_reply: "menu_triagem", intent_detected: null });
      return true;
    case "ag_confirmar": {
      const pend = atendimentoMeta.agendamento_pending;
      if (pend?.loja_nome && pend?.data_horario) {
        await fetch(`${supabaseUrl}/functions/v1/agendar-cliente`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ atendimento_id: atId, contato_id: atendimento.contato_id, loja_nome: pend.loja_nome, data_horario: pend.data_horario }),
        });
        await patchMeta({ agendamento_pending: null, expected_reply: null });
        return true;
      }
      return false;
    }
    case "ag_mudar":
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Tranquilo! Qual dia e horário fica melhor pra você? 🙂");
      return true;
    case "ag_cancelar":
      await patchMeta({ agendamento_pending: null, expected_reply: null });
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Sem problema, cancelei a tentativa. Quando quiser, é só me chamar! 😊");
      return true;
    case "show_confirma": {
      const { data: ag } = await supabase
        .from("agendamentos").select("id, data_horario, loja_nome, metadata")
        .eq("contato_id", atendimento.contato_id)
        .in("status", ["lembrete_enviado", "agendado", "confirmado"])
        .order("data_horario", { ascending: true }).limit(1).maybeSingle();
      if (ag) {
        const md = (ag.metadata || {}) as Record<string, any>;
        await supabase.from("agendamentos").update({
          status: "confirmado", confirmacao_enviada: true,
          metadata: { ...md, cliente_confirmou_at: new Date().toISOString(), via: "interactive_button" },
        }).eq("id", ag.id);
        const dt = new Date(ag.data_horario);
        const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
        const dataFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
        await sendWhatsApp(supabaseUrl, serviceKey, atId, `✅ Confirmado! Te esperamos ${dataFmt} às ${hora} na ${ag.loja_nome}. Até lá! 😊`);
        fetch(`${supabaseUrl}/functions/v1/notificar-loja-agendamento`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ agendamento_id: ag.id }),
        }).catch(() => {});
      }
      return true;
    }
    case "show_remarcar":
      await sendListaLojas(supabase, supabaseUrl, serviceKey, atId);
      return true;
    case "show_nao": {
      const { data: ag } = await supabase
        .from("agendamentos").select("id, metadata")
        .eq("contato_id", atendimento.contato_id)
        .in("status", ["lembrete_enviado", "agendado", "confirmado"])
        .order("data_horario", { ascending: true }).limit(1).maybeSingle();
      if (ag) {
        const md = (ag.metadata || {}) as Record<string, any>;
        await supabase.from("agendamentos").update({
          status: "cancelado",
          metadata: { ...md, cancelado_via: "interactive_button", cancelado_at: new Date().toISOString() },
        }).eq("id", ag.id);
      }
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Tudo bem! Quando quiser remarcar, é só me chamar por aqui 😊");
      return true;
    }
    case "recupera_intent_propria": {
      // Cliente expressou intenção própria (orçamento/óculos/receita/OS/etc.) durante cadência.
      // Encerra a recuperação e deixa o roteamento normal assumir o intent.
      await patchMeta({ expected_reply: null });
      try {
        const { data: _riRow } = await supabase.from("contatos")
          .select("metadata").eq("id", atendimento.contato_id).maybeSingle();
        const _riMeta = (_riRow?.metadata || {}) as Record<string, any>;
        if (_riMeta.recuperacao_vendas) {
          await supabase.from("contatos").update({
            metadata: { ..._riMeta, recuperacao_vendas: {
              ..._riMeta.recuperacao_vendas,
              status: "encerrado_intent_proprio",
              encerrado_at: new Date().toISOString(),
            }},
          }).eq("id", atendimento.contato_id);
        }
      } catch (_) { /* noop */ }
      console.log("[RECUPERACAO] Intenção própria do cliente detectada — cadência encerrada, roteamento normal assume");
      return false; // NÃO consome — roteamento normal (pré-LLM / LLM) assume o intent
    }
    case "recupera_sim":
      await sendListaLojas(supabase, supabaseUrl, serviceKey, atId);
      return true;
    case "recupera_loja":
      await sendEnderecosLojas(supabase, supabaseUrl, serviceKey, atId);
      await patchMeta({ expected_reply: null });
      return true;
    case "recupera_nao":
      await patchMeta({ recuperacao_recusada_at: new Date().toISOString(), expected_reply: null });
      await sendWhatsApp(supabaseUrl, serviceKey, atId, "Compreendo! Obrigado pelo retorno. Quando precisar, estaremos por aqui 😊");
      return true;
  }

  // ── Cashback: "Ver meu saldo" (botão ou texto afirmativo mapeado em detectExpectedReplyAction) ──
  if (buttonId === "cashback_ver") {
    await patchMeta({ expected_reply: null });

    const { data: _cbS } = await supabase.rpc("cashback_consultar_saldo", { _contato_id: atendimento.contato_id });
    const s        = _cbS as any;
    const usavel   = Number(s?.saldo_usavel      ?? 0);
    const carencia = Number(s?.saldo_em_carencia ?? 0);

    const fmtBRL = (n: number) =>
      Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDia = (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = String(iso).slice(0, 10);
      return d.slice(8) + "/" + d.slice(5, 7);
    };
    const proxVenc = fmtDia(s?.proximo_vencimento);
    const proxLib  = fmtDia(s?.proxima_liberacao);

    let cbMsg: string;
    if (usavel > 0 && carencia === 0) {
      cbMsg = `Seu cashback de R$ ${fmtBRL(usavel)} já está liberado pra usar` +
        (proxVenc ? `, e vale até ${proxVenc} 💚` : " 💚");
    } else if (usavel === 0 && carencia > 0) {
      cbMsg = `Seu cashback de R$ ${fmtBRL(carencia)} já está garantido e libera dia ${proxLib} 💚`;
    } else if (usavel > 0 && carencia > 0) {
      cbMsg = `Você tem R$ ${fmtBRL(usavel)} liberado pra usar e mais R$ ${fmtBRL(carencia)} que libera dia ${proxLib} 💚`;
    } else {
      cbMsg = "Você ainda não tem cashback acumulado — mas a cada compra você ganha 15% de volta pra usar na próxima 💚";
    }

    if (usavel > 0 || carencia > 0) {
      await sendInteractive(supabaseUrl, serviceKey, atId, {
        type: "button",
        texto: cbMsg,
        botoes: [{ id: "cashback_como_funciona", titulo: "💳 Como funciona?" }],
      });
    } else {
      await sendWhatsApp(supabaseUrl, serviceKey, atId, cbMsg);
    }

    await supabase.from("eventos_crm").insert({
      contato_id:      atendimento.contato_id,
      tipo:            "cashback_consulta_cliente",
      descricao:       "Cliente consultou saldo cashback via botão",
      referencia_tipo: "atendimento",
      referencia_id:   atId,
    });
    return true;
  }

  // ── Cashback: "Agora não" ──
  if (buttonId === "cashback_nao") {
    await patchMeta({ expected_reply: null });
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Tranquilo! Qualquer coisa é só chamar 💚");
    return true;
  }

  // BLOCO 1 — "Como funciona o cashback?" (stateless, não precisa de dados do contato)
  if (buttonId === "cashback_como_funciona") {
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      "A cada compra você ganha 15% de volta. Pra usar, é só numa nova compra de pelo menos 3× o valor do cashback, e ele vale por 90 dias 💚");
    return true;
  }

  return false;
}

// ── Seleção de loja: sempre cidade → loja ────────────────────────────────────
// sendListaCidades: ponto de entrada único. Substitui getMsgListaCidades (texto)
// e o antigo sendListaLojas (lista flat). Seta expected_reply "cidade_selecao".
async function sendListaCidades(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atId: string, metaAtual: Record<string, any>,
  texto = "Em qual cidade prefere ser atendido? 😊",
): Promise<void> {
  const snap = await loadCidadesLojas().catch(() => null);
  const cidades = snap?.cidadesOrdenadas ?? [];
  await supabase.from("atendimentos")
    .update({ metadata: { ...metaAtual, expected_reply: "cidade_selecao" } })
    .eq("id", atId);
  if (!cidades.length) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      "Em qual cidade fica melhor pra você? Temos em Osasco, Carapicuíba, Itapevi e Barueri 😊");
    return;
  }
  await sendInteractive(supabaseUrl, serviceKey, atId, {
    type: "list",
    texto,
    lista: {
      label: "Ver cidades",
      secao: "Nossas regiões",
      itens: cidades.map((slug) => {
        const n = snap!.cidadeToLojas[slug]?.length ?? 0;
        return { id: `cidade:${slug}`, titulo: snap!.cidadeLabel[slug] || slug,
                 descricao: `${n} unidade${n !== 1 ? "s" : ""}` };
      }),
    },
  });
}

// sendListaLojasDaCidade: envia lojas de uma cidade. Se a cidade tiver apenas 1 loja,
// pula a lista e confirma direto (otimização). contatoId necessário para limpar
// pos_orcamento nesse caso e evitar re-rotear a mensagem de dia/hora.
async function sendListaLojasDaCidade(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atId: string, metaAtual: Record<string, any>,
  cidadeSlug: string,
  lojas: Array<{ id: string; nome_loja?: string | null; endereco?: string | null }>,
  contatoId?: string,
): Promise<void> {
  const snap = await loadCidadesLojas().catch(() => null);
  const nomesNaCidade = snap?.cidadeToLojas[cidadeSlug] ?? [];
  const label = snap?.cidadeLabel[cidadeSlug] ?? cidadeSlug;
  const filtradas = lojas.filter((l) =>
    nomesNaCidade.some((n) => _normTxt(l.nome_loja || "") === _normTxt(n))
  );

  if (filtradas.length === 0) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      `Pra ${label}, me passa o seu bairro que te indico a unidade mais próxima 😊`);
    return;
  }

  // Cidade com 1 loja → confirma direto, sem lista de 1 item.
  if (filtradas.length === 1) {
    const loja = filtradas[0];
    await supabase.from("atendimentos").update({
      metadata: {
        ...metaAtual, expected_reply: "agendamento_data_horario",
        agendamento_pending: {
          ...(metaAtual.agendamento_pending || {}), loja_id: loja.id, loja_nome: loja.nome_loja,
        },
      },
    }).eq("id", atId);
    // Limpa pos_orcamento para que "amanhã às 14h" não re-dispare o handler de loja.
    if (contatoId) {
      try {
        const { data: ctRow } = await supabase.from("contatos")
          .select("metadata").eq("id", contatoId).maybeSingle();
        const ctMeta = (ctRow?.metadata || {}) as Record<string, any>;
        if (ctMeta.pos_orcamento) {
          const { pos_orcamento: _p, ...rest } = ctMeta;
          await supabase.from("contatos").update({ metadata: rest }).eq("id", contatoId);
        }
      } catch (_) { /* noop */ }
    }
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      `Ótimo! Nossa unidade em ${label} é a *${loja.nome_loja}* 😊\nQual dia e horário ficaria melhor pra você?`);
    return;
  }

  await supabase.from("atendimentos")
    .update({ metadata: { ...metaAtual, expected_reply: "loja_selecao" } })
    .eq("id", atId);
  await sendInteractive(supabaseUrl, serviceKey, atId, {
    type: "list",
    texto: `Aqui são as unidades em *${label}* — qual fica melhor? 😊`,
    lista: {
      label: "Ver lojas", secao: "Nossas unidades",
      itens: filtradas.map((l) => ({
        id: `loja:${l.id}`, titulo: l.nome_loja || "",
        descricao: (l.endereco || "").slice(0, 72),
      })),
    },
  });
}

// sendCidadesLojaLocal: envia botões de cidade para consulta de LOCALIZAÇÃO (não agendamento).
// Usa loja_info:SLUG em vez de cidade:SLUG e seta expected_reply: "loja_local_cidade".
async function sendCidadesLojaLocal(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atId: string, metaAtual: Record<string, any>,
): Promise<void> {
  const snap = await loadCidadesLojas().catch(() => null);
  const cidades = snap?.cidadesOrdenadas ?? [];
  await supabase.from("atendimentos")
    .update({ metadata: { ...metaAtual, expected_reply: "loja_local_cidade" } })
    .eq("id", atId);
  if (!cidades.length) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      "Em qual cidade você nos procura? Temos lojas em Osasco, Carapicuíba, Itapevi e Barueri 😊");
    return;
  }
  await sendInteractive(supabaseUrl, serviceKey, atId, {
    type: "list",
    texto: "Em qual cidade você quer saber informações das nossas lojas? 😊",
    lista: {
      label: "Ver cidades",
      secao: "Nossas regiões",
      itens: cidades.map((slug) => {
        const n = snap!.cidadeToLojas[slug]?.length ?? 0;
        return {
          id: `loja_info:${slug}`,
          titulo: snap!.cidadeLabel[slug] || slug,
          descricao: `${n} unidade${n !== 1 ? "s" : ""}`,
        };
      }),
    },
  });
}

// sendInfoLojasCidade: envia endereço + horário hoje + Google Maps de cada loja da cidade.
// NÃO inicia fluxo de agendamento — apenas responde a consulta de localização.
async function sendInfoLojasCidade(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atId: string, metaAtual: Record<string, any>,
  cidadeSlug: string,
): Promise<void> {
  const snap = await loadCidadesLojas().catch(() => null);
  const nomesNaCidade = snap?.cidadeToLojas[cidadeSlug] ?? [];
  const label = snap?.cidadeLabel[cidadeSlug] ?? cidadeSlug;

  const { data: lojasFull } = await supabase
    .from("telefones_lojas")
    .select("id, nome_loja, endereco, horario_abertura, horario_fechamento, google_profile_url, telefone")
    .eq("ativo", true)
    .order("nome_loja");

  const filtradas = ((lojasFull || []) as any[]).filter((l: any) =>
    nomesNaCidade.some((n: string) => _normTxt(l.nome_loja || "") === _normTxt(n))
  );

  // Limpa expected_reply após resolver (seja sucesso ou fallback)
  await supabase.from("atendimentos")
    .update({ metadata: { ...metaAtual, expected_reply: null, loja_local_cidade: cidadeSlug } })
    .eq("id", atId);

  if (filtradas.length === 0) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId,
      `Pra ${label}, me passa seu bairro que te indico a unidade mais próxima 😊`);
    return;
  }

  // Consulta horário de hoje na tabela loja_status_no_dia
  const todayStr = new Date().toISOString().slice(0, 10);
  const lojasIds = filtradas.map((l: any) => l.id).filter(Boolean);
  const statusMap: Record<string, string> = {};
  if (lojasIds.length > 0) {
    try {
      const { data: statusRows } = await supabase
        .from("loja_status_no_dia")
        .select("loja_id, status, abertura, fechamento")
        .in("loja_id", lojasIds)
        .eq("data", todayStr);
      for (const row of (statusRows || []) as any[]) {
        if (row.status === "fechada") {
          statusMap[row.loja_id] = "Hoje: FECHADA";
        } else if (row.abertura && row.fechamento) {
          statusMap[row.loja_id] = `Hoje: ${row.abertura}–${row.fechamento}`;
        }
      }
    } catch (_) { /* noop */ }
  }

  const numEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];
  let msg = filtradas.length === 1
    ? `Aqui estão as informações da nossa unidade em *${label}* 😊`
    : `Aqui estão nossas unidades em *${label}* 😊`;

  filtradas.forEach((l: any, i: number) => {
    msg += `\n\n${numEmojis[i] || `${i + 1}.`} *${l.nome_loja}*`;
    if (l.endereco) msg += `\n📍 ${l.endereco}`;
    const gradeHoje = statusMap[l.id];
    if (gradeHoje) {
      msg += `\n🕐 ${gradeHoje}`;
    } else if (l.horario_abertura && l.horario_fechamento) {
      msg += `\n🕐 ${l.horario_abertura}–${l.horario_fechamento}`;
    }
    if (l.google_profile_url) msg += `\n🗺️ ${l.google_profile_url}`;
  });

  msg += "\n\nQualquer dúvida é só chamar! 😊";
  console.log(`[LOJA-LOCAL] Info enviada: ${filtradas.length} loja(s) em ${label}`);
  await sendWhatsApp(supabaseUrl, serviceKey, atId, msg);
}

async function sendListaLojas(supabase: any, supabaseUrl: string, serviceKey: string, atId: string) {
  let metaAtual: Record<string, any> = {};
  try {
    const { data: atRow } = await supabase.from("atendimentos").select("metadata").eq("id", atId).maybeSingle();
    metaAtual = (atRow?.metadata || {}) as Record<string, any>;
  } catch (_) { /* noop */ }
  await sendListaCidades(supabase, supabaseUrl, serviceKey, atId, metaAtual);
}

async function sendEnderecosLojas(supabase: any, supabaseUrl: string, serviceKey: string, atId: string) {
  const { data: lojas } = await supabase
    .from("telefones_lojas").select("nome_loja, endereco")
    .eq("tipo", "loja").eq("ativo", true)
    .order("nome_loja", { ascending: true }).limit(8);
  if (!lojas?.length) {
    await sendWhatsApp(supabaseUrl, serviceKey, atId, "Te passo as lojas em instantes 🙂");
    return;
  }
  const linhas = lojas.map((l: any) => `📍 *${l.nome_loja}*\n${l.endereco || ""}`).join("\n\n");
  await sendWhatsApp(supabaseUrl, serviceKey, atId, `Aqui estão as nossas lojas, é só passar quando puder 😊\n\n${linhas}`);
}


async function handleEscalation(
  supabase: any, supabaseUrl: string, serviceKey: string,
  atendimentoId: string, contatoId: string, mensagem: string, trigger: string,
  nomePrim: string = ""
) {
  const dentroExpediente = isHorarioHumano();
  // Use custom message for contact lens, default for others
  const resposta = trigger === "lentes_de_contato"
    ? mensagem
    : (dentroExpediente
        ? "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve. Posso te ajudar com algo rápido enquanto isso? 😊"
        : mensagemEscaladaForaHorario(nomePrim));

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
    descricao: `Escalonamento (${trigger}): cliente pediu Consultor${dentroExpediente ? "" : " — fora do expediente"}`,
    metadata: {
      trigger, motivo: trigger, mensagem,
      fora_horario: !dentroExpediente,
      proxima_abertura: dentroExpediente ? null : proximaAberturaHumana(),
    },
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

// ── Helper: cotação de lentes de contato a partir da última receita salva ──
// Usado tanto pela tool consultar_lentes_contato quanto pelo gate determinístico
// pós-confirmação de receita (caso Marcelo, Mai/2026).
async function runConsultarLentesContato(
  supabase: any,
  contatoId: string,
  args: { receita_label?: string; descarte_preferido?: string; marca_preferida?: string; resposta_fallback?: string } = {},
): Promise<{ resposta: string; usou_catalogo: boolean; needs_toric_sob_encomenda: boolean }> {
  const { data: ctRx } = await supabase.from("contatos").select("metadata").eq("id", contatoId).single();
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
      ? allRx.find((r: any) => norm(r.label || "") === norm(args.receita_label!)) || allRx[allRx.length - 1]
      : allRx[allRx.length - 1];
  }

  if (!rxMeta?.eyes) {
    return {
      resposta: args.resposta_fallback || "Pra te passar as opções de lentes de contato, preciso da sua receita. Pode me enviar uma foto? 📸",
      usou_catalogo: false,
      needs_toric_sob_encomenda: false,
    };
  }

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
    return {
      resposta: args.resposta_fallback || "Não consegui ler o grau esférico da sua receita. Pode me enviar uma foto mais nítida?",
      usou_catalogo: false,
      needs_toric_sob_encomenda: false,
    };
  }

  const worstSphere = sphereValues.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b), 0);
  const worstCyl = cylAbsMax > 0 ? (Math.abs(cylODn) > Math.abs(cylOEn) ? cylODn : cylOEn) : 0;
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

  const descPref = String(args.descarte_preferido || "qualquer").toLowerCase();
  if (descPref === "diario" || descPref === "diaria") q = q.eq("descarte", "diario");
  else if (descPref === "quinzenal") q = q.eq("descarte", "quinzenal");
  else if (descPref === "mensal") q = q.eq("descarte", "mensal");

  if (args.marca_preferida) {
    q = q.or(`fornecedor.ilike.%${args.marca_preferida}%,produto.ilike.%${args.marca_preferida}%`);
  }

  const { data: lentes } = await q
    .order("is_dnz", { ascending: false })
    .order("priority", { ascending: true })
    .order("price_brl", { ascending: true })
    .limit(15);

  if (!lentes || lentes.length === 0) {
    return {
      resposta: args.resposta_fallback || (needsToric
        ? "Pelo seu grau, você precisa de lente TÓRICA (com correção de astigmatismo) — esse modelo é sob encomenda. Vou pedir pra um Consultor te apresentar as opções específicas, tudo bem?"
        : "Não encontrei lentes de contato compatíveis no nosso estoque. Posso pedir pra um Consultor te ajudar a buscar uma opção sob encomenda?"),
      usou_catalogo: false,
      needs_toric_sob_encomenda: needsToric,
    };
  }

  const pick: any[] = [];
  const seen = new Set<string>();
  for (const l of lentes) {
    const key = `${l.fornecedor}|${l.descarte}`;
    if (!seen.has(key)) { pick.push(l); seen.add(key); }
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

  const isMonoLC = rxMeta?.monocular === true;
  const odDispLC = od?.blind ? "—" : `${od.sphere ?? "—"}/${od.cylinder ?? "—"}${od.axis ? `x${od.axis}` : ""}`;
  const oeDispLC = oe?.blind ? "—" : `${oe.sphere ?? "—"}/${oe.cylinder ?? "—"}${oe.axis ? `x${oe.axis}` : ""}`;
  let msg = `🔎 *Lentes de contato compatíveis com sua receita:*\nOD ${odDispLC} | OE ${oeDispLC}\n`;
  if (isMonoLC) msg += `\n_💡 Plano calculado para 1 olho apenas (visão monocular)._\n`;
  if (needsToric) {
    msg += `\n⚠️ *Lente TÓRICA* (astigmatismo ≥ 0.75) — sob encomenda. Pagamento confirma o pedido.\n`;
  }

  for (const l of pick) {
    const unidades = Number(l.unidades_por_caixa) || 6;
    const dias = Number(l.dias_por_unidade) || 30;
    const desc = l.descarte === "diario" ? "diária"
      : l.descarte === "quinzenal" ? "quinzenal"
      : l.descarte === "mensal" ? "mensal" : l.descarte;
    const preco = fmtBRL(Number(l.price_brl));

    let plano = "";
    if (isMonoLC) {
      if (l.descarte === "diario") {
        plano = `Plano (1 olho): 1 caixa dura ~${unidades} dias.`;
      } else {
        const meses1cx = Math.round((unidades * dias) / 30);
        const meses4cx = Math.round((4 * unidades * dias) / 30);
        plano = `Plano (1 olho): 1 caixa dura ~${meses1cx} meses. 🎁 *Combo 3+1*: 4 caixas = ~${meses4cx} meses.`;
      }
    } else if (l.descarte === "diario") {
      const dias_cx_um_olho = unidades;
      if (mesmaDioptria) {
        plano = `Plano: 1 caixa atende os 2 olhos por ~${Math.floor(dias_cx_um_olho / 2)} dias.`;
      } else {
        plano = `Plano: 1 caixa por olho — ~${dias_cx_um_olho} dias por olho. Combo 3+1 não se aplica a diárias.`;
      }
    } else {
      const dias_por_olho_1cx = unidades * dias;
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

  msg += `\n\n${MSG_CTA_AGENDAMENTO}`;
  return { resposta: msg, usou_catalogo: true, needs_toric_sob_encomenda: needsToric };
}
