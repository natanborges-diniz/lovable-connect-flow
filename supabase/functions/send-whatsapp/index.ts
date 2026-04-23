// CANAL ÚNICO: Meta Official only.
// Evolution API e Z-API foram descontinuados — todo tráfego B2B/interno migrou para o app Atrium Messenger.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { atendimento_id, texto, remetente_nome } = await req.json();

    if (!atendimento_id || !texto) {
      throw new Error("atendimento_id and texto are required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, canal, contatos(telefone, nome)")
      .eq("id", atendimento_id)
      .single();

    if (atErr || !atendimento) throw new Error("Atendimento not found");

    const contato = (atendimento as any).contatos;
    const phone = contato?.telefone;
    if (!phone) throw new Error("Contact has no phone number");

    const cleanPhone = phone.replace(/\D/g, "");
    const isRepeatedDigits = /^(\d)\1+$/.test(cleanPhone.slice(-9));
    if (cleanPhone.length < 10 || cleanPhone.length > 15 || isRepeatedDigits) {
      return new Response(
        JSON.stringify({ error: "invalid_phone", phone: cleanPhone, reason: "placeholder_or_malformed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Guard 24h Meta: se a última mensagem inbound foi >24h, bloqueia texto livre (precisa template).
    const { data: lastInbound } = await supabase
      .from("mensagens")
      .select("created_at")
      .eq("atendimento_id", atendimento_id)
      .eq("direcao", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastInbound) {
      const hoursSince = (Date.now() - new Date(lastInbound.created_at).getTime()) / 3_600_000;
      if (hoursSince > 24) {
        return new Response(
          JSON.stringify({
            error: "outside_24h_window",
            reason: "Meta exige template aprovado fora da janela de 24h. Use send-whatsapp-template.",
            hours_since_last_inbound: Math.round(hoursSince),
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const apiResult = await sendViaMeta(cleanPhone, texto);
    console.log(`[send-whatsapp] Sent via meta_official:`, apiResult?.messages?.[0]?.id);

    const { error: msgErr } = await supabase.from("mensagens").insert({
      atendimento_id,
      direcao: "outbound",
      conteudo: texto,
      remetente_nome: remetente_nome || "Operador",
      provedor: "meta_official",
      metadata: { whatsapp_message_id: apiResult.messages?.[0]?.id || null, provedor: "meta_official" },
    });

    if (msgErr) console.error("[send-whatsapp] Failed to save message:", msgErr);

    return new Response(JSON.stringify({ status: "sent", provedor: "meta_official", whatsapp_response: apiResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-whatsapp] error:", e);
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
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function bodyToString(body: any): string {
  if (body === null || body === undefined) return "<empty>";
  if (typeof body === "string") return body;
  try { return JSON.stringify(body); } catch { return String(body); }
}

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
