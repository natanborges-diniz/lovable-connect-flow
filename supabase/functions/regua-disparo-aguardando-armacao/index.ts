// regua-disparo-aguardando-armacao
// Cron 07:00 SP. Lê /api/v1/os/movimentadas?data=D-1&codEtapa=15 da bridge
// e dispara template `aviso_aguardando_armacao` (alias) ao cliente de cada OS.
// Idempotência: upsert em os_recebimento_loja por (os_numero,loja_nome);
// pula se aviso_armacao_enviado_at já existe.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// D-1 em São Paulo, formato YYYY-MM-DD
function dataOntemSaoPaulo(): string {
  const nowSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  nowSP.setDate(nowSP.getDate() - 1);
  const y = nowSP.getFullYear();
  const m = String(nowSP.getMonth() + 1).padStart(2, "0");
  const d = String(nowSP.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function montarProdutoDescricao(produtos: Array<{ tipo: string; descricao: string }>): string {
  if (!Array.isArray(produtos) || produtos.length === 0) return "";
  return produtos
    .filter((p) => p?.descricao)
    .map((p) => p.descricao.trim())
    .join(" + ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const BRIDGE_URL   = Deno.env.get("BRIDGE_URL");
    const SVC_SECRET   = Deno.env.get("INTERNAL_SERVICE_SECRET");

    if (!BRIDGE_URL || !SVC_SECRET) {
      return json({ error: "BRIDGE_URL ou INTERNAL_SERVICE_SECRET não configurados" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Permite override via body (testes manuais)
    const body = await req.json().catch(() => ({}));
    const dataConsulta: string = body?.data || dataOntemSaoPaulo();
    const codEtapa: string = String(body?.codEtapa ?? 15);

    const url = `${BRIDGE_URL.replace(/\/$/, "")}/api/v1/os/movimentadas?data=${dataConsulta}&codEtapa=${codEtapa}`;
    console.log(`[regua-armacao] consultando bridge: ${url}`);

    const bridgeResp = await fetch(url, { headers: { "x-service-key": SVC_SECRET } });
    if (!bridgeResp.ok) {
      const t = await bridgeResp.text().catch(() => "");
      console.error("[regua-armacao] bridge erro", bridgeResp.status, t.slice(0, 200));
      return json({ error: "bridge_error", status: bridgeResp.status }, 502);
    }
    const bridgeJson = await bridgeResp.json();
    const rows: Array<Record<string, unknown>> = Array.isArray(bridgeJson?.data)
      ? bridgeJson.data
      : Array.isArray(bridgeJson) ? bridgeJson : [];

    console.log(`[regua-armacao] ${rows.length} OS retornadas`);

    // Carrega mapa cod_empresa → loja_nome
    const { data: tlojas } = await supabase
      .from("telefones_lojas")
      .select("cod_empresa, nome_loja")
      .eq("ativo", true)
      .not("cod_empresa", "is", null);
    const codToLoja = new Map<string, string>();
    (tlojas ?? []).forEach((t: any) => {
      if (t.cod_empresa) codToLoja.set(String(t.cod_empresa), t.nome_loja);
    });

    let enviados = 0;
    let pulados = 0;
    let erros = 0;
    const detalhes: any[] = [];

    // Dedup por (os, loja) — bridge pode retornar a mesma OS em múltiplas linhas de log
    const seen = new Set<string>();

    for (const r of rows) {
      const os_numero = String(r.os ?? "").trim();
      const codEmpresa = r.codEmpresa != null ? String(r.codEmpresa) : null;
      const loja_nome = (codEmpresa && codToLoja.get(codEmpresa)) || String(r.empresa ?? "").trim();
      if (!os_numero || !loja_nome) { erros++; continue; }

      const key = `${os_numero}|${loja_nome}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cliente_nome = r.cliente ? String(r.cliente) : null;
      const cliente_telefone = r.telefone ? String(r.telefone) : null;
      const produtos = Array.isArray(r.produtos) ? r.produtos as any[] : [];
      const produto_descricao = montarProdutoDescricao(produtos);

      // Resolve contato por telefone
      let contato_id: string | null = null;
      if (cliente_telefone) {
        const clean = cliente_telefone.replace(/\D/g, "");
        const { data: c } = await supabase
          .from("contatos")
          .select("id")
          .eq("telefone", clean)
          .maybeSingle();
        contato_id = c?.id ?? null;
      }

      // Upsert
      const { data: row, error: upErr } = await supabase
        .from("os_recebimento_loja")
        .upsert(
          {
            os_numero,
            loja_nome,
            cod_empresa: codEmpresa,
            contato_id,
            cliente_nome,
            cliente_telefone,
            produto_descricao,
            cod_etapa_atual: Number(codEtapa),
            etapa_label: r.etapa ? String(r.etapa) : "Aguardando armação",
            data_movimentacao: dataConsulta,
            metadata: { origem: "regua-disparo-aguardando-armacao", raw_produtos: produtos },
          },
          { onConflict: "os_numero,loja_nome" },
        )
        .select()
        .single();
      if (upErr) { console.error("upsert err", upErr); erros++; continue; }

      if (row.aviso_armacao_enviado_at) { pulados++; continue; }

      if (!contato_id) {
        detalhes.push({ os_numero, loja_nome, skipped: "sem_contato" });
        pulados++;
        continue;
      }

      const primeiroNome = (cliente_nome ?? "").split(" ")[0] || "tudo bem";
      const tplResp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          contato_id,
          template_alias: "aviso_aguardando_armacao",
          template_params: [primeiroNome, os_numero, loja_nome],
          language: "pt_BR",
        }),
      });
      const tplJson = await tplResp.json().catch(() => ({}));

      if (tplResp.ok && tplJson?.status === "sent") {
        await supabase
          .from("os_recebimento_loja")
          .update({
            aviso_armacao_enviado_at: new Date().toISOString(),
            aviso_armacao_template: "aviso_aguardando_armacao",
          })
          .eq("id", row.id);
        enviados++;
        detalhes.push({ os_numero, loja_nome, sent: true });
      } else {
        erros++;
        detalhes.push({ os_numero, loja_nome, error: tplJson });
      }
    }

    console.log(`[regua-armacao] enviados=${enviados} pulados=${pulados} erros=${erros}`);
    return json({ ok: true, data: dataConsulta, codEtapa, total: rows.length, enviados, pulados, erros, detalhes });
  } catch (e) {
    console.error("regua-disparo-aguardando-armacao error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
