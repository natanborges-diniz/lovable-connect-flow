// confirmar-recebimento-os
// Loja confirma manualmente no Atrium Messenger que recebeu a OS.
// Marca recebido_at e dispara template `os_recebida_loja` (alias) ao cliente.
// Idempotente: se já recebida, retorna 200 sem reenviar.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const BRIDGE_URL   = Deno.env.get("BRIDGE_URL");
    const SVC_SECRET   = Deno.env.get("INTERNAL_SERVICE_SECRET");
    const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await userClient.auth.getUser();
    const userId = authData?.user?.id ?? null;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "confirm").toLowerCase(); // "preview" | "confirm"
    const os_numero = String(body.os_numero ?? "").trim();
    const loja_nome = String(body.loja_nome ?? "").trim();

    if (!os_numero) {
      return json({ error: "os_numero é obrigatório" }, 400);
    }
    if (action === "confirm" && !loja_nome) {
      return json({ error: "loja_nome é obrigatório para confirmar" }, 400);
    }

    // ── MODO PREVIEW ──
    // Loja digita o número da OS no Messenger; backend consulta a bridge
    // e devolve cliente/loja/produto/etapa para a tela exibir antes de confirmar.
    if (action === "preview") {
      if (!BRIDGE_URL || !SVC_SECRET) {
        return json({ error: "bridge_indisponivel" }, 503);
      }
      const resp = await fetch(
        `${BRIDGE_URL.replace(/\/$/, "")}/api/v1/os/consulta-status?os=${encodeURIComponent(os_numero)}`,
        { headers: { "x-service-key": SVC_SECRET } },
      );
      if (!resp.ok) {
        return json({ error: "bridge_falhou", status: resp.status }, 502);
      }
      const j = await resp.json();
      const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      const r = rows[0] ?? null;
      if (!r) return json({ error: "os_nao_encontrada", os_numero }, 404);

      // Loja informada x loja da OS — só alerta, não bloqueia (admin pode receber em qualquer).
      const lojaOs = r.empresa ? String(r.empresa) : null;
      const lojaConfere = loja_nome ? loja_nome.toLowerCase() === (lojaOs || "").toLowerCase() : null;

      // Já recebida?
      const { data: existente } = await supabase
        .from("os_recebimento_loja")
        .select("recebido_at, recebido_por, loja_nome")
        .eq("os_numero", os_numero)
        .maybeSingle();

      return json({
        status: "ok",
        preview: {
          os_numero,
          cliente_nome: r.cliente ?? null,
          cliente_telefone: r.telefone ?? null,
          loja_nome_os: lojaOs,
          cod_empresa: r.codEmpresa ?? null,
          cod_etapa_atual: r.codEtapa ?? null,
          etapa_label: r.etapa ?? null,
          produtos: Array.isArray(r.produtos) ? r.produtos : [],
        },
        loja_confere: lojaConfere,
        ja_recebida: existente?.recebido_at ? {
          recebido_at: existente.recebido_at,
          loja: existente.loja_nome,
        } : null,
      });
    }

    // 1) Procura linha existente (pode ter sido criada pelo cron de codEtapa=15)
    const { data: existente } = await supabase
      .from("os_recebimento_loja")
      .select("*")
      .eq("os_numero", os_numero)
      .eq("loja_nome", loja_nome)
      .maybeSingle();

    if (existente?.recebido_at) {
      return json({
        status: "already_received",
        os_numero,
        loja_nome,
        recebido_at: existente.recebido_at,
        notificado_cliente_at: existente.notificado_cliente_at,
      });
    }

    // 2) Se ainda não temos cliente/telefone, consulta a bridge
    let cliente_nome     = existente?.cliente_nome   ?? null;
    let cliente_telefone = existente?.cliente_telefone ?? null;
    let contato_id       = existente?.contato_id     ?? null;
    let produto_descricao = existente?.produto_descricao ?? null;
    let cod_etapa_atual  = existente?.cod_etapa_atual ?? null;
    let etapa_label      = existente?.etapa_label    ?? null;

    if (!cliente_telefone && BRIDGE_URL && SVC_SECRET) {
      try {
        const resp = await fetch(
          `${BRIDGE_URL.replace(/\/$/, "")}/api/v1/os/consulta-status?os=${encodeURIComponent(os_numero)}`,
          { headers: { "x-service-key": SVC_SECRET } },
        );
        if (resp.ok) {
          const j = await resp.json();
          const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
          const r = rows[0] ?? null;
          if (r) {
            cliente_nome     = cliente_nome     ?? (r.cliente  ? String(r.cliente)  : null);
            cliente_telefone = cliente_telefone ?? (r.telefone ? String(r.telefone) : null);
            cod_etapa_atual  = cod_etapa_atual  ?? (r.codEtapa != null ? Number(r.codEtapa) : null);
            etapa_label      = etapa_label      ?? (r.etapa    ? String(r.etapa)    : null);
          }
        }
      } catch (e) {
        console.warn("[confirmar-recebimento-os] bridge lookup falhou:", e);
      }
    }

    // 3) Resolve contato_id por telefone (se ainda não temos)
    if (!contato_id && cliente_telefone) {
      const clean = cliente_telefone.replace(/\D/g, "");
      const { data: c } = await supabase
        .from("contatos")
        .select("id, nome")
        .eq("telefone", clean)
        .maybeSingle();
      if (c) {
        contato_id   = c.id;
        cliente_nome = cliente_nome ?? c.nome;
      }
    }

    // 4) Upsert na tabela com recebido_at
    const now = new Date().toISOString();
    const { data: row, error: upErr } = await supabase
      .from("os_recebimento_loja")
      .upsert(
        {
          os_numero,
          loja_nome,
          contato_id,
          cliente_nome,
          cliente_telefone,
          produto_descricao,
          cod_etapa_atual,
          etapa_label,
          recebido_at: now,
          recebido_por: userId,
        },
        { onConflict: "os_numero,loja_nome" },
      )
      .select()
      .single();
    if (upErr) throw upErr;

    // 5) Dispara template ao cliente (se houver contato resolvido)
    let dispatch: any = { skipped: true, reason: "sem_contato_id" };
    if (contato_id) {
      const primeiroNome = (cliente_nome ?? "").split(" ")[0] || "tudo bem";
      const tplResp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          contato_id,
          template_alias: "os_recebida_loja",
          template_params: [primeiroNome, os_numero, loja_nome],
          language: "pt_BR",
        }),
      });
      const tplJson = await tplResp.json().catch(() => ({}));
      dispatch = { status: tplResp.status, body: tplJson };

      if (tplResp.ok && tplJson?.status === "sent") {
        const wamid = tplJson?.whatsapp_response?.messages?.[0]?.id ?? null;
        await supabase
          .from("os_recebimento_loja")
          .update({
            notificado_cliente_at: new Date().toISOString(),
            notificado_cliente_template: "os_recebida_loja",
            whatsapp_message_id: wamid,
            wa_status: "sent",
            wa_status_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
    }

    await supabase.from("eventos_crm").insert({
      contato_id,
      tipo: "os_recebida_loja",
      descricao: `Loja ${loja_nome} confirmou recebimento da OS ${os_numero}`,
      referencia_tipo: "os_recebimento_loja",
      referencia_id: row.id,
      metadata: { os_numero, loja_nome, dispatch },
    });

    return json({ status: "ok", row, dispatch });
  } catch (e) {
    console.error("confirmar-recebimento-os error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
