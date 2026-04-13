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
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create": {
        const { nome, descricao, expressao_cron, funcao_alvo, payload } = body;

        // Insert into cron_jobs table
        const { data: job, error: insertErr } = await supabase
          .from("cron_jobs")
          .insert({
            nome,
            descricao,
            expressao_cron,
            funcao_alvo,
            payload: payload || {},
            ativo: true,
          })
          .select()
          .single();
        if (insertErr) throw insertErr;

        // Schedule in pg_cron
        const cronName = `cron_${job.id.replace(/-/g, "_")}`;
        const httpCall = buildHttpCall(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, funcao_alvo, payload);
        
        const { data: scheduleResult, error: scheduleErr } = await supabase.rpc("schedule_cron_job" as any, {
          job_name: cronName,
          cron_expression: expressao_cron,
          sql_command: httpCall,
        });

        if (scheduleErr) {
          console.error("pg_cron schedule error:", scheduleErr);
          // Still return success — cron_jobs table is the source of truth
        } else {
          // Store pg_cron job id
          await supabase
            .from("cron_jobs")
            .update({ pg_cron_job_id: scheduleResult } as any)
            .eq("id", job.id);
        }

        return jsonResponse({ ok: true, job });
      }

      case "update": {
        const { id, nome, descricao, expressao_cron, funcao_alvo, payload } = body;

        // Update in cron_jobs table
        const { data: job, error: updateErr } = await supabase
          .from("cron_jobs")
          .update({
            nome,
            descricao,
            expressao_cron,
            funcao_alvo,
            payload: payload || {},
          } as any)
          .eq("id", id)
          .select()
          .single();
        if (updateErr) throw updateErr;

        // Reschedule: unschedule old, schedule new
        const cronName = `cron_${id.replace(/-/g, "_")}`;
        try {
          await supabase.rpc("unschedule_cron_job" as any, { job_name: cronName });
        } catch { /* might not exist */ }

        if (job.ativo) {
          const httpCall = buildHttpCall(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, funcao_alvo, payload);
          await supabase.rpc("schedule_cron_job" as any, {
            job_name: cronName,
            cron_expression: expressao_cron,
            sql_command: httpCall,
          });
        }

        return jsonResponse({ ok: true, job });
      }

      case "toggle": {
        const { id, ativo } = body;

        const { data: job, error } = await supabase
          .from("cron_jobs")
          .update({ ativo } as any)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;

        const cronName = `cron_${id.replace(/-/g, "_")}`;

        if (!ativo) {
          // Unschedule
          try {
            await supabase.rpc("unschedule_cron_job" as any, { job_name: cronName });
          } catch { /* ok */ }
        } else {
          // Re-schedule
          const httpCall = buildHttpCall(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, job.funcao_alvo, job.payload);
          await supabase.rpc("schedule_cron_job" as any, {
            job_name: cronName,
            cron_expression: job.expressao_cron,
            sql_command: httpCall,
          });
        }

        return jsonResponse({ ok: true });
      }

      case "delete": {
        const { id } = body;
        const cronName = `cron_${id.replace(/-/g, "_")}`;

        // Unschedule from pg_cron
        try {
          await supabase.rpc("unschedule_cron_job" as any, { job_name: cronName });
        } catch { /* ok */ }

        // Delete from table
        const { error } = await supabase.from("cron_jobs").delete().eq("id", id);
        if (error) throw error;

        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("manage-cron-jobs error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function buildHttpCall(supabaseUrl: string, serviceKey: string, funcaoAlvo: string, payload: any): string {
  const payloadStr = JSON.stringify(payload || {}).replace(/'/g, "''");
  return `SELECT net.http_post(url:='${supabaseUrl}/functions/v1/${funcaoAlvo}', headers:='{"Content-Type": "application/json", "Authorization": "Bearer ${serviceKey}"}'::jsonb, body:='${payloadStr}'::jsonb) as request_id;`;
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
