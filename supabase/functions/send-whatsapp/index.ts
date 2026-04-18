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
    const { atendimento_id, texto, remetente_nome, force_provider } = await req.json();

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

    const provedor = force_provider || (atendimento as any).canal_provedor || "meta_official";
    const cleanPhone = phone.replace(/\D/g, "");

    // Guard: reject obviously invalid / placeholder numbers (avoids 3x retry loop on Evolution)
    const isRepeatedDigits = /^(\d)\1+$/.test(cleanPhone.slice(-9)); // e.g. 999999999
    if (cleanPhone.length < 10 || cleanPhone.length > 15 || isRepeatedDigits) {
      return new Response(
        JSON.stringify({ error: "invalid_phone", phone: cleanPhone, reason: "placeholder_or_malformed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("request_timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function bodyToString(body: any): string {
  if (body === null || body === undefined) return "<empty>";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Meta Official Graph API ───
async function sendViaMeta(phone: string, text: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
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

  const result = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(`Meta API error (status ${res.status}): ${bodyToString(result?.error?.message || result)}`);
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

  const maxAttempts = 3;
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(`${apiUrl}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          text,
        }),
      }, 20000);

      const result = await readResponseBody(res);
      if (!res.ok) {
        lastError = `status=${res.status} body=${bodyToString(result)}`;
        console.error(`[EVOLUTION] Send failed (attempt ${attempt}/${maxAttempts}): ${lastError}`);

        // Number does not exist on WhatsApp — abort immediately, do not retry
        const msgArr = (result as any)?.response?.message;
        if (Array.isArray(msgArr) && msgArr.some((m: any) => m?.exists === false)) {
          throw new Error(`Evolution API: number ${phone} does not exist on WhatsApp (exists=false)`);
        }

        if (res.status >= 500 && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }

        throw new Error(`Evolution API error: ${lastError}`);
      }

      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      lastError = message;
      console.error(`[EVOLUTION] Send exception (attempt ${attempt}/${maxAttempts}): ${message}`);

      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw new Error(`Evolution API error after ${maxAttempts} attempts: ${lastError}`);
}

// ─── Z-API ───
async function sendViaZApi(phone: string, text: string) {
  const zapiUrl = Deno.env.get("ZAPI_URL");
  const zapiToken = Deno.env.get("ZAPI_TOKEN");
  const zapiInstanceId = Deno.env.get("ZAPI_INSTANCE_ID");

  if (!zapiUrl || !zapiToken || !zapiInstanceId) {
    throw new Error("Z-API credentials not configured (ZAPI_URL / ZAPI_TOKEN / ZAPI_INSTANCE_ID)");
  }

  const res = await fetchWithTimeout(`${zapiUrl}/instances/${zapiInstanceId}/token/${zapiToken}/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message: text }),
  });

  const result = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(`Z-API error (status ${res.status}): ${bodyToString(result)}`);
  }
  return result;
}
