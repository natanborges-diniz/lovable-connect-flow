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
    const { contato_id, atendimento_id, loja_nome, loja_telefone, data_horario, observacoes } = await req.json();

    if (!contato_id || !loja_nome || !data_horario) {
      throw new Error("contato_id, loja_nome and data_horario are required");
    }

    // Get contato info
    const { data: contato } = await supabase
      .from("contatos")
      .select("nome, telefone")
      .eq("id", contato_id)
      .single();

    if (!contato) throw new Error("Contato not found");

    // Create agendamento
    const { data: agendamento, error: agErr } = await supabase
      .from("agendamentos")
      .insert({
        contato_id,
        atendimento_id: atendimento_id || null,
        loja_nome,
        loja_telefone: loja_telefone || null,
        data_horario,
        status: "agendado",
        observacoes: observacoes || null,
      })
      .select()
      .single();

    if (agErr) throw agErr;

    // Format date for message
    const dt = new Date(data_horario);
    const dataFormatada = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    const horaFormatada = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

    // NOTE: WhatsApp confirmation is sent by the AI in ai-triage (args.resposta).
    // This function only creates the record and logs the CRM event.

    // Log CRM event
    await supabase.from("eventos_crm").insert({
      contato_id,
      tipo: "agendamento_criado",
      descricao: `Agendamento: ${loja_nome} em ${dataFormatada} às ${horaFormatada}`,
      referencia_tipo: "agendamento",
      referencia_id: agendamento.id,
      metadata: { loja_nome, data_horario, loja_telefone },
    });

    return new Response(JSON.stringify({ status: "ok", agendamento }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("agendar-cliente error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
