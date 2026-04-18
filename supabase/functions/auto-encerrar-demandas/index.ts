import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INACTIVITY_MINUTES = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const cutoff = new Date(Date.now() - INACTIVITY_MINUTES * 60_000).toISOString();

    const { data: stale, error } = await supabase
      .from("demandas_loja")
      .select("id, protocolo, numero_curto, updated_at, status")
      .in("status", ["aberta", "respondida"])
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(50);

    if (error) throw error;

    const results: any[] = [];
    for (const d of stale || []) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/encerrar-demanda-loja`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "X-Internal-Caller": "auto-encerrar-demandas",
          },
          body: JSON.stringify({ demanda_id: d.id, encerrado_por: "auto" }),
        });
        const json = await resp.json().catch(() => ({}));
        results.push({ id: d.id, protocolo: d.protocolo, ok: resp.ok, json });
      } catch (e) {
        results.push({ id: d.id, protocolo: d.protocolo, ok: false, error: String(e) });
      }
    }

    // Atualiza ultimo_disparo
    await supabase
      .from("cron_jobs")
      .update({ ultimo_disparo: new Date().toISOString() })
      .eq("nome", "auto-encerrar-demandas");

    return new Response(JSON.stringify({
      status: "ok",
      checked: stale?.length || 0,
      cutoff,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("auto-encerrar-demandas error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
