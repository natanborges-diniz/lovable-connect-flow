// Anexa arquivo(s) adicional(is) a um boleto já enviado, SEM consumir
// ciclo de revisão e SEM mover o card de coluna. Append em
// metadata.boleto_arquivos + entrada em metadata.boleto_anexos_historico
// (tipo='extra') + mensagem na thread Messenger + notificação para a loja.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnexoIn { url: string; storage_path?: string; mime_type?: string; nome?: string; tamanho_bytes?: number }
interface Body { solicitacao_id: string; anexos: AnexoIn[]; observacao?: string }

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
    if (!usuario_id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const { solicitacao_id, anexos, observacao } = body;

    if (!solicitacao_id || !Array.isArray(anexos) || anexos.length === 0) {
      return new Response(JSON.stringify({ error: "solicitacao_id e ao menos 1 anexo são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const invalido = anexos.find((a) => !a?.url || !a?.storage_path);
    if (invalido) {
      return new Response(JSON.stringify({ error: "Anexo inválido — refaça o upload." }), {
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
      return new Response(JSON.stringify({ error: "Esta solicitação não é de boleto." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida coluna atual: precisa ser "Boleto Enviado" ou "Boleto em Revisão"
    const { data: colAtual } = await supabase
      .from("pipeline_colunas").select("nome").eq("id", sol.pipeline_coluna_id).maybeSingle();
    const nomeCol = colAtual?.nome || "";
    if (!["Boleto Enviado", "Boleto em Revisão"].includes(nomeCol)) {
      return new Response(JSON.stringify({ error: `Anexo extra só pode ser adicionado quando o card está em 'Boleto Enviado' ou 'Boleto em Revisão' (atual: ${nomeCol || "—"}).` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = (sol.metadata || {}) as Record<string, any>;
    const lojaNome = (meta.alias_loja || meta.loja_nome || "") as string;
    const nowIso = new Date().toISOString();
    const novasUrls = anexos.map((a) => a.url);

    // 1) Insere em solicitacao_anexos
    for (let i = 0; i < anexos.length; i++) {
      const a = anexos[i];
      await supabase.from("solicitacao_anexos").insert({
        solicitacao_id,
        tipo: "boleto_extra",
        descricao: anexos.length > 1 ? `Boleto adicional (${i + 1}/${anexos.length})` : "Boleto adicional",
        url_publica: a.url,
        storage_path: a.storage_path || null,
        mime_type: a.mime_type || null,
        tamanho_bytes: a.tamanho_bytes || null,
      });
    }

    // 2) Append em metadata (sem resetar entrou_terminal_em / arquivado_at)
    const arquivosAtuais: string[] = Array.isArray(meta.boleto_arquivos) ? meta.boleto_arquivos : [];
    const historico: any[] = Array.isArray(meta.boleto_anexos_historico) ? meta.boleto_anexos_historico : [];
    historico.push({
      tipo: "extra",
      enviado_em: nowIso,
      enviado_por: usuario_nome,
      urls: novasUrls,
      observacao: observacao || null,
    });
    const novoMeta = {
      ...meta,
      boleto_arquivos: [...arquivosAtuais, ...novasUrls],
      boleto_anexos_historico: historico,
    };
    await supabase.from("solicitacoes").update({ metadata: novoMeta, updated_at: nowIso }).eq("id", solicitacao_id);

    // 3) Mensagem na thread (espelha em demanda_mensagens + solicitacao_comentarios)
    const tituloMsg = `📎 Arquivo${anexos.length > 1 ? "s" : ""} adicional${anexos.length > 1 ? "is" : ""} do boleto (${anexos.length}).`;
    const demandaId = (meta.demanda_id as string) || null;
    if (demandaId) {
      for (let i = 0; i < anexos.length; i++) {
        const a = anexos[i];
        await supabase.from("demanda_mensagens").insert({
          demanda_id: demandaId,
          direcao: "operador_para_loja",
          autor_id: usuario_id,
          autor_nome: usuario_nome || "Financeiro",
          conteudo: i === 0 ? tituloMsg + (observacao ? `\n\n📝 ${observacao}` : "") : `📎 Arquivo adicional ${i + 1}/${anexos.length}`,
          anexo_url: a.url,
          anexo_mime: a.mime_type || null,
          metadata: { tipo: "boleto_anexo_extra", solicitacao_id, indice: i },
        });
      }
    }
    for (let i = 0; i < anexos.length; i++) {
      const a = anexos[i];
      await supabase.from("solicitacao_comentarios").insert({
        solicitacao_id,
        autor_id: usuario_id,
        autor_nome: usuario_nome || "Financeiro",
        conteudo: i === 0 ? tituloMsg + (observacao ? `\n\n📝 ${observacao}` : "") : `📎 Arquivo adicional ${i + 1}/${anexos.length}`,
        tipo: "operador_para_loja",
        anexo_url: a.url,
        anexo_nome: a.nome || `boleto-extra-${i + 1}.pdf`,
        anexo_mime: a.mime_type || null,
        metadata: { tipo: "boleto_anexo_extra", storage_path: a.storage_path || null, indice: i },
      });
    }

    // 4) Notifica loja
    if (lojaNome) {
      const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
      const userIds = (dests || []).map((d: any) => d.user_id).filter(Boolean);
      if (userIds.length > 0) {
        await supabase.from("notificacoes").insert(userIds.map((uid: string) => ({
          usuario_id: uid,
          tipo: "boleto_anexo_extra",
          titulo: "Arquivo adicional do boleto",
          mensagem: `${sol.protocolo || "Boleto"} — ${anexos.length} arquivo(s) adicional(is)`.slice(0, 140),
          referencia_id: solicitacao_id,
        })));
      }
    }

    // 5) Evento timeline
    await supabase.from("pipeline_card_eventos").insert({
      entidade: "solicitacao",
      entidade_id: solicitacao_id,
      tipo: "boleto_anexo_extra",
      descricao: `Anexo adicional do boleto (${anexos.length} arquivo${anexos.length > 1 ? "s" : ""})`,
      usuario_id, usuario_nome,
      metadata: { urls: novasUrls, total: anexos.length, observacao: observacao || null },
    });

    return new Response(JSON.stringify({ status: "ok", total_anexos: novoMeta.boleto_arquivos.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[anexar-boleto-extra] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
