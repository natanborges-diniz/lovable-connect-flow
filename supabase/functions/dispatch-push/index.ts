// dispatch-push: envia push notifications para o app Atrium Messenger via FCM/APNs.
// Disparado pelo trigger trg_notificacoes_dispatch_push após cada INSERT em notificacoes.
// Modo "log only" enquanto FCM_SERVER_KEY/APNS_* não estiverem configurados.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { notificacao_id, usuario_id, setor_id, titulo, mensagem, tipo, referencia_id } = await req.json();

    // Resolve destinatários: usuario_id explícito ou todos do setor
    let userIds: string[] = [];
    if (usuario_id) {
      userIds = [usuario_id];
    } else if (setor_id) {
      const { data: members } = await supabase
        .from("profiles")
        .select("id")
        .eq("setor_id", setor_id)
        .eq("ativo", true);
      userIds = (members || []).map((m: any) => m.id);
    }

    if (userIds.length === 0) {
      console.log("[dispatch-push] No recipients", { notificacao_id, usuario_id, setor_id });
      return new Response(JSON.stringify({ status: "no_recipients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca push tokens em profiles.metadata
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nome, metadata")
      .in("id", userIds);

    const withToken = (profiles || []).filter((p: any) => p?.metadata?.push_token);
    const withoutToken = (profiles || []).filter((p: any) => !p?.metadata?.push_token);

    const fcmEnabled = !!FCM_SERVER_KEY;

    if (!fcmEnabled) {
      console.log("[dispatch-push] log-only mode (FCM_SERVER_KEY missing)", {
        notificacao_id,
        recipients: userIds.length,
        with_token: withToken.length,
        without_token: withoutToken.length,
        titulo,
        tipo,
      });
      return new Response(JSON.stringify({
        status: "log_only",
        recipients: userIds.length,
        with_token: withToken.length,
        without_token: withoutToken.length,
        reason: "fcm_credentials_not_configured",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // FCM dispatch real
    const results: any[] = [];
    for (const p of withToken) {
      const token = (p as any).metadata.push_token as string;
      const platform = (p as any).metadata.push_platform as string | undefined;
      try {
        const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `key=${FCM_SERVER_KEY}`,
          },
          body: JSON.stringify({
            to: token,
            notification: { title: titulo, body: mensagem || "" },
            data: {
              tipo: tipo || "notificacao",
              referencia_id: referencia_id || "",
              notificacao_id,
            },
          }),
        });
        const fcmJson = await fcmRes.json().catch(() => ({}));
        results.push({ user_id: (p as any).id, platform, status: fcmRes.ok ? "sent" : "fcm_error", fcm: fcmJson });
      } catch (err) {
        results.push({ user_id: (p as any).id, status: "exception", error: err instanceof Error ? err.message : "unknown" });
      }
    }
    for (const p of withoutToken) {
      results.push({ user_id: (p as any).id, status: "skipped_no_token" });
    }

    return new Response(JSON.stringify({
      status: "ok",
      sent: results.filter(r => r.status === "sent").length,
      skipped: withoutToken.length,
      errors: results.filter(r => r.status === "fcm_error" || r.status === "exception").length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[dispatch-push] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
