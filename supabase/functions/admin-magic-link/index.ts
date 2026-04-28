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

    // URL pública do InFoco Messenger. O Messenger trata `?magic_token=...&email=...`
    // chamando supabase.auth.verifyOtp({ email, token, type: "magiclink" }) localmente —
    // então precisamos enviar o OTP bruto (`email_otp`) e não o `hashed_token`.
    const MESSENGER_URL = "https://desktop-joy-app.lovable.app";

    // Redirect final que pedimos ao Supabase. Mesmo que o provedor troque pela Site URL,
    // não importa: vamos descartar o action_link e montar o link manualmente com o OTP.
    const requestedRedirect =
      (typeof redirect_to === "string" && redirect_to.startsWith("http") ? redirect_to : "") ||
      MESSENGER_URL;

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: email.trim().toLowerCase(),
      options: { redirectTo: requestedRedirect },
    });

    if (error) {
      console.error("[admin-magic-link] generateLink error", error);
      return json({ error: error.message }, 400);
    }

    const props = (data as any)?.properties ?? {};
    const emailOtp: string | undefined = props.email_otp;
    const hashedToken: string | undefined = props.hashed_token;
    const actionLink: string | undefined = props.action_link;

    console.log("[admin-magic-link] gerado para", email, {
      hasEmailOtp: !!emailOtp,
      hasHashedToken: !!hashedToken,
      hasActionLink: !!actionLink,
      keys: Object.keys(props),
    });

    if (!emailOtp) {
      return json({ error: "Auth não retornou email_otp", debug: props }, 500);
    }

    // URL final → app Messenger consumindo verifyOtp(email + token) localmente.
    const finalUrl = `${MESSENGER_URL}/login?magic_token=${encodeURIComponent(emailOtp)}&email=${encodeURIComponent(email.trim().toLowerCase())}`;

    return json({ url: finalUrl, redirect_to: MESSENGER_URL });

  } catch (e: any) {
    console.error("[admin-magic-link] exception", e);
    return json({ error: e?.message ?? "Erro interno" }, 500);
  }
});
