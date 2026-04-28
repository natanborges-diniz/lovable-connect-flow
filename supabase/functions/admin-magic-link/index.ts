import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autorizado" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const callerId = userData?.user?.id;
    if (userErr || !callerId) return json({ error: "Sessão inválida" }, 401);

    const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: callerId });
    if (!isAdmin) return json({ error: "Apenas admins" }, 403);

    const { email, redirect_to } = await req.json().catch(() => ({}));
    if (!email || typeof email !== "string") return json({ error: "email obrigatório" }, 400);

    // Use the caller's origin so the magic link redirects back to the same app
    // (preview vs published) the admin is using.
    const originHeader = req.headers.get("origin") || req.headers.get("referer") || "";
    let inferredOrigin = "";
    try {
      if (originHeader) inferredOrigin = new URL(originHeader).origin;
    } catch {
      inferredOrigin = "";
    }
    const finalRedirect = redirect_to || inferredOrigin || "https://atrium-link.lovable.app";

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: email.trim().toLowerCase(),
      options: {
        redirectTo: finalRedirect,
      },
    });

    if (error) {
      console.error("[admin-magic-link] generateLink error", error);
      return json({ error: error.message }, 400);
    }

    const props = (data as any)?.properties ?? {};
    const url: string | undefined = props.action_link;

    console.log("[admin-magic-link] gerado para", email, {
      hasUrl: !!url,
      redirect: finalRedirect,
      keys: Object.keys(props),
    });

    if (!url) {
      return json({ error: "Supabase não retornou action_link", debug: props }, 500);
    }

    return json({ url, redirect_to: finalRedirect });
  } catch (e: any) {
    console.error("[admin-magic-link] exception", e);
    return json({ error: e?.message ?? "Erro interno" }, 500);
  }
});
