// confirmar-recebimento-os
// Loja confirma manualmente no Atrium Messenger que recebeu a OS.
// Marca recebido_at e dispara template `os_recebida_loja` (alias) ao cliente.
// Idempotente: se já recebida, retorna 200 sem reenviar (exceto action=resend).
//
// Actions:
//   - preview : consulta bridge, devolve dados; não grava.
//   - confirm : upsert + dispara template (default).
//   - resend  : reenvia template ao cliente para uma linha já existente
//               (útil quando wa_status='failed' ou 'no_dispatch').

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

// ── Envio de texto livre pela Meta (janela 24h aberta pelo template) ──
async function sendTextViaMeta(phone: string, texto: string): Promise<any> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) throw new Error("WhatsApp Meta creds ausentes");
  const clean = String(phone).replace(/\D/g, "");
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: clean,
      type: "text",
      text: { preview_url: false, body: texto },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`meta ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Follow-up: pergunta se cliente quer marcar horário de retirada ──
// Enviado logo após o template `os_recebida_loja` para dar ao cliente um
// próximo passo claro (agendar retirada). Se ele responder positivamente, o
// gate de loja obrigatória em ai-triage já vai usar a loja da OS direto na
// tool agendar_visita, sem perguntar unidade.
async function enviarFollowupRetirada(opts: {
  supabase: any;
  contato_id: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  os_numero: string;
  loja_nome: string;
  rowId: string;
}) {
  const { supabase, contato_id, cliente_nome, cliente_telefone, os_numero, loja_nome, rowId } = opts;
  if (!cliente_telefone) return { status: "skipped", motivo: "sem_telefone" };
  const primeiroNome = String(cliente_nome ?? "").trim().split(/\s+/)[0] || "";
  const saud = primeiroNome ? `${primeiroNome}, ` : "";
  const texto =
    `${saud}quer que eu já reserve um horário para você passar na *${loja_nome}* para retirar? 😊\n\n` +
    `Se sim, me diga o *dia* e o *período* (manhã ou tarde) que fica melhor pra você — eu confirmo com a loja.\n\n` +
    `Se preferir passar sem hora marcada, também tudo bem, é só nos avisar quando estiver a caminho.`;
  let wamid: string | null = null;
  try {
    const r = await sendTextViaMeta(cliente_telefone, texto);
    wamid = r?.messages?.[0]?.id || null;
  } catch (e) {
    const msg = (e as Error).message || "";
    console.warn("[confirmar-recebimento-os] followup retirada falhou:", msg);
    return { status: "falha", motivo: msg.slice(0, 200) };
  }

  // Loga em mensagens (se houver atendimento aberto p/ o contato)
  try {
    const { data: atendAberto } = await supabase
      .from("atendimentos")
      .select("id")
      .eq("contato_id", contato_id)
      .eq("status", "aberto")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((atendAberto as any)?.id) {
      await supabase.from("mensagens").insert({
        atendimento_id: (atendAberto as any).id,
        direcao: "outbound",
        conteudo: texto,
        tipo_conteudo: "text",
        remetente_nome: "Óticas Diniz",
        provedor: "meta_official",
        metadata: {
          whatsapp_message_id: wamid,
          provedor: "meta_official",
          categoria: "os_recebida_followup_retirada",
          os_numero,
          loja_nome,
          os_recebimento_id: rowId,
        },
      });
    }
  } catch (e) {
    console.warn("[confirmar-recebimento-os] log followup mensagem falhou:", (e as Error).message);
  }

  return { status: "enviado", wamid };
}

async function dispatchTemplate(opts: {
  SUPABASE_URL: string;
  SERVICE_KEY: string;
  supabase: any;
  rowId: string;
  contato_id: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  os_numero: string;
  loja_nome: string;
}) {
  const { SUPABASE_URL, SERVICE_KEY, supabase, rowId, contato_id, cliente_nome, cliente_telefone, os_numero, loja_nome } = opts;
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
  const now = new Date().toISOString();

  if (tplResp.ok && tplJson?.status === "sent") {
    const wamid = tplJson?.whatsapp_response?.messages?.[0]?.id ?? null;
    await supabase
      .from("os_recebimento_loja")
      .update({
        notificado_cliente_at: now,
        notificado_cliente_template: "os_recebida_loja",
        whatsapp_message_id: wamid,
        wa_status: "sent",
        wa_status_at: now,
        wa_status_reason: null,
      })
      .eq("id", rowId);

    // Follow-up de retirada (texto livre — janela 24h aberta pelo template acima).
    // Não bloqueia o retorno se falhar; apenas registra no dispatch.
    const followup = await enviarFollowupRetirada({
      supabase,
      contato_id,
      cliente_nome,
      cliente_telefone,
      os_numero,
      loja_nome,
      rowId,
    });

    return { status: tplResp.status, body: tplJson, wamid, followup };
  }

  // falha explícita — grava motivo para a loja ver
  const reason =
    tplJson?.error?.message ??
    tplJson?.error ??
    tplJson?.message ??
    `dispatch_http_${tplResp.status}`;
  await supabase
    .from("os_recebimento_loja")
    .update({
      wa_status: "failed",
      wa_status_at: now,
      wa_status_reason: String(reason).slice(0, 500),
    })
    .eq("id", rowId);
  return { status: tplResp.status, body: tplJson, error: reason };
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
    const action = String(body.action ?? "confirm").toLowerCase(); // "preview" | "confirm" | "resend"
    const os_numero = String(body.os_numero ?? "").trim();
    const loja_nome = String(body.loja_nome ?? "").trim();

    if (!os_numero) {
      return json({ error: "os_numero é obrigatório" }, 400);
    }
    if ((action === "confirm" || action === "resend") && !loja_nome) {
      return json({ error: "loja_nome é obrigatório" }, 400);
    }

    // ── MODO PREVIEW ──
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

      const lojaOs = r.empresa ? String(r.empresa) : null;
      const lojaConfere = loja_nome ? loja_nome.toLowerCase() === (lojaOs || "").toLowerCase() : null;

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

    // ── MODO RESEND ──
    if (action === "resend") {
      const { data: row, error } = await supabase
        .from("os_recebimento_loja")
        .select("*")
        .eq("os_numero", os_numero)
        .eq("loja_nome", loja_nome)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "os_nao_registrada" }, 404);
      if (!row.contato_id) {
        await supabase
          .from("os_recebimento_loja")
          .update({
            wa_status: "no_dispatch",
            wa_status_at: new Date().toISOString(),
            wa_status_reason: "sem_contato_id_para_reenvio",
          })
          .eq("id", row.id);
        return json({ error: "sem_contato_id" }, 422);
      }
      const dispatch = await dispatchTemplate({
        SUPABASE_URL, SERVICE_KEY, supabase,
        rowId: row.id,
        contato_id: row.contato_id,
        cliente_nome: row.cliente_nome,
        os_numero, loja_nome,
      });
      const { data: fresh } = await supabase
        .from("os_recebimento_loja").select("*").eq("id", row.id).single();
      return json({ status: "resent", row: fresh, dispatch });
    }

    // ── MODO CONFIRM (default) ──
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
        row: existente,
      });
    }

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

    // Dispara template ao cliente (se houver contato resolvido)
    let dispatch: any;
    if (contato_id) {
      dispatch = await dispatchTemplate({
        SUPABASE_URL, SERVICE_KEY, supabase,
        rowId: row.id,
        contato_id,
        cliente_nome,
        os_numero, loja_nome,
      });
    } else {
      const reason = cliente_telefone
        ? "contato_nao_encontrado_para_telefone"
        : "sem_telefone_na_bridge";
      await supabase
        .from("os_recebimento_loja")
        .update({
          wa_status: "no_dispatch",
          wa_status_at: now,
          wa_status_reason: reason,
        })
        .eq("id", row.id);
      dispatch = { skipped: true, reason };
    }

    await supabase.from("eventos_crm").insert({
      contato_id,
      tipo: "os_recebida_loja",
      descricao: `Loja ${loja_nome} confirmou recebimento da OS ${os_numero}`,
      referencia_tipo: "os_recebimento_loja",
      referencia_id: row.id,
      metadata: { os_numero, loja_nome, dispatch },
    });

    const { data: fresh } = await supabase
      .from("os_recebimento_loja").select("*").eq("id", row.id).single();
    return json({ status: "ok", row: fresh, dispatch });
  } catch (e) {
    console.error("confirmar-recebimento-os error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
