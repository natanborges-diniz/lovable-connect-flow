// Responde uma autorização de exceção (aprovar/rejeitar) e executa o efeito do processo.
// Hoje suporta: consulta_cpf_excecao -> move o card de Solicitação para "Consulta CPF Aprovado"
// e adiciona carimbo de rastreabilidade no metadata.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("authorization") || "";
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "invalid_session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { autorizacao_id, decisao, justificativa } = body || {};
    if (!autorizacao_id || !["aprovar", "rejeitar"].includes(decisao)) {
      return new Response(JSON.stringify({ error: "invalid_payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Carrega autorização
    const { data: autz, error: autzErr } = await admin
      .from("autorizacoes_excecao")
      .select("*")
      .eq("id", autorizacao_id)
      .maybeSingle();
    if (autzErr || !autz) {
      return new Response(JSON.stringify({ error: "autorizacao_nao_encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (autz.autorizador_id !== user.id) {
      return new Response(JSON.stringify({ error: "nao_autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (autz.status !== "pendente") {
      return new Response(JSON.stringify({ error: "ja_respondida", status: autz.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Profile autorizador
    const { data: profile } = await admin.from("profiles").select("nome").eq("id", user.id).maybeSingle();
    const autorizadorNome = profile?.nome || autz.autorizador_nome || "Autorizador";

    const novoStatus = decisao === "aprovar" ? "aprovada" : "rejeitada";
    const respondidoAt = new Date().toISOString();

    // Atualiza autorização
    await admin.from("autorizacoes_excecao").update({
      status: novoStatus,
      justificativa_resposta: justificativa || null,
      respondido_at: respondidoAt,
    }).eq("id", autorizacao_id);

    // Aplica efeito por processo
    if (autz.processo_chave === "consulta_cpf_excecao" && autz.referencia_tipo === "solicitacao") {
      const { data: sol } = await admin
        .from("solicitacoes")
        .select("id, protocolo, metadata, pipeline_coluna_id, contato_id, contato:contatos(nome, metadata)")
        .eq("id", autz.referencia_id)
        .maybeSingle();
      const metaAtual = (sol?.metadata as any) || {};
      const carimbo = {
        autorizacao_id,
        autorizador_id: user.id,
        autorizador_nome: autorizadorNome,
        autorizador_role: autz.autorizador_role,
        decisao,
        justificativa: justificativa || null,
        respondido_at: respondidoAt,
        solicitante_id: autz.solicitante_id,
        solicitante_nome: autz.solicitante_nome,
      };
      const historico = Array.isArray(metaAtual.autorizacoes_excecao_historico) ? metaAtual.autorizacoes_excecao_historico : [];
      historico.push(carimbo);

      const updates: any = {
        metadata: {
          ...metaAtual,
          autorizacao_excecao: carimbo,
          autorizacoes_excecao_historico: historico,
        },
      };

      if (decisao === "aprovar") {
        // Move para coluna "Consulta CPF Aprovado"
        const { data: colunas } = await admin
          .from("pipeline_colunas")
          .select("id, nome, setor_id")
          .eq("ativo", true);
        const targetCol = (colunas || []).find((c: any) => c.nome === "Consulta CPF Aprovado");
        if (targetCol) {
          updates.pipeline_coluna_id = targetCol.id;
          updates.status = "concluida";
          updates.metadata.resultado_consulta = "aprovado";
          updates.metadata.data_analise = respondidoAt;
          updates.metadata.justificativa_interna = `[Aprovado por exceção] ${autorizadorNome}: ${justificativa || "—"}`;
        }
      }

      await admin.from("solicitacoes").update(updates).eq("id", autz.referencia_id);

      // Comentário visível no card (auditoria interna)
      await admin.from("solicitacao_comentarios").insert({
        solicitacao_id: autz.referencia_id,
        autor_id: user.id,
        autor_nome: autorizadorNome,
        tipo: decisao === "aprovar" ? "autorizacao_aprovada" : "autorizacao_rejeitada",
        conteudo: decisao === "aprovar"
          ? `✅ Exceção APROVADA por ${autorizadorNome} (${autz.autorizador_role || "autorizador"}).${justificativa ? `\nJustificativa: ${justificativa}` : ""}`
          : `❌ Exceção REJEITADA por ${autorizadorNome} (${autz.autorizador_role || "autorizador"}).${justificativa ? `\nMotivo: ${justificativa}` : ""}`,
      });

      // ─── Aviso read-only para a LOJA (canal único: comentário "retorno_setor" + notificação) ───
      try {
        const meta: any = metaAtual || {};
        const contatoAny: any = (sol as any)?.contato || {};
        const lojaNome: string =
          meta.alias_loja || meta.loja_nome || contatoAny?.metadata?.loja_nome || contatoAny?.nome || "";
        const protocolo = sol?.protocolo ? ` #${sol.protocolo}` : "";

        let textoLoja = "";
        let tituloLoja = "";
        if (decisao === "aprovar") {
          tituloLoja = `Liberação aprovada por exceção${protocolo}`;
          textoLoja =
            `✅ Liberação aprovada por exceção pelo supervisor ${autorizadorNome}.\n` +
            `Sua solicitação pode prosseguir.`;
        } else {
          // Resultado original que permanece
          const resultadoOriginal =
            meta.resultado_consulta === "reprovado" ? "Reprovado"
            : (Array.isArray(meta.dados_incompletos_labels) && meta.dados_incompletos_labels.length > 0) || meta.observacao_dados_incompletos
              ? "Dados Incompletos"
              : "resultado anterior";
          tituloLoja = `Exceção não aprovada${protocolo}`;
          textoLoja =
            `❌ A exceção não foi aprovada pelo supervisor ${autorizadorNome}.\n` +
            `O resultado anterior (${resultadoOriginal}) permanece válido.` +
            (justificativa ? `\n\nMotivo: "${justificativa}"` : "");
        }

        // Comentário visível para a loja
        await admin.from("solicitacao_comentarios").insert({
          solicitacao_id: autz.referencia_id,
          tipo: "retorno_setor",
          autor_id: user.id,
          autor_nome: "Financeiro",
          conteudo: textoLoja,
        });

        // Notifica usuários da loja (push via trigger)
        if (lojaNome) {
          const { data: dest } = await admin.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
          const userIds = Array.from(
            new Set(((dest || []) as any[]).map((d: any) => d.user_id))
          ).filter(Boolean) as string[];
          if (userIds.length > 0) {
            await admin.from("notificacoes").insert(
              userIds.map((uid) => ({
                usuario_id: uid,
                titulo: tituloLoja,
                mensagem: textoLoja.slice(0, 200),
                tipo: "retorno_setor",
                referencia_id: autz.referencia_id,
              }))
            );
          } else {
            console.warn(`[autorizacao] sem destinatários para loja "${lojaNome}"`);
          }
        }
      } catch (e) {
        console.warn("[autorizacao] aviso loja falhou", e);
      }

      // Dispara automações se aprovou e moveu coluna
      if (decisao === "aprovar" && updates.pipeline_coluna_id) {
        try {
          await admin.functions.invoke("pipeline-automations", {
            body: {
              entity_type: "solicitacao",
              entity_id: autz.referencia_id,
              coluna_id: updates.pipeline_coluna_id,
              coluna_anterior_id: sol?.pipeline_coluna_id,
            },
          });
        } catch (e) { console.warn("[autorizacao] pipeline-automations failed", e); }
      }
    }

    // Notifica solicitante (mensagem 1-a-1 com texto + notificação)
    const conteudoAviso = decisao === "aprovar"
      ? `✅ ${autorizadorNome} APROVOU sua solicitação de exceção.${justificativa ? `\n"${justificativa}"` : ""}`
      : `❌ ${autorizadorNome} NÃO APROVOU sua solicitação de exceção.${justificativa ? `\nMotivo: "${justificativa}"` : ""}`;

    const conversaIdAviso = [user.id, autz.solicitante_id].sort().join("__");
    await admin.from("mensagens_internas").insert({
      remetente_id: user.id,
      destinatario_id: autz.solicitante_id,
      conversa_id: conversaIdAviso,
      conteudo: conteudoAviso,
      metadata: { kind: "autorizacao_resposta", autorizacao_id, decisao },
    });

    await admin.from("notificacoes").insert({
      usuario_id: autz.solicitante_id,
      tipo: "autorizacao_excecao",
      titulo: decisao === "aprovar" ? "Exceção aprovada" : "Exceção não aprovada",
      mensagem: `${autorizadorNome}: ${justificativa || (decisao === "aprovar" ? "aprovado" : "rejeitado")}`,
      referencia_id: autorizacao_id,
    });

    return new Response(JSON.stringify({ success: true, status: novoStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[responder-autorizacao] error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
