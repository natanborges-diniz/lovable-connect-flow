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

    const { demanda_id, texto, mensagem_ids } = await req.json();
    if (!demanda_id || !texto) {
      return new Response(JSON.stringify({ error: "demanda_id and texto are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .select("id, atendimento_cliente_id, protocolo")
      .eq("id", demanda_id)
      .single();
    if (demErr || !demanda) throw new Error("Demanda não encontrada");

    const { data: profile } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", user.id)
      .single();
    const operadorNome = profile?.nome || user.email || "Operador";

    // Send to client via send-whatsapp (uses the client's atendimento + provider)
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        atendimento_id: demanda.atendimento_cliente_id,
        texto,
        remetente_nome: operadorNome,
      }),
    });
    const sendData = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) throw new Error(sendData?.error || "Falha ao enviar mensagem ao cliente");

    // Mark forwarded messages
    if (Array.isArray(mensagem_ids) && mensagem_ids.length > 0) {
      await supabase
        .from("demanda_mensagens")
        .update({ encaminhada_ao_cliente: true })
        .in("id", mensagem_ids);
    }

    // Add system note in the demand thread
    await supabase.from("demanda_mensagens").insert({
      demanda_id,
      direcao: "sistema",
      autor_id: user.id,
      autor_nome: operadorNome,
      conteudo: `↗️ Encaminhado ao cliente: "${texto.substring(0, 200)}${texto.length > 200 ? "…" : ""}"`,
    });

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("encaminhar-demanda-cliente error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
