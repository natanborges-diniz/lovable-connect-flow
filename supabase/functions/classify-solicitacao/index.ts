import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { solicitacao_id } = await req.json();
    if (!solicitacao_id) throw new Error("solicitacao_id is required");

    // Fetch solicitação with contato
    const { data: solicitacao, error: fetchErr } = await supabase
      .from("solicitacoes")
      .select("*, contato:contatos(nome, tipo)")
      .eq("id", solicitacao_id)
      .single();
    if (fetchErr) throw fetchErr;

    // Fetch setores and filas for routing suggestion
    const { data: filas } = await supabase
      .from("filas")
      .select("id, nome, tipo, setor:setores(id, nome)")
      .eq("ativo", true);

    const filasInfo = filas?.map(f => `${(f.setor as any)?.nome} > ${f.nome} (${f.tipo}, id: ${f.id})`).join("\n") || "Nenhuma fila cadastrada";

    const prompt = `Você é um classificador de solicitações para uma rede de óticas. Analise a solicitação abaixo e retorne a classificação.

Solicitação:
- Assunto: ${solicitacao.assunto}
- Descrição: ${solicitacao.descricao || "Sem descrição"}
- Canal: ${solicitacao.canal_origem}
- Contato: ${solicitacao.contato?.nome} (${solicitacao.contato?.tipo})

Filas disponíveis para roteamento:
${filasInfo}

Classifique com:
1. tipo: categoria da solicitação (ex: troca, dúvida, reclamação, financeiro, garantia, agendamento, outro)
2. prioridade: critica, alta, normal ou baixa
3. fila_atendimento_id: UUID da fila de atendimento mais adequada (ou null)
4. fila_execucao_id: UUID da fila de execução mais adequada (ou null)
5. confianca: número de 0 a 1 indicando confiança da classificação
6. justificativa: breve explicação da classificação`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você é um assistente de classificação de solicitações. Responda SOMENTE com o JSON solicitado." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classificar_solicitacao",
              description: "Classifica uma solicitação com tipo, prioridade e roteamento",
              parameters: {
                type: "object",
                properties: {
                  tipo: { type: "string", description: "Categoria da solicitação" },
                  prioridade: { type: "string", enum: ["critica", "alta", "normal", "baixa"] },
                  fila_atendimento_id: { type: "string", nullable: true, description: "UUID da fila de atendimento" },
                  fila_execucao_id: { type: "string", nullable: true, description: "UUID da fila de execução" },
                  confianca: { type: "number", minimum: 0, maximum: 1 },
                  justificativa: { type: "string" },
                },
                required: ["tipo", "prioridade", "confianca", "justificativa"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classificar_solicitacao" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit excedido, tente novamente em alguns segundos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos em Settings > Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error [${status}]: ${body}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned from AI");

    const classificacao = JSON.parse(toolCall.function.arguments);

    // Update solicitação
    const updateData: Record<string, unknown> = {
      tipo: classificacao.tipo,
      prioridade: classificacao.prioridade,
      classificacao_ia: classificacao,
    };

    // Auto-classify if confidence > 0.8
    if (classificacao.confianca > 0.8 && solicitacao.status === "aberta") {
      updateData.status = "classificada";
    }

    const { error: updateErr } = await supabase
      .from("solicitacoes")
      .update(updateData)
      .eq("id", solicitacao_id);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ success: true, classificacao }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
