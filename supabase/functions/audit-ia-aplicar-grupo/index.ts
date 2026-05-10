// audit-ia-aplicar-grupo
// Aplica as ações propostas de um grupo de auditoria UMA ÚNICA VEZ e marca todas as auditorias do grupo como aplicado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { grupo_id } = await req.json();
    if (!grupo_id) {
      return new Response(JSON.stringify({ error: "grupo_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: grupo, error } = await supabase
      .from("ia_auditorias_grupos").select("*").eq("id", grupo_id).single();
    if (error || !grupo) throw error || new Error("grupo não encontrado");
    if (grupo.status === "aplicado") {
      return new Response(JSON.stringify({ error: "já aplicado" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acoes = Array.isArray(grupo.acoes_propostas) ? grupo.acoes_propostas : [];
    const auditoriaRef = (grupo.auditoria_ids || [])[0] || null;
    const aplicadas: any[] = [];

    for (const acao of acoes) {
      try {
        let alvoTabela = "";
        let alvoId: string | null = null;
        let payload: any = acao;

        if (acao.tipo === "regra_proibida" && acao.texto) {
          const { data } = await supabase.from("ia_regras_proibidas").insert({
            regra: acao.texto, categoria: acao.categoria || "informacao_falsa", ativo: true,
          }).select().single();
          alvoTabela = "ia_regras_proibidas"; alvoId = data?.id ?? null;
          payload = { regra: acao.texto, categoria: acao.categoria };
        } else if (acao.tipo === "exemplo" && acao.pergunta && acao.resposta_ideal) {
          const { data } = await supabase.from("ia_exemplos").insert({
            pergunta: acao.pergunta, resposta_ideal: acao.resposta_ideal,
            categoria: acao.categoria || "geral", ativo: true,
          }).select().single();
          alvoTabela = "ia_exemplos"; alvoId = data?.id ?? null;
        } else if (acao.tipo === "ajuste_prompt" && acao.instrucao) {
          const { data } = await supabase.from("ia_instrucoes_prompt").insert({
            instrucao: acao.instrucao, categoria: acao.categoria || "fluxo",
            origem: "auditoria", origem_ref: auditoriaRef, ativo: true,
          }).select().single();
          alvoTabela = "ia_instrucoes_prompt"; alvoId = data?.id ?? null;
        } else if (acao.tipo === "tarefa_ti" && acao.titulo) {
          try {
            const { data } = await supabase.from("tarefas").insert({
              titulo: acao.titulo, descricao: acao.descricao || "",
              status: "pendente", origem: "auditoria_ia",
            } as any).select().single();
            alvoId = data?.id ?? null;
          } catch (e) {
            console.warn("[tarefa_ti] insert falhou", e);
          }
          alvoTabela = "tarefas";
        } else {
          continue;
        }

        await supabase.from("ia_auditorias_acoes").insert({
          auditoria_id: auditoriaRef, tipo: acao.tipo,
          alvo_tabela: alvoTabela, alvo_id: alvoId,
          payload: { ...payload, grupo_id, consolidado: true },
        });
        aplicadas.push({ tipo: acao.tipo, alvo_id: alvoId });
      } catch (e: any) {
        console.error("[aplicar-grupo] falha em ação", acao, e?.message);
      }
    }

    await supabase.from("ia_auditorias_grupos").update({
      status: "aplicado", applied_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", grupo_id);

    if ((grupo.auditoria_ids || []).length > 0) {
      await supabase.from("ia_auditorias").update({
        status: "aplicado", updated_at: new Date().toISOString(),
      }).in("id", grupo.auditoria_ids);
    }

    return new Response(JSON.stringify({ aplicadas, total_conversas: (grupo.auditoria_ids || []).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-aplicar-grupo]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
