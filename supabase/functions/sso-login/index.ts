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
    const { email, setor_id, role, nome, departamento } = await req.json();
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
          .update({ nome })
          .eq("id", userId)
          .eq("nome", email); // Only overwrite if name is still the email fallback
      }

      // Resolve setor_id: explicit > departamento (string) > profile.setor_id (auto-heal)
      let resolvedSetorId: string | null = setor_id || null;

      if (!resolvedSetorId && typeof departamento === "string" && departamento.trim()) {
        const dep = departamento.trim();
        const { data: setor } = await supabase
          .from("setores")
          .select("id")
          .or(`nome.ilike.${dep},nome.ilike.${dep.replace(/_/g, " ")}`)
          .eq("ativo", true)
          .limit(1)
          .maybeSingle();
        if (setor?.id) resolvedSetorId = setor.id;
        else console.warn(`[sso-login] departamento "${dep}" não encontrado em setores`);
      }

      // Auto-heal: if no setor came in body, use existing profile.setor_id
      if (!resolvedSetorId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("setor_id")
          .eq("id", userId)
          .maybeSingle();
        if (profile?.setor_id) resolvedSetorId = profile.setor_id;
      }

      // Persist setor_id on profile when resolved
      if (resolvedSetorId) {
        await supabase
          .from("profiles")
          .update({ setor_id: resolvedSetorId })
          .eq("id", userId);
      }

      // Provision user_role whenever we have a resolved setor (default = setor_usuario)
      if (resolvedSetorId || role) {
        const assignedRole = role || "setor_usuario";
        await supabase
          .from("user_roles")
          .upsert(
            { user_id: userId, role: assignedRole, setor_id: resolvedSetorId },
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
