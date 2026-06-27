// Conclui uma solicitação financeira (estorno / pagamento / reembolso).
// - Modo "carta": exige anexo PDF/imagem da carta de devolução do estorno.
// - Modo "comprovante_pagamento": exige anexo + NSU + valor + data.
// Efeitos:
//   1) Insere anexo em solicitacao_anexos.
//   2) Atualiza solicitacoes.metadata (estorno_status / payment_status / NSU / etc).
//   3) Move card para coluna "Concluído" do setor Financeiro (cria msg no thread Messenger).
//   4) Registra evento de timeline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Modo = "carta" | "comprovante_pagamento" | "boleto";

interface AnexoIn { url: string; mime_type?: string; nome?: string; storage_path?: string; tamanho_bytes?: number }

interface Body {
  solicitacao_id: string;
  modo: Modo;
  // carta / comprovante: anexo único; boleto: 1+ via anexos[]
  anexo?: AnexoIn;
  anexos?: AnexoIn[];
  // comprovante_pagamento:
  nsu?: string;
  tid?: string;
  valor?: number | string;
  data_pagamento?: string;        // ISO ou dd/mm/aaaa
  observacao?: string;
  // boleto:
  boleto_impresso?: boolean;
}



serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Autor
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
    if (!usuario_id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const { solicitacao_id, modo } = body;

    // Normaliza lista de anexos (modo boleto suporta múltiplos)
    const anexosIn: AnexoIn[] = Array.isArray(body.anexos) && body.anexos.length > 0
      ? body.anexos
      : (body.anexo ? [body.anexo] : []);
    const primeiroAnexo = anexosIn[0];

    if (!solicitacao_id || !modo || !primeiroAnexo?.url) {
      return new Response(JSON.stringify({ error: "solicitacao_id, modo e pelo menos um anexo são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["carta", "comprovante_pagamento", "boleto"].includes(modo)) {
      return new Response(JSON.stringify({ error: "modo inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (modo === "comprovante_pagamento") {
      if (!body.nsu || !body.valor) {
        return new Response(JSON.stringify({ error: "NSU e valor são obrigatórios para comprovante de pagamento" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
    const lojaNome = (meta.alias_loja || meta.loja_nome || "") as string;
    const colunaAnterior = sol.pipeline_coluna_id as string | null;

    // Descobre setor da coluna atual e procura coluna destino
    //   carta / comprovante_pagamento → "Concluído"
    //   boleto                        → "Boleto Enviado" (com fallback p/ Concluído)
    let colunaNova: string | null = colunaAnterior;
    const nomeColunaDestino = modo === "boleto" ? ["Boleto Enviado", "Concluído"] : ["Concluído"];
    if (colunaAnterior) {
      const { data: colAtual } = await supabase
        .from("pipeline_colunas").select("setor_id").eq("id", colunaAnterior).maybeSingle();
      if (colAtual?.setor_id) {
        const { data: alvos } = await supabase
          .from("pipeline_colunas").select("id, nome")
          .eq("setor_id", colAtual.setor_id).in("nome", nomeColunaDestino).eq("ativo", true);
        const found = nomeColunaDestino
          .map((n) => (alvos || []).find((c: any) => c.nome === n))
          .find(Boolean);
        if (found?.id) colunaNova = found.id;
      }
    }

    // 1) Anexos (1+ no modo boleto)
    const tipoAnexo =
      modo === "carta" ? "carta_estorno" :
      modo === "comprovante_pagamento" ? "comprovante_pagamento" :
      "boleto";
    const descAnexoBase =
      modo === "carta" ? "Carta de devolução do estorno" :
      modo === "comprovante_pagamento" ? "Comprovante de pagamento" :
      "Boleto bancário";
    for (let i = 0; i < anexosIn.length; i++) {
      const a = anexosIn[i];
      await supabase.from("solicitacao_anexos").insert({
        solicitacao_id,
        tipo: tipoAnexo,
        descricao: anexosIn.length > 1 ? `${descAnexoBase} (${i + 1}/${anexosIn.length})` : descAnexoBase,
        url_publica: a.url,
        storage_path: a.storage_path || null,
        mime_type: a.mime_type || null,
        tamanho_bytes: a.tamanho_bytes || null,
      });
    }


    // 2) Metadata
    const nowIso = new Date().toISOString();
    const novoMeta: Record<string, unknown> = { ...meta };
    const anexoPrincipalUrl = primeiroAnexo.url;
    const todasUrlsAnexos = anexosIn.map((a) => a.url);
    if (modo === "carta") {
      novoMeta.estorno_status = "concluido";
      novoMeta.carta_estorno_url = anexoPrincipalUrl;
      novoMeta.estorno_concluido_em = nowIso;
      novoMeta.estorno_concluido_por = usuario_nome;
    } else if (modo === "comprovante_pagamento") {
      novoMeta.payment_status = "PAGO";
      novoMeta.pagamento_status = "concluido";
      novoMeta.nsu = body.nsu;
      if (body.tid) novoMeta.tid = body.tid;
      novoMeta.valor_pago = body.valor;
      novoMeta.payment_confirmed_at = nowIso;
      novoMeta.comprovante_url = anexoPrincipalUrl;
      novoMeta.pago_por = usuario_nome;
      if (body.data_pagamento) novoMeta.data_pagamento = body.data_pagamento;
    } else if (modo === "boleto") {
      novoMeta.boleto_status = "enviado";
      novoMeta.boleto_enviado_em = nowIso;
      novoMeta.boleto_enviado_por = usuario_nome;
      novoMeta.boleto_arquivos = todasUrlsAnexos;
      novoMeta.boleto_url = anexoPrincipalUrl;
      novoMeta.boleto_impresso = !!body.boleto_impresso;

    }
    if (body.observacao) novoMeta.observacao_conclusao = body.observacao;

    await supabase.from("solicitacoes").update({
      pipeline_coluna_id: colunaNova,
      status: modo === "boleto" ? "em_atendimento" : "concluida",
      metadata: novoMeta,
      updated_at: nowIso,
    }).eq("id", solicitacao_id);


    // 3) Mensagem na thread da demanda (Messenger)
    //    Se a solicitação não tem demanda vinculada (criada direto via Messenger
    //    sem passar por demandas_loja), auto-cria uma demanda para a loja
    //    receber a carta/comprovante no app.
    let demandaId = (meta.demanda_id as string) || null;

    if (!demandaId && lojaNome) {
      const { data: lojaInfo } = await supabase
        .from("telefones_lojas")
        .select("telefone, setor_destino_id")
        .ilike("nome_loja", lojaNome)
        .eq("ativo", true)
        .maybeSingle();

      if (lojaInfo?.telefone) {
        const protocolo = `FIN-${new Date().getFullYear()}-${solicitacao_id.slice(0, 8)}`;
        const assuntoDem =
          modo === "carta" ? `Carta de estorno — ${sol.assunto || ""}`.slice(0, 120) :
          modo === "boleto" ? `Boleto enviado — ${sol.assunto || ""}`.slice(0, 120) :
          `Comprovante de pagamento — ${sol.assunto || ""}`.slice(0, 120);
        const perguntaDem =
          modo === "carta" ? "Segue carta de estorno do cliente para repasse." :
          modo === "boleto" ? `Boleto(s) emitido(s) (${anexosIn.length} arquivo${anexosIn.length > 1 ? "s" : ""}) — ${(novoMeta as any).boleto_impresso ? "imprimir e entregar fisicamente" : "envio digital"}.` :
          `Comprovante de pagamento NSU ${body.nsu || ""} — R$ ${Number(body.valor || 0).toFixed(2)}`;

        const { data: novaDem, error: novaDemErr } = await supabase
          .from("demandas_loja")
          .insert({
            protocolo,
            loja_nome: lojaNome,
            loja_telefone: lojaInfo.telefone,
            assunto: assuntoDem,
            pergunta: perguntaDem,
            status: "respondida",
            origem: "operador",
            tipo_chave: modo === "carta" ? "carta_estorno" : modo === "boleto" ? "boleto_enviado" : "comprovante_pagamento",
            setor_destino_id: lojaInfo.setor_destino_id,
            solicitante_id: usuario_id,
            solicitante_nome: usuario_nome,
            metadata: { solicitacao_id, auto_created_from: "concluir-solicitacao-financeiro" },
          })
          .select("id")
          .single();

        if (novaDemErr) {
          console.error("[concluir-solicitacao-financeiro] auto-create demanda failed:", novaDemErr);
        } else if (novaDem?.id) {
          demandaId = novaDem.id;
          // Backfill no solicitação para futuras interações
          novoMeta.demanda_id = demandaId;
          await supabase.from("solicitacoes")
            .update({ metadata: novoMeta })
            .eq("id", solicitacao_id);
        }
      }
    }

    if (demandaId) {
      const tituloMsg =
        modo === "carta" ? `✅ Estorno concluído. Segue a carta para enviar ao cliente.` :
        modo === "boleto" ? `📄 Boleto${anexosIn.length > 1 ? "s" : ""} enviado${anexosIn.length > 1 ? "s" : ""} (${anexosIn.length} arquivo${anexosIn.length > 1 ? "s" : ""}).${(novoMeta as any).boleto_impresso ? "\n🖨️ Imprimir e entregar fisicamente." : ""}` :
        `✅ Pagamento concluído.\n\n🔑 NSU: ${body.nsu}\n💰 Valor: R$ ${Number(body.valor).toFixed(2)}${body.data_pagamento ? `\n📅 ${body.data_pagamento}` : ""}`;

      // Mensagem principal com primeiro anexo
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demandaId,
        direcao: "operador_para_loja",
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Financeiro",
        conteudo: tituloMsg + (body.observacao ? `\n\n📝 ${body.observacao}` : ""),
        anexo_url: anexoPrincipalUrl,
        anexo_mime: primeiroAnexo.mime_type || null,
        metadata: { tipo: "conclusao_financeiro", modo, solicitacao_id, total_anexos: anexosIn.length },
      });

      // Mensagens adicionais para anexos extras (modo boleto)
      for (let i = 1; i < anexosIn.length; i++) {
        const ex = anexosIn[i];
        await supabase.from("demanda_mensagens").insert({
          demanda_id: demandaId,
          direcao: "operador_para_loja",
          autor_id: usuario_id,
          autor_nome: usuario_nome || "Financeiro",
          conteudo: `📎 Boleto ${i + 1}/${anexosIn.length}`,
          anexo_url: ex.url,
          anexo_mime: ex.mime_type || null,
          metadata: { tipo: "conclusao_financeiro", modo, solicitacao_id, indice: i },
        });
      }

      // Atualiza demanda como respondida + invalida vista
      await supabase.from("demandas_loja").update({
        status: "respondida",
        vista_pelo_operador: true,
        ultima_mensagem_loja_at: nowIso,
      }).eq("id", demandaId);


      // (Notificações enviadas no bloco 3b com referencia_id=solicitacao_id —
      //  o Messenger abre a thread da SOL, então evitamos duplicar aqui.)

    } else {
      console.warn("[concluir-solicitacao-financeiro] sem demanda vinculada e sem telefone da loja — loja não foi notificada", { solicitacao_id, lojaNome });
    }

    // 3b) ESPELHA no thread da própria solicitação (Messenger "Minhas demandas"
    //     lista solicitacoes e mostra solicitacao_comentarios). É aqui que a
    //     loja realmente lê a resposta do operador.
    //     Mensagem curta + anexo estruturado (anexo_url/nome/mime) para o app
    //     renderizar como card clicável (sem URL crua no texto).
    const comentarioMsg =
      modo === "carta" ? `✅ Estorno concluído.\n\nCarta de devolução em anexo — toque para abrir, baixar ou compartilhar por WhatsApp com o cliente.` :
      modo === "boleto" ? `📄 Boleto(s) enviado(s) — ${anexosIn.length} arquivo${anexosIn.length > 1 ? "s" : ""} em anexo${(novoMeta as any).boleto_impresso ? "\n\n🖨️ Imprimir e entregar fisicamente." : ""}` :
      `✅ Pagamento concluído.\n\n🔑 NSU: ${body.nsu}\n💰 Valor: R$ ${Number(body.valor).toFixed(2)}${body.data_pagamento ? `\n📅 ${body.data_pagamento}` : ""}\n\nComprovante em anexo.`;

    // Comentário principal (1º anexo)
    await supabase.from("solicitacao_comentarios").insert({
      solicitacao_id,
      autor_id: usuario_id,
      autor_nome: usuario_nome || "Financeiro",
      conteudo: comentarioMsg + (body.observacao ? `\n\n📝 ${body.observacao}` : ""),
      tipo: "operador_para_loja",
      anexo_url: anexoPrincipalUrl,
      anexo_nome: primeiroAnexo.nome || (modo === "carta" ? "carta-estorno.pdf" : modo === "boleto" ? "boleto.pdf" : "comprovante.pdf"),
      anexo_mime: primeiroAnexo.mime_type || null,
      metadata: { tipo: "conclusao_financeiro", modo, storage_path: primeiroAnexo.storage_path || null, total_anexos: anexosIn.length },
    });

    // Comentários adicionais para anexos extras (boleto multi-arquivo)
    for (let i = 1; i < anexosIn.length; i++) {
      const ex = anexosIn[i];
      await supabase.from("solicitacao_comentarios").insert({
        solicitacao_id,
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Financeiro",
        conteudo: `📎 Boleto ${i + 1}/${anexosIn.length}`,
        tipo: "operador_para_loja",
        anexo_url: ex.url,
        anexo_nome: ex.nome || `boleto-${i + 1}.pdf`,
        anexo_mime: ex.mime_type || null,
        metadata: { tipo: "conclusao_financeiro", modo, storage_path: ex.storage_path || null, indice: i },
      });
    }

    // Notifica usuários da loja com referência à SOLICITAÇÃO (Messenger abre a
    // thread da solicitação — é onde a loja vê a carta/comprovante/boleto).
    if (lojaNome) {
      const { data: destsSol } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
      const userIdsSol = (destsSol || []).map((d: any) => d.user_id).filter(Boolean);
      if (userIdsSol.length > 0) {
        const tipoNotif = modo === "carta" ? "estorno_concluido" : modo === "boleto" ? "boleto_enviado" : "pagamento_concluido";
        const tituloNotif = modo === "carta" ? "Carta de estorno disponível" : modo === "boleto" ? "Boleto enviado" : "Pagamento concluído";
        const msgNotif = modo === "carta"
          ? `${sol.protocolo || "Solicitação"} — toque para baixar a carta`
          : modo === "boleto"
          ? `${sol.protocolo || "Solicitação"} — ${anexosIn.length} boleto(s)${(novoMeta as any).boleto_impresso ? " • imprimir" : ""}`
          : `${sol.protocolo || "Solicitação"} — R$ ${Number(body.valor).toFixed(2)} NSU ${body.nsu}`;
        await supabase.from("notificacoes").insert(userIdsSol.map((uid: string) => ({
          usuario_id: uid,
          tipo: tipoNotif,
          titulo: tituloNotif,
          mensagem: msgNotif.slice(0, 140),
          referencia_id: solicitacao_id,
        })));
      }
    }



    // 4) Timeline
    const tipoEvt = modo === "carta" ? "estorno_concluido" : modo === "boleto" ? "boleto_enviado" : "pagamento_concluido";
    const descEvt = modo === "carta" ? "Estorno concluído com carta" : modo === "boleto" ? `Boleto enviado (${anexosIn.length} arquivo${anexosIn.length > 1 ? "s" : ""})` : `Pagamento concluído — NSU ${body.nsu}`;
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: solicitacao_id,
      tipo: tipoEvt,
      descricao: descEvt,
      coluna_anterior_id: colunaAnterior,
      coluna_nova_id: colunaNova,
      usuario_id,
      usuario_nome,
      metadata: { modo, anexo_url: anexoPrincipalUrl, total_anexos: anexosIn.length, nsu: body.nsu, valor: body.valor },
    });


    return new Response(JSON.stringify({ status: "ok", coluna_id: colunaNova, demanda_id: demandaId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[concluir-solicitacao-financeiro] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
