import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

// ── Env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPORT_TOKEN = Deno.env.get("AUDITORIA_EXPORT_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ── Anonimização (inline — não importa de /auditoria-gael) ───────────────────

function md5hex(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function anonimizar(texto: string): string {
  let t = texto;
  t = t.replace(/\+?55\s*\(?\d{2}\)?\s*9?\s*\d{4}[-\s]?\d{4}/g, "+55XXXXXXXXX");
  t = t.replace(/\(\d{2}\)\s*9?\d{4}[-\s]?\d{4}/g, "(XX) XXXX-XXXX");
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "CPF_REDIGIDO");
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "CNPJ_REDIGIDO");
  t = t.replace(/[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "email@redigido");
  t = t.replace(/\b\d{5}-?\d{3}\b/g, "CEP_REDIGIDO");
  t = t.replace(/\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b/g, "DATA_REDIGIDA");
  t = t.replace(
    /\b[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+(?:de|da|do|das|dos|e)\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]?[a-záéíóúâêîôûãõç]+)*(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)*\b/g,
    "PESSOA_REDIGIDA"
  );
  return t;
}

function anonimizarTextoComNome(texto: string, nomeContato: string | null, alias: string): string {
  let t = texto;
  if (nomeContato && nomeContato.trim().length > 0) {
    const nomeCompleto = nomeContato.trim();
    t = t.replace(new RegExp(escapeRegex(nomeCompleto), "gi"), alias);
    const primeiroNome = nomeCompleto.split(/\s+/)[0];
    if (primeiroNome.length >= 4) {
      t = t.replace(new RegExp(`\\b${escapeRegex(primeiroNome)}\\b`, "gi"), alias);
    }
  }
  return anonimizar(t);
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>;

interface ExtractionResult {
  extracted_at: string;
  extractions: Record<string, unknown>;
  errors: Array<{ extraction: string; message: string }>;
}

type Fluxo =
  | "orcamento"
  | "orcamento_lc"
  | "status_pedido"
  | "reclamacao"
  | "duvida_produto"
  | "saudacao_outro";

type Bucket = "bom" | "medio" | "ruim" | "sem_auditoria";

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!EXPORT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "AUDITORIA_EXPORT_TOKEN não configurado" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${EXPORT_TOKEN}`) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const result: ExtractionResult = {
    extracted_at: new Date().toISOString(),
    extractions: {},
    errors: [],
  };

  await runExtraction("system_prompt", async () => {
    const { data, error } = await supabase
      .from("configuracoes_ia")
      .select("chave, valor, updated_at")
      .or("chave.ilike.%prompt%,chave.ilike.%gael%")
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    return data;
  }, result);

  await runExtraction("auditorias", async () => {
    const { data, error } = await supabase
      .from("ia_auditorias")
      .select(`
        id, atendimento_id, score_global, severidade,
        categorias, problemas, diagnostico, flags_heuristicos,
        fonte, created_at,
        run:ia_auditorias_runs!inner(janela_inicio, janela_fim)
      `)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  }, result);

  await runExtraction("metricas", async () => extractMetrics(supabase), result);

  await runExtraction("amostra", async () => extractAmostra(supabase), result);

  return new Response(JSON.stringify(result, null, 2), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

// ── runExtraction ─────────────────────────────────────────────────────────────

async function runExtraction(
  name: string,
  fn: () => Promise<unknown>,
  result: ExtractionResult
): Promise<void> {
  try {
    result.extractions[name] = await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.errors.push({ extraction: name, message });
    result.extractions[name] = null;
  }
}

// ── extractMetrics ────────────────────────────────────────────────────────────

async function extractMetrics(supabase: SupabaseClient) {
  const ha30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const ha7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 3.1 — Taxa de escalada
  const escalada = await (async () => {
    const { data: atendimentos } = await supabase
      .from("atendimentos")
      .select("id, created_at")
      .gte("created_at", ha30dias);

    const rows = (atendimentos ?? []) as Array<{ id: string; created_at: string }>;
    const total = rows.length;
    if (total === 0) return { total: 0, escalados: 0, pct: 0, avg_min_ate_escalada: null };

    const ids = rows.map((a) => a.id);
    const { data: escalamentos } = await supabase
      .from("eventos_crm")
      .select("referencia_id, created_at")
      .eq("tipo", "escalonamento_humano")
      .in("referencia_id", ids);

    const escRows = (escalamentos ?? []) as Array<{ referencia_id: string; created_at: string }>;
    const escalados = new Set(escRows.map((e) => e.referencia_id)).size;
    const pct = Math.round((escalados / total) * 10000) / 100;

    const atMap = Object.fromEntries(rows.map((a) => [a.id, a.created_at]));
    const firstEscByAt: Record<string, string> = {};
    for (const e of escRows) {
      if (!firstEscByAt[e.referencia_id] || e.created_at < firstEscByAt[e.referencia_id]) {
        firstEscByAt[e.referencia_id] = e.created_at;
      }
    }
    const diffs = Object.entries(firstEscByAt)
      .map(([id, escAt]) => (new Date(escAt).getTime() - new Date(atMap[id]).getTime()) / 60000)
      .filter((d) => d >= 0);
    const avg_min_ate_escalada =
      diffs.length > 0
        ? Math.round((diffs.reduce((s, v) => s + v, 0) / diffs.length) * 10) / 10
        : null;

    return { total, escalados, pct, avg_min_ate_escalada };
  })();

  // 3.1b — Top 5 motivos de escalada
  const motivos_escalada_top5 = await (async () => {
    const { data } = await supabase
      .from("eventos_crm")
      .select("metadata")
      .in("tipo", ["escalonamento_humano", "escalar_consultor"])
      .gte("created_at", ha30dias);

    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ metadata: Record<string, unknown> }>) {
      const motivo = (row.metadata?.motivo as string) ?? "sem_motivo";
      counts[motivo] = (counts[motivo] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([motivo, total]) => ({ motivo, total }));
  })();

  // 3.1c — Loops watchdog
  const { count: loops_watchdog } = await supabase
    .from("eventos_crm")
    .select("id", { count: "exact", head: true })
    .eq("tipo", "loop_ia_escalado_watchdog")
    .gte("created_at", ha30dias);

  // 3.2 — Funil orçamento → agendamento
  const funil_orcamento_agendamento = await (async () => {
    const { data: evTriage } = await supabase
      .from("eventos_crm")
      .select("referencia_id, metadata")
      .in("tipo", ["triagem_ia", "escalonamento_humano"])
      .gte("created_at", ha30dias);

    const idsOrcamento = new Set(
      ((evTriage ?? []) as Array<{ referencia_id: string; metadata: Record<string, unknown> }>)
        .filter(
          (e) =>
            (e.metadata?.pipeline_coluna as string | undefined)?.toLowerCase().includes("orç") ||
            (e.metadata?.intencao as string | undefined) === "orcamento"
        )
        .map((e) => e.referencia_id)
    );

    const { data: evAgend } = await supabase
      .from("eventos_crm")
      .select("referencia_id")
      .eq("tipo", "agendamento_criado")
      .gte("created_at", ha30dias);

    const idsAgend = new Set(
      ((evAgend ?? []) as Array<{ referencia_id: string }>).map((e) => e.referencia_id)
    );
    const convertidos = [...idsOrcamento].filter((id) => idsAgend.has(id)).length;

    return {
      em_orcamento: idsOrcamento.size,
      convertidos_agendamento: convertidos,
      pct_conversao:
        idsOrcamento.size > 0
          ? Math.round((convertidos / idsOrcamento.size) * 10000) / 100
          : 0,
    };
  })();

  // 3.3 — Distribuição validator_flags
  const validator_flags = await (async () => {
    const { data } = await supabase
      .from("eventos_crm")
      .select("metadata")
      .in("tipo", ["triagem_ia", "escalonamento_humano"])
      .gte("created_at", ha30dias);

    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ metadata: Record<string, unknown> }>) {
      const flags = row.metadata?.validator_flags;
      if (Array.isArray(flags)) {
        for (const f of flags as string[]) {
          counts[f] = (counts[f] ?? 0) + 1;
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([flag, total]) => ({ flag, total }));
  })();

  // 3.4 — Distribuição eventos_crm
  const eventos_crm_distribuicao = await (async () => {
    const { data } = await supabase
      .from("eventos_crm")
      .select("tipo, created_at")
      .gte("created_at", ha30dias);

    const total30: Record<string, number> = {};
    const total7: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ tipo: string; created_at: string }>) {
      total30[row.tipo] = (total30[row.tipo] ?? 0) + 1;
      if (row.created_at >= ha7dias) {
        total7[row.tipo] = (total7[row.tipo] ?? 0) + 1;
      }
    }
    return Object.entries(total30)
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, total_30d]) => ({ tipo, total_30d, total_7d: total7[tipo] ?? 0 }));
  })();

  // 3.5 — Mensagens IA por dia (sem cálculo de custo — sem dados confiáveis de tokens)
  const mensagens_ia_por_dia = await (async () => {
    const { data } = await supabase
      .from("mensagens")
      .select("created_at")
      .eq("direcao", "outbound")
      .eq("remetente_nome", "Gael")
      .gte("created_at", ha30dias);

    const byDay: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ created_at: string }>) {
      const day = row.created_at.slice(0, 10);
      byDay[day] = (byDay[day] ?? 0) + 1;
    }
    return Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, mensagens]) => ({ dia, mensagens }));
  })();

  return {
    escalada,
    motivos_escalada_top5,
    loops_watchdog: loops_watchdog ?? 0,
    funil_orcamento_agendamento,
    validator_flags,
    eventos_crm_distribuicao,
    mensagens_ia_por_dia,
  };
}

// ── extractAmostra ────────────────────────────────────────────────────────────

function classificarFluxo(intencao: string | null): Fluxo {
  switch (intencao) {
    case "orcamento":
      return "orcamento";
    case "receita_oftalmologica":
      // REGISTRAR: confirmar empiricamente se receita → orcamento_lc faz sentido
      return "orcamento_lc";
    case "status":
      return "status_pedido";
    case "reclamacao":
      return "reclamacao";
    case "informacoes":
      return "duvida_produto";
    default:
      return "saudacao_outro";
  }
}

function classificarBucket(score: number | null, severidade: string | null): Bucket {
  if (score === null && severidade === null) return "sem_auditoria";
  if (severidade === "warn" || severidade === "critical") return "ruim";
  if (score !== null && score >= 8) return "bom";
  if (score !== null && score >= 5) return "medio";
  return "sem_auditoria";
}

function embaralhar<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface AtRow {
  id: string;
  modo: string;
  created_at: string;
  fim_at: string | null;
  contato: { nome: string | null; telefone: string | null } | null;
  auditoria: Array<{ score_global: number | null; severidade: string | null }> | null;
}

interface AtClassified extends AtRow {
  fluxo: Fluxo;
  bucket: Bucket;
  intencao: string | null;
  pipeline_coluna_final: string | null;
}

async function extractAmostra(supabase: SupabaseClient) {
  const ha30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Atendimentos finalizados com contato e auditoria
  const { data: atendimentos, error: errAt } = await supabase
    .from("atendimentos")
    .select(`
      id, modo, created_at, fim_at, status,
      contato:contatos(nome, telefone),
      auditoria:ia_auditorias(score_global, severidade)
    `)
    .eq("status", "finalizado")
    .gte("created_at", ha30dias);

  if (errAt) throw errAt;
  if (!atendimentos || atendimentos.length === 0) return [];

  const rows = atendimentos as AtRow[];
  const ids = rows.map((a) => a.id);

  // 2. Último evento triagem_ia / escalonamento por atendimento
  const { data: evTriagem } = await supabase
    .from("eventos_crm")
    .select("referencia_id, metadata, created_at")
    .in("tipo", ["triagem_ia", "escalonamento_humano"])
    .in("referencia_id", ids)
    .order("created_at", { ascending: false });

  const ultimoTriage: Record<string, { intencao: string | null; pipeline_coluna: string | null }> = {};
  for (const ev of (evTriagem ?? []) as Array<{
    referencia_id: string;
    metadata: Record<string, unknown>;
  }>) {
    if (!ultimoTriage[ev.referencia_id]) {
      ultimoTriage[ev.referencia_id] = {
        intencao: (ev.metadata?.intencao as string) ?? null,
        pipeline_coluna: (ev.metadata?.pipeline_coluna as string) ?? null,
      };
    }
  }

  // 3. Atendimentos que foram escalados
  const { data: evEscalada } = await supabase
    .from("eventos_crm")
    .select("referencia_id")
    .eq("tipo", "escalonamento_humano")
    .in("referencia_id", ids);

  const foiEscalado = new Set(
    ((evEscalada ?? []) as Array<{ referencia_id: string }>).map((e) => e.referencia_id)
  );

  // 4. Classificar
  const classified: AtClassified[] = rows.map((a) => {
    const triage = ultimoTriage[a.id];
    const auditRow = Array.isArray(a.auditoria) ? a.auditoria[0] : null;
    return {
      ...a,
      fluxo: classificarFluxo(triage?.intencao ?? null),
      bucket: classificarBucket(auditRow?.score_global ?? null, auditRow?.severidade ?? null),
      intencao: triage?.intencao ?? null,
      pipeline_coluna_final: triage?.pipeline_coluna ?? null,
    };
  });

  // 5. Amostragem estratificada: 2 por (fluxo, bucket), 1 para sem_auditoria
  const grupos: Record<string, AtClassified[]> = {};
  for (const item of classified) {
    const key = `${item.fluxo}::${item.bucket}`;
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(item);
  }

  const selecionados: AtClassified[] = [];
  for (const [key, items] of Object.entries(grupos)) {
    const n = key.endsWith("::sem_auditoria") ? 1 : 2;
    embaralhar(items)
      .slice(0, n)
      .forEach((i) => selecionados.push(i));
  }

  // 6. Para cada selecionado: mensagens + tools + anonimização
  const resultados = [];
  for (const at of selecionados) {
    const alias = `Cliente_${md5hex(at.contato?.telefone ?? at.id).slice(0, 6)}`;
    const nomeContato = at.contato?.nome ?? null;

    const { data: mensagens } = await supabase
      .from("mensagens")
      .select("id, direcao, conteudo, created_at, remetente_nome")
      .eq("atendimento_id", at.id)
      .order("created_at");

    const { data: toolsEvs } = await supabase
      .from("eventos_crm")
      .select("metadata")
      .eq("referencia_id", at.id)
      .not("metadata->tools", "is", null);

    const tools_chamadas: string[] = [];
    for (const ev of (toolsEvs ?? []) as Array<{ metadata: Record<string, unknown> }>) {
      const t = ev.metadata?.tools;
      if (Array.isArray(t)) tools_chamadas.push(...(t as string[]));
      else if (typeof t === "string") tools_chamadas.push(t);
    }

    // 7. Anonimizar transcrição (nome do contato e PII)
    const transcricao = ((mensagens ?? []) as Array<{
      id: string;
      direcao: string;
      conteudo: string | null;
      created_at: string;
      remetente_nome: string | null;
    }>).map((m) => ({
      id: m.id,
      direcao: m.direcao,
      created_at: m.created_at,
      remetente: m.remetente_nome === "Gael" ? "Gael" : alias,
      conteudo: anonimizarTextoComNome(m.conteudo ?? "", nomeContato, alias),
    }));

    const auditRow = Array.isArray(at.auditoria) ? at.auditoria[0] : null;
    const fim = at.fim_at ? new Date(at.fim_at).getTime() : Date.now();
    const tempo_total_min = Math.round((fim - new Date(at.created_at).getTime()) / 60000);

    // NÃO inclui contato_nome nem contato_telefone
    resultados.push({
      atendimento_id: at.id,
      fluxo: at.fluxo,
      intencao: at.intencao,
      pipeline_coluna_final: at.pipeline_coluna_final,
      modo: at.modo,
      foi_escalado: foiEscalado.has(at.id),
      tempo_total_min,
      msg_inbound: transcricao.filter((m) => m.direcao === "inbound").length,
      msg_outbound: transcricao.filter((m) => m.direcao === "outbound").length,
      tools_chamadas: [...new Set(tools_chamadas)],
      score_audit: auditRow?.score_global ?? null,
      severidade_audit: auditRow?.severidade ?? null,
      bucket: at.bucket,
      transcricao,
    });
  }

  return resultados;
}
