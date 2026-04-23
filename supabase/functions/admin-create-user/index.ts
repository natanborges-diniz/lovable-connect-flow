import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type AppRole = "admin" | "operador" | "setor_usuario";

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

    // Allow internal service-to-service calls via shared secret
    const internalHeader = req.headers.get("x-internal-secret");
    const isInternalCall = !!INTERNAL_SECRET && internalHeader === INTERNAL_SECRET;

    let callerEmail: string | undefined;

    if (!isInternalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return json({ error: "Não autorizado" }, 401);
      }

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) {
        return json({ error: "Sessão inválida" }, 401);
      }
      callerEmail = userData.user.email;

      const { data: isAdminData, error: isAdminErr } = await admin.rpc("is_admin", {
        _user_id: userData.user.id,
      });
      if (isAdminErr || !isAdminData) {
        return json({ error: "Apenas admins podem criar usuários" }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const {
      email,
      nome,
      cargo,
      setor_id,
      role,
      loja_nome,
    } = body ?? {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return json({ error: "email inválido" }, 400);
    }
    if (!nome || typeof nome !== "string" || nome.trim().length < 2) {
      return json({ error: "nome obrigatório" }, 400);
    }
    const finalRole: AppRole = (role === "admin" || role === "operador" || role === "setor_usuario")
      ? role
      : "setor_usuario";

    // 1) Cria o usuário no Auth (sem senha; convite via link)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? "Falha ao criar usuário" }, 500);
    }
    const newUserId = created.user.id;

    // O trigger handle_new_user já cria o profile. Atualiza cargo/setor se informados.
    const profileUpdates: Record<string, unknown> = {};
    if (cargo) profileUpdates.cargo = cargo;
    if (setor_id) profileUpdates.setor_id = setor_id;
    if (Object.keys(profileUpdates).length > 0) {
      await admin.from("profiles").update(profileUpdates).eq("id", newUserId);
    }

    // 2) Garante role (limpa qualquer role default e insere a desejada)
    await admin.from("user_roles").delete().eq("user_id", newUserId);
    const roleRow: Record<string, unknown> = { user_id: newUserId, role: finalRole };
    if (finalRole === "setor_usuario") {
      if (setor_id) roleRow.setor_id = setor_id;
      if (loja_nome) roleRow.loja_nome = loja_nome;
    }
    const { error: roleErr } = await admin.from("user_roles").insert(roleRow);
    if (roleErr) {
      console.error("[admin-create-user] insert role error:", roleErr.message);
    }

    // 3) Gera link de convite para o usuário definir a senha / acessar
    let invite_url: string | undefined;
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
      });
      invite_url = (linkData as any)?.properties?.action_link ?? undefined;
    } catch (e) {
      console.warn("[admin-create-user] generateLink falhou:", (e as Error).message);
    }

    console.log(
      `[admin-create-user] caller=${callerEmail ?? "internal"} criou user=${email} (${newUserId}) role=${finalRole}`,
    );

    return json({
      success: true,
      user_id: newUserId,
      email,
      invite_url,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Erro interno" }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
