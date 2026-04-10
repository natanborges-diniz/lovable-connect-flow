import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { solicitacao_id, mensagem } = await req.json();
    if (!solicitacao_id || !mensagem) {
      return new Response(JSON.stringify({ error: "solicitacao_id and mensagem are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get solicitação with contato
    const { data: sol, error: solErr } = await supabase
      .from("solicitacoes")
      .select("*, contato:contatos(id, nome, telefone)")
      .eq("id", solicitacao_id)
      .single();
    if (solErr || !sol) {
      return new Response(JSON.stringify({ error: "Solicitação não encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contato = (sol as any).contato;
    if (!contato?.telefone) {
      return new Response(JSON.stringify({ error: "Contato sem telefone" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const protocolo = (sol as any).protocolo || "";
    const textoFormatado = protocolo
      ? `📋 *Protocolo: ${protocolo}*\n\n${mensagem}`
      : mensagem;

    // Find active atendimento or send direct
    const tel = contato.telefone.replace(/\D/g, "");
    const { data: canal } = await supabase
      .from("canais")
      .select("contato_id")
      .eq("identificador", tel)
      .eq("tipo", "whatsapp")
      .limit(1)
      .single();

    let sent = false;
    if (canal) {
      const { data: atend } = await supabase
        .from("atendimentos")
        .select("id")
        .eq("contato_id", canal.contato_id)
        .in("status", ["aguardando", "em_atendimento"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (atend) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ atendimento_id: atend.id, texto: textoFormatado, remetente_nome: "Sistema" }),
        });
        sent = true;
      }
    }

    if (!sent) {
      await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ telefone: tel, texto: textoFormatado, remetente_nome: "Sistema" }),
      });
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("responder-solicitacao error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
