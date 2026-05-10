// audit-ia-ignorar-grupo
// Marca um grupo de auditoria como ignorado e propaga para todas as auditorias do grupo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { grupo_id, motivo, user_id } = await req.json();
    if (!grupo_id) {
      return new Response(JSON.stringify({ error: "grupo_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: grupo } = await supabase
      .from("ia_auditorias_grupos").select("auditoria_ids").eq("id", grupo_id).single();

    await supabase.from("ia_auditorias_grupos").update({
      status: "ignorado",
      ignorado_motivo: motivo || null,
      updated_at: new Date().toISOString(),
    }).eq("id", grupo_id);

    if (grupo?.auditoria_ids?.length) {
      await supabase.from("ia_auditorias").update({
        status: "ignorado",
        ignorado_motivo: motivo || null,
        ignorado_por: user_id || null,
        ignorado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).in("id", grupo.auditoria_ids);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-ignorar-grupo]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
