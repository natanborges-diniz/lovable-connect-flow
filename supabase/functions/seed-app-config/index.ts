// seed-app-config: copia SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (vindos do ambiente
// das edge functions) para a tabela public.app_config, para que funções SQL como
// fn_send_push consigam ler o service_role_key (o vault está vazio neste projeto).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "missing env" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const rows = [
      { key: "SUPABASE_URL", value: SUPABASE_URL, updated_at: new Date().toISOString() },
      { key: "SUPABASE_SERVICE_ROLE_KEY", value: SERVICE_ROLE, updated_at: new Date().toISOString() },
    ];
    const { error } = await admin.from("app_config").upsert(rows, { onConflict: "key" });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, seeded: rows.map(r => r.key) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
