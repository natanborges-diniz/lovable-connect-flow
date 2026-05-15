#!/usr/bin/env node
// diagnose-catalog.js
// Conecta no Supabase via REST API (sem dependências) e gera um relatório de
// saúde do catálogo de lentes (pricing_table_lentes) + gaps de orçamento.
//
// Uso:
//   SUPABASE_SERVICE_KEY=<service_role_key> node scripts/diagnose-catalog.js
//
// Se SUPABASE_SERVICE_KEY não estiver definida, usa a anon key do .env.
// A service key é necessária para ler eventos_crm (RLS).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Carrega .env manualmente (sem dotenv) ──────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

function loadEnv(path) {
  try {
    const raw = readFileSync(path, "utf8");
    const vars = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#\n]*)"?\s*$/);
      if (m) vars[m[1]] = m[2].trim();
    }
    return vars;
  } catch {
    return {};
  }
}

const env = loadEnv(envPath);

const SUPABASE_URL  = process.env.SUPABASE_URL  || env.SUPABASE_URL  || env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY      = process.env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const API_KEY       = SERVICE_KEY || ANON_KEY;

if (!SUPABASE_URL || !API_KEY) {
  console.error("❌  Defina SUPABASE_URL e SUPABASE_SERVICE_KEY (ou SUPABASE_PUBLISHABLE_KEY) no .env");
  process.exit(1);
}

if (!SERVICE_KEY) {
  console.warn("⚠️  SUPABASE_SERVICE_KEY não encontrada — usando anon key.");
  console.warn("    Queries em eventos_crm podem retornar vazio se RLS bloquear.\n");
}

const BASE = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: API_KEY,
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
  Prefer: "count=exact",
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function query(table, params = {}) {
  const url = new URL(`${BASE}/${table}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${table}] HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const contentRange = res.headers.get("content-range") || "";
  const total = contentRange.includes("/") ? Number(contentRange.split("/")[1]) : null;
  const data = await res.json();
  return { data, total };
}

// Busca TODAS as linhas paginando de 1000 em 1000
async function fetchAll(table, params = {}) {
  const PAGE = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const url = new URL(`${BASE}/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("limit", PAGE);
    url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: HEADERS });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[${table}] HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function groupBy(arr, key) {
  const map = {};
  for (const item of arr) {
    const k = item[key] ?? "(null)";
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

// ── Relatório ──────────────────────────────────────────────────────────────

async function run() {
  const report = {
    gerado_em: new Date().toISOString(),
    supabase_url: SUPABASE_URL,
    usando_service_key: !!SERVICE_KEY,
  };

  console.log("🔍  Conectando em", SUPABASE_URL);
  console.log("─".repeat(60));

  // ── 1. Total por brand e category ────────────────────────────────────────
  console.log("\n[1/6] Buscando todas as linhas de pricing_table_lentes...");
  const allLenses = await fetchAll("pricing_table_lentes", { select: "id,brand,category,active" });
  const total = allLenses.length;
  const active = allLenses.filter(r => r.active).length;

  const byBrand    = groupBy(allLenses, "brand");
  const byCategory = groupBy(allLenses, "category");
  const byBrandActive    = groupBy(allLenses.filter(r => r.active), "brand");
  const byCategoryActive = groupBy(allLenses.filter(r => r.active), "category");

  report.total_linhas = { total, active, inativas: total - active };
  report.por_brand    = { total: sortedEntries(byBrand),    active: sortedEntries(byBrandActive) };
  report.por_category = { total: sortedEntries(byCategory), active: sortedEntries(byCategoryActive) };

  console.log(`   Total: ${total} linhas (${active} ativas, ${total - active} inativas)`);
  console.log("   Por brand (ativas):");
  for (const [b, n] of sortedEntries(byBrandActive)) {
    console.log(`     ${b.padEnd(20)} ${n}`);
  }

  // ── 2. cylinder_min positivo (erro semântico) ─────────────────────────────
  console.log("\n[2/6] Verificando cylinder_min positivo...");
  const { data: cylPos, total: cylPosTotal } = await query("pricing_table_lentes", {
    select: "id,brand,family,index_name,category,cylinder_min",
    "cylinder_min": "gt.0",
    limit: 200,
  });
  report.cylinder_min_positivo = {
    total: cylPosTotal ?? cylPos.length,
    exemplos: cylPos.slice(0, 10).map(r => ({
      id: r.id, brand: r.brand, family: r.family,
      index_name: r.index_name, category: r.category, cylinder_min: r.cylinder_min,
    })),
  };
  console.log(`   cylinder_min > 0: ${cylPosTotal ?? cylPos.length} registros ${(cylPosTotal ?? cylPos.length) > 0 ? "⚠️" : "✅"}`);

  // ── 3. sphere_min ou sphere_max NULL ──────────────────────────────────────
  console.log("\n[3/6] Verificando sphere_min/sphere_max NULL...");
  const [{ data: sphMinNull, total: sphMinNullTotal }, { data: sphMaxNull, total: sphMaxNullTotal }] =
    await Promise.all([
      query("pricing_table_lentes", { select: "id,brand,family,category,active", "sphere_min": "is.null", limit: 200 }),
      query("pricing_table_lentes", { select: "id,brand,family,category,active", "sphere_max": "is.null", limit: 200 }),
    ]);

  // IDs únicos entre os dois conjuntos
  const nullSphereIds = new Set([...sphMinNull.map(r => r.id), ...sphMaxNull.map(r => r.id)]);

  report.sphere_null = {
    sphere_min_null: sphMinNullTotal ?? sphMinNull.length,
    sphere_max_null: sphMaxNullTotal ?? sphMaxNull.length,
    registros_unicos_afetados: nullSphereIds.size,
    exemplos_sphere_min_null: sphMinNull.slice(0, 8).map(r => ({
      id: r.id, brand: r.brand, family: r.family, category: r.category, active: r.active,
    })),
  };
  console.log(`   sphere_min NULL: ${sphMinNullTotal ?? sphMinNull.length} | sphere_max NULL: ${sphMaxNullTotal ?? sphMaxNull.length}`);
  console.log(`   Registros únicos com sphere NULL: ${nullSphereIds.size} ${nullSphereIds.size > 0 ? "⚠️  (nunca retornam na query de orçamento)" : "✅"}`);

  // ── 4. price_brl = 0 ou NULL ──────────────────────────────────────────────
  console.log("\n[4/6] Verificando price_brl inválido...");
  const [{ data: priceZero, total: priceZeroTotal }, { data: priceNull, total: priceNullTotal }] =
    await Promise.all([
      query("pricing_table_lentes", { select: "id,brand,family,category,price_brl,active", "price_brl": "eq.0", limit: 100 }),
      query("pricing_table_lentes", { select: "id,brand,family,category,price_brl,active", "price_brl": "is.null", limit: 100 }),
    ]);

  report.price_invalido = {
    price_zero: priceZeroTotal ?? priceZero.length,
    price_null: priceNullTotal ?? priceNull.length,
    total: (priceZeroTotal ?? priceZero.length) + (priceNullTotal ?? priceNull.length),
    exemplos: [...priceZero, ...priceNull].slice(0, 10).map(r => ({
      id: r.id, brand: r.brand, family: r.family, category: r.category,
      price_brl: r.price_brl, active: r.active,
    })),
  };
  console.log(`   price_brl = 0: ${priceZeroTotal ?? priceZero.length} | price_brl NULL: ${priceNullTotal ?? priceNull.length}`);

  // ── 5. Valores distintos de category ──────────────────────────────────────
  console.log("\n[5/6] Listando categories distintos...");
  const allCats = await fetchAll("pricing_table_lentes", { select: "category,active" });
  const distinctCats = [...new Set(allCats.map(r => r.category))].sort();
  const activeCats   = [...new Set(allCats.filter(r => r.active).map(r => r.category))].sort();

  // Categorias presentes na tabela mas NÃO mapeadas no categoryMap do ai-triage
  const KNOWN_CATEGORIES = new Set([
    "single_vision", "single_vision_digital", "single_vision_stock",
    "single_vision_digital_kids", "single", "digital", "visao_simples",
    "special_myopia", "special_drive", "special_sport", "myopia_control",
    "especial", "special",
    "progressive", "progressiva", "occupational", "ocupacional",
  ]);
  const unmappedCats = activeCats.filter(c => !KNOWN_CATEGORIES.has(c));

  report.categories = {
    distintos_total: distinctCats,
    distintos_active: activeCats,
    nao_mapeados_no_ai_triage: unmappedCats,
  };

  console.log(`   Distintos (total): ${distinctCats.join(", ")}`);
  if (unmappedCats.length > 0) {
    console.log(`   ⚠️  Não mapeados no ai-triage (nunca serão encontrados): ${unmappedCats.join(", ")}`);
  } else {
    console.log("   ✅  Todos os categories ativos estão mapeados no ai-triage");
  }

  // ── 6. eventos_crm — gaps de orçamento ───────────────────────────────────
  console.log("\n[6/6] Buscando eventos consultar_lentes_zero_resultados...");
  let gapEvents = [];
  let gapError = null;
  try {
    gapEvents = await fetchAll("eventos_crm", {
      select: "metadata,created_at",
      tipo: "eq.consultar_lentes_zero_resultados",
      order: "created_at.desc",
      limit: 50,
    });
  } catch (e) {
    gapError = e.message;
    console.warn("   ⚠️  Não foi possível ler eventos_crm:", gapError);
    console.warn("       Forneça SUPABASE_SERVICE_KEY para acessar esta tabela.\n");
  }

  if (gapEvents.length > 0) {
    // Agrupa por rx_type
    const byRxType = {};
    // Agrupa por sphere (arredondado para 0.25 mais próximo)
    const bySphere = {};
    // Agrupa por cylinder (arredondado)
    const byCylinder = {};
    // Combinações mais problemáticas
    const combos = {};

    for (const ev of gapEvents) {
      const m = ev.metadata || {};
      const rxType   = m.rx_type   || "(desconhecido)";
      const sphere   = typeof m.sphere   === "number" ? Math.round(m.sphere   * 4) / 4 : null;
      const cylinder = typeof m.cylinder === "number" ? Math.round(m.cylinder * 4) / 4 : null;

      byRxType[rxType] = (byRxType[rxType] || 0) + 1;

      if (sphere !== null) {
        const sk = sphere.toFixed(2);
        bySphere[sk] = (bySphere[sk] || 0) + 1;
      }
      if (cylinder !== null) {
        const ck = cylinder.toFixed(2);
        byCylinder[ck] = (byCylinder[ck] || 0) + 1;
      }

      const combo = `${rxType} | sph ${sphere?.toFixed(2) ?? "?"} cyl ${cylinder?.toFixed(2) ?? "?"}`;
      combos[combo] = (combos[combo] || 0) + 1;
    }

    const topCombos = sortedEntries(combos).slice(0, 15);

    report.gaps_orcamento = {
      total_eventos_analisados: gapEvents.length,
      por_rx_type: sortedEntries(byRxType),
      por_sphere_mais_frequente: sortedEntries(bySphere).slice(0, 10),
      por_cylinder_mais_frequente: sortedEntries(byCylinder).slice(0, 10),
      combos_mais_problematicos: topCombos,
    };

    console.log(`   ${gapEvents.length} eventos analisados`);
    console.log("   Por rx_type:");
    for (const [t, n] of sortedEntries(byRxType)) {
      console.log(`     ${t.padEnd(20)} ${n} ocorrências`);
    }
    console.log("   Top combos sem resultado:");
    for (const [combo, n] of topCombos.slice(0, 5)) {
      console.log(`     [${n}x] ${combo}`);
    }
  } else if (!gapError) {
    report.gaps_orcamento = { total_eventos_analisados: 0, nota: "Nenhum evento encontrado." };
    console.log("   ✅  Nenhum evento de gap encontrado.");
  } else {
    report.gaps_orcamento = { erro: gapError };
  }

  // ── Salva JSON ─────────────────────────────────────────────────────────────
  const outPath = join(__dirname, "catalog-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  // ── Resumo final ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("RESUMO");
  console.log("═".repeat(60));
  console.log(`Total de linhas:          ${total} (${active} ativas)`);
  console.log(`cylinder_min positivo:    ${report.cylinder_min_positivo.total}  ${report.cylinder_min_positivo.total > 0 ? "⚠️  ERRO SEMÂNTICO" : "✅"}`);
  console.log(`sphere NULL:              ${nullSphereIds.size}  ${nullSphereIds.size > 0 ? "⚠️  nunca retornam na query" : "✅"}`);
  console.log(`price_brl inválido:       ${report.price_invalido.total}  ${report.price_invalido.total > 0 ? "⚠️" : "✅"}`);
  console.log(`Categories não mapeados:  ${unmappedCats.length}  ${unmappedCats.length > 0 ? "⚠️  " + unmappedCats.join(", ") : "✅"}`);
  if (report.gaps_orcamento?.total_eventos_analisados > 0) {
    console.log(`Gaps de orçamento:        ${report.gaps_orcamento.total_eventos_analisados} eventos recentes`);
  }
  console.log(`\n📄  Relatório completo: ${outPath}`);
}

run().catch(e => {
  console.error("❌  Erro fatal:", e.message);
  process.exit(1);
});
