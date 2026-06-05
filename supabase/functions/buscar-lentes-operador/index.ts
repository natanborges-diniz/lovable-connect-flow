// Copiloto de Cotação (uso humano).
// EF de leitura pura: nunca escreve em mensagens/metadata/eventos.
// Reproduz a linguagem Gael/Óticas Diniz e a lógica de 3 faixas usada por ai-triage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Modo = "oculos" | "lc" | "estimativa" | "catalogo_livre";

interface RxEye { sphere?: number | null; cylinder?: number | null; axis?: number | null; add?: number | null }
interface Rx { eyes?: { od?: RxEye; oe?: RxEye }; rx_type?: string; label?: string }

interface Body {
  atendimento_id?: string | null;
  modo: Modo;
  query_natural?: string;
  filtros?: {
    preferencia_marca?: string;
    filtro_blue?: boolean;
    filtro_photo?: boolean;
    material_policarbonato?: boolean; // óculos 3-peças
    descarte?: "diaria" | "quinzenal" | "mensal";
    is_toric?: boolean;
    preco_max?: number;
  };
  receita_override?: Rx;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const MSG_CTA_AGENDAMENTO = "Quer que eu agende uma visita pra você ver as armações pessoalmente? 😊";

const brandDisplay = (b: string) => {
  const up = String(b || "").trim().toUpperCase();
  if (["HOYA", "DNZ", "DMAX", "ZEISS"].includes(up)) return up;
  return up.charAt(0) + up.slice(1).toLowerCase();
};
const brandKey = (b: string) => String(b || "").trim().toUpperCase();
const brl = (n: number) => `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function deriveRxStats(rx?: Rx) {
  const od = rx?.eyes?.od || {};
  const oe = rx?.eyes?.oe || {};
  const sph = [od.sphere, oe.sphere].filter((v) => typeof v === "number") as number[];
  const cyl = [od.cylinder, oe.cylinder].filter((v) => typeof v === "number") as number[];
  const add = [od.add, oe.add].filter((v) => typeof v === "number") as number[];
  const worstSphere = sph.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0);
  const worstCyl = cyl.length ? cyl.reduce((a, b) => Math.abs(a) > Math.abs(b) ? a : b, 0) : 0;
  const maxAdd = add.length ? Math.max(...add) : null;
  const rxType = rx?.rx_type || (add.length ? "progressive" : sph.length ? "single_vision" : "unknown");
  return { od, oe, sph, cyl, add, worstSphere, worstCyl, maxAdd, rxType, hasAdd: add.length > 0 };
}

async function buscarOculos(supabase: any, rx: Rx, filtros: Body["filtros"]) {
  const s = deriveRxStats(rx);
  if (!s.sph.length) return { erro: "Receita sem esférico. Edite os valores no painel pra buscar." };

  const categoryMap: Record<string, string[]> = {
    single_vision: ["single_vision", "single_vision_digital", "single_vision_stock", "single_vision_digital_kids", "single", "digital", "visao_simples", "special_myopia", "special_drive", "special_sport", "myopia_control", "especial", "special"],
    progressive: ["progressive", "progressiva", "occupational", "ocupacional"],
  };
  const categories = categoryMap[s.rxType] || [s.rxType];

  let q = supabase.from("pricing_table_lentes").select("*")
    .eq("active", true)
    .in("category", categories)
    .gt("price_brl", 0)
    .lte("sphere_min", s.worstSphere).gte("sphere_max", s.worstSphere)
    .lte("cylinder_min", s.worstCyl).gte("cylinder_max", s.worstCyl);

  if (s.rxType === "progressive" && s.maxAdd !== null) {
    q = q.lte("add_min", s.maxAdd).gte("add_max", s.maxAdd);
  }
  if (filtros?.filtro_blue) q = q.eq("blue", true);
  if (filtros?.filtro_photo) q = q.eq("photo", true);
  if (filtros?.preferencia_marca) q = q.ilike("brand", `%${filtros.preferencia_marca}%`);
  if (filtros?.material_policarbonato) q = q.or("family.ilike.%airwear%,family.ilike.%policar%,index_name.ilike.%1.59%");
  if (filtros?.preco_max) q = q.lte("price_brl", filtros.preco_max);

  const { data: lenses, error } = await q.order("priority", { ascending: true }).order("price_brl", { ascending: true }).limit(80);
  if (error) return { erro: error.message };
  if (!lenses?.length) return { erro: "Nenhuma lente do catálogo cobre essa combinação. Tente afrouxar filtros ou usar estimativa." };

  // Particiona em 3 faixas — mirror do runConsultarLentes.
  const sorted = [...lenses].sort((a, b) => Number(a.price_brl) - Number(b.price_brl));
  let eco: any[] = [], inter: any[] = [], prem: any[] = [];

  if (filtros?.preferencia_marca) {
    const e = sorted[0];
    const p = sorted[sorted.length - 1];
    const midIdx = Math.floor(sorted.length / 2);
    const m = sorted.length >= 3 ? sorted[midIdx] : null;
    eco = [e];
    if (m && m.id !== e.id && m.id !== p.id && Number(m.price_brl) > Number(e.price_brl)) inter = [m];
    if (p.id !== e.id && Number(p.price_brl) > Number(e.price_brl)) prem = [p];
  } else {
    const p1 = Number(sorted[Math.floor(sorted.length / 3)]?.price_brl ?? 0);
    const p2 = Number(sorted[Math.floor((2 * sorted.length) / 3)]?.price_brl ?? 0);
    const faixaDe = (p: number) => p <= p1 ? "eco" : p <= p2 ? "inter" : "prem";
    const isVarilux = (l: any) => /essilor|varilux/i.test(String(l.brand || "")) || /varilux/i.test(String(l.family || ""));
    const pick = (faixa: string) => {
      let pool = sorted.filter((l) => faixaDe(Number(l.price_brl)) === faixa);
      if (faixa === "prem" && s.rxType === "progressive") {
        pool = [...pool].sort((a, b) => {
          const va = isVarilux(a) ? 0 : 1, vb = isVarilux(b) ? 0 : 1;
          if (va !== vb) return va - vb;
          return Number(a.price_brl) - Number(b.price_brl);
        });
      }
      const seen = new Set<string>();
      const out: any[] = [];
      for (const l of pool) {
        const k = brandKey(l.brand);
        if (seen.has(k)) continue;
        seen.add(k); out.push(l);
        if (out.length >= 2) break;
      }
      return out;
    };
    eco = pick("eco"); inter = pick("inter"); prem = pick("prem");

    // anti-inversão
    const minP = (a: any[]) => a.length ? Math.min(...a.map((l) => Number(l.price_brl))) : Infinity;
    if ((eco.length && inter.length && minP(eco) > minP(inter)) ||
        (inter.length && prem.length && minP(inter) > minP(prem)) ||
        (eco.length && prem.length && minP(eco) > minP(prem))) {
      const n = sorted.length;
      const i1 = Math.max(1, Math.floor(n / 3));
      const i2 = Math.max(i1 + 1, Math.floor((2 * n) / 3));
      eco = sorted.slice(0, i1).slice(0, 2);
      inter = sorted.slice(i1, i2).slice(0, 2);
      prem = sorted.slice(i2).slice(0, 2);
    }
  }

  // Formata mensagem no estilo Gael.
  const od = s.od, oe = s.oe;
  const header = `🔍 *Opções de lentes para o seu grau:*\nOD ${od.sphere ?? "—"}/${od.cylinder ?? "—"} | OE ${oe.sphere ?? "—"}/${oe.cylinder ?? "—"}${s.hasAdd ? ` | Ad: +${s.maxAdd}` : ""}\n\n`;
  const renderFaixa = (label: string, itens: any[]) => {
    if (!itens.length) return "";
    const linhas = itens
      .sort((a, b) => Number(a.price_brl) - Number(b.price_brl))
      .map((l) => `  • *${brandDisplay(l.brand)} ${l.family}* ${l.index_name} ${l.treatment}${l.blue ? " + Azul" : ""}${l.photo ? " + Foto" : ""} — *${brl(Number(l.price_brl))}*`)
      .join("\n");
    return `${label}\n${linhas}\n\n`;
  };
  const blocoEco = renderFaixa("🟢 *Econômica:*", eco);
  const blocoInter = renderFaixa("🟡 *Intermediária:*", inter);
  const blocoPrem = renderFaixa("💎 *Premium:*", prem);

  let msg = header + blocoEco + blocoInter + blocoPrem;
  msg = msg.replace(/\n{3,}$/, "\n\n").trimEnd() + "\n\n" + MSG_CTA_AGENDAMENTO;

  const buildSolo = (bloco: string) => bloco ? (header + bloco).trimEnd() + "\n\n" + MSG_CTA_AGENDAMENTO : "";
  const mensagens_por_faixa: Record<string, string> = {};
  if (blocoEco) mensagens_por_faixa.economica = buildSolo(blocoEco);
  if (blocoInter) mensagens_por_faixa.intermediaria = buildSolo(blocoInter);
  if (blocoPrem) mensagens_por_faixa.premium = buildSolo(blocoPrem);

  const tier = (arr: any[]) => arr.map((l) => ({
    id: l.id, brand: brandDisplay(l.brand), family: l.family, index_name: l.index_name,
    treatment: l.treatment, blue: !!l.blue, photo: !!l.photo, price_brl: Number(l.price_brl),
  }));

  return {
    faixas: { economica: tier(eco), intermediaria: tier(inter), premium: tier(prem) },
    alternativas: sorted.slice(0, 12).map((l) => ({
      id: l.id, brand: brandDisplay(l.brand), family: l.family, treatment: l.treatment,
      blue: !!l.blue, photo: !!l.photo, price_brl: Number(l.price_brl),
    })),
    mensagem_formatada_cliente: msg,
    mensagens_por_faixa,
    debug: { rx_type: s.rxType, sphere: s.worstSphere, cylinder: s.worstCyl, add: s.maxAdd, total: lenses.length },
  };
}

// Regex de produtos cosméticos/coloridos (uso estético, não correção visual prioritária).
const COSMETIC_RE = /color|natural colors|hidrocor|hydrocor|freshlook|colorblends|air optix colors|solflex (color|natural)|aquarella|hidroblue|hidrosoft|aquarela/i;

async function buscarLC(supabase: any, rx: Rx, filtros: Body["filtros"], queryNatural?: string) {
  const s = deriveRxStats(rx);
  const forceToric = filtros?.is_toric ?? (Math.abs(s.worstCyl) >= 0.75);
  const marca = (filtros?.preferencia_marca || "").trim();
  const qNat = (queryNatural || "").toLowerCase();
  const operadorPediuCosmetica =
    /\b(colorid|cosm[eé]tic|cor|est[eé]tic|hidrocor|natural colors|freshlook|colorblends)\b/i.test(qNat) ||
    (marca && COSMETIC_RE.test(marca));

  let q = supabase.from("pricing_lentes_contato").select("*").eq("active", true).gt("price_brl", 0);
  if (s.sph.length) q = q.lte("sphere_min", s.worstSphere).gte("sphere_max", s.worstSphere);
  if (forceToric) q = q.eq("is_toric", true);
  else q = q.eq("is_toric", false);
  if (filtros?.descarte) q = q.eq("descarte", filtros.descarte);
  if (marca) {
    // Marca pode estar em fornecedor (Coopervision, Alcon, J&J) OU em produto (Acuvue, Oasys, Biofinity, Hidrocor, DNZ, Air Optix…)
    const safe = marca.replace(/[%,()]/g, "");
    q = q.or(`fornecedor.ilike.%${safe}%,produto.ilike.%${safe}%`);
  }

  const { data: lc, error } = await q.order("priority", { ascending: true }).order("price_brl", { ascending: true }).limit(80);
  if (error) return { erro: error.message };
  if (!lc?.length) return { erro: "Sem lentes de contato pra esse perfil. Verifique tórica/descarte/marca." };

  // Combo 3+1: cada caixa cobre `unidades_por_caixa * dias_por_unidade` dias por OLHO.
  const itens = lc.map((l: any) => {
    const caixasPorOlhoAno = Math.ceil(365 / (l.unidades_por_caixa * l.dias_por_unidade));
    const caixasTotal = caixasPorOlhoAno * 2;
    const valor = Number(l.price_brl) * (l.combo_3mais1 ? Math.ceil(caixasTotal * 3 / 4) : caixasTotal);
    return {
      id: l.id, fornecedor: l.fornecedor, produto: l.produto, descarte: l.descarte,
      is_toric: l.is_toric, combo: l.combo_3mais1, price_caixa: Number(l.price_brl),
      caixas_ano_2olhos: caixasTotal, total_ano: valor, is_dnz: l.is_dnz, observacoes: l.observacoes,
      _cosmetica: COSMETIC_RE.test(`${l.fornecedor} ${l.produto}`),
    };
  });

  // Para top 3: se operador não pediu cosmética, esconde coloridas.
  const candidatos = operadorPediuCosmetica ? itens : itens.filter((i: any) => !i._cosmetica);
  const pool = candidatos.length ? candidatos : itens;

  // Diversifica por descarte (diária → quinzenal → mensal) — pula se operador pediu marca específica.
  let top: any[] = [];
  if (marca) {
    top = pool.slice(0, 3);
  } else {
    const ordem = ["diario", "diaria", "quinzenal", "mensal"];
    for (const d of ordem) {
      const it = pool.find((i: any) => i.descarte === d);
      if (it && !top.includes(it)) top.push(it);
      if (top.length >= 3) break;
    }
    for (const it of pool) {
      if (top.length >= 3) break;
      if (!top.includes(it)) top.push(it);
    }
  }

  const headerLC = `👁️ *Lentes de contato — opções:*\n${forceToric ? "_⚠️ Tórica (sob encomenda — cyl ≥ 0,75)_\n" : ""}\n`;
  const ctaLC = `\nQual descarte combina mais com a sua rotina? Te indico a loja mais próxima pra finalizar 😊`;
  const lineLC = (it: any) => `• *${it.fornecedor} ${it.produto}* (${it.descarte}${it.is_dnz ? " · DNZ" : ""}${it.combo ? " · combo 3+1" : ""}) — ${brl(it.price_caixa)} a caixa\n  Plano anual (2 olhos): ~${brl(it.total_ano)} (${it.caixas_ano_2olhos} cx)\n`;

  let msg = headerLC + top.map(lineLC).join("") + ctaLC;

  const labels = ["🟢 *Econômica:*", "🟡 *Intermediária:*", "💎 *Premium:*"];
  const keys = ["economica", "intermediaria", "premium"] as const;
  const mensagens_por_faixa: Record<string, string> = {};
  top.forEach((it, i) => {
    mensagens_por_faixa[keys[i]] = headerLC + labels[i] + "\n" + lineLC(it) + ctaLC;
  });

  return {
    faixas: { economica: top.slice(0, 1), intermediaria: top.slice(1, 2), premium: top.slice(2, 3) },
    alternativas: itens,
    mensagem_formatada_cliente: msg,
    mensagens_por_faixa,
    debug: { tórica: forceToric, total: lc.length, cyl: s.worstCyl, marca, operadorPediuCosmetica, cosmeticas_filtradas: itens.length - candidatos.length },
  };
}

async function buscarCatalogoLivre(supabase: any, filtros: Body["filtros"]) {
  let q = supabase.from("pricing_table_lentes").select("brand,family,category,index_name,treatment,blue,photo,price_brl")
    .eq("active", true).gt("price_brl", 0);
  if (filtros?.preferencia_marca) q = q.ilike("brand", `%${filtros.preferencia_marca}%`);
  if (filtros?.filtro_blue) q = q.eq("blue", true);
  if (filtros?.filtro_photo) q = q.eq("photo", true);
  if (filtros?.preco_max) q = q.lte("price_brl", filtros.preco_max);
  const { data, error } = await q.order("price_brl", { ascending: true }).limit(50);
  if (error) return { erro: error.message };
  return {
    faixas: { economica: [], intermediaria: [], premium: [] },
    alternativas: (data || []).map((l: any) => ({
      brand: brandDisplay(l.brand), family: l.family, category: l.category,
      index_name: l.index_name, treatment: l.treatment, blue: !!l.blue, photo: !!l.photo, price_brl: Number(l.price_brl),
    })),
    mensagem_formatada_cliente: "",
    debug: { total: data?.length || 0 },
  };
}

// Extrai filtros de query natural via Lovable AI Gateway (opcional).
async function extrairFiltrosNL(query: string): Promise<Body["filtros"]> {
  if (!LOVABLE_API_KEY || !query?.trim()) return {};
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        temperature: 0,
        messages: [
          { role: "system", content: "Extraia filtros de busca de lentes a partir do texto do operador. Devolva JSON estrito com chaves opcionais: preferencia_marca (string: Varilux, DNZ, DMAX, HOYA, ZEISS, Essilor, Kodak), filtro_blue (bool, se citar 'blue'/'azul'/'tela'), filtro_photo (bool, se citar 'foto'/'transitions'), material_policarbonato (bool, se citar '3 peças'/'policarbonato'/'airwear'/'parafuso'), descarte ('diaria'|'quinzenal'|'mensal'), is_toric (bool, se citar 'tórica'/'astigmatismo alto'), preco_max (number, se citar limite). Nada além do JSON." },
          { role: "user", content: query },
        ],
      }),
    });
    if (!r.ok) return {};
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || "{}";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return {};
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing_auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseUser.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json()) as Body;
    if (!body?.modo) {
      return new Response(JSON.stringify({ error: "modo_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve receita
    let rx: Rx | undefined = body.receita_override;
    if (!rx && body.atendimento_id) {
      const { data: at } = await supabase
        .from("atendimentos")
        .select("contato_id, metadata, contatos:contato_id(metadata)")
        .eq("id", body.atendimento_id).maybeSingle();
      const atMeta = (at?.metadata as any) || {};
      const ctMeta = ((at as any)?.contatos?.metadata) || {};
      const arr = Array.isArray(atMeta.receitas) ? atMeta.receitas
        : Array.isArray(ctMeta.receitas) ? ctMeta.receitas
        : null;
      if (arr?.length) rx = arr[arr.length - 1];
      else if (ctMeta.ultima_receita?.eyes) rx = ctMeta.ultima_receita;
      else if (atMeta.ultima_receita?.eyes) rx = atMeta.ultima_receita;
    }

    // Merge filtros NL + estruturados
    let filtros = body.filtros || {};
    if (body.query_natural) {
      const nl = await extrairFiltrosNL(body.query_natural);
      filtros = { ...nl, ...filtros };
    }

    let result: any;
    if (body.modo === "oculos") result = await buscarOculos(supabase, rx || {}, filtros);
    else if (body.modo === "lc") result = await buscarLC(supabase, rx || {}, filtros, body.query_natural);
    else if (body.modo === "catalogo_livre") result = await buscarCatalogoLivre(supabase, filtros);
    else if (body.modo === "estimativa") result = await buscarOculos(supabase, rx || {}, filtros); // mesma engine; receita_override permite cenário parcial
    else result = { erro: `modo_invalido:${body.modo}` };

    return new Response(JSON.stringify({ ok: !result.erro, ...result, filtros_aplicados: filtros }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[buscar-lentes-operador]", e);
    return new Response(JSON.stringify({ error: e?.message || "internal" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
