import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

    if (!accessToken || !phoneNumberId) {
      throw new Error("WhatsApp credentials not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
    }

    const { atendimento_id, texto, remetente_nome } = await req.json();

    if (!atendimento_id || !texto) {
      throw new Error("atendimento_id and texto are required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get atendimento + contato phone
    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, contatos(telefone, nome)")
      .eq("id", atendimento_id)
      .single();

    if (atErr || !atendimento) throw new Error("Atendimento not found");

    const contato = (atendimento as any).contatos;
    const phone = contato?.telefone;

    if (!phone) throw new Error("Contact has no phone number");

    // Send via Meta Graph API
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone.replace(/\D/g, ""),
        type: "text",
        text: { preview_url: false, body: texto },
      }),
    });

    const apiResult = await res.json();

    if (!res.ok) {
      console.error("WhatsApp API error:", JSON.stringify(apiResult));
      throw new Error(`WhatsApp API error: ${JSON.stringify(apiResult.error?.message || apiResult)}`);
    }

    console.log("Message sent successfully:", apiResult);

    // Save outbound message in DB
    const { error: msgErr } = await supabase.from("mensagens").insert({
      atendimento_id,
      direcao: "outbound",
      conteudo: texto,
      remetente_nome: remetente_nome || "Operador",
      metadata: { whatsapp_message_id: apiResult.messages?.[0]?.id },
    });

    if (msgErr) console.error("Failed to save message:", msgErr);

    return new Response(JSON.stringify({ status: "sent", whatsapp_response: apiResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
