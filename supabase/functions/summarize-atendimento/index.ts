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

    const { atendimento_id } = await req.json();
    if (!atendimento_id) throw new Error("atendimento_id is required");

    // Fetch messages
    const { data: mensagens, error: msgErr } = await supabase
      .from("mensagens")
      .select("*")
      .eq("atendimento_id", atendimento_id)
      .order("created_at", { ascending: true });
    if (msgErr) throw msgErr;

    if (!mensagens?.length) {
      return new Response(JSON.stringify({ resumo: "Nenhuma mensagem para resumir." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch atendimento context
    const { data: atendimento } = await supabase
      .from("atendimentos")
      .select("*, contato:contatos(nome, tipo), solicitacao:solicitacoes(assunto, descricao)")
      .eq("id", atendimento_id)
      .single();

    const historico = mensagens.map(m => {
      const dir = m.direcao === "inbound" ? "Cliente" : m.direcao === "internal" ? "[Nota Interna]" : "Operador";
      return `${dir} (${m.remetente_nome || "—"}): ${m.conteudo}`;
    }).join("\n");

    const prompt = `Resuma o atendimento abaixo em NO MÁXIMO 3 frases curtas. Texto corrido, sem markdown, sem títulos, sem listas, sem bullets.

Contexto:
- Solicitação: ${atendimento?.solicitacao?.assunto || "N/A"}
- Contato: ${atendimento?.contato?.nome || "N/A"}
- Canal: ${atendimento?.canal || "N/A"}

Histórico:
${historico}

Formato: "[Motivo do contato]. [O que foi feito]. [Pendência/próximo passo]."

Exemplo: "Cliente quer status de óculos não retirado (CPF informado). IA escalou para consultor da loja. Aguardando retorno."`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Você gera resumos ULTRA-CURTOS (máx 3 frases) de atendimentos. Sem markdown, sem listas, sem títulos. Apenas texto corrido objetivo." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limit excedido, tente novamente." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos insuficientes." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway error [${status}]: ${body}`);
    }

    const aiData = await response.json();
    const resumo = aiData.choices?.[0]?.message?.content || "Não foi possível gerar o resumo.";

    // Save resumo in atendimento metadata
    const currentMeta = atendimento?.metadata || {};
    await supabase
      .from("atendimentos")
      .update({ metadata: { ...currentMeta, resumo_ia: resumo, resumo_gerado_em: new Date().toISOString() } })
      .eq("id", atendimento_id);

    return new Response(JSON.stringify({ success: true, resumo }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("summarize error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
