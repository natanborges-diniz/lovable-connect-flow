// renovar-cobranca-v1 — renovação de cobrança expirada PELO PRÓPRIO CLIENTE.
// Chamada pelas páginas públicas do OB (/pix/:id e /pay/:id) quando a
// cobrança está expirada. Reemite com os DADOS IDÊNTICOS ao original
// (valor, parcelas, descrição, loja, cliente) — o cliente não escolhe nada.
// Loja e Financeiro são apenas notificados (monitoramento, sem tarefa).
//
// Segurança (endpoint público): age somente sobre cobranças expiradas e não
// pagas; idempotente (se já existe renovação ativa, devolve ela em vez de
// criar outra); limite de 3 renovações por cadeia.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OB_URL = Deno.env.get("OPTICAL_BUSINESS_URL") || "";
    const OB_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET") || "";
    const OB_BASE = (OB_URL.match(/^https?:\/\/[^/]+/) || [OB_URL])[0];
    const supabase = createClient(SUPABASE_URL, SERVICE);

    const { payment_link_id } = await req.json().catch(() => ({}));
    if (!payment_link_id) return json({ error: "payment_link_id é obrigatório" }, 400);

    // ── Localiza a solicitação original ──
    const { data: original } = await supabase
      .from("solicitacoes")
      .select("*")
      .in("tipo", ["link_pagamento", "pix_pagamento"])
      .eq("metadata->>payment_link_id", String(payment_link_id))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!original) return json({ error: "Cobrança não encontrada" }, 404);

    const meta = (original.metadata || {}) as Record<string, any>;
    if (meta.payment_status === "PAGO" || original.status === "concluida") {
      return json({ error: "Esta cobrança já foi paga." }, 409);
    }

    // ── Idempotência: já existe renovação em aberto? Devolve ela. ──
    if (meta.renovado_para) {
      const { data: renov } = await supabase
        .from("solicitacoes").select("id, metadata, status")
        .eq("id", meta.renovado_para).maybeSingle();
      const rm = (renov?.metadata || {}) as Record<string, any>;
      if (renov && renov.status !== "cancelada" && rm.payment_status !== "PAGO" && rm.url) {
        return json({ url: rm.url, renovado: false, ja_existia: true });
      }
    }

    // ── Só renova se realmente expirada ──
    const expirou = !!meta.expirado_at ||
      new Date(original.created_at).getTime() < Date.now() - 48 * 3600 * 1000 ||
      (meta.expira_em && new Date(meta.expira_em).getTime() < Date.now());
    if (!expirou && meta.url) {
      // Ainda ativa: devolve a própria URL, sem criar nada.
      return json({ url: meta.url, renovado: false, ainda_ativa: true });
    }

    const renovacoes = Number(meta.renovacoes || 0);
    if (renovacoes >= 3) {
      return json({ error: "Limite de renovações atingido. Fale com a loja para gerar uma nova cobrança." }, 429);
    }

    if (!OB_BASE || !OB_SECRET) return json({ error: "Integração indisponível" }, 500);

    // ── Reemite no OB com os dados originais ──
    const isPix = original.tipo === "pix_pagamento";
    const endpoint = isPix ? "pix-charges-v4" : "payment-links";
    const payload = isPix
      ? {
          action: "criar", cod_empresa: meta.cod_empresa, valor: meta.valor,
          descricao: meta.descricao || "Óticas Diniz", cliente_nome: meta.cliente || null,
          expiracao_segundos: 172800, origem: "ATRIUM_INFOCO",
          origem_ref: `renovacao:${original.id}`,
        }
      : {
          action: "criar", cod_empresa: meta.cod_empresa, valor: meta.valor,
          descricao: meta.descricao || "Óticas Diniz",
          parcelas_max: meta.parcelas || 1, parcelas_fixas: meta.parcelas || 1,
          cliente_nome: meta.cliente || null, origem: "ATRIUM_INFOCO",
          origem_ref: `renovacao:${original.id}`,
        };

    const obRes = await fetch(`${OB_BASE}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-key": OB_SECRET },
      body: JSON.stringify(payload),
    });
    const obData = await obRes.json().catch(() => null);
    if (!obRes.ok || !obData || obData.error || !obData.id) {
      console.error("[renovar] OB falhou:", obRes.status, JSON.stringify(obData).slice(0, 300));
      return json({ error: "Não foi possível gerar a nova cobrança agora. Tente novamente em instantes." }, 502);
    }

    const novaUrl: string = obData.url_pagamento;
    const novoMeta: Record<string, any> = {
      ...meta,
      payment_link_id: obData.id,
      url: novaUrl,
      renovado_de: original.id,
      renovacoes: renovacoes + 1,
      origem_renovacao: "cliente_pagina",
      // limpa marcas da cadeia anterior
      lembrete_loja_at: null, lembrete_cliente_at: null,
      expirado_at: null, arquivado_at: null, expirado_por: null,
      payment_status: null, comprovante_pagamento: null,
      ...(isPix ? { txid: obData.txid, pix_copia_cola: obData.pix_copia_cola, expira_em: obData.expira_em } : {}),
    };

    // ── Coluna destino ──
    const { data: setorFin } = await supabase.from("setores").select("id").eq("nome", "Financeiro").single();
    let colunaId: string | null = null;
    if (setorFin) {
      const { data: col } = await supabase.from("pipeline_colunas").select("id")
        .eq("setor_id", setorFin.id).eq("nome", isPix ? "Pix Enviado" : "Link Enviado")
        .eq("ativo", true).maybeSingle();
      colunaId = col?.id ?? null;
    }

    // ── Nova solicitação (clone) ──
    const { data: nova, error: novaErr } = await supabase.from("solicitacoes").insert({
      contato_id: original.contato_id,
      assunto: `${original.assunto || "Cobrança"} (renovada pelo cliente)`,
      descricao: original.descricao,
      canal_origem: "sistema",
      status: "em_atendimento",
      tipo: original.tipo,
      metadata: novoMeta,
      ...(colunaId ? { pipeline_coluna_id: colunaId } : {}),
    }).select("id").single();
    if (novaErr) throw novaErr;

    const ano = new Date().getFullYear();
    const { data: seq } = await supabase.rpc("nextval_protocolo", {});
    const protocolo = `SOL-${ano}-${String(Number(seq ?? Date.now() % 100000)).padStart(5, "0")}`;
    await supabase.from("solicitacoes").update({ protocolo }).eq("id", nova.id);

    // Vincula original → renovação
    await supabase.from("solicitacoes").update({
      metadata: { ...meta, renovado_para: nova.id, renovacoes: renovacoes + 1 },
    }).eq("id", original.id);

    // ── Espelho financeiro ──
    const { data: plAntigo } = await supabase.from("pagamentos_link")
      .select("contato_id, cliente_telefone").eq("solicitacao_id", original.id).maybeSingle();
    await supabase.from("pagamentos_link").upsert({
      payment_link_id: obData.id,
      solicitacao_id: nova.id,
      contato_id: plAntigo?.contato_id ?? null,
      loja_nome: (meta.loja_nome || "").replace(/^DINIZ\s+/i, "Diniz "),
      alias_loja: meta.alias_loja || meta.loja_nome,
      cod_empresa: meta.cod_empresa,
      cliente_nome: meta.cliente || null,
      cliente_telefone: plAntigo?.cliente_telefone ?? null,
      valor: meta.valor ? Number(String(meta.valor).replace(/[^0-9.]/g, "")) : null,
      parcelas: meta.parcelas ? Number(meta.parcelas) : null,
      descricao: meta.descricao || null,
      status: "criado",
      link_url: novaUrl,
      metodo: isPix ? "pix" : "cartao",
      ...(isPix ? { pix_txid: obData.txid, pix_copia_cola: obData.pix_copia_cola } : {}),
      metadata: novoMeta,
    }, { onConflict: "payment_link_id" });

    // ── WhatsApp do novo link ao cliente (best effort) ──
    let envio = "pulado";
    if (plAntigo?.contato_id) {
      try {
        const valorFmt = String(meta.valor || "").replace(".", ",");
        const prot8 = String(obData.id).slice(-8).toUpperCase();
        const tplBody = isPix
          ? { template_alias: "pix_pagamento_cliente", template_params: [prot8, valorFmt, obData.pix_copia_cola, novaUrl] }
          : { template_alias: "link_pagamento_cliente", template_params: [prot8, valorFmt, novaUrl] };
        const t = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ contato_id: plAntigo.contato_id, language: "pt_BR", ...tplBody }),
        });
        const tj = await t.json().catch(() => ({}));
        envio = tj?.status === "sent" ? "enviado" : "falhou";
      } catch (_e) { envio = "falhou"; }
    }

    // ── Notifica a loja (informativo, sem tarefa) ──
    const lojaAlias = meta.alias_loja || meta.loja_nome;
    await supabase.from("solicitacao_comentarios").insert({
      solicitacao_id: nova.id,
      tipo: "retorno_setor",
      autor_nome: "Sistema Financeiro",
      conteudo: `🔄 O cliente renovou sozinho a cobrança expirada ${original.protocolo || ""} pela página de pagamento. Nova cobrança ${protocolo} gerada com os mesmos dados (renovação ${renovacoes + 1}/3). Nenhuma ação necessária — acompanhe.`,
      metadata: { origem: "renovar-cobranca", renovado_de: original.id },
    });
    if (lojaAlias) {
      try {
        const { data: dests } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaAlias });
        const notifs = (dests || []).map((d: any) => ({
          usuario_id: d.user_id, setor_id: d.setor_id,
          titulo: `🔄 Cliente renovou cobrança — ${meta.cliente || "cliente"}`,
          mensagem: `${protocolo} gerada automaticamente pelo cliente (substitui ${original.protocolo || "anterior"}).`,
          tipo: "solicitacao", referencia_id: nova.id,
        }));
        if (notifs.length) await supabase.from("notificacoes").insert(notifs);
      } catch (_e) { /* best effort */ }
    }

    return json({ url: novaUrl, protocolo, renovado: true, envio_whatsapp: envio });
  } catch (e) {
    console.error("[renovar-cobranca] erro:", e);
    return json({ error: "Erro interno ao renovar" }, 500);
  }
});
