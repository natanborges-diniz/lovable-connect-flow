// register-push-token: chamado pelo app Atrium Messenger no login.
// Persiste push_token (FCM/APNs) em profiles.metadata para uso pelo dispatch-push.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "missing_authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");

    // Valida JWT e descobre user_id
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "invalid_jwt" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const platform = body.platform === "ios" || body.platform === "android" ? body.platform : null;

    if (!token || !platform) {
      return new Response(JSON.stringify({
        error: "invalid_body",
        details: "token (string) e platform ('ios'|'android') são obrigatórios",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (token.length < 10 || token.length > 4096) {
      return new Response(JSON.stringify({ error: "token_length_invalid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role para escrever metadata sem depender de RLS de UPDATE no campo
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Lê metadata atual e faz merge (jsonb || jsonb)
    const { data: profile, error: readErr } = await admin
      .from("profiles")
      .select("metadata")
      .eq("id", user.id)
      .maybeSingle();

    if (readErr) {
      console.error("[register-push-token] read error", readErr);
      return new Response(JSON.stringify({ error: "profile_read_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentMeta = (profile?.metadata as Record<string, unknown>) || {};
    const newMeta = {
      ...currentMeta,
      push_token: token,
      push_platform: platform,
      push_registered_at: new Date().toISOString(),
    };

    const { error: updErr } = await admin
      .from("profiles")
      .update({ metadata: newMeta })
      .eq("id", user.id);

    if (updErr) {
      console.error("[register-push-token] update error", updErr);
      return new Response(JSON.stringify({ error: "profile_update_failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[register-push-token] registered", { user_id: user.id, platform });
    return new Response(JSON.stringify({ status: "ok", platform }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[register-push-token] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
