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

async function consolidar(
  achados: Array<{ id: string; severidade: string; diagnostico: string; problemas: any; flags: any }>,
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

Retorne JSON estrito:
{
  "grupos": [
    {
      "titulo": "frase curta",
      "descricao": "explicação 1-2 linhas",
      "severidade": "critical|warn|info",
      "auditoria_ids": ["uuid", ...],
      "acoes": [
        {"tipo":"regra_proibida","categoria":"...","texto":"..."},
        {"tipo":"exemplo","categoria":"...","pergunta":"...","resposta_ideal":"..."},
        {"tipo":"ajuste_prompt","categoria":"fluxo","instrucao":"..."},
        {"tipo":"tarefa_ti","titulo":"...","descricao":"..."}
      ]
    }
  ]
}`;

  const user = `ACHADOS (${achados.length}):
${JSON.stringify(achados, null, 1).slice(0, 14000)}

JÁ EXISTEM (não propor duplicatas):
- Regras proibidas ativas: ${JSON.stringify(jaExistentes.regras).slice(0, 2000)}
- Exemplos ativos (perguntas): ${JSON.stringify(jaExistentes.exemplos).slice(0, 2000)}
- Diretrizes ativas: ${JSON.stringify(jaExistentes.instrucoes).slice(0, 2000)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      temperature: 0.2,
      max_completion_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
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

    // Limpa grupos pendentes anteriores desta run
    await supabase.from("ia_auditorias_grupos").delete().eq("run_id", run_id).eq("status", "pendente");

    const { data: auditorias, error: errA } = await supabase
      .from("ia_auditorias")
      .select("id, severidade, diagnostico, problemas, flags_heuristicos, status")
      .eq("run_id", run_id)
      .in("severidade", ["warn", "critical"])
      .neq("status", "ignorado");
    if (errA) throw errA;

    const achados = (auditorias || []).filter((a: any) => a.status !== "aplicado").map((a: any) => ({
      id: a.id,
      severidade: a.severidade,
      diagnostico: (a.diagnostico || "").slice(0, 800),
      problemas: a.problemas || [],
      flags: a.flags_heuristicos || [],
    }));

    if (achados.length === 0) {
      return new Response(JSON.stringify({ grupos: [], total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: regras }, { data: exemplos }, { data: instr }] = await Promise.all([
      supabase.from("ia_regras_proibidas").select("regra").eq("ativo", true).limit(80),
      supabase.from("ia_exemplos").select("pergunta").eq("ativo", true).limit(80),
      supabase.from("ia_instrucoes_prompt").select("instrucao").eq("ativo", true).limit(80),
    ]);

    const decisao = await consolidar(achados, {
      regras: (regras || []).map((r: any) => r.regra),
      exemplos: (exemplos || []).map((e: any) => e.pergunta),
      instrucoes: (instr || []).map((i: any) => i.instrucao),
    });

    const gruposLLM = Array.isArray(decisao?.grupos) ? decisao.grupos : [];
    const validIds = new Set(achados.map((a) => a.id));
    const inseridos: any[] = [];

    for (const g of gruposLLM) {
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

    return new Response(JSON.stringify({ grupos: inseridos, total: inseridos.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-consolidar]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
