// loja-acao-agendamento
// Endpoint autenticado chamado pelo InFoco Messenger quando a loja toca em
// um dos botões do card de cobrança: "compareceu" | "noshow" | "venda_fechada".
// Atualiza o agendamento, registra evento no CRM e dispara automações.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Acao = "compareceu" | "noshow" | "venda_fechada" | "reverter_noshow";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Autenticação via JWT do app
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const agendamento_id: string | undefined = body.agendamento_id;
    const acao: Acao | undefined = body.acao;
    const valor_venda: number | undefined = body.valor_venda;
    const numero_venda: string | undefined = body.numero_venda;
    const numeros_os: string[] | undefined = body.numeros_os;
    const observacao: string | undefined = body.observacao;

    if (!agendamento_id || !acao) return json({ error: "agendamento_id e acao são obrigatórios" }, 400);
    if (!["compareceu", "noshow", "venda_fechada", "reverter_noshow"].includes(acao)) {
      return json({ error: "acao inválida" }, 400);
    }

    // Carrega agendamento
    const { data: ag, error: agErr } = await supabase
      .from("agendamentos")
      .select("id, contato_id, loja_nome, status, loja_confirmou_presenca, metadata")
      .eq("id", agendamento_id)
      .single();
    if (agErr || !ag) return json({ error: "agendamento não encontrado" }, 404);

    // Verifica se o usuário pertence à loja do agendamento
    const { data: pode } = await supabase.rpc("resolver_destinatarios_loja", {
      _loja_nome: ag.loja_nome,
    });
    const list = (pode || []) as Array<{ user_id: string }>;
    const podeAgir = list.some((d) => d.user_id === userId);
    if (!podeAgir) {
      // Não bloqueamos admin; tentamos checar role admin
      const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userId });
      if (!isAdmin) return json({ error: "Sem permissão para esta loja" }, 403);
    }

    // Resolve nome do autor
    const { data: prof } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", userId)
      .single();
    const autorNome = prof?.nome || "Loja";

    const md = (ag.metadata || {}) as Record<string, any>;
    const stamp = new Date().toISOString();
    const updates: Record<string, any> = {};
    let eventoTipo = "";
    let eventoDesc = "";

    if (acao === "compareceu") {
      if (ag.status === "compareceu" || ag.loja_confirmou_presenca === true) {
        return json({ ok: true, skipped: true, reason: "ja_compareceu" });
      }
      updates.status = "compareceu";
      updates.loja_confirmou_presenca = true;
      updates.metadata = { ...md, loja_acao_at: stamp, loja_acao_por: userId, loja_acao: "compareceu" };
      eventoTipo = "loja_confirmou_comparecimento";
      eventoDesc = `${autorNome} confirmou comparecimento (${ag.loja_nome})`;
    } else if (acao === "noshow") {
      if (ag.status === "no_show") return json({ ok: true, skipped: true, reason: "ja_noshow" });
      updates.status = "no_show";
      updates.loja_confirmou_presenca = false;
      updates.metadata = { ...md, loja_acao_at: stamp, loja_acao_por: userId, loja_acao: "noshow", noshow_motivo: observacao || null };
      eventoTipo = "loja_marcou_noshow";
      eventoDesc = `${autorNome} marcou no-show (${ag.loja_nome})${observacao ? ` — ${observacao}` : ""}`;
    } else if (acao === "reverter_noshow") {
      if (!["no_show", "recuperacao"].includes(ag.status)) {
        return json({ error: "só é possível reverter quando status é no_show ou recuperacao" }, 400);
      }
      updates.status = "compareceu";
      updates.loja_confirmou_presenca = true;
      updates.tentativas_recuperacao = 0;
      updates.metadata = { ...md, loja_acao_at: stamp, loja_acao_por: userId, loja_acao: "reverter_noshow" };
      eventoTipo = "loja_reverteu_noshow";
      eventoDesc = `${autorNome} reverteu no-show para compareceu (${ag.loja_nome})`;
    } else if (acao === "venda_fechada") {
      if (typeof valor_venda !== "number" || valor_venda <= 0) {
        return json({ error: "valor_venda obrigatório (> 0)" }, 400);
      }
      updates.status = "venda_fechada";
      updates.loja_confirmou_presenca = true;
      updates.valor_venda = valor_venda;
      if (numero_venda) updates.numero_venda = numero_venda;
      if (Array.isArray(numeros_os) && numeros_os.length) updates.numeros_os = numeros_os;
      updates.metadata = { ...md, loja_acao_at: stamp, loja_acao_por: userId, loja_acao: "venda_fechada" };
      eventoTipo = "venda_fechada";
      eventoDesc = `${autorNome} registrou venda fechada R$ ${valor_venda.toFixed(2)}${numero_venda ? ` (#${numero_venda})` : ""}`;
    }

    const { error: upErr } = await supabase
      .from("agendamentos")
      .update(updates)
      .eq("id", agendamento_id);
    if (upErr) throw upErr;

    await supabase.from("eventos_crm").insert({
      contato_id: ag.contato_id,
      tipo: eventoTipo,
      descricao: eventoDesc,
      referencia_id: ag.id,
      referencia_tipo: "agendamento",
      metadata: { loja_nome: ag.loja_nome, autor_id: userId, autor_nome: autorNome, valor_venda, numero_venda, numeros_os },
    });

    // Marca como lidas notificações relacionadas a este agendamento
    await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("referencia_id", ag.id)
      .in("tipo", [
        "cobranca_comparecimento_loja",
        "cobranca_comparecimento_loja_2",
        "agendamento_confirmacao",
        "agendamento_novo_loja",
        "agendamento_confirmado_loja",
      ]);

    return json({ ok: true, status: updates.status, evento: eventoTipo });
  } catch (e) {
    console.error("[loja-acao-agendamento] erro:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }

  function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
