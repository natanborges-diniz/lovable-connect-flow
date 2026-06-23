// Cron: reabertura de atendimentos escalados fora do horário humano.
// Quando ai-triage escala fora do expediente e a janela 24h Meta vai estourar antes da
// próxima abertura, ele grava atendimentos.metadata.reabertura_template_at.
// Este job (a cada 10min) varre vencidos, dispara template aprovado de retomada uma
// única vez (idempotente via metadata.reabertura_template_enviada_at) e libera o
// operador para texto livre quando o cliente responder.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATE_NAME = "retomada_consultor_v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const nowISO = new Date().toISOString();

    // Atendimentos com reabertura agendada e ainda não enviada.
    // metadata é jsonb — usamos filtros explícitos via PostgREST.
    const { data: candidatos, error: qErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, status, metadata")
      .neq("status", "encerrado")
      .not("metadata->>reabertura_template_at", "is", null)
      .is("metadata->>reabertura_template_enviada_at", null)
      .lte("metadata->>reabertura_template_at", nowISO)
      .limit(50);

    if (qErr) throw qErr;

    let enviados = 0;
    let pulados = 0;
    const erros: Array<{ atendimento_id: string; erro: string }> = [];

    for (const at of candidatos || []) {
      try {
        // Confirma janela 24h fechada (se ainda aberta, operador pode responder direto)
        const { data: lastInbound } = await supabase
          .from("mensagens")
          .select("created_at")
          .eq("atendimento_id", at.id)
          .eq("direcao", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const horas = lastInbound
          ? (Date.now() - new Date(lastInbound.created_at).getTime()) / 3_600_000
          : 999;

        if (horas <= 23) {
          // Janela ainda aberta — marca como não-necessário, operador pode digitar direto.
          await supabase
            .from("atendimentos")
            .update({
              metadata: {
                ...(at.metadata || {}),
                reabertura_template_skipped_at: nowISO,
                reabertura_template_skip_reason: "janela_aberta",
              },
            })
            .eq("id", at.id);
          pulados++;
          continue;
        }

        // Dispara template aprovado
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            contato_id: at.contato_id,
            template_name: TEMPLATE_NAME,
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          erros.push({ atendimento_id: at.id, erro: out?.error || `status ${res.status}` });
          continue;
        }

        // Marca idempotente
        await supabase
          .from("atendimentos")
          .update({
            metadata: {
              ...(at.metadata || {}),
              reabertura_template_enviada_at: nowISO,
              reabertura_template_name: TEMPLATE_NAME,
            },
          })
          .eq("id", at.id);

        enviados++;
      } catch (e) {
        erros.push({
          atendimento_id: at.id,
          erro: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    console.log(
      `[cron-reabertura-fora-horario] candidatos=${candidatos?.length || 0} enviados=${enviados} pulados=${pulados} erros=${erros.length}`,
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        candidatos: candidatos?.length || 0,
        enviados,
        pulados,
        erros,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[cron-reabertura-fora-horario] erro:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
