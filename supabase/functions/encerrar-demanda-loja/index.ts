import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-caller",
};

type EncerradoPor = "operador" | "loja" | "auto";

function buildClosingMessage(protocolo: string, by: EncerradoPor, motivo?: string): string {
  switch (by) {
    case "loja":
      return [
        `✅ *Demanda ${protocolo} encerrada por você.*`,
        ``,
        `Para uma nova solicitação, digite *menu*.`,
      ].join("\n");
    case "auto":
      return [
        `⏰ *Demanda ${protocolo} encerrada automaticamente* por inatividade (30min sem atividade).`,
        ``,
        `Para uma nova solicitação, digite *menu*.`,
      ].join("\n");
    case "operador":
    default:
      return [
        `✅ *Demanda ${protocolo} encerrada* pelo operador${motivo ? `: ${motivo}` : ""}.`,
        `Obrigado pelo retorno!`,
        ``,
        `Para uma nova solicitação, digite *menu*.`,
      ].join("\n");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { demanda_id, motivo } = body;
    const encerrado_por: EncerradoPor = (body.encerrado_por as EncerradoPor) || "operador";
    const internalCaller = req.headers.get("X-Internal-Caller");

    if (!demanda_id) {
      return new Response(JSON.stringify({ error: "demanda_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: operador requer JWT; loja/auto vêm de chamadas internas com service-role.
    let operadorNome = "Sistema";
    if (encerrado_por === "operador") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      const user = userData?.user;
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: profile } = await supabase
        .from("profiles").select("nome").eq("id", user.id).single();
      operadorNome = profile?.nome || user.email || "Operador";
    } else if (!internalCaller) {
      // loja/auto só podem ser chamadas internamente
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // Mark as closed
    await supabase
      .from("demandas_loja")
      .update({ status: "encerrada", encerrada_at: new Date().toISOString() })
      .eq("id", demanda_id);

    // System note in thread
    let notaSistema = "";
    if (encerrado_por === "loja") notaSistema = `🔚 Demanda encerrada pela loja (#encerrademanda).`;
    else if (encerrado_por === "auto") notaSistema = `⏰ Demanda encerrada automaticamente por inatividade (30min).`;
    else notaSistema = `✅ Demanda encerrada por ${operadorNome}${motivo ? `: ${motivo}` : ""}.`;

    await supabase.from("demanda_mensagens").insert({
      demanda_id,
      direcao: "sistema",
      autor_nome: "Sistema",
      conteudo: notaSistema,
      metadata: { encerrado_por },
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
      const waMessage = buildClosingMessage(demanda.protocolo, encerrado_por, motivo);
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

    // Notifica operador quando loja/auto encerrou
    if (encerrado_por !== "operador" && demanda.solicitante_id) {
      const titulo = encerrado_por === "loja"
        ? `Loja encerrou demanda ${demanda.protocolo}`
        : `Demanda ${demanda.protocolo} auto-encerrada (inatividade)`;
      const mensagem = encerrado_por === "loja"
        ? `${demanda.loja_nome} encerrou a demanda enviando #encerrademanda.`
        : `${demanda.loja_nome} ficou 30min sem atividade — demanda foi encerrada automaticamente.`;
      await supabase.from("notificacoes").insert({
        usuario_id: demanda.solicitante_id,
        tipo: "demanda_encerrada",
        titulo,
        mensagem,
        referencia_id: demanda_id,
      }).then(() => {}, (e: any) => console.error("[encerrar-demanda] notif failed:", e));
    }

    return new Response(JSON.stringify({ status: "ok", demanda_id, encerrado_por }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("encerrar-demanda-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
