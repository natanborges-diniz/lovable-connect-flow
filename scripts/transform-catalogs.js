#!/usr/bin/env node
/**
 * transform-catalogs.js
 *
 * Lê os JSONs de catálogo (HOYA, ZEISS, Essilor, Diniz + lentes de contato)
 * e gera um SQL de upsert para pricing_table_lentes e pricing_lentes_contato.
 *
 * Uso:
 *   node scripts/transform-catalogs.js
 *
 * Output:
 *   scripts/output/pricing_table_lentes_seed.sql
 *   scripts/output/pricing_lentes_contato_seed.sql
 *   scripts/output/transform-report.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT_DIR = join(__dirname, "output");

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Arquivos de entrada ────────────────────────────────────────────────────

const CATALOG_FILES = [
  "hoya_abr2025_expandido.json",
  "zeiss_consumidor_2026_expandido.json",
  "essilor_pvc_abr2026_expandido.json",
  "diniz_dmax_pvc_maio2025.json",
];

const LC_FILE = "lentes_contato_abr2026.json";

// Normaliza nomes de marca com inconsistências conhecidas
const BRAND_NORMALIZE = { "HOYA": "Hoya" };

// Tenta encontrar os JSONs em várias localizações possíveis
function findCatalogFile(filename) {
  const candidates = [
    join(ROOT, filename),
    join(ROOT, "scripts", filename),
    join(ROOT, "scripts", "catalogs", filename),
    join(ROOT, "data", filename),
    join(ROOT, "catalogs", filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Mapeamento de subcategoria → category ──────────────────────────────────

const SUBCATEGORIA_TO_CATEGORY = {
  monofocal:    "single_vision",
  progressiva:  "progressive",
  ocupacional:  "occupational",
  especial:     "especial",
};

// Mapeamento adicional por tags para subcategorias especiais
function deriveCategory(produto) {
  const base = SUBCATEGORIA_TO_CATEGORY[produto.subcategoria] || "single_vision";

  // Especialidades baseadas em tags
  const tags = produto.tags || [];
  if (tags.includes("controle_miopia")) return "myopia_control";
  if (tags.includes("dirigir"))         return "special_drive";
  if (tags.includes("esportivo"))       return "special_sport";
  if (tags.includes("anti_fadiga") || tags.includes("digital")) {
    if (base === "single_vision") return "single_vision_digital";
  }
  if (tags.includes("pronta_entrega"))  {
    if (base === "single_vision") return "single_vision_stock";
  }
  if (tags.includes("pediatrico") && base === "single_vision") {
    return "single_vision_digital_kids";
  }

  return base;
}

// ─── Derivação de blue e photo ───────────────────────────────────────────────

function deriveBlue(produto) {
  const arCodigo = produto.antirreflexo?.codigo || "";
  const arNome   = produto.antirreflexo?.nome   || "";
  const adicInc  = produto.material?.adicional_incorporado || "";
  const adicTipo = produto.adicional?.tipo || "";

  return (
    arCodigo.toLowerCase().includes("blue") ||
    arNome.toLowerCase().includes("blue") ||
    arNome.toLowerCase().includes("bluecontrol") ||
    adicInc.includes("Filtro Azul") ||
    adicTipo === "filtro_azul"
  );
}

function derivePhoto(produto) {
  const adicTipo = produto.adicional?.tipo || "";
  const adicInc  = produto.material?.adicional_incorporado || "";
  const tags     = produto.tags || [];

  return (
    adicTipo === "fotossensivel" ||
    adicInc.includes("Fotossensível") ||
    tags.includes("fotossensivel")
  );
}

// ─── Escape SQL ──────────────────────────────────────────────────────────────

function esc(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─── Transformação de um produto ─────────────────────────────────────────────

function transformProduto(produto, catalogMeta) {
  const p = produto.parametros || {};

  // cylinder_min: no JSON é cilindrico_max (negativo, ex: -6.00)
  // na tabela cylinder_min também é negativo — semântica preservada
  const cylinderMin = p.cilindrico_max ?? null;
  // cylinder_max: sempre 0 (sem cilindro no máximo)
  const cylinderMax = cylinderMin !== null ? 0 : null;

  // index_name: usa material.codigo; normaliza aliases
  const indexName = produto.material?.codigo ?? "1.50";

  return {
    brand:              BRAND_NORMALIZE[produto.marca] ?? produto.marca,
    family:             produto.design_base,
    category:           deriveCategory(produto),
    index_name:         indexName,
    treatment:          produto.antirreflexo?.nome ?? "Sem AR",
    blue:               deriveBlue(produto),
    photo:              derivePhoto(produto),
    sphere_min:         p.esferico_min ?? null,
    sphere_max:         p.esferico_max ?? null,
    cylinder_min:       cylinderMin,
    cylinder_max:       cylinderMax,
    add_min:            p.adicao_min ?? null,
    add_max:            p.adicao_max ?? null,
    diameter:           p.diametro_mm ?? null,
    min_fitting_height: p.altura_montagem_minima_mm ?? null,
    price_brl:          produto.preco?.valor ?? null,
    priority:           10,
    active:             true,
    source_catalog:     `${catalogMeta.nome} ${catalogMeta.versao || catalogMeta.data_vigencia || ""}`.trim(),
    source_page:        null,
  };
}

// ─── Geração do SQL ──────────────────────────────────────────────────────────

function buildUpsertSQL(rows) {
  const cols = [
    "brand","family","category","index_name","treatment",
    "blue","photo","sphere_min","sphere_max",
    "cylinder_min","cylinder_max","add_min","add_max",
    "diameter","min_fitting_height","price_brl",
    "priority","active","source_catalog","source_page",
  ];

  const conflictCols = "(brand, family, category, index_name, treatment, blue, photo)";
  const updateCols = [
    "sphere_min","sphere_max","cylinder_min","cylinder_max",
    "add_min","add_max","diameter","min_fitting_height",
    "price_brl","priority","active","source_catalog","updated_at",
  ].map(c => `${c} = EXCLUDED.${c}`).join(", ") + ", updated_at = now()";

  const chunks = [];

  // Processa em batches de 500 para não gerar SQL gigante
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(row =>
      `(${cols.map(c => esc(row[c])).join(", ")})`
    ).join(",\n  ");

    chunks.push(
      `INSERT INTO public.pricing_table_lentes (${cols.join(", ")})\nVALUES\n  ${values}\nON CONFLICT ${conflictCols}\nDO UPDATE SET ${updateCols};`
    );
  }

  return chunks.join("\n\n");
}

// ─── Contact lens helpers ─────────────────────────────────────────────────────

const DESCARTE_DIAS = {
  diario: 1, quinzenal: 15, mensal: 30,
  mensal_ou_semanal: 30, trimestral: 90, anual: 365,
};

function parseCilindricos(str) {
  if (!str) return { min: null, max: null };
  const vals = str.split("/").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  if (!vals.length) return { min: null, max: null };
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function transformLC(produto, catalogMeta) {
  const p   = produto.parametros || {};
  const uso = produto.uso || {};
  const cyl = parseCilindricos(p.cilindrico_disponivel);
  const tags = produto.tags || [];

  return {
    fornecedor:             produto.fornecedor ?? produto.marca,
    produto:                produto.nome,
    material:               produto.tecnologia_material?.nome ?? null,
    dk:                     produto.tecnologia_material?.dk_permeabilidade_o2 ?? null,
    sphere_min:             p.esferico_min ?? null,
    sphere_max:             p.esferico_max ?? null,
    cylinder_min:           cyl.min,
    cylinder_max:           cyl.max,
    cylinder_axes_disponiveis: p.cilindrico_disponivel ?? null,
    descarte:               uso.descarte ?? "mensal",
    dias_por_unidade:       DESCARTE_DIAS[uso.descarte] ?? 30,
    unidades_por_caixa:     uso.numero_lentes_caixa ?? 6,
    price_brl:              produto.preco?.valor ?? null,
    is_toric:               !!p.cilindrico_disponivel,
    is_color:               tags.includes("colorida") || tags.includes("cor"),
    is_dnz:                 produto.nome.toLowerCase().includes("dnz"),
    priority:               10,
    combo_3mais1:           tags.includes("3mais1") || tags.includes("3_mais_1"),
    active:                 true,
    observacoes:            produto.informativo?.descricao ?? null,
  };
}

function buildLCUpsertSQL(rows) {
  const cols = [
    "fornecedor","produto","material","dk",
    "sphere_min","sphere_max","cylinder_min","cylinder_max","cylinder_axes_disponiveis",
    "descarte","dias_por_unidade","unidades_por_caixa","price_brl",
    "is_toric","is_color","is_dnz","priority","combo_3mais1","active","observacoes",
  ];

  const conflictCols = "(fornecedor, produto, descarte)";
  const updateSet = [
    "material","dk","sphere_min","sphere_max","cylinder_min","cylinder_max",
    "cylinder_axes_disponiveis","dias_por_unidade","unidades_por_caixa",
    "price_brl","is_toric","is_color","is_dnz","priority","combo_3mais1","active","observacoes",
  ].map(c => `${c} = EXCLUDED.${c}`).join(", ") + ", updated_at = now()";

  const chunks = [];
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(row =>
      `(${cols.map(c => esc(row[c])).join(", ")})`
    ).join(",\n  ");
    chunks.push(
      `INSERT INTO public.pricing_lentes_contato (${cols.join(", ")})\nVALUES\n  ${values}\nON CONFLICT ${conflictCols}\nDO UPDATE SET ${updateSet};`
    );
  }
  return chunks.join("\n\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const allRows = [];
const report  = { por_fornecedor: [], erros: [], total: 0 };

for (const filename of CATALOG_FILES) {
  const filepath = findCatalogFile(filename);

  if (!filepath) {
    const msg = `ARQUIVO NÃO ENCONTRADO: ${filename}`;
    console.warn(`⚠️  ${msg}`);
    report.erros.push(msg);
    continue;
  }

  console.log(`📂 Lendo ${filename}...`);
  const raw = JSON.parse(readFileSync(filepath, "utf8"));
  const catalogo = raw.catalogo;
  const produtos  = catalogo.produtos || [];

  let ok = 0, skip = 0;
  const rows = [];

  for (const produto of produtos) {
    // Validação mínima
    if (!produto.preco?.valor || produto.preco.valor <= 0) { skip++; continue; }
    if (!produto.marca)        { skip++; continue; }
    if (!produto.design_base)  { skip++; continue; }

    const row = transformProduto(produto, catalogo);

    // Valida campos críticos para a query
    if (row.sphere_min === null || row.sphere_max === null) {
      report.erros.push(`${produto.id}: sphere_min/max nulo`);
      skip++;
      continue;
    }
    if (row.price_brl === null) {
      report.erros.push(`${produto.id}: price_brl nulo`);
      skip++;
      continue;
    }

    rows.push(row);
    ok++;
  }

  allRows.push(...rows);
  report.por_fornecedor.push({
    arquivo:    filename,
    fornecedor: catalogo.fornecedor,
    total_json: produtos.length,
    importados: ok,
    ignorados:  skip,
  });

  console.log(`   ✅ ${ok} importados | ⚠️  ${skip} ignorados`);
}

report.total = allRows.length;

// ─── Contact lens processing ─────────────────────────────────────────────────

const lcFilepath = findCatalogFile(LC_FILE);
const lcRows = [];
let lcReport = null;

if (!lcFilepath) {
  console.warn(`⚠️  ${LC_FILE} não encontrado — pulando lentes de contato`);
} else {
  console.log(`\n📂 Lendo ${LC_FILE}...`);
  const lcRaw = JSON.parse(readFileSync(lcFilepath, "utf8"));
  const lcCatalogo = lcRaw.catalogo;
  const produtos = lcCatalogo.produtos || [];
  let lcOk = 0, lcSkip = 0;

  for (const produto of produtos) {
    if (!produto.preco?.valor || produto.preco.valor <= 0) { lcSkip++; continue; }
    if (!produto.nome) { lcSkip++; continue; }
    lcRows.push(transformLC(produto, lcCatalogo));
    lcOk++;
  }

  lcReport = { arquivo: LC_FILE, total_json: produtos.length, importados: lcOk, ignorados: lcSkip };
  console.log(`   ✅ ${lcOk} importados | ⚠️  ${lcSkip} ignorados`);
}

// ─── Gera SQL pricing_table_lentes ───────────────────────────────────────────

// Gera SQL
const sql = [
  "-- Auto-gerado por transform-catalogs.js",
  `-- Total de registros: ${allRows.length}`,
  `-- Gerado em: ${new Date().toISOString()}`,
  "",
  "-- Adiciona UNIQUE constraint se não existir",
  "DO $$ BEGIN",
  "  IF NOT EXISTS (",
  "    SELECT 1 FROM pg_constraint",
  "    WHERE conname = 'pricing_table_lentes_unique_sku'",
  "  ) THEN",
  "    ALTER TABLE public.pricing_table_lentes",
  "    ADD CONSTRAINT pricing_table_lentes_unique_sku",
  "    UNIQUE (brand, family, category, index_name, treatment, blue, photo);",
  "  END IF;",
  "END $$;",
  "",
  "-- Adiciona índices se não existirem",
  "CREATE INDEX IF NOT EXISTS idx_ptl_filter   ON public.pricing_table_lentes (active, category, sphere_min, sphere_max);",
  "CREATE INDEX IF NOT EXISTS idx_ptl_cylinder ON public.pricing_table_lentes (cylinder_min, cylinder_max);",
  "CREATE INDEX IF NOT EXISTS idx_ptl_brand    ON public.pricing_table_lentes (brand);",
  "CREATE INDEX IF NOT EXISTS idx_ptl_price    ON public.pricing_table_lentes (price_brl);",
  "",
  "-- Normaliza duplicata de brand (Hoya vs HOYA)",
  "UPDATE public.pricing_table_lentes SET brand = 'Hoya' WHERE brand = 'HOYA';",
  "",
  "-- Upsert dos produtos",
  buildUpsertSQL(allRows),
].join("\n");

// ─── Gera SQL pricing_lentes_contato ─────────────────────────────────────────

let lcSql = null;
if (lcRows.length > 0) {
  lcSql = [
    "-- Auto-gerado por transform-catalogs.js — lentes de contato",
    `-- Total de registros: ${lcRows.length}`,
    `-- Gerado em: ${new Date().toISOString()}`,
    "",
    "-- Adiciona UNIQUE constraint se não existir",
    "DO $$ BEGIN",
    "  IF NOT EXISTS (",
    "    SELECT 1 FROM pg_constraint",
    "    WHERE conname = 'pricing_lentes_contato_unique_sku'",
    "  ) THEN",
    "    ALTER TABLE public.pricing_lentes_contato",
    "    ADD CONSTRAINT pricing_lentes_contato_unique_sku",
    "    UNIQUE (fornecedor, produto, descarte);",
    "  END IF;",
    "END $$;",
    "",
    buildLCUpsertSQL(lcRows),
  ].join("\n");
}

// Salva outputs
const sqlPath    = join(OUTPUT_DIR, "pricing_table_lentes_seed.sql");
const lcSqlPath  = join(OUTPUT_DIR, "pricing_lentes_contato_seed.sql");
const reportPath = join(OUTPUT_DIR, "transform-report.json");

writeFileSync(sqlPath, sql, "utf8");
if (lcSql) writeFileSync(lcSqlPath, lcSql, "utf8");
if (lcReport) report.lentes_contato = lcReport;
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

// Resumo no console
console.log("\n" + "═".repeat(60));
console.log("RESUMO DA TRANSFORMAÇÃO");
console.log("═".repeat(60));
for (const f of report.por_fornecedor) {
  console.log(`\n${f.fornecedor}`);
  console.log(`  JSON total:  ${f.total_json}`);
  console.log(`  Importados:  ${f.importados}`);
  console.log(`  Ignorados:   ${f.ignorados}`);
}
console.log(`\nTOTAL GERAL: ${report.total} registros`);
if (lcReport) {
  console.log(`\nLentes de contato (${lcReport.arquivo}):`);
  console.log(`  Importados: ${lcReport.importados} | Ignorados: ${lcReport.ignorados}`);
}
if (report.erros.length > 0) {
  console.log(`\n⚠️  ${report.erros.length} erros — veja transform-report.json`);
}
console.log(`\n📄 SQL lentes:         scripts/output/pricing_table_lentes_seed.sql`);
if (lcSql) console.log(`📄 SQL lentes contato: scripts/output/pricing_lentes_contato_seed.sql`);
console.log(`📊 Relatório:          scripts/output/transform-report.json`);
console.log("═".repeat(60));
console.log("\nPróximo passo:");
console.log("  1. Abra o SQL Editor do Supabase");
console.log("  2. Execute pricing_table_lentes_seed.sql");
console.log("  3. Execute pricing_lentes_contato_seed.sql\n");
