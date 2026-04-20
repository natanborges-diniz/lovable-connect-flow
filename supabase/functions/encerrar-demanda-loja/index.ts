// CANAL ÚNICO: encerramento de demanda só notifica via app Atrium Messenger
// (notificacoes + mensagens_internas). NENHUMA mensagem WhatsApp é disparada.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-caller",
};

type EncerradoPor = "operador" | "loja" | "auto";

function makeConversaId(a: string, b: string) {
  return [a, b].sort().join("_");
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

    let operadorNome = "Sistema";
    let operadorId: string | null = null;
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
      operadorId = user.id;
      const { data: profile } = await supabase
        .from("profiles").select("nome").eq("id", user.id).single();
      operadorNome = profile?.nome || user.email || "Operador";
    } else if (!internalCaller) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja").select("*").eq("id", demanda_id).single();
    if (demErr || !demanda) throw new Error("Demanda não encontrada");

    if (demanda.status === "encerrada") {
      return new Response(JSON.stringify({ status: "already_closed", demanda_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("demandas_loja")
      .update({ status: "encerrada", encerrada_at: new Date().toISOString() })
      .eq("id", demanda_id);

    let notaSistema = "";
    if (encerrado_por === "loja") notaSistema = `🔚 Demanda encerrada pela loja.`;
    else if (encerrado_por === "auto") notaSistema = `⏰ Demanda encerrada automaticamente por inatividade.`;
    else notaSistema = `✅ Demanda encerrada por ${operadorNome}${motivo ? `: ${motivo}` : ""}.`;

    await supabase.from("demanda_mensagens").insert({
      demanda_id,
      direcao: "sistema",
      autor_nome: "Sistema",
      conteudo: notaSistema,
      metadata: { encerrado_por },
    });

    // Notificações via app Atrium Messenger
    const titulo = `Demanda ${demanda.protocolo} encerrada`;
    const mensagemBody = encerrado_por === "operador"
      ? `${operadorNome} encerrou a demanda${motivo ? ` (${motivo})` : ""}.`
      : encerrado_por === "loja"
      ? `Loja ${demanda.loja_nome} encerrou a demanda.`
      : `Demanda auto-encerrada por inatividade (${demanda.loja_nome}).`;

    // Notifica o solicitante (operador que abriu) quando loja/auto encerrou
    if (encerrado_por !== "operador" && demanda.solicitante_id) {
      await supabase.from("notificacoes").insert({
        usuario_id: demanda.solicitante_id,
        tipo: "demanda_encerrada",
        titulo,
        mensagem: mensagemBody,
        referencia_id: demanda_id,
      });
    }

    // Notifica destinatários internos da loja quando operador encerrou
    if (encerrado_por === "operador") {
      const { data: dests } = await supabase
        .rpc("resolver_destinatarios_loja", { _loja_nome: demanda.loja_nome });
      const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;
      for (const d of list) {
        await supabase.from("notificacoes").insert({
          usuario_id: d.user_id,
          setor_id: d.setor_id,
          tipo: "demanda_encerrada",
          titulo,
          mensagem: mensagemBody,
          referencia_id: demanda_id,
        });
        if (operadorId) {
          const conversa_id = makeConversaId(operadorId, d.user_id);
          await supabase.from("mensagens_internas").insert({
            remetente_id: operadorId,
            destinatario_id: d.user_id,
            conversa_id,
            conteudo: `🔚 Demanda *${demanda.protocolo}* encerrada${motivo ? `: ${motivo}` : "."}`,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      status: "ok",
      demanda_id,
      encerrado_por,
      canal: "app_atrium_messenger",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("encerrar-demanda-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
