// Loja (ou admin) responde "Tem / Não tem". Atualiza card, move coluna,
// posta msg na thread, encerra demanda, notifica solicitante.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  confirmacao_id: z.string().uuid(),
  resposta: z.enum(["sim", "nao"]),
  observacao: z.string().trim().max(500).optional().nullable(),
});

const SETOR_ID = "0e7b7572-4581-4e74-88eb-afca41ab71cf";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SRK);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { confirmacao_id, resposta, observacao } = parsed.data;

    const { data: card, error: cardErr } = await supabase
      .from("confirmacoes_estoque").select("*").eq("id", confirmacao_id).single();
    if (cardErr || !card) throw new Error("Confirmação não encontrada");
    if (card.status !== "aguardando") {
      return new Response(JSON.stringify({ error: "Já respondida", status: card.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Coluna alvo
    const tipoAcaoAlvo = resposta === "sim" ? "confirmacao_estoque_ok" : "confirmacao_estoque_sem";
    const { data: colunaAlvo } = await supabase
      .from("pipeline_colunas")
      .select("id")
      .eq("setor_id", SETOR_ID)
      .eq("tipo_acao", tipoAcaoAlvo)
      .maybeSingle();
    if (!colunaAlvo) throw new Error("Coluna alvo não encontrada");

    const { data: profile } = await supabase
      .from("profiles").select("nome").eq("id", user.id).maybeSingle();
    const autorNome = profile?.nome || user.email || "Loja";

    // 1) Atualiza o card
    await supabase.from("confirmacoes_estoque").update({
      status: resposta === "sim" ? "confirmada" : "sem_estoque",
      resposta_loja: resposta,
      resposta_observacao: observacao ?? null,
      respondida_por: user.id,
      respondida_at: new Date().toISOString(),
      pipeline_coluna_id: colunaAlvo.id,
      proximo_lembrete_at: null,
    }).eq("id", confirmacao_id);

    // 2) Mensagem formatada na thread da demanda
    if (card.demanda_id) {
      const icone = resposta === "sim" ? "✅" : "❌";
      const titulo = resposta === "sim" ? "Tenho a peça" : "Não tenho a peça";
      const conteudo = `${icone} *${titulo}* — ${card.protocolo}` +
        (observacao && observacao.trim() ? `\n📝 ${observacao.trim()}` : "");

      await supabase.from("demanda_mensagens").insert({
        demanda_id: card.demanda_id,
        direcao: "loja_para_operador",
        autor_id: user.id,
        autor_nome: autorNome,
        conteudo,
        metadata: { confirmacao_resposta: resposta, confirmacao_estoque_id: confirmacao_id },
      });

      // 3) Encerra a demanda (pela loja)
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/encerrar-demanda-loja`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-caller": "responder-confirmacao-estoque",
            "Authorization": `Bearer ${SRK}`,
          },
          body: JSON.stringify({ demanda_id: card.demanda_id, encerrado_por: "loja" }),
        });
      } catch (e) {
        console.warn("Falha encerrar-demanda-loja:", e);
      }
    }

    // 4) Notifica solicitante (estoquista)
    if (card.solicitante_id) {
      const msg = resposta === "sim"
        ? `${card.loja_nome} confirmou a peça REF ${card.referencia}.`
        : `${card.loja_nome} informou que NÃO tem a peça REF ${card.referencia}.`;
      await supabase.from("notificacoes").insert({
        usuario_id: card.solicitante_id,
        tipo: "confirmacao_estoque_resposta",
        titulo: `${resposta === "sim" ? "✅" : "❌"} ${card.protocolo} — ${card.loja_nome}`,
        mensagem: msg + (observacao ? ` Obs: ${observacao}` : ""),
        referencia_id: card.id,
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[responder-confirmacao-estoque] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
