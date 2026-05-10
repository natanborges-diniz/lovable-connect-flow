// audit-ia-aplicar-correcao
// Recebe { auditoria_id }. LLM "engenheiro de prompt" decide forma(s) de correção e aplica.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function classificar(auditoria: any): Promise<any> {
  const sys = `Você é engenheiro de prompts e qualidade de IA. Recebeu o diagnóstico de uma conversa em que a IA Gael (atendente da ótica) errou. Decida a(s) melhor(es) forma(s) de prevenir o erro no futuro.

OPÇÕES (pode combinar):
1. "regra_proibida": para conteúdos factualmente proibidos (preço de marca não negociada, promessa indevida, dado sensível). Texto deve ser uma regra imperativa curta. Ex: "NUNCA cite valores para a marca Kodak; sempre escale para humano."
2. "exemplo": para padrão de pergunta-resposta recorrente. Devolva pergunta_cliente_tipica + resposta_ideal. Categoria: lentes_contato, receita, agendamento, preco, geral...
3. "ajuste_prompt": para regras de fluxo/decisão. Texto vira bullet em "Diretrizes operacionais aprendidas". Ex: "NUNCA confirme uma receita ao cliente se algum campo (ESF, CIL, EIXO) for ?, unknown ou vazio — peça os valores por texto."
4. "tarefa_ti": apenas se exige código/integração nova (tool nova, bug). Forneça titulo e descricao técnicos.

Retorne JSON estrito:
{
 "acoes": [
   {"tipo":"regra_proibida","categoria":"informacao_falsa","texto":"..."},
   {"tipo":"exemplo","categoria":"...","pergunta":"...","resposta_ideal":"..."},
   {"tipo":"ajuste_prompt","categoria":"fluxo|tom|seguranca|fechamento","instrucao":"..."},
   {"tipo":"tarefa_ti","titulo":"...","descricao":"..."}
 ]
}

Princípios:
- Prefira ajuste_prompt para "a IA não deveria ter feito X" de fluxo.
- Prefira regra_proibida para conteúdo específico vetado.
- Prefira exemplo quando há um padrão de pergunta com resposta certa replicável.
- Combine quando útil (ex: regra + exemplo).
- Texto sempre em português, imperativo, conciso.`;

  const user = `DIAGNÓSTICO: ${auditoria.diagnostico || "(sem diagnóstico)"}

PROBLEMAS: ${JSON.stringify(auditoria.problemas || [])}

FLAGS HEURÍSTICOS: ${JSON.stringify(auditoria.flags_heuristicos || [])}

TRANSCRIÇÃO (resumo):
${(auditoria.transcricao_resumo || "").slice(0, 6000)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      temperature: 0.2,
      max_completion_tokens: 1500,
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
    const { auditoria_id } = await req.json();
    if (!auditoria_id) {
      return new Response(JSON.stringify({ error: "auditoria_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: auditoria, error } = await supabase
      .from("ia_auditorias").select("*").eq("id", auditoria_id).single();
    if (error || !auditoria) throw error || new Error("auditoria não encontrada");

    if (auditoria.status === "aplicado") {
      return new Response(JSON.stringify({ error: "já aplicado" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const decisao = await classificar(auditoria);
    const acoes = Array.isArray(decisao?.acoes) ? decisao.acoes : [];
    const aplicadas: any[] = [];

    for (const acao of acoes) {
      try {
        if (acao.tipo === "regra_proibida" && acao.texto) {
          const { data } = await supabase.from("ia_regras_proibidas").insert({
            regra: acao.texto,
            categoria: acao.categoria || "informacao_falsa",
            ativo: true,
          }).select().single();
          await supabase.from("ia_auditorias_acoes").insert({
            auditoria_id, tipo: "regra_proibida",
            alvo_tabela: "ia_regras_proibidas", alvo_id: data?.id,
            payload: { regra: acao.texto, categoria: acao.categoria },
          });
          aplicadas.push({ tipo: "regra_proibida", texto: acao.texto, alvo_id: data?.id });
        } else if (acao.tipo === "exemplo" && acao.pergunta && acao.resposta_ideal) {
          const { data } = await supabase.from("ia_exemplos").insert({
            pergunta: acao.pergunta,
            resposta_ideal: acao.resposta_ideal,
            categoria: acao.categoria || "geral",
            ativo: true,
          }).select().single();
          await supabase.from("ia_auditorias_acoes").insert({
            auditoria_id, tipo: "exemplo",
            alvo_tabela: "ia_exemplos", alvo_id: data?.id,
            payload: acao,
          });
          aplicadas.push({ tipo: "exemplo", pergunta: acao.pergunta, alvo_id: data?.id });
        } else if (acao.tipo === "ajuste_prompt" && acao.instrucao) {
          const { data } = await supabase.from("ia_instrucoes_prompt").insert({
            instrucao: acao.instrucao,
            categoria: acao.categoria || "fluxo",
            origem: "auditoria",
            origem_ref: auditoria_id,
            ativo: true,
          }).select().single();
          await supabase.from("ia_auditorias_acoes").insert({
            auditoria_id, tipo: "ajuste_prompt",
            alvo_tabela: "ia_instrucoes_prompt", alvo_id: data?.id,
            payload: acao,
          });
          aplicadas.push({ tipo: "ajuste_prompt", instrucao: acao.instrucao, alvo_id: data?.id });
        } else if (acao.tipo === "tarefa_ti" && acao.titulo) {
          // Tenta inserir tarefa; se a tabela tarefas tem schema diferente, salva só o registro de ação
          let alvoId: string | null = null;
          try {
            const { data } = await supabase.from("tarefas").insert({
              titulo: acao.titulo,
              descricao: acao.descricao || "",
              status: "pendente",
              origem: "auditoria_ia",
            } as any).select().single();
            alvoId = data?.id ?? null;
          } catch (e) {
            console.warn("[tarefa_ti] insert falhou, registrando só payload", e);
          }
          await supabase.from("ia_auditorias_acoes").insert({
            auditoria_id, tipo: "tarefa_ti",
            alvo_tabela: "tarefas", alvo_id: alvoId,
            payload: acao,
          });
          aplicadas.push({ tipo: "tarefa_ti", titulo: acao.titulo, alvo_id: alvoId });
        }
      } catch (e: any) {
        console.error("[apply] falha em ação", acao, e?.message);
      }
    }

    await supabase.from("ia_auditorias").update({
      status: "aplicado",
      updated_at: new Date().toISOString(),
    }).eq("id", auditoria_id);

    return new Response(JSON.stringify({ aplicadas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-aplicar-correcao]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
