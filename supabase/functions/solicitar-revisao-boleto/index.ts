// solicitar-revisao-boleto
// Chamado pelo Messenger (loja) quando ela quer pedir ajuste em um boleto já enviado.
// - Valida ciclos máximos (app_config.boleto_max_ciclos_revisao, default 3)
// - Move card de "Boleto Enviado" → "Boleto em Revisão"
// - Insere msg na thread (solicitacao_comentarios + demanda_mensagens)
// - Notifica usuários do Financeiro
// - Registra evento em pipeline_card_eventos
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  solicitacao_id: string;
  motivo: string;
  campos_revisar?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    let usuario_id: string | null = null;
    let usuario_nome: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: u } = await userClient.auth.getUser();
      usuario_id = u?.user?.id || null;
      if (usuario_id) {
        const { data: prof } = await supabase.from("profiles").select("nome").eq("id", usuario_id).maybeSingle();
        usuario_nome = prof?.nome || u?.user?.email || null;
      }
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const { solicitacao_id, motivo, campos_revisar } = body;
    if (!solicitacao_id || !motivo || String(motivo).trim().length < 5) {
      return new Response(JSON.stringify({ error: "solicitacao_id e motivo (>=5 chars) obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sol, error: solErr } = await supabase
      .from("solicitacoes").select("*").eq("id", solicitacao_id).single();
    if (solErr || !sol) {
      return new Response(JSON.stringify({ error: "solicitacao_nao_encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sol.tipo !== "boleto") {
      return new Response(JSON.stringify({ error: "solicitacao_nao_eh_boleto" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const meta = (sol.metadata || {}) as Record<string, any>;
    if (meta.boleto_status !== "enviado") {
      return new Response(JSON.stringify({ error: "boleto_ainda_nao_enviado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await supabase.from("app_config").select("value").eq("key", "boleto_max_ciclos_revisao").maybeSingle();
    const maxCiclos = Number(cfg?.value ?? 3);
    const cicloAtual = Number(meta.boleto_revisao?.ciclo || 0);
    if (cicloAtual >= maxCiclos) {
      return new Response(JSON.stringify({ error: "limite_de_ciclos_atingido", maxCiclos }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const novoCiclo = cicloAtual + 1;

    const colunaAnterior = sol.pipeline_coluna_id as string | null;
    let colunaNova: string | null = colunaAnterior;
    if (colunaAnterior) {
      const { data: colAtual } = await supabase
        .from("pipeline_colunas").select("setor_id").eq("id", colunaAnterior).maybeSingle();
      if (colAtual?.setor_id) {
        const { data: alvo } = await supabase
          .from("pipeline_colunas").select("id")
          .eq("setor_id", colAtual.setor_id)
          .eq("nome", "Boleto em Revisão")
          .eq("ativo", true)
          .maybeSingle();
        if (alvo?.id) colunaNova = alvo.id;
      }
    }

    const nowIso = new Date().toISOString();
    const novoMeta = {
      ...meta,
      boleto_revisao: {
        solicitada_em: nowIso,
        solicitada_por: usuario_nome,
        motivo: motivo.trim(),
        campos_revisar: Array.isArray(campos_revisar) ? campos_revisar : [],
        ciclo: novoCiclo,
      },
      arquivado_at: null,
    };

    await supabase.from("solicitacoes").update({
      pipeline_coluna_id: colunaNova,
      status: "em_atendimento",
      metadata: novoMeta,
      updated_at: nowIso,
    }).eq("id", solicitacao_id);

    const camposTxt = (campos_revisar && campos_revisar.length > 0)
      ? `\n\n📝 Campos a revisar: ${campos_revisar.join(", ")}`
      : "";
    const conteudo = `🔄 Revisão de boleto solicitada (ciclo ${novoCiclo}/${maxCiclos})\n\nMotivo: ${motivo.trim()}${camposTxt}`;

    await supabase.from("solicitacao_comentarios").insert({
      solicitacao_id,
      autor_id: usuario_id,
      autor_nome: usuario_nome || "Loja",
      conteudo,
      tipo: "loja_para_operador",
      metadata: { tipo: "boleto_revisao_solicitada", ciclo: novoCiclo, campos_revisar },
    });

    const demandaId = (meta.demanda_id as string) || null;
    if (demandaId) {
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demandaId,
        direcao: "loja_para_operador",
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Loja",
        conteudo,
        metadata: { tipo: "boleto_revisao_solicitada", ciclo: novoCiclo, solicitacao_id },
      });
      await supabase.from("demandas_loja").update({
        status: "aguardando_complemento",
        vista_pelo_operador: false,
        ultima_mensagem_loja_at: nowIso,
      }).eq("id", demandaId);
    }

    try {
      const { data: dests } = await supabase.rpc("resolver_destinatarios_setor", { _setor_nome: "Financeiro" });
      const userIds = ((dests as any) || []).map((d: any) => d.user_id).filter(Boolean);
      if (userIds.length > 0) {
        await supabase.from("notificacoes").insert(userIds.map((uid: string) => ({
          usuario_id: uid,
          tipo: "boleto_revisao_solicitada",
          titulo: `Revisão de boleto pedida (ciclo ${novoCiclo})`,
          mensagem: `${meta.loja_nome || "Loja"} — ${motivo.trim().slice(0, 120)}`,
          referencia_id: solicitacao_id,
        })));
      }
    } catch (e) {
      console.warn("[solicitar-revisao-boleto] resolver_destinatarios_setor falhou:", e);
    }

    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: solicitacao_id,
      tipo: "boleto_revisao_solicitada",
      descricao: `Loja pediu revisão do boleto (ciclo ${novoCiclo}): ${motivo.trim().slice(0, 200)}`,
      coluna_anterior_id: colunaAnterior,
      coluna_nova_id: colunaNova,
      usuario_id,
      usuario_nome,
      metadata: { motivo, campos_revisar, ciclo: novoCiclo },
    });

    return new Response(JSON.stringify({ status: "ok", ciclo: novoCiclo, max_ciclos: maxCiclos, coluna_id: colunaNova }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[solicitar-revisao-boleto] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
