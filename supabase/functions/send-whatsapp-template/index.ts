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
      throw new Error("Meta WhatsApp credentials not configured");
    }

    const { contato_id, template_name, template_params, language } = await req.json();

    if (!contato_id || !template_name) {
      throw new Error("contato_id and template_name are required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get contato
    const { data: contato, error: cErr } = await supabase
      .from("contatos")
      .select("*")
      .eq("id", contato_id)
      .single();

    if (cErr || !contato) throw new Error("Contato not found");
    if (!contato.telefone) throw new Error("Contato has no phone number");

    const cleanPhone = contato.telefone.replace(/\D/g, "");

    // Build template message
    const templateBody: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanPhone,
      type: "template",
      template: {
        name: template_name,
        language: { code: language || "pt_BR" },
      },
    };

    if (template_params?.length) {
      templateBody.template.components = [
        {
          type: "body",
          parameters: template_params.map((p: string) => ({ type: "text", text: p })),
        },
      ];
    }

    // Send template via Meta Graph API
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(templateBody),
    });

    const apiResult = await res.json();

    if (!res.ok) {
      throw new Error(`Meta API error: ${JSON.stringify(apiResult.error?.message || apiResult)}`);
    }

    // ─── Reuse existing open atendimento or create new ───
    let atendimentoId: string;
    let solicitacaoId: string;

    // Search for any open atendimento for this contact (any provider)
    const { data: existingAtendimento } = await supabase
      .from("atendimentos")
      .select("id, solicitacao_id")
      .eq("contato_id", contato_id)
      .eq("canal", "whatsapp")
      .neq("status", "encerrado")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (existingAtendimento) {
      // Reuse existing atendimento — just log the template message there
      atendimentoId = existingAtendimento.id;
      solicitacaoId = existingAtendimento.solicitacao_id;
      console.log(`Reusing existing atendimento ${atendimentoId} for template ${template_name}`);
    } else {
      // No open atendimento — create new solicitação + atendimento
      const { data: solicitacao, error: solErr } = await supabase
        .from("solicitacoes")
        .insert({
          contato_id,
          assunto: `Disparo proativo: ${template_name}`,
          descricao: `Template enviado: ${template_name}`,
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
          contato_id,
          canal: "whatsapp",
          status: "aguardando",
          canal_provedor: "meta_official",
        })
        .select()
        .single();
      if (atErr) throw atErr;

      atendimentoId = atendimento.id;
      solicitacaoId = solicitacao.id;
      console.log(`Created new atendimento ${atendimentoId} for template ${template_name}`);
    }

    // Save outbound template message (always with provedor meta_official for traceability)
    await supabase.from("mensagens").insert({
      atendimento_id: atendimentoId,
      direcao: "outbound",
      conteudo: `[Template: ${template_name}]${template_params?.length ? " Params: " + template_params.join(", ") : ""}`,
      remetente_nome: "Sistema",
      provedor: "meta_official",
      metadata: { whatsapp_message_id: apiResult.messages?.[0]?.id, template_name },
    });

    await supabase.from("eventos_crm").insert({
      contato_id,
      tipo: "disparo_proativo",
      descricao: `Template "${template_name}" enviado via API oficial`,
      referencia_tipo: "atendimento",
      referencia_id: atendimentoId,
    });

    return new Response(JSON.stringify({
      status: "sent",
      atendimento_id: atendimentoId,
      solicitacao_id: solicitacaoId,
      whatsapp_response: apiResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp-template error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
