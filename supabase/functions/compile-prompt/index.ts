import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Validation keywords that MUST appear in the compiled prompt
const VALIDATION_KEYWORDS = [
  { keyword: "nunca invente", label: "anti-alucinação" },
  { keyword: "consultor", label: "terminologia" },
  { keyword: "3 frases", label: "concisão" },
  { keyword: "receita", label: "fluxo core" },
];

function validateCompiledPrompt(prompt: string): { valid: boolean; missing: string[] } {
  const normalized = prompt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const missing: string[] = [];
  for (const { keyword, label } of VALIDATION_KEYWORDS) {
    const kNorm = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!normalized.includes(kNorm)) {
      missing.push(`"${keyword}" (${label})`);
    }
  }
  return { valid: missing.length === 0, missing };
}

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

  try {
    // 1. Load all sources in parallel
    const [promptRes, exemplosRes, feedbacksRes] = await Promise.all([
      supabase.from("configuracoes_ia").select("valor").eq("chave", "prompt_atendimento").single(),
      supabase.from("ia_exemplos").select("categoria, pergunta, resposta_ideal").eq("ativo", true).order("created_at", { ascending: false }),
      supabase.from("ia_feedbacks").select("motivo, resposta_corrigida")
        .in("avaliacao", ["negativo", "corrigido"])
        .not("resposta_corrigida", "is", null)
        .order("created_at", { ascending: false }).limit(20),
    ]);

    const promptBase = promptRes.data?.valor || "";
    const exemplos = exemplosRes.data || [];
    const feedbacks = feedbacksRes.data || [];

    if (!promptBase) {
      return new Response(
        JSON.stringify({ error: "prompt_atendimento não encontrado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Build the meta-prompt for the compiler
    const metaPrompt = `Você é um engenheiro de prompts expert. Sua tarefa é reescrever o prompt de atendimento abaixo, incorporando os exemplos modelo e correções de feedbacks em um texto coeso, otimizado e profissional.

## REGRAS DO COMPILADOR

1. MANTENHA a identidade, tom e personalidade do prompt original intactos
2. INTEGRE os exemplos como padrões de resposta dentro das seções relevantes do prompt
3. INTEGRE as correções de feedbacks como regras aprendidas
4. MANTENHA seções Markdown com hierarquia clara:
   - # REGRAS DE ATENDIMENTO (espinha dorsal)
   - # EXEMPLOS INTEGRADOS (padrões aprendidos)
   - # CORREÇÕES APRENDIDAS (erros corrigidos)
5. PRESERVE literalmente todas as instruções sobre: preços, receitas, agendamentos, escalonamento
6. O prompt DEVE conter as seguintes frases/conceitos obrigatoriamente:
   - "NUNCA invente" (anti-alucinação)
   - "Consultor especializado" (terminologia oficial)
   - "3 frases" ou "máximo 3" (regra de concisão)
   - "receita" (fluxo core de orçamento)
7. INCLUA os seguintes marcadores de slot para dados dinâmicos (NÃO os preencha):
   - {{PROIBICOES}} — será substituído pelas regras proibidas literais em runtime
   - {{CONHECIMENTO}} — será substituído pela base de conhecimento em runtime
   - {{LOJAS}} — será substituído pelas lojas disponíveis em runtime
   - {{AGENDAMENTOS}} — será substituído pelos agendamentos do cliente em runtime
8. NÃO inclua regras proibidas no texto — elas serão injetadas literalmente via {{PROIBICOES}}
9. O resultado deve ser APENAS o prompt compilado, sem explicações ou comentários externos

## PROMPT ORIGINAL (espinha dorsal)

${promptBase}

## EXEMPLOS MODELO (${exemplos.length} ativos)

${exemplos.length > 0 
  ? exemplos.map((e: any) => `[${e.categoria}] Pergunta: "${e.pergunta}" → Resposta ideal: "${e.resposta_ideal}"`).join("\n")
  : "(nenhum exemplo cadastrado)"}

## FEEDBACKS CORRIGIDOS (${feedbacks.length} correções)

${feedbacks.length > 0
  ? feedbacks.map((f: any) => `- Erro: ${f.motivo || "não especificado"} → Correto: ${f.resposta_corrigida}`).join("\n")
  : "(nenhuma correção cadastrada)"}`;

    // 3. Call AI to compile
    console.log(`[COMPILE] Starting compilation: prompt=${promptBase.length}ch, exemplos=${exemplos.length}, feedbacks=${feedbacks.length}`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.3,
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: "Você é um compilador de prompts. Retorne APENAS o prompt compilado, sem explicações." },
          { role: "user", content: metaPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[COMPILE] AI error: ${aiResponse.status} ${errText}`);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const compiledPrompt = aiData.choices?.[0]?.message?.content?.trim();

    if (!compiledPrompt) {
      throw new Error("AI returned empty response");
    }

    // 4. Validate compiled prompt — auto-append missing critical rules instead of failing
    let finalPrompt = compiledPrompt;
    const validation = validateCompiledPrompt(finalPrompt);
    if (!validation.valid) {
      console.warn(`[COMPILE] Auto-appending missing rules: ${validation.missing.join(", ")}`);
      const CRITICAL_RULES_BLOCK = `\n\n# ⚠️ REGRAS CRÍTICAS DE SEGURANÇA\n\n- NUNCA invente informações, preços, prazos ou dados que não estejam na base de conhecimento\n- Você é um consultor especializado — nunca aja como robô genérico\n- Respostas com no máximo 3 frases — concisão é obrigatória\n- Sempre seguir o fluxo de receita antes de gerar orçamento`;
      finalPrompt = finalPrompt + CRITICAL_RULES_BLOCK;
      
      // Re-validate after append
      const revalidation = validateCompiledPrompt(finalPrompt);
      if (!revalidation.valid) {
        console.error(`[COMPILE] Still missing after auto-append: ${revalidation.missing.join(", ")}`);
        return new Response(
          JSON.stringify({ 
            error: "Validação falhou mesmo após auto-correção", 
            missing: revalidation.missing,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 5. Save current compiled as previous (for rollback)
    const { data: currentCompiled } = await supabase
      .from("configuracoes_ia")
      .select("valor")
      .eq("chave", "prompt_compilado")
      .single();

    if (currentCompiled?.valor) {
      // Load existing versions
      const { data: versionsRow } = await supabase
        .from("configuracoes_ia")
        .select("valor")
        .eq("chave", "prompt_versoes")
        .single();

      let versions: any[] = [];
      try {
        versions = versionsRow?.valor ? JSON.parse(versionsRow.valor) : [];
      } catch { versions = []; }

      // Keep last 5 versions
      versions.unshift({
        prompt: currentCompiled.valor,
        compiled_at: new Date().toISOString(),
        fontes: { exemplos: exemplos.length, feedbacks: feedbacks.length },
      });
      versions = versions.slice(0, 5);

      await upsertConfig(supabase, "prompt_versoes", JSON.stringify(versions));
    }

    // 6. Save compiled prompt and metadata
    await Promise.all([
      upsertConfig(supabase, "prompt_compilado", finalPrompt),
      upsertConfig(supabase, "prompt_compilado_at", new Date().toISOString()),
      upsertConfig(supabase, "prompt_compilado_fontes", JSON.stringify({
        exemplos: exemplos.length,
        feedbacks: feedbacks.length,
        prompt_base_length: promptBase.length,
      })),
    ]);

    console.log(`[COMPILE] Success: ${finalPrompt.length}ch compiled from ${promptBase.length}ch base + ${exemplos.length} exemplos + ${feedbacks.length} feedbacks`);

    return new Response(
      JSON.stringify({
        status: "ok",
        compiled_length: finalPrompt.length,
        fontes: { exemplos: exemplos.length, feedbacks: feedbacks.length },
        prompt_compilado: finalPrompt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[COMPILE] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function upsertConfig(supabase: any, chave: string, valor: string) {
  const { data: existing } = await supabase
    .from("configuracoes_ia")
    .select("id")
    .eq("chave", chave)
    .single();

  if (existing) {
    await supabase.from("configuracoes_ia").update({ valor, updated_at: new Date().toISOString() }).eq("chave", chave);
  } else {
    await supabase.from("configuracoes_ia").insert({ chave, valor });
  }
}
