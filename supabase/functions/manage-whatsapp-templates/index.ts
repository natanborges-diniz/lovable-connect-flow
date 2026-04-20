import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_TO_LOCAL_STATUS: Record<string, string> = {
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const wabaId = Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");

  if (!accessToken || !wabaId) {
    return new Response(JSON.stringify({ error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, template_name, template_data, sync } = await req.json();

    // LIST templates (com upsert opcional no catálogo local)
    if (action === "list") {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error || data));

      // Sync = true → faz upsert no catálogo local
      let synced = 0;
      if (sync === true && Array.isArray(data.data)) {
        const now = new Date().toISOString();
        for (const t of data.data) {
          const body = (t.components || []).find((c: any) => c.type === "BODY")?.text || "";
          // Extrai variáveis {{1}}, {{2}}…
          const varMatches = body.match(/\{\{(\d+)\}\}/g) || [];
          const variaveis = [...new Set(varMatches.map((v: string) => v.replace(/[{}]/g, "")))];
          const localStatus = META_TO_LOCAL_STATUS[t.status] || t.status?.toLowerCase() || "pending";

          const { error: upErr } = await supabase
            .from("whatsapp_templates")
            .upsert({
              nome: t.name,
              categoria: t.category || "UTILITY",
              idioma: t.language || "pt_BR",
              body,
              variaveis,
              status: localStatus,
              motivo_rejeicao: t.rejected_reason || null,
              ultima_sincronizacao: now,
            }, { onConflict: "nome" });
          if (!upErr) synced++;
          else console.error(`upsert ${t.name}:`, upErr);
        }
      }

      return jsonRes({ ...data, synced });
    }

    // GET single template status
    if (action === "status" && template_name) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${template_name}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error || data));
      return jsonRes(data);
    }

    // CREATE template
    if (action === "create" && template_data) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(template_data),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error || data));
      return jsonRes({ status: "created", data });
    }

    // DELETE template
    if (action === "delete" && template_name) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${template_name}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error || data));
      return jsonRes({ status: "deleted", data });
    }

    throw new Error("Invalid action. Use: list, status, create, delete");
  } catch (e) {
    console.error("manage-whatsapp-templates error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function jsonRes(data: any) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}
