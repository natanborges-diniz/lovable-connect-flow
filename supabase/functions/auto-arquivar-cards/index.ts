// Auto-arquivamento de cards em colunas terminais.
// - Critério: solicitacao.pipeline_coluna_id em coluna com terminal=true
//   E updated_at < now() - dias_auto_arquivar (default 7)
//   E metadata->>'arquivado_at' IS NULL
// - Ação: marca metadata.arquivado_at = now()
//         Não move de coluna, não muda status — só esconde da UI por padrão.
// - Rastreabilidade: registra pipeline_card_eventos tipo "card_arquivado".
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE);

    const { data: colunas, error: colErr } = await supabase
      .from("pipeline_colunas")
      .select("id, nome, setor_id, dias_auto_arquivar")
      .eq("terminal", true)
      .eq("ativo", true);
    if (colErr) throw colErr;

    let totalArquivados = 0;
    const detalhes: Array<{ coluna: string; arquivados: number }> = [];

    for (const col of colunas || []) {
      const dias = Math.max(0, col.dias_auto_arquivar ?? 7);
      const cutoff = new Date(Date.now() - dias * 86400000).toISOString();

      const { data: cards, error } = await supabase
        .from("solicitacoes")
        .select("id, metadata, updated_at")
        .eq("pipeline_coluna_id", col.id)
        .lt("updated_at", cutoff)
        .limit(500);
      if (error) {
        console.error(`[auto-arquivar-cards] erro coluna ${col.nome}`, error);
        continue;
      }

      const pendentes = (cards || []).filter((c: any) => !c.metadata?.arquivado_at);
      let arquivadosCol = 0;
      for (const c of pendentes) {
        const novoMeta = { ...(c.metadata || {}), arquivado_at: new Date().toISOString(), arquivado_motivo: `auto:${dias}d_em_${col.nome}` };
        const { error: uErr } = await supabase
          .from("solicitacoes")
          .update({ metadata: novoMeta })
          .eq("id", c.id);
        if (uErr) {
          console.error(`[auto-arquivar-cards] update ${c.id}`, uErr);
          continue;
        }
        await supabase.from("pipeline_card_eventos").insert({
          entidade: "solicitacao",
          entidade_id: c.id,
          tipo: "card_arquivado",
          descricao: `Auto-arquivado após ${dias} dias em "${col.nome}"`,
          coluna_anterior_id: col.id,
          coluna_nova_id: col.id,
          usuario_nome: "Sistema",
          metadata: { auto: true, dias, coluna_nome: col.nome },
        });
        arquivadosCol++;
      }
      totalArquivados += arquivadosCol;
      detalhes.push({ coluna: col.nome, arquivados: arquivadosCol });
    }

    return new Response(JSON.stringify({ ok: true, total_arquivados: totalArquivados, detalhes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[auto-arquivar-cards] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
