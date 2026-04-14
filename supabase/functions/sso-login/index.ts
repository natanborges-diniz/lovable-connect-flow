import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Validate service key
  const serviceKey = req.headers.get("x-service-key");
  const expectedKey = Deno.env.get("INTERNAL_SERVICE_SECRET");
  if (!expectedKey || serviceKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { email, setor_id, role, nome } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: "https://atrium-link.lovable.app",
        data: nome ? { nome } : undefined,
      },
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = data.user?.id;
    if (userId) {
      // Update profile name if provided (handles existing users whose name wasn't set)
      if (nome) {
        await supabase
          .from("profiles")
          .update({ nome, ...(setor_id ? { setor_id } : {}) })
          .eq("id", userId)
          .eq("nome", email); // Only overwrite if name is still the email fallback
      } else if (setor_id) {
        await supabase
          .from("profiles")
          .update({ setor_id })
          .eq("id", userId);
      }

      // Provision user_role if setor_id and role provided
      if (setor_id || role) {
        const assignedRole = role || "setor_usuario";
        await supabase
          .from("user_roles")
          .upsert(
            { user_id: userId, role: assignedRole, setor_id: setor_id || null },
            { onConflict: "user_id,role,setor_id" }
          );
      }
    }

    return new Response(
      JSON.stringify({ url: data.properties.action_link }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
