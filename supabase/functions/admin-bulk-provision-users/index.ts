import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

type TipoUsuario = "loja" | "colaborador" | "setor_operador" | "admin";
type AppRole = "admin" | "operador" | "setor_usuario";

interface Candidate {
  email: string;
  nome: string;
  tipo_usuario: TipoUsuario;
  setor_id?: string | null;
  loja_nome?: string | null;
  cargo?: string | null;
  telefone?: string | null;
  origem?: string | null; // 'telefones_lojas' | 'fluxo_responsaveis'
}

interface ResultRow {
  email: string;
  nome: string;
  status: "created" | "exists" | "error";
  user_id?: string;
  invite_url?: string;
  message?: string;
}

function tipoToRole(tipo: TipoUsuario): AppRole {
  if (tipo === "admin") return "admin";
  return "setor_usuario"; // loja/colaborador/setor_operador → todos com permissões setoriais
}

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

    const internalHeader = req.headers.get("x-internal-secret");
    const isInternalCall = !!INTERNAL_SECRET && internalHeader === INTERNAL_SECRET;

    if (!isInternalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return json({ error: "Não autorizado" }, 401);
      }
      const token = authHeader.replace("Bearer ", "");

      // Use admin client (service role) to validate the token via getUser(jwt).
      // This works regardless of whether the token has 'sub' claim format mismatches
      // and avoids the publishable/anon-key getClaims pitfall.
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      const userId = userData?.user?.id;
      if (userErr || !userId) {
        console.error("[bulk-provision] auth failed:", userErr?.message, "token_prefix:", token.slice(0, 20));
        return json({ error: "Sessão inválida — faça logout e login novamente" }, 401);
      }

      const { data: isAdminData, error: isAdminErr } = await admin.rpc("is_admin", {
        _user_id: userId,
      });
      if (isAdminErr || !isAdminData) {
        return json({ error: "Apenas admins podem provisionar usuários em lote" }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const candidates: Candidate[] = Array.isArray(body?.candidates) ? body.candidates : [];
    const defaultPassword: string | null =
      typeof body?.default_password === "string" && body.default_password.length >= 6
        ? body.default_password
        : null;
    if (candidates.length === 0) return json({ error: "candidates vazio" }, 400);
    if (candidates.length > 50) return json({ error: "máximo 50 por chamada" }, 400);

    const results: ResultRow[] = [];

    for (const c of candidates) {
      try {
        const email = String(c.email || "").trim().toLowerCase();
        const nome = String(c.nome || "").trim();
        if (!email || !email.includes("@")) {
          results.push({ email: c.email || "", nome, status: "error", message: "email inválido" });
          continue;
        }
        if (nome.length < 2) {
          results.push({ email, nome, status: "error", message: "nome obrigatório" });
          continue;
        }

        const tipoUsuario: TipoUsuario = c.tipo_usuario || "setor_operador";
        const role = tipoToRole(tipoUsuario);
        const setorId = c.setor_id || null;
        const lojaNome = c.loja_nome || null;
        const telefone = (c.telefone || "").replace(/\D/g, "") || null;
        const origem = c.origem || null;

        const profileMetadata: Record<string, unknown> = {};
        if (telefone) profileMetadata.telefone = telefone;
        if (origem) profileMetadata.origem_cadastro = origem;
        if (lojaNome) profileMetadata.loja_nome = lojaNome;

        // Check if user already exists in auth
        let userId: string | null = null;
        let exists = false;
        try {
          const { data: existingList } = await admin.auth.admin.listUsers({
            page: 1,
            perPage: 200,
          });
          const found = existingList?.users?.find(
            (u) => u.email?.toLowerCase() === email,
          );
          if (found) {
            userId = found.id;
            exists = true;
          }
        } catch (_e) {
          // ignore listing errors, fallback to create
        }

        let invite_url: string | undefined;

        if (!exists) {
          const createPayload: Record<string, unknown> = {
            email,
            email_confirm: true,
            user_metadata: { nome },
          };
          if (defaultPassword) createPayload.password = defaultPassword;

          const { data: created, error: createErr } = await admin.auth.admin.createUser(
            createPayload as any,
          );
          if (createErr || !created?.user) {
            const msg = createErr?.message || "Falha ao criar";
            if (/already|registered|exists/i.test(msg)) {
              const { data: list2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
              const f2 = list2?.users?.find((u) => u.email?.toLowerCase() === email);
              if (f2) {
                userId = f2.id;
                exists = true;
              } else {
                results.push({ email, nome, status: "error", message: msg });
                continue;
              }
            } else {
              results.push({ email, nome, status: "error", message: msg });
              continue;
            }
          } else {
            userId = created.user.id;
          }

          // Only generate invite link if NO default password was provided
          if (!defaultPassword && userId && !exists) {
            try {
              const { data: linkData } = await admin.auth.admin.generateLink({
                type: "invite",
                email,
              });
              invite_url = (linkData as any)?.properties?.action_link ?? undefined;
            } catch (_e) {
              // best-effort
            }
          }
        }

        if (!userId) {
          results.push({ email, nome, status: "error", message: "user_id ausente" });
          continue;
        }

        // Update profile (cargo, setor_id, tipo_usuario, metadata)
        const profileUpdate: Record<string, unknown> = {
          tipo_usuario: tipoUsuario,
        };
        if (c.cargo) profileUpdate.cargo = c.cargo;
        if (setorId) profileUpdate.setor_id = setorId;
        if (Object.keys(profileMetadata).length > 0) {
          // Merge metadata
          const { data: existingProfile } = await admin
            .from("profiles")
            .select("metadata")
            .eq("id", userId)
            .maybeSingle();
          const currentMeta = (existingProfile?.metadata as Record<string, unknown>) || {};
          profileUpdate.metadata = { ...currentMeta, ...profileMetadata };
        }
        await admin.from("profiles").update(profileUpdate).eq("id", userId);

        // Reset roles and insert the desired one
        await admin.from("user_roles").delete().eq("user_id", userId);
        const roleRow: Record<string, unknown> = { user_id: userId, role };
        if (role === "setor_usuario") {
          if (setorId) roleRow.setor_id = setorId;
          if (lojaNome) roleRow.loja_nome = lojaNome;
        }
        const { error: roleErr } = await admin.from("user_roles").insert(roleRow);
        if (roleErr) {
          console.warn(`[bulk-provision] role insert error for ${email}:`, roleErr.message);
        }

        results.push({
          email,
          nome,
          status: exists ? "exists" : "created",
          user_id: userId,
          invite_url,
          message: exists ? "Já existia — atualizado tipo/role" : "Criado com convite",
        });
      } catch (e: any) {
        results.push({
          email: c.email || "",
          nome: c.nome || "",
          status: "error",
          message: e?.message ?? "erro desconhecido",
        });
      }
    }

    const summary = {
      total: results.length,
      created: results.filter((r) => r.status === "created").length,
      exists: results.filter((r) => r.status === "exists").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    console.log("[admin-bulk-provision-users]", summary);

    return json({ success: true, summary, results });
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
