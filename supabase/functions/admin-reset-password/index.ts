import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const INTERNAL_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Allow internal service-to-service calls via shared secret (one-off ops)
    const internalHeader = req.headers.get("x-internal-secret");
    const isInternalCall = !!INTERNAL_SECRET && internalHeader === INTERNAL_SECRET;

    if (!isInternalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsErr } = await admin.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Sessão inválida" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const callerId = claimsData.claims.sub as string;

      const { data: isAdminData, error: isAdminErr } = await admin.rpc("is_admin", {
        _user_id: callerId,
      });
      if (isAdminErr || !isAdminData) {
        return new Response(JSON.stringify({ error: "Apenas admins podem redefinir senhas" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const { user_id, new_password } = body ?? {};
    if (!user_id || typeof user_id !== "string") {
      return new Response(JSON.stringify({ error: "user_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!new_password || typeof new_password !== "string" || new_password.length < 6) {
      return new Response(JSON.stringify({ error: "Senha precisa ter no mínimo 6 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(user_id, {
      password: new_password,
    });
    if (updErr) {
      const raw = (updErr.message ?? "").toLowerCase();
      let friendly = updErr.message;
      let status = 500;

      if (raw.includes("weak") || raw.includes("pwned") || raw.includes("known to be")) {
        friendly =
          "Essa senha aparece em listas públicas de senhas vazadas e foi bloqueada. Escolha uma combinação mais forte (use letras, números e símbolos, evite sequências comuns).";
        status = 400;
      } else if (raw.includes("password should be at least") || raw.includes("at least")) {
        friendly = "A senha precisa atender ao tamanho mínimo exigido.";
        status = 400;
      } else if (raw.includes("same as the old")) {
        friendly = "A nova senha não pode ser igual à anterior.";
        status = 400;
      }

      return new Response(JSON.stringify({ error: friendly }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit log
    try {
      const { data: targetProfile } = await admin
        .from("profiles")
        .select("nome")
        .eq("id", user_id)
        .maybeSingle();
      console.log(
        `[admin-reset-password] reset senha user_id=${user_id} (${targetProfile?.nome ?? "?"}) internal=${isInternalCall}`,
      );
    } catch (_) {}

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
