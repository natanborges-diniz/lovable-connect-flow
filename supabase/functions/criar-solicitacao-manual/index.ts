// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_TIPOS_FINANCEIRO = ["pagamento", "reembolso", "cobranca", "estorno_cartao", "estorno_pix_debito", "outro"];
const ALLOWED_TIPOS_TI = ["impressoes", "suporte", "equipamento", "outro"];

async function generateProtocolo(supabase: any, solicitacaoId: string): Promise<string> {
  const ano = new Date().getFullYear();
  const { data: seqResult } = await supabase.rpc("nextval_protocolo", {});
  const seq = seqResult != null ? Number(seqResult) : (Date.now() % 100000);
  const protocolo = `SOL-${ano}-${String(seq).padStart(5, "0")}`;
  await supabase.from("solicitacoes").update({ protocolo }).eq("id", solicitacaoId);
  return protocolo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate user via anon client
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { contato_id, contato_nome, assunto, tipo, descricao, destino, coluna_destino_id } = body || {};

    // Validate inputs
    if (!contato_id || typeof contato_id !== "string") {
      return new Response(JSON.stringify({ error: "contato_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!assunto || typeof assunto !== "string" || assunto.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Assunto deve ter ao menos 3 caracteres" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!tipo || typeof tipo !== "string") {
      return new Response(JSON.stringify({ error: "Tipo obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!descricao || typeof descricao !== "string" || descricao.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Descrição obrigatória (mínimo 5 caracteres)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!coluna_destino_id || typeof coluna_destino_id !== "string") {
      return new Response(JSON.stringify({ error: "coluna_destino_id obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowed = destino === "ti" ? ALLOWED_TIPOS_TI : ALLOWED_TIPOS_FINANCEIRO;
    if (!allowed.includes(tipo)) {
      return new Response(JSON.stringify({ error: `Tipo inválido para ${destino}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve operator name
    const { data: profile } = await admin
      .from("profiles")
      .select("nome, email")
      .eq("id", userId)
      .maybeSingle();
    const operadorNome = profile?.nome || profile?.email || "Operador";

    // Insert solicitação
    const { data: sol, error: insErr } = await admin
      .from("solicitacoes")
      .insert({
        contato_id,
        assunto: assunto.trim(),
        tipo,
        descricao: descricao.trim(),
        pipeline_coluna_id: coluna_destino_id,
        canal_origem: "manual_operador",
        status: "aberta",
        created_by: userId,
        metadata: {
          origem_manual: true,
          aberto_por: userId,
          aberto_por_nome: operadorNome,
          destino_pipeline: destino,
          contato_nome: contato_nome || null,
        },
      })
      .select("id")
      .single();

    if (insErr || !sol) {
      console.error("[criar-solicitacao-manual] insert error:", insErr);
      return new Response(JSON.stringify({ error: insErr?.message || "Falha ao criar solicitação" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Protocolo
    const protocolo = await generateProtocolo(admin, sol.id);

    // Pipeline event
    await admin.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: sol.id,
      tipo: "criacao_manual",
      descricao: `Solicitação criada manualmente por ${operadorNome} (${protocolo}) — ${assunto.trim()}`,
      coluna_nova_id: coluna_destino_id,
      usuario_id: userId,
      usuario_nome: operadorNome,
      metadata: { tipo, destino, protocolo },
    });

    return new Response(JSON.stringify({ ok: true, solicitacao_id: sol.id, protocolo }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[criar-solicitacao-manual] unhandled:", e);
    return new Response(JSON.stringify({ error: e?.message || "Erro inesperado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
