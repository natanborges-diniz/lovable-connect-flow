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
    const body = await req.json();
    const {
      atendimento_id,
      texto,
      remetente_nome,
      media_url,
      mime_type,
      caption,
      interactive,
    }: {
      atendimento_id?: string;
      texto?: string;
      remetente_nome?: string;
      media_url?: string;
      mime_type?: string;
      caption?: string;
      interactive?: InteractivePayload;
    } = body || {};

    if (!atendimento_id) throw new Error("atendimento_id is required");
    if (!texto && !media_url && !interactive) throw new Error("texto, media_url or interactive is required");

    if (interactive) {
      const valErr = validateInteractive(interactive);
      if (valErr) {
        return new Response(JSON.stringify({ error: "invalid_interactive", reason: valErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Guard 24h Meta
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

    const isInteractive = !!interactive;
    const isImage = !isInteractive && !!media_url;
    const finalCaption = (caption ?? texto ?? "").trim();

    let apiResult: any;
    let kind: "interactive" | "image" | "text";
    if (isInteractive) {
      kind = "interactive";
      try {
        apiResult = await sendInteractiveViaMeta(cleanPhone, interactive!);
      } catch (e) {
        // Fallback p/ texto se Meta rejeitar payload interativo
        console.warn("[send-whatsapp] interactive failed, falling back to text:", e);
        apiResult = await sendTextViaMeta(cleanPhone, interactive!.texto);
        kind = "text";
      }
    } else if (isImage) {
      kind = "image";
      apiResult = await sendImageViaMeta(cleanPhone, media_url!, finalCaption || undefined);
    } else {
      kind = "text";
      apiResult = await sendTextViaMeta(cleanPhone, texto!);
    }

    console.log(`[send-whatsapp] Sent via meta_official (${kind}):`, apiResult?.messages?.[0]?.id);

    const persistedContent = isInteractive
      ? interactive!.texto
      : (isImage ? (finalCaption || "[image]") : texto!);
    const persistedTipo = isInteractive ? "interactive" : (isImage ? "image" : "text");

    const { error: msgErr } = await supabase.from("mensagens").insert({
      atendimento_id,
      direcao: "outbound",
      conteudo: persistedContent,
      tipo_conteudo: persistedTipo,
      remetente_nome: remetente_nome || "Operador",
      provedor: "meta_official",
      metadata: {
        whatsapp_message_id: apiResult.messages?.[0]?.id || null,
        provedor: "meta_official",
        ...(isImage ? { media_url, mime_type: mime_type || null } : {}),
        ...(isInteractive ? { interactive } : {}),
      },
    });

    if (msgErr) console.error("[send-whatsapp] Failed to save message:", msgErr);

    return new Response(JSON.stringify({ status: "sent", provedor: "meta_official", whatsapp_response: apiResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-whatsapp] error:", e);
    // Transient Meta 5xx → degrade gracefully (200 + fallback flag) to avoid client crash
    if (e instanceof MetaTransientError) {
      return new Response(
        JSON.stringify({
          error: "meta_unavailable",
          fallback: true,
          retryable: true,
          reason: e.message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
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

// Retries Meta call once on transient 5xx / network errors.
async function fetchMetaWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init);
      if (res.status >= 500 && attempt === 0) {
        await res.text().catch(() => {});
        console.warn(`[send-whatsapp] Meta ${res.status} on attempt ${attempt + 1}, retrying…`);
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 0) {
        console.warn(`[send-whatsapp] Meta fetch failed (${e}), retrying…`);
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

class MetaTransientError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
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

function getMetaCreds() {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!accessToken || !phoneNumberId) {
    throw new Error("Meta WhatsApp credentials not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }
  return { accessToken, phoneNumberId };
}

async function sendTextViaMeta(phone: string, text: string) {
  const { accessToken, phoneNumberId } = getMetaCreds();
  const res = await fetchMetaWithRetry(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
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

async function sendImageViaMeta(phone: string, mediaUrl: string, caption?: string) {
  const { accessToken, phoneNumberId } = getMetaCreds();
  // Meta limita caption a 1024 chars
  const safeCaption = caption ? caption.slice(0, 1024) : undefined;
  const res = await fetchMetaWithRetry(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "image",
      image: {
        link: mediaUrl,
        ...(safeCaption ? { caption: safeCaption } : {}),
      },
    }),
  });

  const result = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(`Meta API error (status ${res.status}): ${bodyToString(result?.error?.message || result)}`);
  }
  return result;
}

// ─── Interactive Messages (botões / listas) ───
// Modelo: clientes recebem botões/listas Meta SOMENTE dentro da janela de 24h.
// Fora dela, usar send-whatsapp-template.

interface InteractivePayload {
  type: "button" | "list";
  texto: string;
  botoes?: Array<{ id: string; titulo: string }>;
  lista?: {
    label: string;
    secao: string;
    itens: Array<{ id: string; titulo: string; descricao?: string }>;
  };
}

function validateInteractive(p: InteractivePayload): string | null {
  if (!p || !p.texto || !p.type) return "missing_fields";
  if (p.type === "button") {
    if (!p.botoes?.length) return "missing_botoes";
    if (p.botoes.length > 3) return "botoes_max_3";
    for (const b of p.botoes) {
      if (!b.id || !b.titulo) return "botao_id_or_titulo_missing";
      if (b.id.length > 256) return "botao_id_too_long";
    }
    return null;
  }
  if (p.type === "list") {
    if (!p.lista?.itens?.length) return "missing_itens";
    if (p.lista.itens.length > 10) return "itens_max_10";
    if (!p.lista.label || !p.lista.secao) return "missing_lista_label_or_secao";
    for (const it of p.lista.itens) {
      if (!it.id || !it.titulo) return "item_id_or_titulo_missing";
    }
    return null;
  }
  return "invalid_type";
}

function trunc(s: string, n: number): string {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function sendInteractiveViaMeta(phone: string, p: InteractivePayload) {
  const { accessToken, phoneNumberId } = getMetaCreds();

  let interactive: any;
  if (p.type === "button") {
    interactive = {
      type: "button",
      body: { text: trunc(p.texto, 1024) },
      action: {
        buttons: p.botoes!.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: trunc(b.titulo, 20) },
        })),
      },
    };
  } else {
    interactive = {
      type: "list",
      body: { text: trunc(p.texto, 1024) },
      action: {
        button: trunc(p.lista!.label, 20),
        sections: [{
          title: trunc(p.lista!.secao, 24),
          rows: p.lista!.itens.slice(0, 10).map((it) => ({
            id: it.id,
            title: trunc(it.titulo, 24),
            ...(it.descricao ? { description: trunc(it.descricao, 72) } : {}),
          })),
        }],
      },
    };
  }

  const res = await fetchMetaWithRetry(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "interactive",
      interactive,
    }),
  });

  const result = await readResponseBody(res);
  if (!res.ok) {
    throw new Error(`Meta API error (status ${res.status}) [interactive ${p.type}]: ${bodyToString(result?.error?.message || result)}`);
  }
  return result;
}
