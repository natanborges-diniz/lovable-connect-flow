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

    // Busca push tokens
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", userIds);

    // Push tokens ficam em profiles.metadata.push_token (ainda não há coluna metadata em profiles → futura)
    // Por enquanto operamos em modo log-only. Realtime entrega in-app instantaneamente.
    const fcmEnabled = !!FCM_SERVER_KEY;

    if (!fcmEnabled) {
      console.log("[dispatch-push] log-only mode (FCM_SERVER_KEY missing)", {
        notificacao_id,
        recipients: userIds.length,
        titulo,
        tipo,
      });
      return new Response(JSON.stringify({
        status: "log_only",
        recipients: userIds.length,
        reason: "fcm_credentials_not_configured",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // FCM dispatch (placeholder — implementação real exige tokens persistidos)
    const results: any[] = [];
    for (const uid of userIds) {
      // TODO: ler profiles.metadata.push_token quando disponível
      results.push({ user_id: uid, status: "skipped_no_token" });
      await supabase.from("eventos_crm").insert({
        contato_id: uid, // placeholder; ideal seria coluna user_id
        tipo: "push_skipped_no_token",
        descricao: `Push pulado: usuario ${uid} sem token registrado`,
        metadata: { notificacao_id, titulo, tipo: tipo || null },
      }).then(() => {}, () => {});
    }

    return new Response(JSON.stringify({ status: "ok", results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[dispatch-push] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
