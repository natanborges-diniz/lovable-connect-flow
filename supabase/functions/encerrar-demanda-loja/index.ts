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

    const { demanda_id, motivo } = await req.json();
    if (!demanda_id) {
      return new Response(JSON.stringify({ error: "demanda_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .select("*")
      .eq("id", demanda_id)
      .single();
    if (demErr || !demanda) throw new Error("Demanda não encontrada");

    if (demanda.status === "encerrada") {
      return new Response(JSON.stringify({ status: "already_closed", demanda_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles").select("nome").eq("id", user.id).single();
    const operadorNome = profile?.nome || user.email || "Operador";

    // Mark as closed
    await supabase
      .from("demandas_loja")
      .update({ status: "encerrada", encerrada_at: new Date().toISOString() })
      .eq("id", demanda_id);

    // System note in thread
    await supabase.from("demanda_mensagens").insert({
      demanda_id,
      direcao: "sistema",
      autor_nome: "Sistema",
      conteudo: `✅ Demanda encerrada por ${operadorNome}${motivo ? `: ${motivo}` : ""}.`,
    });

    // Notify the store via WhatsApp (best-effort, via the store's atendimento)
    const cleanPhone = String(demanda.loja_telefone).replace(/\D/g, "");
    const { data: storeContato } = await supabase
      .from("contatos").select("id").eq("telefone", cleanPhone).limit(1).maybeSingle();

    let storeAtendimentoId: string | null = null;
    if (storeContato) {
      const { data: openAt } = await supabase
        .from("atendimentos")
        .select("id")
        .eq("contato_id", storeContato.id)
        .eq("canal", "whatsapp")
        .neq("status", "encerrado")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      storeAtendimentoId = openAt?.id || null;
    }

    if (storeAtendimentoId) {
      const waMessage = [
        `✅ *Demanda ${demanda.protocolo} encerrada* pelo operador.`,
        `Obrigado pelo retorno!`,
        ``,
        `Para uma nova solicitação, digite *menu*.`,
      ].join("\n");

      await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          atendimento_id: storeAtendimentoId,
          texto: waMessage,
          remetente_nome: "Sistema",
          force_provider: "evolution_api",
        }),
      }).catch((e) => console.error("[encerrar-demanda] WA notify failed:", e));

      // Reset bot session so next message starts fresh menu
      await supabase
        .from("bot_sessoes")
        .update({ status: "concluido" })
        .eq("atendimento_id", storeAtendimentoId)
        .eq("status", "ativo");
    }

    return new Response(JSON.stringify({ status: "ok", demanda_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("encerrar-demanda-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
