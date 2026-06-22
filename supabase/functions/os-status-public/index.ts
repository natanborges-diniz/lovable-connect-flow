// os-status-public — consulta status de OS via bridge Firebird.
// Auth: x-service-key (INTERNAL_SERVICE_SECRET). Chamada server-to-server; nunca exposta ao cliente final.
// Retorna { encontrado, resultados } onde cada resultado tem { publico, interno }.
// "publico" é repassado ao LLM/ai-triage; "interno" NUNCA é repassado ao cliente.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-key",
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return "***";
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

// ── formatarDataBR ──────────────────────────────────────────────────────────
// Converte ISO / YYYY-MM-DD / DD/MM/YYYY para DD/MM/YYYY. Retorna null se inválido.
function formatarDataBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Já no formato DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // ISO: YYYY-MM-DDT... ou YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return null;
}

// ── situacaoFromCodEtapa ────────────────────────────────────────────────────
// Fonte de verdade para o campo "situacao" no público. Usa codEtapa numérico.
// Primeira regra que casa vence.
function situacaoFromCodEtapa(codEtapa: number | null): string {
  if (codEtapa === null || codEtapa === undefined) {
    console.warn("[os-status] codEtapa nulo — usando fallback producao_lentes");
    return "producao_lentes";
  }
  if ([9, 13, 17, 18].includes(codEtapa)) return "escala_humano";
  if (codEtapa === 8)                      return "entregue";
  if (codEtapa === 5)                      return "pronto";
  if ([2, 3, 4, 15, 16].includes(codEtapa)) return "producao_montagem";
  if ([1, 6, 7, 10, 11, 12, 14].includes(codEtapa)) return "producao_lentes";
  if (codEtapa === 0)                      return "nao_iniciada";
  console.warn(`[os-status] codEtapa fora de 0–18 (${codEtapa}) — usando fallback producao_lentes`);
  return "producao_lentes";
}

// ── montarProdutoResumo ─────────────────────────────────────────────────────
// Retorna string pronta pro cliente. Não interpreta prefixo nem distingue grau/contato.
// Dedup: od+oe preenchidos → uma única ocorrência de "lentes".
function montarProdutoResumo(
  produtos: Array<{ tipo: "lente_od" | "lente_oe" | "armacao"; descricao: string }>,
): string {
  const temLente = produtos.some(
    (p) => (p.tipo === "lente_od" || p.tipo === "lente_oe") && p.descricao.trim() !== "",
  );
  const temArmacao = produtos.some(
    (p) => p.tipo === "armacao" && p.descricao.trim() !== "",
  );
  if (temArmacao && temLente) return "armação + lentes";
  if (temLente)               return "lentes";
  if (temArmacao)             return "armação";
  return "";
}

// ── sanitizarArmacao ────────────────────────────────────────────────────────
// Extrai marca+modelo legíveis da descrição crua do Firebird.
// Remove códigos internos e cor entre parênteses; limita a 40 chars.
function sanitizarArmacao(descricao: string): string {
  let s = String(descricao || "").trim();
  if (!s) return "";
  // Remove parênteses (geralmente cor/código): "RB4171 (BLACK)" → "RB4171"
  s = s.replace(/\([^)]*\)/g, "").trim();
  // Title Case suave: cada palavra com inicial maiúscula
  s = s.toLowerCase().replace(/\b([a-z0-9])([a-z0-9-]*)/g, (_, a, b) => a.toUpperCase() + b);
  // Códigos tipo "RB4171" devem ficar maiúsculos
  s = s.replace(/\b([A-Z]{2,4})(\d{2,5})\b/gi, (_, l, n) => `${l.toUpperCase()}${n}`);
  return s.length > 40 ? s.slice(0, 37).trimEnd() + "…" : s;
}

// ── classificarLente ────────────────────────────────────────────────────────
// Classifica lente em categoria + tratamentos a partir de keywords. Conservador:
// quando incerto, devolve "lentes" simples sem inferir tecnologia.
function classificarLente(descricao: string): string {
  const d = String(descricao || "").toLowerCase();
  if (!d.trim()) return "";

  let categoria = "lentes monofocais";
  if (/multifocal|progressi|varilux|eyezen|precise/.test(d)) categoria = "lentes multifocais";
  else if (/bifocal/.test(d))                                categoria = "lentes bifocais";
  else if (/contato|contact|gelflex|biofinity|acuvue|frequency|soflens/.test(d)) categoria = "lentes de contato";
  else if (/visao\s*simples|vis[aã]o\s*simples|monofocal|single/.test(d))      categoria = "lentes monofocais";

  const tratos: string[] = [];
  if (/antirreflexo|anti-reflexo|\bar\b|hmc|crizal|sapphire/.test(d)) tratos.push("antirreflexo");
  if (/transitions|fotossens|photofusion|fotocrom/.test(d))           tratos.push("fotossensíveis");
  if (/blue|azul|filtro\s*azul/.test(d))                              tratos.push("filtro azul");
  if (/polariz/.test(d))                                              tratos.push("polarizadas");

  return tratos.length ? `${categoria} com ${tratos.join(" e ")}` : categoria;
}

// ── montarProdutoDescricao ──────────────────────────────────────────────────
// Versão detalhada e amigável: marca da armação + categoria das lentes (dedupando OD/OE).
// Fallback silencioso para `montarProdutoResumo` se nada legível for extraído.
function montarProdutoDescricao(
  produtos: Array<{ tipo: "lente_od" | "lente_oe" | "armacao"; descricao: string }>,
): string {
  const partes: string[] = [];

  const arm = produtos.find((p) => p.tipo === "armacao" && p.descricao.trim() !== "");
  if (arm) {
    const nome = sanitizarArmacao(arm.descricao);
    if (nome) partes.push(`armação ${nome}`);
  }

  const od = produtos.find((p) => p.tipo === "lente_od" && p.descricao.trim() !== "");
  const oe = produtos.find((p) => p.tipo === "lente_oe" && p.descricao.trim() !== "");
  const lenteOd = od ? classificarLente(od.descricao) : "";
  const lenteOe = oe ? classificarLente(oe.descricao) : "";
  if (lenteOd && lenteOe && lenteOd === lenteOe) {
    partes.push(lenteOd);
  } else {
    if (lenteOd) partes.push(lenteOd);
    if (lenteOe && lenteOe !== lenteOd) partes.push(lenteOe);
  }

  return partes.join(" + ");
}

// ── normalizarResultado ─────────────────────────────────────────────────────
// Transforma uma linha crua do bridge no formato { os, cliente, empresa, vendedor, publico, interno }.
// "interno" NUNCA é exposto ao cliente/LLM — serve para rastreio e log.
function normalizarResultado(raw: Record<string, unknown>): {
  os: string;
  cliente: string;
  empresa: string;
  vendedor: string | null;
  publico: Record<string, unknown>;
  interno: Record<string, unknown>;
} {
  const codEtapa = raw.codEtapa != null ? Number(raw.codEtapa) : null;
  const situacao = situacaoFromCodEtapa(codEtapa);
  const produtos = Array.isArray(raw.produtos)
    ? (raw.produtos as Array<{ tipo: "lente_od" | "lente_oe" | "armacao"; descricao: string }>)
    : [];

  const publico: Record<string, unknown> = {
    situacao,                                          // fonte de verdade para o ai-triage
    etapa:           String(raw.etapa ?? "").trim(),   // rótulo textual de apoio (Firebird)
    produtoResumo:   montarProdutoResumo(produtos),    // produtos crus NÃO vão no público
    previsaoEntrega: formatarDataBR(raw.dataPrevisao as string | null),
    pronto:          situacao === "pronto",
    entregue:        situacao === "entregue",
  };

  const interno: Record<string, unknown> = {
    etapaErp:    String(raw.etapa ?? "").trim(),
    statusAtraso: raw.statusAtraso ?? null,
    atrasoDias:  raw.atrasoDias ?? null,
    dataEmissao: formatarDataBR(raw.dataEmissao as string | null),
    dataSaida:   formatarDataBR(raw.dataSaida  as string | null),
    codEtapa,
    produtos,   // cru, para debug interno
  };

  return {
    os:       String(raw.os      ?? "").trim(),
    cliente:  String(raw.cliente ?? "").trim(),
    empresa:  String(raw.empresa ?? "").trim(),
    vendedor: raw.vendedor != null ? String(raw.vendedor).trim() : null,
    publico,
    interno,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const serviceKey    = req.headers.get("x-service-key");
  const expectedKey   = Deno.env.get("INTERNAL_SERVICE_SECRET");
  if (!expectedKey || serviceKey !== expectedKey) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const BRIDGE_URL = Deno.env.get("BRIDGE_URL");
  if (!BRIDGE_URL) {
    return jsonResp({ error: "BRIDGE_URL não configurado" }, 500);
  }

  try {
    const body     = await req.json().catch(() => ({}));
    const rawOs    = body.os  != null ? String(body.os).trim()  : "";
    const rawCpf   = body.cpf != null ? String(body.cpf).trim() : "";
    const cpfDigits = rawCpf.replace(/\D/g, "");

    if (!rawOs && !cpfDigits) {
      return jsonResp({ error: "Informe os ou cpf" }, 400);
    }
    if (rawCpf && cpfDigits.length !== 11) {
      return jsonResp({ error: "cpf deve conter 11 dígitos" }, 400);
    }

    // Monta query string
    const qs = new URLSearchParams();
    if (rawOs)      qs.set("os",  rawOs);
    if (cpfDigits)  qs.set("cpf", cpfDigits);

    console.log("[os-status-public] consulta", {
      os:  rawOs  || null,
      cpf: cpfDigits ? maskCpf(cpfDigits) : null,
    });

    const bridgeController = new AbortController();
    const bridgeTimeout = setTimeout(() => bridgeController.abort(), 38_000);
    let bridgeResp: Response;
    try {
      bridgeResp = await fetch(
        `${BRIDGE_URL.replace(/\/$/, "")}/api/v1/os/consulta-status?${qs}`,
        { headers: { "Content-Type": "application/json" }, signal: bridgeController.signal },
      );
    } catch (fetchErr) {
      clearTimeout(bridgeTimeout);
      if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
        console.error("[os-status-public] Bridge timeout após 38s");
        return jsonResp({ encontrado: false, indisponivel: true }, 504);
      }
      throw fetchErr;
    }
    clearTimeout(bridgeTimeout);

    if (!bridgeResp.ok) {
      const errBody = await bridgeResp.text().catch(() => "");
      console.error("[os-status-public] bridge erro", bridgeResp.status, errBody.slice(0, 200));
      return jsonResp({ error: "Erro ao consultar bridge", detalhe: bridgeResp.status }, 502);
    }

    const bridgeJson = await bridgeResp.json();
    const rows: Record<string, unknown>[] = Array.isArray(bridgeJson?.data)
      ? bridgeJson.data
      : Array.isArray(bridgeJson)
        ? bridgeJson
        : [];

    const resultados = rows.map(normalizarResultado);

    return jsonResp({
      encontrado: resultados.length > 0,
      resultados,
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[os-status-public] erro inesperado:", msg);
    return jsonResp({ error: "Erro interno" }, 500);
  }
});
