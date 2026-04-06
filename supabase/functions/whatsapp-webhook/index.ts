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

    let { phone, senderName, text, messageId, source, mediaType, mediaId, mediaUrl, mediaMimeType } = message;
    console.log(`Message received via ${source} from ${phone}: type=${mediaType || 'text'} ${text.substring(0, 50)}`);

    // 1. Find or create contato
    let { data: contatoResult } = await supabase
      .from("contatos")
      .select("*")
      .eq("telefone", phone)
      .order("created_at", { ascending: true })
      .limit(1);

    let contato = contatoResult?.[0] || null;

    if (!contato) {
      // Use upsert to handle race conditions with unique telefone index
      const { data: newContato, error: createErr } = await supabase
        .from("contatos")
        .upsert(
          { nome: senderName || phone, tipo: "cliente", telefone: phone },
          { onConflict: "telefone", ignoreDuplicates: true }
        )
        .select()
        .single();
      if (createErr) {
        // If upsert still fails, try fetching again
        const { data: retry } = await supabase
          .from("contatos")
          .select("*")
          .eq("telefone", phone)
          .limit(1);
        contato = retry?.[0] || null;
        if (!contato) throw createErr;
      } else {
        contato = newContato;
      }
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
    const isCorporateContact = isLoja || contato.tipo === "colaborador";

    if (isLoja && contato.tipo !== "loja") {
      await supabase.from("contatos").update({ tipo: "loja" }).eq("id", contato.id);
      contato = { ...contato, tipo: "loja" };
    }

    // 3. Find open atendimento (any provider) or create solicitação + atendimento
    let { data: atendimentoAberto } = await supabase
      .from("atendimentos")
      .select("id, modo, canal_provedor")
      .eq("contato_id", contato.id)
      .eq("canal", "whatsapp")
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let atendimentoId: string;
    let atendimentoModo: string;

    if (atendimentoAberto) {
      atendimentoId = atendimentoAberto.id;
      atendimentoModo = (atendimentoAberto as any).modo || "ia";

      // Update canal_provedor to current source for correct reply routing
      if ((atendimentoAberto as any).canal_provedor !== source) {
        await supabase.from("atendimentos").update({ canal_provedor: source }).eq("id", atendimentoId);
        console.log(`Updated canal_provedor to ${source} for atendimento ${atendimentoId}`);
      }
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

    // ── CANCEL RECOVERY if contact is in recovery cadence ──
    try {
      const contatoMeta = (contato.metadata as any) || {};
      const recuperacao = contatoMeta.recuperacao_vendas;
      if (recuperacao && recuperacao.tentativas > 0) {
        console.log(`[RECOVERY CANCEL] Inbound from ${contato.id}, resetting recuperacao_vendas (was at attempt ${recuperacao.tentativas})`);
        const { recuperacao_vendas, ...restMeta } = contatoMeta;
        await supabase.from("contatos").update({
          metadata: { ...restMeta, recuperacao_vendas: { tentativas: 0 } },
        }).eq("id", contato.id);
        contato = { ...contato, metadata: { ...restMeta, recuperacao_vendas: { tentativas: 0 } } };

        await supabase.from("eventos_crm").insert({
          contato_id: contato.id,
          tipo: "recuperacao_cancelada",
          descricao: `Cliente respondeu durante cadência de recuperação (tentativa ${recuperacao.tentativas}/3). Recuperação cancelada.`,
        });
      }
    } catch (recErr) {
      console.error("[RECOVERY CANCEL] Error:", recErr);
    }

    // ── CRM ROUTING: Assign pipeline_coluna_id immediately ──
    try {
      const { data: allColunas } = await supabase
        .from("pipeline_colunas")
        .select("id, nome, setor_id, ordem")
        .eq("ativo", true);

      if (allColunas && allColunas.length > 0) {
        const salesColunas = allColunas
          .filter((c: any) => c.setor_id === null)
          .sort((a: any, b: any) => a.ordem - b.ordem);
        // Filter internal columns by "Atendimento Gael" sector to avoid mixing with Financeiro/Agendamentos
        const ATENDIMENTO_GAEL_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";
        const internalColunas = allColunas
          .filter((c: any) => c.setor_id === ATENDIMENTO_GAEL_SETOR_ID)
          .sort((a: any, b: any) => a.ordem - b.ordem);
        // Fallback: if Atendimento Gael has no columns, use any internal columns
        const internalColunasFallback = internalColunas.length > 0
          ? internalColunas
          : allColunas.filter((c: any) => c.setor_id !== null).sort((a: any, b: any) => a.ordem - b.ordem);

        const currentColuna = allColunas.find((c: any) => c.id === contato.pipeline_coluna_id);
        const novoContatoCol = salesColunas.find((c: any) => c.nome === "Novo Contato") ?? salesColunas[0] ?? null;
        const retornoCol = salesColunas.find((c: any) => c.nome === "Retorno") ?? null;
        const internalDefaultCol = internalColunasFallback.find((c: any) => c.nome === "Novo") ?? internalColunasFallback[0] ?? null;

        let targetColunaId: string | null = null;

        if (isCorporateContact) {
          if (currentColuna?.setor_id) {
            targetColunaId = currentColuna.id;
          } else if (internalDefaultCol) {
            targetColunaId = internalDefaultCol.id;
          }
        } else if (!contato.pipeline_coluna_id) {
          targetColunaId = novoContatoCol?.id ?? null;
        } else if (currentColuna?.setor_id) {
          // Corrige contatos não-corporativos presos em pipeline interno
          targetColunaId = retornoCol?.id ?? novoContatoCol?.id ?? null;
        } else if (currentColuna && ["Abandonado", "Cancelado", "Perdidos"].includes(currentColuna.nome)) {
          targetColunaId = retornoCol?.id ?? null;
        }

        if (targetColunaId && targetColunaId !== contato.pipeline_coluna_id) {
          await supabase.from("contatos").update({ pipeline_coluna_id: targetColunaId }).eq("id", contato.id);
          contato = { ...contato, pipeline_coluna_id: targetColunaId };
          console.log(`[CRM ROUTING] Contact ${contato.id} assigned to column ${targetColunaId}`);
        }
      }
    } catch (routingErr) {
      console.error("[CRM ROUTING] Error:", routingErr);
    }

    // 4. Handle media: download and store in bucket
    let storedMediaUrl: string | null = null;
    let inlineMediaBase64: string | null = null;
    let storedMediaMimeType: string | null = mediaMimeType || null;
    let tipoConteudo = "text";

    if (mediaType && mediaType !== "text") {
      tipoConteudo = mediaType; // image, document, audio, video, sticker
      try {
        const storedMedia = await downloadAndStoreMedia(supabase, SUPABASE_URL, {
          source,
          mediaId,
          mediaUrl,
          mediaMimeType,
          atendimentoId,
          messageId,
          evolutionMessageKey: message.evolutionMessageKey,
        });
        storedMediaUrl = storedMedia?.publicUrl || null;
        inlineMediaBase64 = storedMedia?.inlineBase64 || null;
        storedMediaMimeType = storedMedia?.mimeType || storedMediaMimeType;
        console.log(`Media stored: ${storedMediaUrl}`);

        // Transcribe audio if applicable
        if (mediaType === "audio" && storedMedia?.mediaBytes) {
          try {
            const transcribed = await transcribeAudio(storedMedia.mediaBytes, storedMediaMimeType || "audio/ogg");
            if (transcribed) {
              console.log(`[AUDIO] Transcribed: "${transcribed.substring(0, 80)}..."`);
              // Replace [audio] with transcribed text for AI processing
              text = transcribed;
            }
          } catch (e) {
            console.error("[AUDIO] Transcription failed:", e);
          }
        }
      } catch (e) {
        console.error("Failed to download/store media:", e);
      }
    }

    // 5. Save message
    const isTranscribedAudio = mediaType === "audio" && text && text !== `[audio]`;
    const messageContent = mediaType && mediaType !== "text"
      ? (isTranscribedAudio ? `🎤 ${text}` : (text || `[${mediaType}]`))
      : text;

    await supabase.from("mensagens").insert({
      atendimento_id: atendimentoId,
      direcao: "inbound",
      conteudo: messageContent,
      remetente_nome: senderName || contato.nome,
      tipo_conteudo: isTranscribedAudio ? "text" : tipoConteudo,
      metadata: {
        whatsapp_message_id: messageId,
        source,
        ...(storedMediaUrl && { media_url: storedMediaUrl }),
        ...(storedMediaMimeType && { mime_type: storedMediaMimeType }),
        ...(isTranscribedAudio && { transcribed_from: "audio", original_type: "audio" }),
      },
      provedor: source,
    });

    // 6. Mark as read (Meta official API only)
    if (source === "meta_official" && messageId) {
      markAsRead(messageId).catch((e) => console.error("Failed to mark as read:", e));
    }

    // 6.5. Auto-confirm agendamento if client responds with confirmation keyword
    if (!isLoja && text) {
      const confirmKeywords = ["sim", "confirmo", "confirmado", "ok", "vou sim", "pode confirmar", "estarei lá", "vou estar", "combinado", "fechado", "tá bom", "beleza", "ta bom", "vou", "claro", "com certeza"];
      const normalizedText = text.trim().toLowerCase().replace(/[!.,?]/g, "");
      const isConfirmation = confirmKeywords.some(kw => normalizedText === kw || normalizedText.startsWith(kw + " "));

      if (isConfirmation) {
        // Check if contato has an agendamento in lembrete_enviado
        const { data: agendamentoPendente } = await supabase
          .from("agendamentos")
          .select("id, data_horario, loja_nome")
          .eq("contato_id", contato.id)
          .eq("status", "lembrete_enviado")
          .order("data_horario", { ascending: true })
          .limit(1)
          .single();

        if (agendamentoPendente) {
          console.log(`Auto-confirming agendamento ${agendamentoPendente.id} based on keyword "${normalizedText}"`);

          // Update agendamento status to confirmado
          await supabase.from("agendamentos")
            .update({ status: "confirmado", confirmacao_enviada: true })
            .eq("id", agendamentoPendente.id);

          // Register CRM event
          await supabase.from("eventos_crm").insert({
            contato_id: contato.id,
            tipo: "agendamento_confirmado",
            descricao: `Cliente confirmou agendamento via WhatsApp: "${text}"`,
            referencia_tipo: "agendamento",
            referencia_id: agendamentoPendente.id,
          });

          // Send deterministic confirmation response (no AI needed)
          const dataAgendamento = new Date(agendamentoPendente.data_horario);
          const hora = dataAgendamento.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          const dataFormatada = dataAgendamento.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

          const confirmMsg = `✅ Confirmado! Te esperamos ${dataFormatada} às ${hora} na ${agendamentoPendente.loja_nome}. Até lá! 😊`;

          // Save outbound confirmation message
          await supabase.from("mensagens").insert({
            atendimento_id: atendimentoId,
            direcao: "outbound",
            conteudo: confirmMsg,
            remetente_nome: "Sistema",
            provedor: source,
          });

          // Send via WhatsApp
          await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: cleanPhoneForLoja,
              message: confirmMsg,
              atendimento_id: atendimentoId,
              source,
            }),
          });

          // Pipeline automations will fire via the DB trigger on status change
          return new Response(JSON.stringify({ status: "ok", action: "auto_confirmed", atendimento_id: atendimentoId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
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
          mime_type: storedMediaMimeType,
          inline_base64: inlineMediaBase64,
          is_transcribed_audio: isTranscribedAudio,
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
    evolutionMessageKey?: any;
  }
): Promise<{ publicUrl: string | null; inlineBase64: string | null; mimeType: string; mediaBytes: ArrayBuffer | null } | null> {
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

  } else if (opts.source === "evolution_api" && opts.evolutionMessageKey) {
    // Evolution API: use getBase64FromMediaMessage endpoint
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");
    const evolutionInstance = Deno.env.get("EVOLUTION_INSTANCE_NAME");

    if (evolutionApiUrl && evolutionApiKey && evolutionInstance) {
      try {
        const b64Res = await fetch(
          `${evolutionApiUrl}/chat/getBase64FromMediaMessage/${evolutionInstance}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: evolutionApiKey,
            },
            body: JSON.stringify({
              message: { key: opts.evolutionMessageKey },
              convertToMp4: false,
            }),
          }
        );

        if (b64Res.ok) {
          const b64Data = await b64Res.json();
          const base64String = b64Data.base64 || b64Data.data;
          if (base64String) {
            // base64 may include data URI prefix
            const raw = base64String.includes(",")
              ? base64String.split(",")[1]
              : base64String;
            // Decode base64 to bytes
            const binaryStr = atob(raw);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            mediaBytes = bytes.buffer;
            // Try to extract mime from data URI if present
            if (base64String.includes(",") && base64String.startsWith("data:")) {
              const extractedMime = base64String.split(";")[0].replace("data:", "");
              if (extractedMime) mimeType = extractedMime;
            }
            console.log(`[MEDIA] Evolution base64 decoded: ${bytes.length} bytes, mime=${mimeType}`);
          }
        } else {
          console.warn(`[MEDIA] Evolution getBase64 failed: ${b64Res.status} — falling back to direct URL`);
        }
      } catch (e) {
        console.warn("[MEDIA] Evolution getBase64 error — falling back to direct URL:", e);
      }
    }

    // Fallback: try direct URL with API key header
    if (!mediaBytes && opts.mediaUrl) {
      const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
      const headers: Record<string, string> = {};
      if (evolutionKey) headers["apikey"] = evolutionKey;
      const downloadRes = await fetch(opts.mediaUrl, { headers });
      if (downloadRes.ok) {
        mediaBytes = await downloadRes.arrayBuffer();
      }
    }

  } else if (opts.mediaUrl) {
    // Z-API / Generic: direct URL download
    const downloadRes = await fetch(opts.mediaUrl);
    if (!downloadRes.ok) throw new Error(`Media download failed: ${downloadRes.status}`);
    mediaBytes = await downloadRes.arrayBuffer();
  }

  if (!mediaBytes) return null;

  const bytesToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

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

  return {
    publicUrl: publicUrl?.publicUrl || null,
    inlineBase64: mimeType.startsWith("image/") ? bytesToBase64(mediaBytes) : null,
    mimeType,
    mediaBytes,
  };
}

// ─── Transcribe Audio via OpenAI Whisper ───
async function transcribeAudio(mediaBytes: ArrayBuffer, mimeType: string): Promise<string | null> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    console.warn("[AUDIO] OPENAI_API_KEY not set — skipping transcription");
    return null;
  }

  const extMap: Record<string, string> = {
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/opus": "opus",
    "audio/aac": "aac", "audio/mp4": "m4a", "audio/wav": "wav",
    "audio/ogg; codecs=opus": "ogg",
  };
  const cleanMime = mimeType.split(";")[0].trim();
  const ext = extMap[cleanMime] || extMap[mimeType] || "ogg";

  const formData = new FormData();
  const blob = new Blob([mediaBytes], { type: cleanMime });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "pt");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[AUDIO] Whisper error ${res.status}: ${errText}`);
    return null;
  }

  const data = await res.json();
  const transcription = data.text?.trim();
  return transcription || null;
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
  mediaInfo?: { tipo_conteudo: string; media_url: string | null; mime_type?: string | null; inline_base64?: string | null; is_transcribed_audio?: boolean }
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
  evolutionMessageKey?: any; // Full key object for Evolution API media download
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
        evolutionMessageKey: body.data.key,
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
        evolutionMessageKey: body.data.key,
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
        evolutionMessageKey: body.data.key,
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
        evolutionMessageKey: body.data.key,
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
