// Devolve uma solicitação à loja com motivo obrigatório.
// - Cria/atualiza demanda_loja vinculada (status=aguardando_complemento)
// - Posta mensagem no thread da demanda (operador_para_loja)
// - Move solicitação para coluna tipo_acao=devolver_para_loja
// - Notifica usuários da loja + push
// - Registra evento na timeline (pipeline_card_eventos)
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
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve usuário autor (via JWT do header)
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
        const { data: prof } = await supabase
          .from("profiles").select("nome").eq("id", usuario_id).maybeSingle();
        usuario_nome = prof?.nome || u?.user?.email || null;
      }
    }

    const body = await req.json();
    const { solicitacao_id, motivo, coluna_destino_id } = body || {};

    if (!solicitacao_id || !motivo || String(motivo).trim().length < 3) {
      return new Response(JSON.stringify({ error: "solicitacao_id e motivo (>=3 chars) são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega solicitação
    const { data: sol, error: solErr } = await supabase
      .from("solicitacoes").select("*").eq("id", solicitacao_id).single();
    if (solErr || !sol) {
      return new Response(JSON.stringify({ error: "solicitacao_nao_encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = (sol.metadata || {}) as Record<string, unknown>;
    const lojaNome = (meta.loja_nome || meta.alias_loja || "") as string;
    const colunaAnterior = sol.pipeline_coluna_id;

    // Coluna destino: prioridade ao parâmetro; senão coluna tipo_acao=devolver_para_loja do mesmo setor
    let colunaNova: string | null = coluna_destino_id || null;
    if (!colunaNova && colunaAnterior) {
      const { data: colAtual } = await supabase
        .from("pipeline_colunas").select("setor_id").eq("id", colunaAnterior).maybeSingle();
      if (colAtual?.setor_id) {
        const { data: alvo } = await supabase
          .from("pipeline_colunas")
          .select("id")
          .eq("setor_id", colAtual.setor_id)
          .eq("tipo_acao", "devolver_para_loja")
          .eq("ativo", true)
          .order("ordem", { ascending: true })
          .limit(1)
          .maybeSingle();
        colunaNova = alvo?.id || colunaAnterior;
      }
    }

    // Vincula/cria demanda_loja
    let demandaId: string | null = (meta.demanda_id as string) || null;
    if (!demandaId) {
      // Se a loja já tiver telefone cadastrado, cria demanda
      const { data: lojaCad } = await supabase
        .from("telefones_lojas").select("telefone, setor_destino_id, nome_loja")
        .ilike("nome_loja", lojaNome).eq("ativo", true).maybeSingle();
      if (lojaCad) {
        const { data: nova } = await supabase
          .from("demandas_loja").insert({
            loja_nome: lojaCad.nome_loja,
            loja_telefone: lojaCad.telefone,
            origem: "operador",
            status: "aguardando_complemento",
            assunto: `Pendência — ${sol.assunto || sol.tipo}`,
            pergunta: motivo,
            tipo_chave: "pendencia_solicitacao",
            setor_destino_id: lojaCad.setor_destino_id,
            solicitante_id: usuario_id,
            solicitante_nome: usuario_nome,
            metadata: { solicitacao_id: sol.id, motivo },
            ultima_mensagem_loja_at: null,
          })
          .select("id, protocolo")
          .single();
        if (nova) {
          demandaId = nova.id;
          await supabase.from("solicitacoes")
            .update({ metadata: { ...meta, demanda_id: nova.id } })
            .eq("id", sol.id);
        }
      }
    } else {
      // Atualiza demanda existente
      await supabase.from("demandas_loja")
        .update({ status: "aguardando_complemento", vista_pelo_operador: false })
        .eq("id", demandaId);
    }

    // Mensagem de devolução no thread (se houver demanda)
    if (demandaId) {
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demandaId,
        direcao: "operador_para_loja",
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Operador",
        conteudo: `⚠️ Pendência: precisamos do seguinte para continuar.\n\n${motivo}`,
        metadata: { tipo: "devolucao", solicitacao_id: sol.id },
      });

      // Notifica usuários da loja
      const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
      const userIds = (dests || []).map((d: any) => d.user_id).filter(Boolean);
      if (userIds.length > 0) {
        const notifs = userIds.map((uid: string) => ({
          usuario_id: uid,
          tipo: "demanda_pendente",
          titulo: `Pendência: ${sol.assunto || "solicitação"}`,
          mensagem: motivo.slice(0, 140),
          referencia_id: demandaId,
        }));
        await supabase.from("notificacoes").insert(notifs);
      }
    }

    // Move card e atualiza metadata
    await supabase.from("solicitacoes").update({
      pipeline_coluna_id: colunaNova,
      status: "aguardando_complemento",
      metadata: {
        ...meta,
        demanda_id: demandaId,
        motivo_devolucao: motivo,
        devolvido_em: new Date().toISOString(),
        devolvido_por: usuario_nome,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", sol.id);

    // Evento timeline
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: sol.id,
      tipo: "devolvido_para_loja",
      descricao: `Devolvido à loja: ${motivo.slice(0, 200)}`,
      coluna_anterior_id: colunaAnterior,
      coluna_nova_id: colunaNova,
      usuario_id,
      usuario_nome,
      metadata: { motivo, demanda_id: demandaId },
    });

    return new Response(JSON.stringify({ status: "ok", demanda_id: demandaId, coluna_id: colunaNova }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[devolver-solicitacao-loja] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
