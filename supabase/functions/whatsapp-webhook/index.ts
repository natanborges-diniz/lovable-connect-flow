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

    const { phone, senderName, text, messageId, source, mediaType, mediaId, mediaUrl, mediaMimeType } = message;
    console.log(`Message received via ${source} from ${phone}: type=${mediaType || 'text'} ${text.substring(0, 50)}`);

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

    // 2.5. Check if this is a store phone
    const cleanPhoneForLoja = phone.replace(/\D/g, "");
    const { data: lojaMatch } = await supabase
      .from("telefones_lojas")
      .select("*")
      .eq("telefone", cleanPhoneForLoja)
      .eq("ativo", true)
      .limit(1)
      .single();

    const isLoja = !!lojaMatch;

    if (isLoja && contato.tipo !== "loja") {
      await supabase.from("contatos").update({ tipo: "loja" }).eq("id", contato.id);
    }

    // 3. Find open atendimento or create solicitação + atendimento
    let { data: atendimentoAberto } = await supabase
      .from("atendimentos")
      .select("id, modo")
      .eq("contato_id", contato.id)
      .eq("canal", "whatsapp")
      .eq("canal_provedor", source)
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let atendimentoId: string;
    let atendimentoModo: string;

    if (atendimentoAberto) {
      atendimentoId = atendimentoAberto.id;
      atendimentoModo = (atendimentoAberto as any).modo || "ia";
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
          modo: "ia",
        })
        .select()
        .single();
      if (atErr) throw atErr;

      atendimentoId = atendimento.id;
      atendimentoModo = "ia";

      await supabase.from("eventos_crm").insert({
        contato_id: contato.id,
        tipo: "solicitacao_criada",
        descricao: `Nova solicitação via WhatsApp (${source}): ${text.substring(0, 100)}`,
        referencia_tipo: "solicitacao",
        referencia_id: solicitacao.id,
      });
    }

    // 4. Handle media: download and store in bucket
    let storedMediaUrl: string | null = null;
    let tipoConteudo = "text";

    if (mediaType && mediaType !== "text") {
      tipoConteudo = mediaType; // image, document, audio, video, sticker
      try {
        storedMediaUrl = await downloadAndStoreMedia(supabase, SUPABASE_URL, {
          source,
          mediaId,
          mediaUrl,
          mediaMimeType,
          atendimentoId,
          messageId,
        });
        console.log(`Media stored: ${storedMediaUrl}`);
      } catch (e) {
        console.error("Failed to download/store media:", e);
      }
    }

    // 5. Save message
    const messageContent = mediaType && mediaType !== "text"
      ? (text || `[${mediaType}]`)
      : text;

    await supabase.from("mensagens").insert({
      atendimento_id: atendimentoId,
      direcao: "inbound",
      conteudo: messageContent,
      remetente_nome: senderName || contato.nome,
      tipo_conteudo: tipoConteudo,
      metadata: {
        whatsapp_message_id: messageId,
        source,
        ...(storedMediaUrl && { media_url: storedMediaUrl }),
        ...(mediaMimeType && { mime_type: mediaMimeType }),
      },
      provedor: source,
    });

    // 6. Mark as read (Meta official API only)
    if (source === "meta_official" && messageId) {
      markAsRead(messageId).catch((e) => console.error("Failed to mark as read:", e));
    }

    // 7. Check homologação mode
    const shouldSkipBot = await isHomologacaoBlocked(supabase, phone);

    // 8. Trigger appropriate bot (fire-and-forget)
    if (shouldSkipBot) {
      console.log(`Homologação: phone ${phone} not in whitelist, skipping bot/AI`);
    } else if (isLoja) {
      runInBackground(
        triggerBotLojas(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimentoId, contato.id, phone, text, lojaMatch).catch(
          (e) => console.error("Bot lojas trigger failed:", e)
        )
      );
    } else if (atendimentoModo === "ia" || atendimentoModo === "hibrido") {
      runInBackground(
        triggerAiTriage(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atendimentoId, contato.id, phone, text, {
          tipo_conteudo: tipoConteudo,
          media_url: storedMediaUrl,
        }).catch(
          (e) => console.error("AI triage trigger failed:", e)
        )
      );
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

// ─── Download and Store Media ───
async function downloadAndStoreMedia(
  supabase: any,
  supabaseUrl: string,
  opts: {
    source: string;
    mediaId?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    atendimentoId: string;
    messageId: string;
  }
): Promise<string | null> {
  let mediaBytes: ArrayBuffer | null = null;
  let mimeType = opts.mediaMimeType || "application/octet-stream";

  if (opts.source === "meta_official" && opts.mediaId) {
    // Step 1: Get media URL from Graph API
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    if (!accessToken) throw new Error("WHATSAPP_ACCESS_TOKEN not set");

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${opts.mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) throw new Error(`Meta media lookup failed: ${metaRes.status}`);
    const metaData = await metaRes.json();
    mimeType = metaData.mime_type || mimeType;

    // Step 2: Download the actual media
    const downloadRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!downloadRes.ok) throw new Error(`Meta media download failed: ${downloadRes.status}`);
    mediaBytes = await downloadRes.arrayBuffer();

  } else if (opts.mediaUrl) {
    // Evolution API / Z-API: direct URL download
    const downloadRes = await fetch(opts.mediaUrl);
    if (!downloadRes.ok) throw new Error(`Media download failed: ${downloadRes.status}`);
    mediaBytes = await downloadRes.arrayBuffer();
  }

  if (!mediaBytes) return null;

  // Determine file extension from mime type
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/opus": "opus",
    "video/mp4": "mp4", "application/pdf": "pdf",
    "image/gif": "gif", "audio/aac": "aac",
  };
  const ext = extMap[mimeType] || "bin";
  const filePath = `${opts.atendimentoId}/${opts.messageId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("whatsapp-media")
    .upload(filePath, mediaBytes, { contentType: mimeType, upsert: true });

  if (uploadErr) throw uploadErr;

  const { data: publicUrl } = supabase.storage
    .from("whatsapp-media")
    .getPublicUrl(filePath);

  return publicUrl?.publicUrl || null;
}

// ─── Trigger Bot Lojas ───
async function triggerBotLojas(
  supabaseUrl: string,
  serviceRoleKey: string,
  atendimentoId: string,
  contatoId: string,
  phone: string,
  text: string,
  lojaInfo: any
) {
  await fetch(`${supabaseUrl}/functions/v1/bot-lojas`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      atendimento_id: atendimentoId,
      contato_id: contatoId,
      mensagem_texto: text,
      loja_info: lojaInfo,
    }),
  });
}

// ─── Check homologação mode ───
async function isHomologacaoBlocked(supabase: any, phone: string): Promise<boolean> {
  const { data: modoConfig } = await supabase
    .from("configuracoes_ia")
    .select("valor")
    .eq("chave", "modo_homologacao")
    .single();

  if (modoConfig?.valor !== "true") return false;

  const cleanPhone = phone.replace(/\D/g, "");
  const { data: whitelist } = await supabase
    .from("contatos_homologacao")
    .select("id")
    .eq("telefone", cleanPhone)
    .eq("ativo", true)
    .limit(1);

  return !whitelist?.length;
}

// ─── Trigger AI Triage ───
async function triggerAiTriage(
  supabaseUrl: string,
  serviceRoleKey: string,
  atendimentoId: string,
  contatoId: string,
  phone: string,
  text: string,
  mediaInfo?: { tipo_conteudo: string; media_url: string | null }
) {
  await fetch(`${supabaseUrl}/functions/v1/ai-triage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      atendimento_id: atendimentoId,
      contato_id: contatoId,
      mensagem_texto: text,
      ...(mediaInfo && { media: mediaInfo }),
    }),
  });
}

function runInBackground(promise: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
    return;
  }

  promise.catch((e) => console.error("Background task failed:", e));
}

// ─── Mark message as read via Meta Graph API ───
async function markAsRead(messageId: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) return;

  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  });
}

// ─── Normalize webhook payloads ───
interface NormalizedMessage {
  phone: string;
  senderName: string;
  text: string;
  messageId: string;
  source: "meta_official" | "evolution_api" | "z_api" | "generic";
  mediaType?: string;    // image, audio, video, document, sticker
  mediaId?: string;      // Meta media ID
  mediaUrl?: string;     // Direct URL (Evolution/Z-API)
  mediaMimeType?: string;
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
        const contactInfo = value.contacts?.[0];

        const base = {
          phone: msg.from,
          senderName: contactInfo?.profile?.name || msg.from,
          messageId: msg.id || "",
          source: "meta_official" as const,
        };

        if (msg.type === "text") {
          return { ...base, text: msg.text?.body || "" };
        }
        if (msg.type === "image") {
          return {
            ...base,
            text: msg.image?.caption || "",
            mediaType: "image",
            mediaId: msg.image?.id,
            mediaMimeType: msg.image?.mime_type,
          };
        }
        if (msg.type === "document") {
          return {
            ...base,
            text: msg.document?.caption || msg.document?.filename || "",
            mediaType: "document",
            mediaId: msg.document?.id,
            mediaMimeType: msg.document?.mime_type,
          };
        }
        if (msg.type === "audio") {
          return {
            ...base,
            text: "",
            mediaType: "audio",
            mediaId: msg.audio?.id,
            mediaMimeType: msg.audio?.mime_type,
          };
        }
        if (msg.type === "video") {
          return {
            ...base,
            text: msg.video?.caption || "",
            mediaType: "video",
            mediaId: msg.video?.id,
            mediaMimeType: msg.video?.mime_type,
          };
        }
        if (msg.type === "sticker") {
          return {
            ...base,
            text: "",
            mediaType: "sticker",
            mediaId: msg.sticker?.id,
            mediaMimeType: msg.sticker?.mime_type,
          };
        }
      }
    }
    return null;
  }

  // ── Evolution API ──
  if (body.data?.key?.remoteJid) {
    const phone = body.data.key.remoteJid.replace("@s.whatsapp.net", "");
    const msgData = body.data.message;

    // Image message
    if (msgData?.imageMessage) {
      return {
        phone,
        senderName: body.data.pushName || phone,
        text: msgData.imageMessage.caption || "",
        messageId: body.data.key.id || "",
        source: "evolution_api",
        mediaType: "image",
        mediaUrl: msgData.imageMessage.url || body.data.mediaUrl,
        mediaMimeType: msgData.imageMessage.mimetype,
      };
    }
    // Document message
    if (msgData?.documentMessage) {
      return {
        phone,
        senderName: body.data.pushName || phone,
        text: msgData.documentMessage.caption || msgData.documentMessage.fileName || "",
        messageId: body.data.key.id || "",
        source: "evolution_api",
        mediaType: "document",
        mediaUrl: msgData.documentMessage.url || body.data.mediaUrl,
        mediaMimeType: msgData.documentMessage.mimetype,
      };
    }
    // Audio message
    if (msgData?.audioMessage) {
      return {
        phone,
        senderName: body.data.pushName || phone,
        text: "",
        messageId: body.data.key.id || "",
        source: "evolution_api",
        mediaType: "audio",
        mediaUrl: msgData.audioMessage.url || body.data.mediaUrl,
        mediaMimeType: msgData.audioMessage.mimetype,
      };
    }
    // Video message
    if (msgData?.videoMessage) {
      return {
        phone,
        senderName: body.data.pushName || phone,
        text: msgData.videoMessage.caption || "",
        messageId: body.data.key.id || "",
        source: "evolution_api",
        mediaType: "video",
        mediaUrl: msgData.videoMessage.url || body.data.mediaUrl,
        mediaMimeType: msgData.videoMessage.mimetype,
      };
    }
    // Text message (fallback)
    return {
      phone,
      senderName: body.data.pushName || phone,
      text: msgData?.conversation || msgData?.extendedTextMessage?.text || "",
      messageId: body.data.key.id || "",
      source: "evolution_api",
    };
  }

  // ── Z-API ──
  if (body.phone) {
    const base = {
      phone: body.phone.replace(/\D/g, ""),
      senderName: body.senderName || body.phone,
      messageId: body.messageId || body.zapiMessageId || "",
      source: "z_api" as const,
    };
    if (body.image) {
      return { ...base, text: body.image.caption || "", mediaType: "image", mediaUrl: body.image.imageUrl };
    }
    return { ...base, text: body.text?.message || body.message || "" };
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
