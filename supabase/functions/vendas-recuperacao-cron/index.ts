import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Eligible sales columns for recovery (by name)
const ELIGIBLE_COLUMNS = ["Novo Contato", "Lead", "Orçamento", "Qualificado", "Atendimento Humano", "Retorno"];

// Template sequence
const TEMPLATES = [
  "retomada_contexto_1",
  "retomada_contexto_2",
  "retomada_despedida",
];

// Delays: 48h for first, 72h for subsequent
const DELAY_HOURS = [48, 72, 72];
// After 3rd attempt, wait 72h then move to Perdidos
const FINAL_WAIT_HOURS = 72;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Get eligible sales columns IDs
    const { data: colunas } = await supabase
      .from("pipeline_colunas")
      .select("id, nome")
      .eq("ativo", true)
      .is("setor_id", null);

    if (!colunas?.length) {
      return new Response(JSON.stringify({ status: "no_columns" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eligibleIds = colunas
      .filter((c: any) => ELIGIBLE_COLUMNS.includes(c.nome))
      .map((c: any) => c.id);

    const perdidosCol = colunas.find((c: any) => c.nome === "Perdidos");
    if (!perdidosCol) {
      console.error("Coluna 'Perdidos' not found");
      return new Response(JSON.stringify({ error: "Perdidos column missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!eligibleIds.length) {
      return new Response(JSON.stringify({ status: "no_eligible_columns" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get contacts in eligible columns
    const { data: contatos } = await supabase
      .from("contatos")
      .select("id, nome, telefone, pipeline_coluna_id, metadata")
      .eq("ativo", true)
      .eq("tipo", "cliente")
      .in("pipeline_coluna_id", eligibleIds);

    if (!contatos?.length) {
      return new Response(JSON.stringify({ status: "no_contacts", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    let processed = 0;
    let movedToPerdidos = 0;

    for (const contato of contatos) {
      try {
        const meta = (contato.metadata as any) || {};
        const recuperacao = meta.recuperacao_vendas || { tentativas: 0 };
        const tentativas = recuperacao.tentativas || 0;

        // Find latest open atendimento for this contact
        const { data: atendimento } = await supabase
          .from("atendimentos")
          .select("id, created_at")
          .eq("contato_id", contato.id)
          .eq("canal", "whatsapp")
          .neq("status", "encerrado")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!atendimento) continue;

        // Find last inbound message time
        const { data: lastInbound } = await supabase
          .from("mensagens")
          .select("created_at")
          .eq("atendimento_id", atendimento.id)
          .eq("direcao", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!lastInbound) continue;

        const lastInboundAt = new Date(lastInbound.created_at);
        const hoursSinceInbound = (now.getTime() - lastInboundAt.getTime()) / (1000 * 60 * 60);

        // If already completed 3 attempts, check if time to move to Perdidos
        if (tentativas >= 3) {
          const lastAttemptAt = recuperacao.ultima_tentativa_at ? new Date(recuperacao.ultima_tentativa_at) : lastInboundAt;
          const hoursSinceLastAttempt = (now.getTime() - lastAttemptAt.getTime()) / (1000 * 60 * 60);

          if (hoursSinceLastAttempt >= FINAL_WAIT_HOURS) {
            // Move to Perdidos
            await supabase.from("contatos").update({
              pipeline_coluna_id: perdidosCol.id,
              metadata: { ...meta, recuperacao_vendas: { ...recuperacao, status: "perdido" } },
            }).eq("id", contato.id);

            await supabase.from("eventos_crm").insert({
              contato_id: contato.id,
              tipo: "lead_perdido",
              descricao: "Lead movido para Perdidos após 3 tentativas de recuperação sem resposta",
            });

            movedToPerdidos++;
            console.log(`[PERDIDO] ${contato.nome} (${contato.id}) moved to Perdidos`);
          }
          continue;
        }

        // Determine required delay
        const requiredDelay = DELAY_HOURS[tentativas]; // 48h for first, 72h for 2nd/3rd

        // For first attempt: check hours since last inbound
        // For subsequent: check hours since last attempt
        let referenceTime: Date;
        if (tentativas === 0) {
          referenceTime = lastInboundAt;
        } else {
          referenceTime = recuperacao.ultima_tentativa_at
            ? new Date(recuperacao.ultima_tentativa_at)
            : lastInboundAt;
        }

        const hoursSinceReference = (now.getTime() - referenceTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceReference < requiredDelay) continue;

        // Generate context summary on first attempt
        let resumoContexto = recuperacao.resumo_contexto || "";
        if (tentativas === 0) {
          try {
            const sumResp = await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ atendimento_id: atendimento.id }),
            });
            if (sumResp.ok) {
              const sumData = await sumResp.json();
              resumoContexto = sumData.summary || sumData.resumo || "seus óculos";
              // Truncate for template parameter (max ~100 chars)
              if (resumoContexto.length > 100) {
                resumoContexto = resumoContexto.substring(0, 97) + "...";
              }
            }
          } catch (e) {
            console.error(`Summary failed for ${contato.id}:`, e);
            resumoContexto = "seus óculos";
          }
        }

        // Send recovery template via official channel
        const templateName = TEMPLATES[tentativas];
        const firstName = contato.nome.split(" ")[0];

        try {
          const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contato_id: contato.id,
              template_name: templateName,
              template_params: [firstName, resumoContexto],
              language: "pt_BR",
            }),
          });

          if (!sendResp.ok) {
            const errBody = await sendResp.text();
            console.error(`Template send failed for ${contato.id}: ${errBody}`);
            continue;
          }

          // Update metadata with recovery state
          const updatedRecuperacao = {
            tentativas: tentativas + 1,
            ultima_tentativa_at: now.toISOString(),
            resumo_contexto: resumoContexto,
          };

          await supabase.from("contatos").update({
            metadata: { ...meta, recuperacao_vendas: updatedRecuperacao },
          }).eq("id", contato.id);

          await supabase.from("eventos_crm").insert({
            contato_id: contato.id,
            tipo: "recuperacao_tentativa",
            descricao: `Tentativa ${tentativas + 1}/3 de recuperação: template "${templateName}"`,
            metadata: { template: templateName, tentativa: tentativas + 1 },
          });

          processed++;
          console.log(`[RECOVERY] ${contato.nome}: attempt ${tentativas + 1}/3, template=${templateName}`);
        } catch (sendErr) {
          console.error(`Send error for ${contato.id}:`, sendErr);
        }
      } catch (contactErr) {
        console.error(`Error processing contact ${contato.id}:`, contactErr);
      }
    }

    return new Response(JSON.stringify({
      status: "ok",
      processed,
      moved_to_perdidos: movedToPerdidos,
      total_checked: contatos.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vendas-recuperacao-cron error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
