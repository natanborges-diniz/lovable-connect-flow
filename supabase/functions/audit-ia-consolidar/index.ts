// audit-ia-consolidar
// Agrupa achados (ia_auditorias) de uma run por causa-raiz e propõe correções únicas por grupo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Achado = {
  id: string;
  severidade: string;
  diagnostico: string;
  problemas: any[];
  flags: any[];
};

function primaryType(a: Achado): string {
  const p = (a.problemas?.[0]?.tipo) || (a.flags?.[0]?.tipo) || "outro";
  return String(p);
}

async function consolidarChunk(
  achados: Achado[],
  jaExistentes: { regras: string[]; exemplos: string[]; instrucoes: string[] },
): Promise<any> {
  const sys = `Você é engenheiro de prompts. Recebe uma LISTA de achados de auditoria (cada um é uma conversa com problema) e deve AGRUPAR por causa-raiz comum, propondo a correção UMA ÚNICA VEZ por grupo (evita duplicatas).

REGRAS:
- Mesmo padrão de erro em conversas diferentes = MESMO grupo. Ex: "IA citou preço Kodak" em 5 conversas = 1 grupo.
- NÃO proponha regras/exemplos/instruções que já existam (lista abaixo).
- Para cada grupo escolha 1+ ações que MELHOR previnam recorrência:
  * "regra_proibida": conteúdo factualmente vetado (preço de marca não negociada, promessa indevida).
  * "exemplo": padrão pergunta-resposta replicável (categoria: lentes_contato, receita, agendamento, preco, geral).
  * "ajuste_prompt": regra de fluxo/decisão (categoria: fluxo, tom, seguranca, fechamento).
  * "tarefa_ti": exige código/integração nova (titulo + descricao técnica).
- Sempre português, imperativo, conciso.

Retorne JSON estrito: {"grupos":[{"titulo":"...","descricao":"...","severidade":"critical|warn|info","auditoria_ids":["uuid"],"acoes":[...]}]}`;

  const user = `ACHADOS (${achados.length}):
${JSON.stringify(achados)}

JÁ EXISTEM (não duplicar):
- Regras: ${JSON.stringify(jaExistentes.regras.slice(0, 30))}
- Exemplos (perguntas): ${JSON.stringify(jaExistentes.exemplos.slice(0, 30))}
- Diretrizes: ${JSON.stringify(jaExistentes.instrucoes.slice(0, 30))}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      max_completion_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const finishReason = data.choices?.[0]?.finish_reason;
  const usage = data.usage;
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = cleaned.search(/[\{\[]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    console.error("[consolidar] JSON parse falhou.", { len: raw.length, finishReason, usage, preview: raw.slice(0, 300) });
    return { grupos: [] };
  }
}

function mergeGrupos(parciais: any[]): any[] {
  const map = new Map<string, any>();
  for (const lote of parciais) {
    for (const g of (lote?.grupos || [])) {
      const key = String(g.titulo || "").trim().toLowerCase().slice(0, 80) || crypto.randomUUID();
      if (map.has(key)) {
        const cur = map.get(key);
        const ids = new Set([...(cur.auditoria_ids || []), ...(g.auditoria_ids || [])]);
        cur.auditoria_ids = Array.from(ids);
        cur.acoes = [...(cur.acoes || []), ...(g.acoes || [])];
      } else {
        map.set(key, { ...g });
      }
    }
  }
  return Array.from(map.values());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { run_id } = await req.json();
    if (!run_id) {
      return new Response(JSON.stringify({ error: "run_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("ia_auditorias_grupos").delete().eq("run_id", run_id).eq("status", "pendente");

    const { data: auditorias, error: errA } = await supabase
      .from("ia_auditorias")
      .select("id, severidade, diagnostico, problemas, flags_heuristicos, status")
      .eq("run_id", run_id)
      .in("severidade", ["warn", "critical"])
      .neq("status", "ignorado");
    if (errA) throw errA;

    const trimItem = (p: any) => ({
      tipo: p?.tipo,
      severidade: p?.severidade,
      trecho: typeof p?.trecho === "string" ? p.trecho.slice(0, 160) : undefined,
    });
    const achados: Achado[] = (auditorias || [])
      .filter((a: any) => a.status !== "aplicado")
      .map((a: any) => ({
        id: a.id,
        severidade: a.severidade,
        diagnostico: (a.diagnostico || "").slice(0, 240),
        problemas: (Array.isArray(a.problemas) ? a.problemas : []).slice(0, 3).map(trimItem),
        flags: (Array.isArray(a.flags_heuristicos) ? a.flags_heuristicos : []).slice(0, 3).map(trimItem),
      }));

    if (achados.length === 0) {
      return new Response(JSON.stringify({ grupos: [], total: 0, motivo: "sem_achados_elegiveis" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: regras }, { data: exemplos }, { data: instr }] = await Promise.all([
      supabase.from("ia_regras_proibidas").select("regra").eq("ativo", true).limit(80),
      supabase.from("ia_exemplos").select("pergunta").eq("ativo", true).limit(80),
      supabase.from("ia_instrucoes_prompt").select("instrucao").eq("ativo", true).limit(80),
    ]);
    const ja = {
      regras: (regras || []).map((r: any) => r.regra),
      exemplos: (exemplos || []).map((e: any) => e.pergunta),
      instrucoes: (instr || []).map((i: any) => i.instrucao),
    };

    // Pré-clusteriza por tipo de problema para que cada chunk vá com achados similares juntos
    const byType = new Map<string, Achado[]>();
    for (const a of achados) {
      const t = primaryType(a);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(a);
    }
    const ordered: Achado[] = [];
    for (const arr of byType.values()) ordered.push(...arr);

    const CHUNK = 25;
    const chunks: Achado[][] = [];
    for (let i = 0; i < ordered.length; i += CHUNK) chunks.push(ordered.slice(i, i + CHUNK));

    console.log(`[consolidar] achados=${achados.length} chunks=${chunks.length} types=${byType.size}`);

    const parciais: any[] = [];
    for (const c of chunks) {
      try {
        const r = await consolidarChunk(c, ja);
        parciais.push(r);
      } catch (e: any) {
        console.error("[consolidar] chunk falhou:", e.message);
      }
    }

    const merged = mergeGrupos(parciais);
    const validIds = new Set(achados.map((a) => a.id));
    const inseridos: any[] = [];

    for (const g of merged) {
      const ids = (g.auditoria_ids || []).filter((id: string) => validIds.has(id));
      if (ids.length === 0) continue;
      const { data, error } = await supabase
        .from("ia_auditorias_grupos")
        .insert({
          run_id,
          titulo: String(g.titulo || "Sem título").slice(0, 200),
          descricao: g.descricao || null,
          severidade: ["critical", "warn", "info"].includes(g.severidade) ? g.severidade : "warn",
          auditoria_ids: ids,
          acoes_propostas: Array.isArray(g.acoes) ? g.acoes : [],
          status: "pendente",
        })
        .select()
        .single();
      if (error) {
        console.error("[consolidar] insert grupo falhou", error);
        continue;
      }
      inseridos.push(data);
    }

    const motivo = inseridos.length === 0
      ? (merged.length === 0 ? "llm_sem_grupos" : "grupos_sem_ids_validos")
      : undefined;

    return new Response(JSON.stringify({ grupos: inseridos, total: inseridos.length, motivo, debug: { achados: achados.length, chunks: chunks.length, merged: merged.length } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-consolidar]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
