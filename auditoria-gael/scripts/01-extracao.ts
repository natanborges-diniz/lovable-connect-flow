import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const ERROS_LOG = join(OUTPUT_DIR, "_erros.log");
mkdirSync(OUTPUT_DIR, { recursive: true });

function save(filename: string, data: unknown): void {
  const path = join(OUTPUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✓ Salvo: output/${filename}`);
}

function logErro(extracao: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  const linha = `[${new Date().toISOString()}] ${extracao}\n${msg}\n${"─".repeat(60)}\n`;
  appendFileSync(ERROS_LOG, linha, "utf-8");
}

// ─── Fail-fast: credenciais obrigatórias ─────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL) {
  console.error("ERRO: SUPABASE_URL não definida em .env");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERRO: SUPABASE_SERVICE_ROLE_KEY não definida em .env");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não definida em .env");
  process.exit(1);
}

// ─── Clientes ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function queryPg<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

// ─── Anonimização ─────────────────────────────────────────────────────────────
function md5hex(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aplica 7 camadas de remoção de PII a um texto livre.
 * Ordem importa: identificadores estruturados (tel, CPF, CNPJ) antes de nomes.
 */
function anonimizar(texto: string): string {
  let t = texto;

  // 1. Telefones BR em múltiplos formatos
  t = t.replace(/\+?55\s*\(?\d{2}\)?\s*9?\s*\d{4}[-\s]?\d{4}/g, "+55XXXXXXXXX");
  t = t.replace(/\(\d{2}\)\s*9?\d{4}[-\s]?\d{4}/g, "(XX) XXXX-XXXX");

  // 2. CPF
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "CPF_REDIGIDO");

  // 3. CNPJ
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "CNPJ_REDIGIDO");

  // 4. Email
  t = t.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "email@redigido");

  // 5. CEP
  t = t.replace(/\b\d{5}-?\d{3}\b/g, "CEP_REDIGIDO");

  // 6. Datas DD/MM/AAAA e variantes (DD-MM-AA, etc.)
  t = t.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, "DATA_REDIGIDA");

  // 7. Nomes próprios com partículas (de, da, do, das, dos, e)
  t = t.replace(
    /\b[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+(?:de|da|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]?[a-záéíóúâêîôûãõç]+)*(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*\b/g,
    "PESSOA_REDIGIDA"
  );

  return t;
}

/**
 * Passo pré-regex determinístico: substitui o nome real do contato (e primeiro nome)
 * pelo alias antes de aplicar anonimizar(). Garante cobertura mesmo para variações
 * de capitalização não capturadas pela regex genérica de nomes.
 */
function anonimizarTextoComNome(
  texto: string,
  nomeContato: string | null,
  alias: string
): string {
  let t = texto;

  if (nomeContato && nomeContato.trim().length > 0) {
    const nomeCompleto = nomeContato.trim();
    // nome completo (case-insensitive)
    t = t.replace(new RegExp(escapeRegex(nomeCompleto), "gi"), alias);
    // primeiro nome isolado (só se >= 4 chars, evita substituir "de", "da", etc.)
    const primeiroNome = nomeCompleto.split(/\s+/)[0];
    if (primeiroNome.length >= 4) {
      t = t.replace(new RegExp(`\\b${escapeRegex(primeiroNome)}\\b`, "gi"), alias);
    }
  }

  return anonimizar(t);
}

// ─── EXTRAÇÃO 4: System prompt vigente ───────────────────────────────────────
async function extractSystemPrompt(): Promise<void> {
  console.log("\n[EXTRAÇÃO 4] System prompt vigente...");

  const { data, error } = await supabase
    .from("configuracoes_ia")
    .select("chave, valor, updated_at")
    .or("chave.ilike.%prompt%, chave.ilike.%gael%")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) throw new Error(`Supabase error (configuracoes_ia): ${error.message}`);

  console.log(`  Registros encontrados: ${data?.length ?? 0}`);
  save("04-system-prompt.json", data ?? []);
}

// ─── EXTRAÇÃO 2: Últimas 100 auditorias ──────────────────────────────────────
async function extractAuditorias(): Promise<void> {
  console.log("\n[EXTRAÇÃO 2] Últimas 100 auditorias...");

  const { data, error } = await supabase
    .from("ia_auditorias")
    .select(`
      id,
      atendimento_id,
      score_global,
      severidade,
      categorias,
      problemas,
      diagnostico,
      flags_heuristicos,
      fonte,
      status,
      created_at,
      ia_auditorias_runs!inner (
        janela_inicio,
        janela_fim,
        status
      )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Supabase error (ia_auditorias): ${error.message}`);

  console.log(`  Auditorias encontradas: ${data?.length ?? 0}`);
  save("02-auditorias.json", data ?? []);
}

// ─── EXTRAÇÃO 3: Métricas operacionais ───────────────────────────────────────
async function extractMetricas(): Promise<void> {
  console.log("\n[EXTRAÇÃO 3] Métricas operacionais (últimos 30 dias)...");

  // 3.1 — Taxa de escalada
  const escaladaRows = await queryPg(`
    WITH base AS (
      SELECT
        a.id,
        a.modo,
        MAX(CASE WHEN e.tipo = 'escalonamento_humano' THEN 1 ELSE 0 END) AS teve_escalada,
        MIN(CASE WHEN e.tipo = 'escalonamento_humano' THEN e.created_at END) AS primeira_escalada_at,
        MIN(a.created_at) AS inicio_at
      FROM public.atendimentos a
      LEFT JOIN public.eventos_crm e ON e.referencia_id = a.id AND e.referencia_tipo = 'atendimento'
      WHERE a.created_at >= now() - interval '30 days'
      GROUP BY a.id, a.modo
    )
    SELECT
      COUNT(*)                                                        AS total_atendimentos,
      SUM(teve_escalada)                                              AS escalados,
      ROUND(100.0 * SUM(teve_escalada) / NULLIF(COUNT(*), 0), 1)     AS pct_escalados,
      ROUND(AVG(
        CASE WHEN teve_escalada = 1
        THEN EXTRACT(EPOCH FROM (primeira_escalada_at - inicio_at)) / 60.0
        END
      ), 1)                                                           AS avg_min_ate_escalada
    FROM base
  `);

  // Top-5 motivos de escalada
  const motivosRows = await queryPg(`
    SELECT
      e.metadata->>'motivo' AS motivo,
      COUNT(*)              AS ocorrencias
    FROM public.eventos_crm e
    WHERE e.tipo IN ('escalonamento_humano', 'escalar_consultor')
      AND e.created_at >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5
  `);

  // Watchdog loops
  const watchdogRows = await queryPg(`
    SELECT COUNT(*) AS loops_watchdog
    FROM public.eventos_crm
    WHERE tipo = 'loop_ia_escalado_watchdog'
      AND created_at >= now() - interval '30 days'
  `);

  // 3.2 — Funil orçamento → agendamento
  const funilRows = await queryPg(`
    WITH orcamentos AS (
      SELECT DISTINCT referencia_id AS atendimento_id
      FROM public.eventos_crm
      WHERE tipo IN ('triagem_ia','escalonamento_humano')
        AND metadata->>'pipeline_coluna' = 'Orçamento'
        AND created_at >= now() - interval '30 days'
    ),
    agendados AS (
      SELECT DISTINCT referencia_id AS atendimento_id
      FROM public.eventos_crm
      WHERE tipo = 'agendamento_criado'
        AND created_at >= now() - interval '30 days'
    )
    SELECT
      COUNT(o.atendimento_id)                                                        AS chegaram_orcamento,
      COUNT(ag.atendimento_id)                                                       AS converteram_agendamento,
      ROUND(100.0 * COUNT(ag.atendimento_id) / NULLIF(COUNT(o.atendimento_id),0),1) AS pct_conversao
    FROM orcamentos o
    LEFT JOIN agendados ag USING (atendimento_id)
  `);

  // 3.3 — Distribuição de validator_flags
  const flagsRows = await queryPg(`
    SELECT
      flag AS validator_flag,
      COUNT(*) AS ocorrencias
    FROM public.eventos_crm e,
      jsonb_array_elements_text(e.metadata->'validator_flags') AS flag
    WHERE e.tipo IN ('triagem_ia', 'escalonamento_humano')
      AND e.created_at >= now() - interval '30 days'
      AND e.metadata ? 'validator_flags'
    GROUP BY 1
    ORDER BY 2 DESC
  `);

  // 3.4 — Distribuição de eventos_crm
  const eventosRows = await queryPg(`
    SELECT
      tipo,
      COUNT(*)                                                    AS total,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS ultimos_7d
    FROM public.eventos_crm
    WHERE created_at >= now() - interval '30 days'
    GROUP BY tipo
    ORDER BY total DESC
  `);

  // 3.5 — Estimativa de custo de tokens
  const custoRows = await queryPg(`
    SELECT
      DATE_TRUNC('day', created_at)              AS dia,
      COUNT(*)                                   AS mensagens_ia,
      ROUND(COUNT(*) * 1000.0 / 1e6 * 3.0, 4)   AS custo_usd_estimado
    FROM public.mensagens
    WHERE direcao = 'outbound'
      AND remetente_nome = 'Gael'
      AND created_at >= now() - interval '30 days'
    GROUP BY 1
    ORDER BY 1
  `);

  console.log(`  Escalada: ${JSON.stringify(escaladaRows[0])}`);
  console.log(`  Funil: ${JSON.stringify(funilRows[0])}`);
  console.log(`  Tipos de eventos únicos: ${eventosRows.length}`);
  console.log(`  Flags distintos: ${flagsRows.length}`);

  save("03-metricas.json", {
    escalada: {
      resumo: escaladaRows[0] ?? null,
      top5_motivos: motivosRows,
      loops_watchdog: watchdogRows[0] ?? null,
    },
    funil_orcamento_agendamento: funilRows[0] ?? null,
    validator_flags: flagsRows,
    eventos_crm: eventosRows,
    custo_tokens_estimado: custoRows,
  });
}

// ─── EXTRAÇÃO 1: Amostra estratificada ───────────────────────────────────────
interface MensagemRaw {
  ts: string;
  dir: string;
  de: string;
  texto: string;
  tipo: string;
}

interface AmostraRow {
  atendimento_id: string;
  fluxo: string;
  intencao_final: string | null;
  pipeline_coluna_final: string | null;
  modo_atendimento: string | null;
  foi_escalado: boolean | null;
  tempo_total_min: string | null;
  msg_inbound: string | null;
  msg_outbound: string | null;
  tools_chamadas: unknown;
  score_audit: string;
  severidade_audit: string | null;
  bucket: string;
  transcricao: MensagemRaw[] | null;
  // campos temporários para anonimização — removidos antes de salvar
  contato_nome: string | null;
  contato_telefone: string | null;
}

async function extractAmostra(): Promise<void> {
  console.log("\n[EXTRAÇÃO 1] Amostra estratificada de conversas...");

  const rows = await queryPg<AmostraRow>(`
    WITH
    last_triage AS (
      SELECT DISTINCT ON (referencia_id)
        referencia_id                         AS atendimento_id,
        metadata->>'intencao'                 AS intencao,
        metadata->>'pipeline_coluna'          AS pipeline_coluna,
        metadata->>'modo'                     AS modo_final,
        (metadata->'validator_flags')         AS validator_flags,
        created_at
      FROM public.eventos_crm
      WHERE tipo IN ('triagem_ia','escalonamento_humano')
        AND referencia_tipo = 'atendimento'
      ORDER BY referencia_id, created_at DESC
    ),
    fluxo_map AS (
      SELECT
        lt.*,
        CASE
          WHEN intencao = 'receita_oftalmologica' THEN 'orcamento_lc'
          WHEN intencao = 'orcamento'             THEN 'orcamento'
          WHEN intencao = 'status'                THEN 'status_pedido'
          WHEN intencao = 'reclamacao'            THEN 'reclamacao'
          WHEN intencao = 'informacoes'           THEN 'duvida_produto'
          ELSE 'saudacao_outro'
        END AS fluxo
      FROM last_triage lt
    ),
    enriquecido AS (
      SELECT
        a.id                                              AS atendimento_id,
        fm.fluxo,
        fm.intencao,
        fm.pipeline_coluna,
        a.modo,
        COALESCE(audi.score_global, -1)                   AS score_audit,
        audi.severidade                                   AS severidade_audit,
        EXTRACT(EPOCH FROM (a.fim_at - a.created_at))/60  AS tempo_min,
        a.created_at,
        a.contato_id,
        c.nome   AS contato_nome,
        c.telefone AS contato_telefone
      FROM public.atendimentos a
      JOIN fluxo_map fm ON fm.atendimento_id = a.id
      LEFT JOIN public.ia_auditorias audi ON audi.atendimento_id = a.id
      LEFT JOIN public.contatos c ON c.id = a.contato_id
      WHERE a.created_at >= now() - interval '30 days'
        AND a.status = 'finalizado'
    ),
    ranked AS (
      SELECT *,
        CASE
          WHEN severidade_audit IN ('warn','critical') THEN 'ruim'
          WHEN score_audit >= 8                        THEN 'bom'
          WHEN score_audit >= 5                        THEN 'medio'
          ELSE 'sem_auditoria'
        END AS bucket,
        ROW_NUMBER() OVER (
          PARTITION BY fluxo,
            CASE
              WHEN severidade_audit IN ('warn','critical') THEN 'ruim'
              WHEN score_audit >= 8                        THEN 'bom'
              WHEN score_audit >= 5                        THEN 'medio'
              ELSE 'sem_auditoria'
            END
          ORDER BY RANDOM()
        ) AS rn
      FROM enriquecido
    ),
    amostra AS (
      SELECT * FROM ranked
      WHERE (bucket IN ('bom','medio','ruim') AND rn <= 2)
         OR (bucket = 'sem_auditoria' AND rn <= 1)
    ),
    stats AS (
      SELECT
        m.atendimento_id,
        COUNT(*) FILTER (WHERE m.direcao = 'inbound')   AS msg_inbound,
        COUNT(*) FILTER (WHERE m.direcao = 'outbound')  AS msg_outbound,
        bool_or(
          m.remetente_nome NOT IN ('Gael','Sistema')
          AND m.direcao = 'outbound'
        )                                               AS foi_escalado
      FROM public.mensagens m
      WHERE m.atendimento_id IN (SELECT atendimento_id FROM amostra)
      GROUP BY m.atendimento_id
    ),
    transcricao AS (
      -- Texto retornado RAW; anonimização aplicada em TypeScript após fetch
      SELECT
        m.atendimento_id,
        jsonb_agg(
          jsonb_build_object(
            'ts',   m.created_at,
            'dir',  m.direcao,
            'de',   CASE
                      WHEN m.direcao = 'inbound'
                      THEN 'Cliente_' || LEFT(md5(c.telefone), 6)
                      ELSE m.remetente_nome
                    END,
            'texto', m.conteudo,
            'tipo',  COALESCE(m.tipo_conteudo, 'text')
          )
          ORDER BY m.created_at
        ) AS mensagens
      FROM public.mensagens m
      JOIN public.atendimentos a ON a.id = m.atendimento_id
      JOIN public.contatos c     ON c.id = a.contato_id
      WHERE m.atendimento_id IN (SELECT atendimento_id FROM amostra)
      GROUP BY m.atendimento_id
    ),
    tools AS (
      SELECT
        referencia_id AS atendimento_id,
        jsonb_agg(DISTINCT metadata->'tools') FILTER (WHERE metadata ? 'tools') AS tools_list
      FROM public.eventos_crm
      WHERE referencia_id IN (SELECT atendimento_id FROM amostra)
        AND referencia_tipo = 'atendimento'
      GROUP BY referencia_id
    )
    SELECT
      s2.atendimento_id,
      s2.fluxo,
      s2.intencao            AS intencao_final,
      s2.pipeline_coluna     AS pipeline_coluna_final,
      s2.modo                AS modo_atendimento,
      st.foi_escalado,
      ROUND(s2.tempo_min::numeric, 1) AS tempo_total_min,
      st.msg_inbound,
      st.msg_outbound,
      tl.tools_list          AS tools_chamadas,
      s2.score_audit,
      s2.severidade_audit,
      s2.bucket,
      tr.mensagens           AS transcricao,
      s2.contato_nome,
      s2.contato_telefone
    FROM amostra s2
    LEFT JOIN stats st       ON st.atendimento_id = s2.atendimento_id
    LEFT JOIN transcricao tr ON tr.atendimento_id = s2.atendimento_id
    LEFT JOIN tools tl       ON tl.atendimento_id = s2.atendimento_id
    ORDER BY s2.fluxo, s2.bucket, s2.atendimento_id
  `);

  // Anonimização em TypeScript: pré-regex de nome + 7 camadas de regex
  const rowsSanitized = rows.map((row) => {
    const { contato_nome, contato_telefone, transcricao, ...rest } = row;

    const alias = contato_telefone
      ? `Cliente_${md5hex(contato_telefone).slice(0, 6)}`
      : "Cliente_HASH";

    const transcricaoAnon: MensagemRaw[] = (transcricao ?? []).map((msg) => ({
      ...msg,
      texto: anonimizarTextoComNome(msg.texto, contato_nome, alias),
    }));

    return { ...rest, transcricao: transcricaoAnon };
  });

  console.log(`  Conversas na amostra: ${rowsSanitized.length}`);
  const porFluxo = rowsSanitized.reduce<Record<string, number>>((acc, r) => {
    acc[r.fluxo] = (acc[r.fluxo] ?? 0) + 1;
    return acc;
  }, {});
  console.log("  Distribuição por fluxo:", porFluxo);

  save("01-amostra-conversas.json", rowsSanitized);
}

// ─── Error handling isolado por extração ─────────────────────────────────────
interface ExtResult {
  label: string;
  ok: boolean;
  erro?: string;
}

async function runExtract(label: string, fn: () => Promise<void>): Promise<ExtResult> {
  try {
    await fn();
    return { label, ok: true };
  } catch (e) {
    logErro(label, e);
    return { label, ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("=== AUDITORIA GAEL — Extração de dados ===");
  console.log("Credenciais: carregadas (não exibidas)");

  const resultados: ExtResult[] = [];

  try {
    resultados.push(await runExtract("EXTRAÇÃO 4 (system prompt)", extractSystemPrompt));
    resultados.push(await runExtract("EXTRAÇÃO 2 (auditorias)",    extractAuditorias));
    resultados.push(await runExtract("EXTRAÇÃO 3 (métricas)",      extractMetricas));
    resultados.push(await runExtract("EXTRAÇÃO 1 (amostra)",       extractAmostra));
  } finally {
    await pool.end();
  }

  console.log("\n─── Resumo ────────────────────────────────────");
  for (const r of resultados) {
    if (r.ok) {
      console.log(`  ✓ ${r.label} (sucesso)`);
    } else {
      console.log(`  ✗ ${r.label} (falhou — ver output/_erros.log)`);
      if (r.erro) console.log(`    → ${r.erro}`);
    }
  }
  console.log("───────────────────────────────────────────────");

  const algumFalhou = resultados.some((r) => !r.ok);
  if (algumFalhou) {
    console.log("\n⚠️  Uma ou mais extrações falharam. Ver output/_erros.log para detalhes.");
    process.exit(1);
  }
  console.log("\n✅ Extração concluída. Arquivos em auditoria-gael/output/");
}

main().catch((err) => {
  console.error("ERRO FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
