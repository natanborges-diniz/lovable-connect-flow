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
    const { atendimento_id, texto, remetente_nome } = await req.json();

    if (!atendimento_id || !texto) {
      throw new Error("atendimento_id and texto are required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get atendimento + contato phone + canal_provedor
    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, canal_provedor, contatos(telefone, nome)")
      .eq("id", atendimento_id)
      .single();

    if (atErr || !atendimento) throw new Error("Atendimento not found");

    const contato = (atendimento as any).contatos;
    const phone = contato?.telefone;
    if (!phone) throw new Error("Contact has no phone number");

    const provedor = (atendimento as any).canal_provedor || "meta_official";
    const cleanPhone = phone.replace(/\D/g, "");

    let apiResult: any;

    if (provedor === "evolution_api") {
      apiResult = await sendViaEvolution(cleanPhone, texto);
    } else if (provedor === "z_api") {
      apiResult = await sendViaZApi(cleanPhone, texto);
    } else {
      apiResult = await sendViaMeta(cleanPhone, texto);
    }

    console.log(`Message sent via ${provedor}:`, apiResult);

    // Save outbound message
    const { error: msgErr } = await supabase.from("mensagens").insert({
      atendimento_id,
      direcao: "outbound",
      conteudo: texto,
      remetente_nome: remetente_nome || "Operador",
      provedor,
      metadata: { whatsapp_message_id: apiResult.messages?.[0]?.id || apiResult.key?.id || null, provedor },
    });

    if (msgErr) console.error("Failed to save message:", msgErr);

    return new Response(JSON.stringify({ status: "sent", provedor, whatsapp_response: apiResult }), {
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

// ─── Meta Official Graph API ───
async function sendViaMeta(phone: string, text: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(`Meta API error: ${JSON.stringify(result.error?.message || result)}`);
  }
  return result;
}

// ─── Evolution API ───
async function sendViaEvolution(phone: string, text: string) {
  const apiUrl = Deno.env.get("EVOLUTION_API_URL");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  const instanceName = Deno.env.get("EVOLUTION_INSTANCE_NAME");

  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error("Evolution API credentials not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE_NAME)");
  }

  const res = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      number: phone,
      text: text,
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(`Evolution API error: ${JSON.stringify(result)}`);
  }
  return result;
}

// ─── Z-API ───
async function sendViaZApi(phone: string, text: string) {
  const zapiUrl = Deno.env.get("ZAPI_URL");
  const zapiToken = Deno.env.get("ZAPI_TOKEN");
  const zapiInstanceId = Deno.env.get("ZAPI_INSTANCE_ID");

  if (!zapiUrl || !zapiToken || !zapiInstanceId) {
    throw new Error("Z-API credentials not configured (ZAPI_URL / ZAPI_TOKEN / ZAPI_INSTANCE_ID)");
  }

  const res = await fetch(`${zapiUrl}/instances/${zapiInstanceId}/token/${zapiToken}/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message: text }),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(`Z-API error: ${JSON.stringify(result)}`);
  }
  return result;
}
