// Fluxo A — Loja → Setor (gera card no pipeline do setor destino)
// Chamado pelo app InFoco Messenger (JWT da loja). Substitui a lógica antes
// dormente em `bot-lojas`. Sem WhatsApp: canal único corporativo é o app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnexoIn {
  url: string;
  mime_type?: string;
  nome?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OB_URL = Deno.env.get("OPTICAL_BUSINESS_URL");
    const OB_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET");

    const supabase = createClient(SUPABASE_URL, SERVICE);

    // ── Auth ──
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const fluxoChave: string = body.fluxo_chave;
    const dados: Record<string, unknown> = body.dados || {};
    const anexos: AnexoIn[] = Array.isArray(body.anexos) ? body.anexos : [];
    const lojaSelecionada: { nome_loja?: string; cod_empresa?: string } = body.loja || {};

    if (!fluxoChave) {
      return new Response(JSON.stringify({ error: "fluxo_chave é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Profile + role da loja ──
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, nome, tipo_usuario")
      .eq("id", user.id)
      .single();
    if (!profile || !["loja", "colaborador"].includes(profile.tipo_usuario)) {
      return new Response(JSON.stringify({ error: "Apenas usuários loja/colaborador podem abrir solicitações" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("loja_nome")
      .eq("user_id", user.id)
      .not("loja_nome", "is", null)
      .limit(1)
      .single();

    const nomeLoja = lojaSelecionada.nome_loja || roleRow?.loja_nome || "";
    if (!nomeLoja) {
      return new Response(JSON.stringify({ error: "Loja não identificada para o usuário" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve cod_empresa via telefones_lojas
    let codEmpresa = lojaSelecionada.cod_empresa || "";
    if (!codEmpresa) {
      const { data: tel } = await supabase
        .from("telefones_lojas")
        .select("cod_empresa")
        .ilike("nome_loja", `%${nomeLoja}%`)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      codEmpresa = tel?.cod_empresa || "";
    }

    // ── Resolve / cria contato âncora da loja (PK = telefone) ──
    // Usamos um telefone sintético "loja:<nome>" para não conflitar com clientes finais.
    const telSintetico = `loja:${nomeLoja}`.toLowerCase().replace(/\s+/g, "_");
    const { data: contatoExistente } = await supabase
      .from("contatos")
      .select("id")
      .eq("telefone", telSintetico)
      .maybeSingle();
    let contatoId = contatoExistente?.id;
    if (!contatoId) {
      const { data: novo, error: cErr } = await supabase
        .from("contatos")
        .insert({
          nome: nomeLoja,
          telefone: telSintetico,
          tipo: "loja",
          metadata: { loja_nome: nomeLoja, cod_empresa: codEmpresa, origem: "criar-solicitacao-loja" },
        })
        .select("id")
        .single();
      if (cErr) throw cErr;
      contatoId = novo.id;
    }

    // ── Carrega fluxo ──
    const { data: fluxo } = await supabase
      .from("bot_fluxos")
      .select("*")
      .eq("chave", fluxoChave)
      .eq("ativo", true)
      .maybeSingle();
    if (!fluxo) {
      return new Response(JSON.stringify({ error: `Fluxo "${fluxoChave}" não encontrado/ativo` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acao = (fluxo as any).acao_final || {};
    const tipoSolicitacao: string = acao.tipo_solicitacao || fluxoChave;

    // ── Caso especial: link_pagamento via Optical Business ──
    let extraMetadata: Record<string, unknown> = {};
    let respostaCliente: { url?: string; payment_link_id?: string } = {};
    if (acao.endpoint === "payment-links") {
      if (!OB_URL || !OB_SECRET) {
        return new Response(JSON.stringify({ error: "Integração de pagamento não configurada" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!codEmpresa) {
        return new Response(JSON.stringify({ error: `Loja "${nomeLoja}" sem cod_empresa cadastrado` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const obRes = await fetch(`${OB_URL}/functions/v1/payment-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-key": OB_SECRET },
        body: JSON.stringify({
          action: "criar",
          cod_empresa: codEmpresa,
          valor: dados.valor,
          descricao: dados.descricao,
          parcelas_max: dados.parcelas || 1,
          cliente_nome: dados.cliente || null,
          origem: "ATRIUM_INFOCO",
          origem_ref: user.id,
        }),
      });
      const obData = await obRes.json();
      if (obData?.error) {
        return new Response(JSON.stringify({ error: `OB: ${obData.error}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      respostaCliente = { url: obData.url_pagamento, payment_link_id: obData.id };
      extraMetadata = { payment_link_id: obData.id, url: obData.url_pagamento };
    }

    // ── Resolve coluna destino (primeira do setor do fluxo) ──
    let colunaId: string | null = null;
    if ((fluxo as any).setor_destino_id) {
      const { data: cols } = await supabase
        .from("pipeline_colunas")
        .select("id, nome, ordem")
        .eq("setor_id", (fluxo as any).setor_destino_id)
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      const prio = [acao.coluna_destino].filter(Boolean) as string[];
      const found = (cols || []).find((c: any) => prio.includes(c.nome));
      colunaId = found?.id || (cols && cols[0]?.id) || null;
    }

    // ── Insere solicitação ──
    const assunto = `${(fluxo as any).nome} — ${nomeLoja}`;
    const descricao = Object.entries(dados)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");

    const { data: solicitacao, error: sErr } = await supabase
      .from("solicitacoes")
      .insert({
        contato_id: contatoId,
        assunto,
        descricao,
        canal_origem: "sistema",
        status: "em_atendimento",
        tipo: tipoSolicitacao,
        metadata: { ...dados, ...extraMetadata, alias_loja: nomeLoja, cod_empresa: codEmpresa, origem_app: "infoco_messenger" },
        ...(colunaId ? { pipeline_coluna_id: colunaId } : {}),
      })
      .select("id")
      .single();
    if (sErr) throw sErr;

    // ── Protocolo ──
    const ano = new Date().getFullYear();
    const { data: seqRes } = await supabase.rpc("nextval_protocolo", {});
    const seq = seqRes !== null && seqRes !== undefined ? Number(seqRes) : Date.now() % 100000;
    const protocolo = `SOL-${ano}-${String(seq).padStart(5, "0")}`;
    await supabase.from("solicitacoes").update({ protocolo }).eq("id", solicitacao.id);

    // ── Anexos ──
    for (let i = 0; i < anexos.length; i++) {
      const a = anexos[i];
      try {
        const r = await fetch(a.url);
        if (!r.ok) continue;
        const bytes = await r.arrayBuffer();
        const mime = a.mime_type || "application/octet-stream";
        const extMap: Record<string, string> = {
          "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
          "application/pdf": "pdf", "image/gif": "gif",
        };
        const ext = extMap[mime] || "bin";
        const path = `comprovantes/${ano}/${protocolo}/anexo_${i + 1}.${ext}`;
        await supabase.storage.from("whatsapp-media").upload(path, bytes, { contentType: mime, upsert: true });
        const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
        await supabase.from("solicitacao_anexos").insert({
          solicitacao_id: solicitacao.id,
          tipo: "comprovante",
          descricao: a.nome || `Anexo ${i + 1}`,
          storage_path: path,
          url_publica: pub?.publicUrl || a.url,
          mime_type: mime,
          tamanho_bytes: bytes.byteLength,
        });
      } catch (e) {
        console.error("[criar-solicitacao-loja] anexo error", e);
      }
    }

    // ── Evento CRM ──
    await supabase.from("eventos_crm").insert({
      contato_id: contatoId,
      tipo: `${tipoSolicitacao}_solicitado`,
      descricao: `${(fluxo as any).nome} solicitado por ${profile.nome} (${nomeLoja})`,
      referencia_tipo: "solicitacao",
      referencia_id: solicitacao.id,
      metadata: { protocolo, alias_loja: nomeLoja, cod_empresa: codEmpresa },
    });

    // ── Notificações in-app para o setor destino (canal único = app) ──
    const setorId = (fluxo as any).setor_destino_id;
    if (setorId) {
      const { data: prof } = await supabase
        .from("profiles").select("id").eq("setor_id", setorId).eq("ativo", true);
      const titulo = `Nova solicitação: ${(fluxo as any).nome}`;
      const mensagem = `🏪 ${nomeLoja} | 📋 ${protocolo}`;
      const notifs: any[] = [{
        setor_id: setorId, titulo, mensagem,
        tipo: "solicitacao", referencia_id: solicitacao.id,
      }];
      for (const p of (prof || [])) {
        notifs.push({
          usuario_id: p.id, setor_id: setorId,
          titulo, mensagem, tipo: "solicitacao",
          referencia_id: solicitacao.id,
        });
      }
      if (notifs.length) await supabase.from("notificacoes").insert(notifs);
    }

    return new Response(JSON.stringify({
      status: "ok",
      solicitacao_id: solicitacao.id,
      protocolo,
      tipo: tipoSolicitacao,
      ...respostaCliente,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("criar-solicitacao-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
