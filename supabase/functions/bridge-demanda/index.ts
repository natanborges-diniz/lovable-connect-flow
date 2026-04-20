// Espelha mensagens internas (conversa_id = 'demanda_<id>') para a thread oficial
// `demanda_mensagens`, atualiza `demandas_loja`, notifica solicitante e processa
// comandos textuais da loja (/encerrar, /resolvido).
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
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const {
      mensagem_interna_id,
      conversa_id,
      remetente_id,
      destinatario_id,
      conteudo,
      anexo_url,
      anexo_tipo,
    } = body || {};

    if (!conversa_id || !String(conversa_id).startsWith("demanda_")) {
      return new Response(JSON.stringify({ status: "skipped", reason: "not_demanda_conversa" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const demanda_id = String(conversa_id).slice("demanda_".length);
    if (!demanda_id) {
      return new Response(JSON.stringify({ status: "skipped", reason: "no_demanda_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega demanda
    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .select("*")
      .eq("id", demanda_id)
      .single();
    if (demErr || !demanda) {
      console.warn(`[bridge-demanda] demanda não encontrada ${demanda_id}`);
      return new Response(JSON.stringify({ status: "skipped", reason: "demanda_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (demanda.status === "encerrada") {
      return new Response(JSON.stringify({ status: "skipped", reason: "demanda_encerrada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-loop: se a mensagem original já marca bootstrap, não duplica
    // (criar-demanda-loja insere na thread direto + manda mensagens_internas; queremos mirror APENAS de mensagens_internas posteriores)
    if (mensagem_interna_id) {
      const { data: original } = await supabase
        .from("mensagens_internas")
        .select("id")
        .eq("id", mensagem_interna_id)
        .single();
      if (!original) {
        return new Response(JSON.stringify({ status: "skipped", reason: "msg_not_found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Anti-loop: se a primeira mensagem desta conversa é bootstrap (igual à pergunta da demanda),
    // ignora a primeira leva (broadcasts iniciais)
    // Estratégia: dedup por (mensagem_interna_id) — se já existe demanda_mensagens com esse origin_id, skip
    const { data: jaEspelhada } = await supabase
      .from("demanda_mensagens")
      .select("id")
      .eq("demanda_id", demanda_id)
      .contains("metadata", { origin_msg_id: mensagem_interna_id })
      .maybeSingle();
    if (jaEspelhada) {
      return new Response(JSON.stringify({ status: "skipped", reason: "already_mirrored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve direção: se remetente é o solicitante (operador) → operador_para_loja; senão → loja_para_operador
    const isOperador = remetente_id && demanda.solicitante_id && remetente_id === demanda.solicitante_id;
    const direcao = isOperador ? "operador_para_loja" : "loja_para_operador";

    // Bootstrap dedup: se conteúdo coincide exatamente com a pergunta inicial da demanda
    // E ainda não existe nenhuma mensagem `loja_para_operador`, é o broadcast inicial — pula
    const conteudoStr = String(conteudo || "").trim();
    const isBootstrap =
      direcao === "operador_para_loja" &&
      conteudoStr.includes(demanda.pergunta) &&
      conteudoStr.includes(demanda.protocolo);
    if (isBootstrap) {
      return new Response(JSON.stringify({ status: "skipped", reason: "bootstrap_message" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve nome do autor
    let autorNome = "Operador";
    if (!isOperador) autorNome = demanda.loja_nome;
    if (remetente_id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("nome")
        .eq("id", remetente_id)
        .single();
      if (prof?.nome) autorNome = prof.nome;
    }

    // Comandos textuais da loja
    const lower = conteudoStr.toLowerCase().trim();
    const isEncerrarCmd = !isOperador && (lower === "/encerrar" || lower === "/resolvido" || lower === "/fechar");

    if (isEncerrarCmd) {
      // Insere nota e chama encerrar-demanda-loja
      await supabase.from("demanda_mensagens").insert({
        demanda_id,
        direcao: "loja_para_operador",
        autor_id: remetente_id,
        autor_nome: autorNome,
        conteudo: conteudoStr,
        metadata: { via_bridge: true, origin_msg_id: mensagem_interna_id, comando: "encerrar" },
      });
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/encerrar-demanda-loja`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "X-Internal-Caller": "bridge-demanda",
          },
          body: JSON.stringify({ demanda_id, encerrado_por: "loja" }),
        });
      } catch (e) {
        console.error("[bridge-demanda] encerrar falhou:", e);
      }
      return new Response(JSON.stringify({ status: "ok", action: "encerrada_loja" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Espelha mensagem comum
    await supabase.from("demanda_mensagens").insert({
      demanda_id,
      direcao,
      autor_id: remetente_id,
      autor_nome: autorNome,
      conteudo: conteudoStr,
      anexo_url: anexo_url || null,
      anexo_mime: anexo_tipo || null,
      tipo_conteudo: anexo_url ? (String(anexo_tipo || "").startsWith("image") ? "image" : "file") : "text",
      metadata: { via_bridge: true, origin_msg_id: mensagem_interna_id },
    });

    // Atualiza demanda + notifica solicitante quando vier da loja
    if (!isOperador) {
      await supabase
        .from("demandas_loja")
        .update({
          status: demanda.status === "aberta" ? "respondida" : demanda.status,
          ultima_mensagem_loja_at: new Date().toISOString(),
          vista_pelo_operador: false,
        })
        .eq("id", demanda_id);

      if (demanda.solicitante_id) {
        await supabase.from("notificacoes").insert({
          usuario_id: demanda.solicitante_id,
          tipo: "demanda_resposta",
          titulo: `Resposta da loja • ${demanda.protocolo}`,
          mensagem: `${autorNome}: ${conteudoStr.slice(0, 140)}`,
          referencia_id: demanda_id,
        });
      }
    }

    return new Response(JSON.stringify({ status: "ok", direcao }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[bridge-demanda] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
