// Reabertura de demanda de Confirmação PIX pela loja.
// Chamado pelo app InFoco Messenger quando a loja clica "Pedir nova conferência"
// no card que está em "PIX Não Confirmado". Move o mesmo card de volta para
// "Confirmação PIX", reativa a solicitação e notifica o setor Financeiro.
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

    // ── Auth ──
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const solicitacaoId: string = body.solicitacao_id;
    if (!solicitacaoId) {
      return new Response(JSON.stringify({ error: "solicitacao_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Carrega a solicitação ──
    const { data: sol, error: sErr } = await supabase
      .from("solicitacoes")
      .select("id, tipo, status, pipeline_coluna_id, contato_id, metadata, protocolo")
      .eq("id", solicitacaoId)
      .maybeSingle();
    if (sErr || !sol) {
      return new Response(JSON.stringify({ error: "Solicitação não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sol.tipo !== "confirmacao_pix") {
      return new Response(JSON.stringify({ error: "Solicitação não é de confirmação PIX" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve setor Financeiro e colunas ──
    const { data: setor } = await supabase
      .from("setores").select("id").eq("nome", "Financeiro").maybeSingle();
    if (!setor) {
      return new Response(JSON.stringify({ error: "Setor Financeiro não encontrado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: cols } = await supabase
      .from("pipeline_colunas")
      .select("id, nome")
      .eq("setor_id", setor.id)
      .eq("ativo", true);
    const colNaoConf = (cols || []).find((c: any) => c.nome === "PIX Não Confirmado");
    const colConf = (cols || []).find((c: any) => c.nome === "Confirmação PIX");
    if (!colConf) {
      return new Response(JSON.stringify({ error: "Coluna 'Confirmação PIX' não encontrada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Só permite reabrir se estiver em "PIX Não Confirmado"
    if (colNaoConf && sol.pipeline_coluna_id !== colNaoConf.id) {
      return new Response(JSON.stringify({
        error: "Só é possível pedir nova conferência quando o card está em 'PIX Não Confirmado'",
        coluna_atual_id: sol.pipeline_coluna_id,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const colunaAnterior = sol.pipeline_coluna_id;
    const now = new Date().toISOString();
    const meta = (sol.metadata || {}) as Record<string, unknown>;
    const tentativas = Number(meta.reaberturas_loja || 0) + 1;

    // ── Move card de volta + reativa status ──
    await supabase.from("solicitacoes").update({
      pipeline_coluna_id: colConf.id,
      status: "em_atendimento",
      metadata: {
        ...meta,
        reaberturas_loja: tentativas,
        ultima_reabertura_loja_at: now,
        ultima_reabertura_loja_por: user.id,
      },
    }).eq("id", sol.id);

    // ── Comentário automático na thread ──
    await supabase.from("solicitacao_comentarios").insert({
      solicitacao_id: sol.id,
      tipo: "sistema",
      autor_nome: "Loja",
      conteudo: `Loja pediu nova conferência em ${new Date(now).toLocaleString("pt-BR")}.`,
    } as any);

    // ── Evento no histórico do card ──
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: sol.id,
      tipo: "reabertura_loja",
      descricao: `Loja pediu nova conferência de PIX (tentativa #${tentativas})`,
      coluna_anterior_id: colunaAnterior,
      coluna_nova_id: colConf.id,
      usuario_id: user.id,
      metadata: { motivo: "reabertura_pix" },
    } as any);

    // ── Notifica o setor Financeiro (notificação útil: é reabertura manual) ──
    const lojaNome = (meta.alias_loja as string) || (meta.loja_nome as string) || "Loja";
    await supabase.from("notificacoes").insert({
      setor_id: setor.id,
      tipo: "solicitacao",
      titulo: `🔁 Nova conferência de PIX — ${lojaNome}`,
      mensagem: `Protocolo ${sol.protocolo || "—"} | Tentativa #${tentativas}`,
      referencia_id: sol.id,
    } as any);

    return new Response(JSON.stringify({
      status: "ok",
      solicitacao_id: sol.id,
      tentativas,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("reabrir-confirmacao-pix error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
