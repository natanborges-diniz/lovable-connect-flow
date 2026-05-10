// audit-ia-desfazer-acao — desativa o alvo e marca ação como desfeita
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { acao_id, user_id } = await req.json();
    const { data: acao, error } = await supabase.from("ia_auditorias_acoes").select("*").eq("id", acao_id).single();
    if (error || !acao) throw error || new Error("ação não encontrada");
    if (acao.desfeita) {
      return new Response(JSON.stringify({ error: "já desfeita" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (acao.alvo_id) {
      if (["ia_regras_proibidas", "ia_exemplos", "ia_instrucoes_prompt"].includes(acao.alvo_tabela)) {
        await supabase.from(acao.alvo_tabela).update({ ativo: false }).eq("id", acao.alvo_id);
      } else if (acao.alvo_tabela === "tarefas") {
        await supabase.from("tarefas").update({ status: "cancelada" } as any).eq("id", acao.alvo_id);
      }
    }

    await supabase.from("ia_auditorias_acoes").update({
      desfeita: true, desfeita_at: new Date().toISOString(), desfeita_por: user_id || null,
    }).eq("id", acao_id);

    // Se todas ações da auditoria foram desfeitas, volta status pra pendente
    const { data: restantes } = await supabase
      .from("ia_auditorias_acoes").select("id").eq("auditoria_id", acao.auditoria_id).eq("desfeita", false);
    if (!restantes || restantes.length === 0) {
      await supabase.from("ia_auditorias").update({ status: "pendente" }).eq("id", acao.auditoria_id);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
