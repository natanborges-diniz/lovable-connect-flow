import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  try {
    const { action, template_name, template_data } = await req.json();

    // LIST templates
    if (action === "list") {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error || data));
      return jsonRes(data);
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
