// get-vapid-public-key: retorna a VAPID_PUBLIC_KEY (segura para expor) para o cliente
// poder se inscrever no Push Manager.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  return new Response(JSON.stringify({ publicKey: key }), {
    status: key ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
