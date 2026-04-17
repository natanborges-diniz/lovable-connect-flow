// ═══════════════════════════════════════════════════════════
// BRIDGE-MENSAGERIA: Ponte WhatsApp ↔ Mensageria Interna
// ═══════════════════════════════════════════════════════════
// Direções:
//   1. whatsapp_to_interno: msg externa do contato → mensagem interna pro responsável
//   2. interno_to_whatsapp: msg interna do responsável → WhatsApp pro contato
// ═══════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface BridgePayload {
  direction: "whatsapp_to_interno" | "interno_to_whatsapp";
  contato_id: string;
  conteudo: string;
  // for whatsapp_to_interno
  atendimento_id?: string;
  mensagem_id?: string;
  tipo_conteudo?: string;
  media_url?: string | null;
  // for interno_to_whatsapp
  mensagem_interna_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const payload = (await req.json()) as BridgePayload;
    const { direction, contato_id, conteudo } = payload;

    if (!direction || !contato_id) {
      return jsonResponse({ error: "direction and contato_id required" }, 400);
    }

    // Carrega ponte ativa
    const { data: ponte, error: ponteErr } = await supabase
      .from("contato_ponte")
      .select("*")
      .eq("contato_id", contato_id)
      .eq("ativo", true)
      .maybeSingle();

    if (ponteErr || !ponte) {
      console.log(`[BRIDGE] no active ponte for contato=${contato_id}`);
      return jsonResponse({ status: "skipped", reason: "no_ponte" });
    }

    if (direction === "whatsapp_to_interno") {
      return await handleWhatsappToInterno(supabase, ponte, payload);
    } else if (direction === "interno_to_whatsapp") {
      return await handleInternoToWhatsapp(supabase, ponte, payload);
    }

    return jsonResponse({ error: "invalid direction" }, 400);
  } catch (e: any) {
    console.error("[BRIDGE] error:", e);
    return jsonResponse({ error: e.message }, 500);
  }
});

// ─── WhatsApp inbound → Mensagem interna ───
async function handleWhatsappToInterno(
  supabase: any,
  ponte: any,
  payload: BridgePayload
) {
  const { conteudo, mensagem_id, tipo_conteudo, media_url } = payload;

  // Carrega nome do contato pra prefixar
  const { data: contato } = await supabase
    .from("contatos")
    .select("nome, telefone")
    .eq("id", ponte.contato_id)
    .single();

  const prefixo = `📲 ${contato?.nome || "Contato"} (${contato?.telefone || "—"})`;
  let texto = `${prefixo}:\n${conteudo || "(sem texto)"}`;
  if (tipo_conteudo && tipo_conteudo !== "text" && media_url) {
    texto += `\n\n[anexo ${tipo_conteudo}] ${media_url}`;
  }

  // Anti-loop: marca metadata pra trigger NÃO reenviar isso pro WhatsApp
  // O remetente_id é o RESPONSÁVEL? NÃO. Aqui o remetente é "sistema" (bridge).
  // O trigger só dispara se remetente_id === ponte.responsavel_user_id, então usar
  // o próprio contato_id como remetente quebraria (precisa ser uuid de auth.users).
  // Solução: usar responsavel como destinatario, e como remetente um UUID-sistema.
  // Como mensagens_internas exige FK válida, usamos o próprio responsavel como ambos
  // não funciona pra UI. Usamos o destinatario = responsavel, remetente = um perfil
  // "Sistema Ponte" criado on-demand.

  const sistemaId = await getOrCreateSistemaPonteProfile(supabase);

  const { data: msg, error: msgErr } = await supabase
    .from("mensagens_internas")
    .insert({
      conversa_id: ponte.conversa_id,
      remetente_id: sistemaId,
      destinatario_id: ponte.responsavel_user_id,
      conteudo: texto,
      lida: false,
    })
    .select()
    .single();

  if (msgErr) {
    console.error("[BRIDGE] failed insert mensagem interna:", msgErr);
    return jsonResponse({ error: msgErr.message }, 500);
  }

  // Notificação in-app
  await supabase.from("notificacoes").insert({
    usuario_id: ponte.responsavel_user_id,
    tipo: "mensagem_ponte",
    titulo: `Nova mensagem de ${contato?.nome}`,
    mensagem: (conteudo || "").slice(0, 120),
    referencia_id: ponte.contato_id,
  });

  await supabase.from("eventos_crm").insert({
    contato_id: ponte.contato_id,
    tipo: "ponte_inbound_espelhado",
    descricao: `Msg externa espelhada para ${ponte.responsavel_user_id}`,
    referencia_tipo: "mensagem_interna",
    referencia_id: msg.id,
    metadata: { whatsapp_msg_id: mensagem_id },
  });

  console.log(`[BRIDGE] inbound espelhado contato=${ponte.contato_id} → user=${ponte.responsavel_user_id}`);
  return jsonResponse({ status: "ok", mensagem_interna_id: msg.id });
}

// ─── Mensagem interna → WhatsApp outbound ───
async function handleInternoToWhatsapp(
  supabase: any,
  ponte: any,
  payload: BridgePayload
) {
  const { conteudo, mensagem_interna_id } = payload;

  if (!conteudo?.trim()) {
    return jsonResponse({ status: "skipped", reason: "empty" });
  }

  // Acha atendimento aberto do contato
  const { data: atendimento } = await supabase
    .from("atendimentos")
    .select("id, status")
    .eq("contato_id", ponte.contato_id)
    .eq("canal", "whatsapp")
    .neq("status", "encerrado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!atendimento) {
    console.warn(`[BRIDGE] no open atendimento for contato=${ponte.contato_id}`);
    return jsonResponse({ status: "skipped", reason: "no_atendimento" });
  }

  // Dispara via send-whatsapp
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      atendimento_id: atendimento.id,
      mensagem: conteudo,
      remetente_nome: "Operador Interno",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("[BRIDGE] send-whatsapp failed:", err);
    return jsonResponse({ error: "send_whatsapp_failed", detail: err }, 502);
  }

  await supabase.from("eventos_crm").insert({
    contato_id: ponte.contato_id,
    tipo: "ponte_outbound_via_interno",
    descricao: `Resposta interna enviada via WhatsApp`,
    referencia_tipo: "mensagem_interna",
    referencia_id: mensagem_interna_id,
  });

  console.log(`[BRIDGE] outbound enviado contato=${ponte.contato_id} via mensagem_interna=${mensagem_interna_id}`);
  return jsonResponse({ status: "ok" });
}

// ─── Helper: perfil "Sistema Ponte" para remetente das mensagens espelhadas ───
async function getOrCreateSistemaPonteProfile(supabase: any): Promise<string> {
  // Busca config existente
  const { data: cfg } = await supabase
    .from("configuracoes_ia")
    .select("valor")
    .eq("chave", "sistema_ponte_profile_id")
    .maybeSingle();

  if (cfg?.valor) {
    // Confirma que ainda existe
    const { data: existe } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", cfg.valor)
      .maybeSingle();
    if (existe) return cfg.valor;
  }

  // Procura por nome
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("nome", "Sistema · Ponte WhatsApp")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("configuracoes_ia")
      .upsert({ chave: "sistema_ponte_profile_id", valor: existing.id }, { onConflict: "chave" });
    return existing.id;
  }

  // Cria um profile fictício (id qualquer; profiles.id não tem FK pra auth.users como NOT NULL)
  // O id realmente precisa existir em auth.users? Sim, pois trigger handle_new_user existe.
  // Mas se inserirmos diretamente em profiles ignorando o trigger... vamos tentar.
  const newId = crypto.randomUUID();
  const { error } = await supabase
    .from("profiles")
    .insert({
      id: newId,
      nome: "Sistema · Ponte WhatsApp",
      email: "ponte-system@internal.local",
      ativo: false, // não aparece em listas de usuários ativos
    });

  if (error) {
    console.error("[BRIDGE] failed to create sistema profile:", error);
    // Fallback: usa o próprio responsável (vai aparecer como auto-msg, não ideal mas funciona)
    throw new Error("cannot_create_sistema_profile: " + error.message);
  }

  await supabase
    .from("configuracoes_ia")
    .upsert({ chave: "sistema_ponte_profile_id", valor: newId }, { onConflict: "chave" });

  return newId;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
