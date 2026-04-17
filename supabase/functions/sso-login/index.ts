import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-key",
};

// Normaliza string: lowercase, sem acento, sem pontuação, sem "dpto"/"depto"/"departamento"
function normalize(s: string): string {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._\-/]+/g, " ")
    .replace(/\b(dpto|depto|departamento|setor)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    console.log("[sso-login] body recebido", { email, setor_id, role, nome, departamento });

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
      console.error("[sso-login] generateLink error", error);
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

      // Resolve setor_id: explicit > departamento (string, normalizado) > profile.setor_id (auto-heal)
      let resolvedSetorId: string | null = setor_id || null;

      if (!resolvedSetorId && typeof departamento === "string" && departamento.trim()) {
        const depNorm = normalize(departamento);
        // Carrega todos os setores ativos e compara normalizado em memória
        const { data: setores } = await supabase
          .from("setores")
          .select("id, nome")
          .eq("ativo", true);

        const match = (setores || []).find((s) => normalize(s.nome) === depNorm);
        if (match?.id) {
          resolvedSetorId = match.id;
          console.log(`[sso-login] departamento "${departamento}" -> setor "${match.nome}" (${match.id})`);
        } else {
          console.warn(
            `[sso-login] departamento "${departamento}" (norm="${depNorm}") sem match. Disponíveis:`,
            (setores || []).map((s) => `${s.nome} [${normalize(s.nome)}]`)
          );
        }
      }

      // Auto-heal: if no setor came in body, use existing profile.setor_id
      if (!resolvedSetorId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("setor_id")
          .eq("id", userId)
          .maybeSingle();
        if (profile?.setor_id) {
          resolvedSetorId = profile.setor_id;
          console.log(`[sso-login] auto-heal via profile.setor_id = ${resolvedSetorId}`);
        }
      }

      // Persist setor_id on profile when resolved
      if (resolvedSetorId) {
        const { error: profErr } = await supabase
          .from("profiles")
          .update({ setor_id: resolvedSetorId })
          .eq("id", userId);
        if (profErr) console.error("[sso-login] update profile setor_id error", profErr);
      }

      // Provisiona user_role sempre que houver setor resolvido (default = setor_usuario).
      // Idempotente: upsert por (user_id, role, setor_id).
      if (resolvedSetorId || role) {
        const assignedRole = role || "setor_usuario";
        const { error: roleErr } = await supabase
          .from("user_roles")
          .upsert(
            { user_id: userId, role: assignedRole, setor_id: resolvedSetorId },
            { onConflict: "user_id,role,setor_id" }
          );
        if (roleErr) {
          console.error("[sso-login] upsert user_roles error", roleErr);
        } else {
          console.log(`[sso-login] user_role garantido: ${assignedRole} / setor=${resolvedSetorId}`);
        }
      } else {
        console.warn(`[sso-login] usuário ${userId} ficou sem setor resolvido — sem provisionar role`);
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
    console.error("[sso-login] exception", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
