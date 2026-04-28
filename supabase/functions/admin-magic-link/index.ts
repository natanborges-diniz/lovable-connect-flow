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

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: email.trim().toLowerCase(),
      options: {
        redirectTo: redirect_to || "https://atrium-link.lovable.app",
      },
    });

    if (error) return json({ error: error.message }, 400);
    return json({ url: (data as any)?.properties?.action_link });
  } catch (e: any) {
    return json({ error: e?.message ?? "Erro interno" }, 500);
  }
});
