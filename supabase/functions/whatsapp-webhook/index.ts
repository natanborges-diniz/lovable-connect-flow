import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();

    // Support multiple webhook formats (Evolution API, Z-API, etc.)
    // Normalize to a common format
    const message = normalizeWebhookPayload(body);
    if (!message) {
      return new Response(JSON.stringify({ status: "ignored", reason: "Unsupported message type or format" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { phone, senderName, text, messageId } = message;

    // 1. Find or create contato by phone
    let { data: contato } = await supabase
      .from("contatos")
      .select("*")
      .eq("telefone", phone)
      .single();

    if (!contato) {
      const { data: newContato, error: createErr } = await supabase
        .from("contatos")
        .insert({
          nome: senderName || phone,
          tipo: "cliente",
          telefone: phone,
        })
        .select()
        .single();
      if (createErr) throw createErr;
      contato = newContato;
    }

    // 2. Find or create canal
    let { data: canal } = await supabase
      .from("canais")
      .select("*")
      .eq("contato_id", contato.id)
      .eq("tipo", "whatsapp")
      .eq("identificador", phone)
      .single();

    if (!canal) {
      await supabase.from("canais").insert({
        contato_id: contato.id,
        tipo: "whatsapp",
        identificador: phone,
        principal: true,
      });
    }

    // 3. Find open atendimento for this contato or create solicitação + atendimento
    let { data: atendimentoAberto } = await supabase
      .from("atendimentos")
      .select("id")
      .eq("contato_id", contato.id)
      .eq("canal", "whatsapp")
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let atendimentoId: string;

    if (atendimentoAberto) {
      atendimentoId = atendimentoAberto.id;
    } else {
      // Create new solicitação
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

      // Create atendimento
      const { data: atendimento, error: atErr } = await supabase
        .from("atendimentos")
        .insert({
          solicitacao_id: solicitacao.id,
          contato_id: contato.id,
          canal: "whatsapp",
          status: "aguardando",
        })
        .select()
        .single();
      if (atErr) throw atErr;

      atendimentoId = atendimento.id;

      // Create CRM event
      await supabase.from("eventos_crm").insert({
        contato_id: contato.id,
        tipo: "solicitacao_criada",
        descricao: `Nova solicitação via WhatsApp: ${text.substring(0, 100)}`,
        referencia_tipo: "solicitacao",
        referencia_id: solicitacao.id,
      });
    }

    // 4. Save message
    await supabase.from("mensagens").insert({
      atendimento_id: atendimentoId,
      direcao: "inbound",
      conteudo: text,
      remetente_nome: senderName || contato.nome,
      metadata: { whatsapp_message_id: messageId },
    });

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

interface NormalizedMessage {
  phone: string;
  senderName: string;
  text: string;
  messageId: string;
}

function normalizeWebhookPayload(body: any): NormalizedMessage | null {
  // Evolution API format
  if (body.data?.key?.remoteJid) {
    const phone = body.data.key.remoteJid.replace("@s.whatsapp.net", "");
    return {
      phone,
      senderName: body.data.pushName || phone,
      text: body.data.message?.conversation || body.data.message?.extendedTextMessage?.text || "",
      messageId: body.data.key.id || "",
    };
  }

  // Z-API format
  if (body.phone) {
    return {
      phone: body.phone.replace(/\D/g, ""),
      senderName: body.senderName || body.phone,
      text: body.text?.message || body.message || "",
      messageId: body.messageId || body.zapiMessageId || "",
    };
  }

  // Generic/simple format
  if (body.from && body.body) {
    return {
      phone: body.from.replace(/\D/g, ""),
      senderName: body.senderName || body.from,
      text: body.body,
      messageId: body.id || "",
    };
  }

  return null;
}
