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

  // ─── GET: Meta Webhook Verification ───
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // ─── POST: Incoming Messages ───
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const message = normalizeWebhookPayload(body);

    if (!message) {
      return new Response(JSON.stringify({ status: "ignored", reason: "Unsupported message type or format" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { phone, senderName, text, messageId, source } = message;
    console.log(`Message received via ${source} from ${phone}: ${text.substring(0, 50)}`);

    // 1. Find or create contato
    let { data: contato } = await supabase
      .from("contatos")
      .select("*")
      .eq("telefone", phone)
      .single();

    if (!contato) {
      const { data: newContato, error: createErr } = await supabase
        .from("contatos")
        .insert({ nome: senderName || phone, tipo: "cliente", telefone: phone })
        .select()
        .single();
      if (createErr) throw createErr;
      contato = newContato;
    }

    // 2. Find or create canal (with provedor)
    let { data: canal } = await supabase
      .from("canais")
      .select("*")
      .eq("contato_id", contato.id)
      .eq("tipo", "whatsapp")
      .eq("identificador", phone)
      .eq("provedor", source)
      .single();

    if (!canal) {
      await supabase.from("canais").insert({
        contato_id: contato.id,
        tipo: "whatsapp",
        identificador: phone,
        principal: true,
        provedor: source,
      });
    }

    // 3. Find open atendimento or create solicitação + atendimento
    let { data: atendimentoAberto } = await supabase
      .from("atendimentos")
      .select("id")
      .eq("contato_id", contato.id)
      .eq("canal", "whatsapp")
      .eq("canal_provedor", source)
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let atendimentoId: string;

    if (atendimentoAberto) {
      atendimentoId = atendimentoAberto.id;
    } else {
      const { data: solicitacao, error: solErr } = await supabase
        .from("solicitacoes")
        .insert({
          contato_id: contato.id,
          assunto: text.substring(0, 100) || "Mensagem via WhatsApp",
          descricao: text,
          canal_origem: "whatsapp",
          status: "aberta",
        })
        .select()
        .single();
      if (solErr) throw solErr;

      const { data: atendimento, error: atErr } = await supabase
        .from("atendimentos")
        .insert({
          solicitacao_id: solicitacao.id,
          contato_id: contato.id,
          canal: "whatsapp",
          status: "aguardando",
          canal_provedor: source,
        })
        .select()
        .single();
      if (atErr) throw atErr;

      atendimentoId = atendimento.id;

      await supabase.from("eventos_crm").insert({
        contato_id: contato.id,
        tipo: "solicitacao_criada",
        descricao: `Nova solicitação via WhatsApp (${source}): ${text.substring(0, 100)}`,
        referencia_tipo: "solicitacao",
        referencia_id: solicitacao.id,
      });
    }

    // 4. Save message with provedor
    await supabase.from("mensagens").insert({
      atendimento_id: atendimentoId,
      direcao: "inbound",
      conteudo: text,
      remetente_nome: senderName || contato.nome,
      metadata: { whatsapp_message_id: messageId, source },
      provedor: source,
    });

    // 5. Mark as read (Meta official API only)
    if (source === "meta_official" && messageId) {
      await markAsRead(messageId);
    }

    return new Response(JSON.stringify({ status: "ok", atendimento_id: atendimentoId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Mark message as read via Meta Graph API ───
async function markAsRead(messageId: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) return;

  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  } catch (e) {
    console.error("Failed to mark as read:", e);
  }
}

// ─── Normalize webhook payloads ───
interface NormalizedMessage {
  phone: string;
  senderName: string;
  text: string;
  messageId: string;
  source: "meta_official" | "evolution_api" | "z_api" | "generic";
}

function normalizeWebhookPayload(body: any): NormalizedMessage | null {
  // ── Meta Official Cloud API ──
  if (body.object === "whatsapp_business_account" && body.entry) {
    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = change.value;
        if (!value?.messages?.length) continue;
        const msg = value.messages[0];
        if (msg.type !== "text") continue;
        const contactInfo = value.contacts?.[0];
        return {
          phone: msg.from,
          senderName: contactInfo?.profile?.name || msg.from,
          text: msg.text?.body || "",
          messageId: msg.id || "",
          source: "meta_official",
        };
      }
    }
    return null;
  }

  // ── Evolution API ──
  if (body.data?.key?.remoteJid) {
    const phone = body.data.key.remoteJid.replace("@s.whatsapp.net", "");
    return {
      phone,
      senderName: body.data.pushName || phone,
      text: body.data.message?.conversation || body.data.message?.extendedTextMessage?.text || "",
      messageId: body.data.key.id || "",
      source: "evolution_api",
    };
  }

  // ── Z-API ──
  if (body.phone) {
    return {
      phone: body.phone.replace(/\D/g, ""),
      senderName: body.senderName || body.phone,
      text: body.text?.message || body.message || "",
      messageId: body.messageId || body.zapiMessageId || "",
      source: "z_api",
    };
  }

  // ── Generic ──
  if (body.from && body.body) {
    return {
      phone: body.from.replace(/\D/g, ""),
      senderName: body.senderName || body.from,
      text: body.body,
      messageId: body.id || "",
      source: "generic",
    };
  }

  return null;
}
