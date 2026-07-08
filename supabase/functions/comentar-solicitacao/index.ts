// Diálogo livre setor ↔ loja dentro de uma solicitação.
// Cria solicitacao_comentarios + notificacoes (push) para o outro lado.
// NÃO altera status/coluna do card.
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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const solicitacao_id: string = body.solicitacao_id;
    const conteudo: string = (body.conteudo || "").trim();
    const destino: "loja" | "setor" = body.destino;

    if (!solicitacao_id || !conteudo || !["loja", "setor"].includes(destino)) {
      return new Response(JSON.stringify({ error: "solicitacao_id, conteudo e destino (loja|setor) são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sol, error: solErr } = await supabase
      .from("solicitacoes")
      .select("id, protocolo, assunto, metadata, pipeline_coluna_id, created_by")
      .eq("id", solicitacao_id)
      .single();
    if (solErr || !sol) throw new Error("Solicitação não encontrada");

    const { data: profile } = await supabase
      .from("profiles").select("nome").eq("id", user.id).single();
    const autorNome = profile?.nome || user.email || "Usuário";

    const tipo = destino === "loja" ? "retorno_setor" : "resposta_loja";

    const { data: coment, error: cErr } = await supabase
      .from("solicitacao_comentarios")
      .insert({
        solicitacao_id,
        autor_id: user.id,
        autor_nome: autorNome,
        conteudo,
        tipo,
      })
      .select()
      .single();
    if (cErr) throw cErr;

    const meta = (sol.metadata || {}) as Record<string, any>;
    const protocolo = sol.protocolo || solicitacao_id.slice(0, 8);
    const titulo = destino === "loja"
      ? `Retorno do setor — ${protocolo}`
      : `Loja respondeu — ${protocolo}`;
    const mensagem = `${autorNome}: ${conteudo.slice(0, 140)}`;

    // Resolve destinatários
    const usuariosDest: Array<{ user_id: string; setor_id: string | null }> = [];

    if (destino === "loja") {
      const lojaNome = meta.alias_loja || meta.loja_nome;
      if (!lojaNome) throw new Error("Solicitação sem loja_nome/alias_loja em metadata");
      const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
      for (const d of (dests || []) as any[]) usuariosDest.push({ user_id: d.user_id, setor_id: d.setor_id });
    } else {
      // destino=setor: resolver operadores do setor do card via pipeline_colunas.setor_id
      let setorId: string | null = null;
      if (sol.pipeline_coluna_id) {
        const { data: col } = await supabase
          .from("pipeline_colunas").select("setor_id").eq("id", sol.pipeline_coluna_id).single();
        setorId = col?.setor_id || null;
      }
      if (setorId) {
        const { data: acessos } = await supabase
          .from("user_acessos").select("user_id, setores, acesso_total");
        for (const a of (acessos || []) as any[]) {
          const setores = Array.isArray(a.setores) ? a.setores : [];
          if (a.acesso_total || setores.includes(setorId)) {
            usuariosDest.push({ user_id: a.user_id, setor_id: setorId });
          }
        }
      }
      // Fallback: criador da solicitação (operador que abriu ou moveu)
      if (usuariosDest.length === 0 && sol.created_by) {
        usuariosDest.push({ user_id: sol.created_by, setor_id: setorId });
      }
    }

    // Dedup + evita notificar o próprio autor
    const seen = new Set<string>([user.id]);
    const notifs = usuariosDest
      .filter((d) => {
        if (seen.has(d.user_id)) return false;
        seen.add(d.user_id);
        return true;
      })
      .map((d) => ({
        usuario_id: d.user_id,
        setor_id: d.setor_id,
        tipo: destino === "loja" ? "retorno_setor" : "resposta_loja",
        titulo,
        mensagem,
        referencia_id: solicitacao_id,
      }));

    if (notifs.length > 0) {
      await supabase.from("notificacoes").insert(notifs);
    }

    return new Response(JSON.stringify({
      status: "ok",
      comentario_id: coment.id,
      notificados: notifs.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("comentar-solicitacao error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
