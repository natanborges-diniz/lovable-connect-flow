// regua-disparo-aguardando-armacao
// Cron 07:00 SP. Lê /api/v1/os/movimentadas?data=D-1&codEtapa=15 da bridge
// e dispara template `aviso_aguardando_armacao` (alias) ao cliente de cada OS.
// Idempotência: upsert em os_recebimento_loja por (os_numero,loja_nome);
// pula se aviso_armacao_enviado_at já existe.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pingBridge,
  listarGaps,
  marcarSync,
  notificarAdminBridgeDown,
  hojeSP as bhHojeSP,
} from "../_shared/bridge-health.ts";

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

// Hoje em São Paulo (Date com fuso SP)
function hojeSP(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// Regra:
//  - domingo (dow=0)  → não roda
//  - segunda (dow=1)  → processa D-1 (domingo) + D-2 (sábado), pois domingo não rodou
//  - demais dias      → processa apenas D-1
function datasParaProcessar(): string[] {
  const hoje = hojeSP();
  const dow = hoje.getDay();
  if (dow === 0) return []; // domingo
  const d1 = new Date(hoje); d1.setDate(d1.getDate() - 1);
  if (dow === 1) {
    const d2 = new Date(hoje); d2.setDate(d2.getDate() - 2);
    return [fmt(d2), fmt(d1)];
  }
  return [fmt(d1)];
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
    const codEtapa: string = String(body?.codEtapa ?? 15);
    const datasBase: string[] = body?.data
      ? [String(body.data)]
      : Array.isArray(body?.datas) && body.datas.length
        ? body.datas.map(String)
        : datasParaProcessar();

    // ── Catch-up curto: só recupera gaps dos últimos 3 dias (D-3).
    // Justificativa: aviso "aguardando armação" perde validade rápido — OS antiga
    // pode já ter saído da etapa 15 e o cliente receberia template desatualizado.
    // A regra normal (seg processa sáb+dom) já cobre o fim de semana.
    const CATCHUP_DIAS = Number(body?.catchup_dias ?? 3);
    let datas = datasBase;
    if (!body?.data && !(Array.isArray(body?.datas) && body.datas.length)) {
      const gaps = await listarGaps(supabase, "armacao_codetapa15", CATCHUP_DIAS, bhHojeSP());
      const set = new Set<string>([...gaps, ...datasBase]);
      datas = Array.from(set).sort();
      if (gaps.length) console.log(`[regua-armacao] catch-up gaps (${CATCHUP_DIAS}d): ${gaps.join(", ")}`);
    }

    if (datas.length === 0) {
      console.log("[regua-armacao] domingo SP + sem gaps — execução pulada");
      return json({ ok: true, skipped: "domingo", datas: [], total: 0, enviados: 0, pulados: 0, erros: 0 });
    }
    console.log(`[regua-armacao] datas a processar: ${datas.join(", ")}`);

    // ── Health-check bridge: se fora, marca todas as datas como bridge_down + notifica + sai 200
    const ping = await pingBridge(BRIDGE_URL, SVC_SECRET);
    if (!ping.ok) {
      console.error(`[regua-armacao] BRIDGE DOWN: ${ping.error}`);
      for (const d of datas) {
        await marcarSync(supabase, {
          fonte: "armacao_codetapa15",
          data_alvo: d,
          status: "bridge_down",
          erro_msg: ping.error ?? `HTTP ${ping.status ?? "?"}`,
        });
      }
      await notificarAdminBridgeDown(supabase, "armacao_codetapa15", ping.error ?? `HTTP ${ping.status}`);
      return json({ ok: true, bridge_down: true, datas, erro: ping.error });
    }

    // Carrega mapa cod_empresa → loja_nome (uma única vez)
    const { data: tlojas } = await supabase
      .from("telefones_lojas")
      .select("cod_empresa, nome_loja")
      .eq("ativo", true)
      .not("cod_empresa", "is", null);
    const codToLoja = new Map<string, string>();
    (tlojas ?? []).forEach((t: any) => {
      if (t.cod_empresa) codToLoja.set(String(t.cod_empresa), t.nome_loja);
    });

    let totalRows = 0;
    let enviados = 0;
    let pulados = 0;
    let erros = 0;
    const detalhes: any[] = [];

    for (const dataConsulta of datas) {
      const url = `${BRIDGE_URL.replace(/\/$/, "")}/api/v1/os/movimentadas?data=${dataConsulta}&codEtapa=${codEtapa}`;
      console.log(`[regua-armacao] consultando bridge: ${url}`);

      const bridgeResp = await fetch(url, { headers: { "x-service-key": SVC_SECRET } });
      if (!bridgeResp.ok) {
        const t = await bridgeResp.text().catch(() => "");
        console.error("[regua-armacao] bridge erro", bridgeResp.status, t.slice(0, 200));
        detalhes.push({ data: dataConsulta, error: "bridge_error", status: bridgeResp.status });
        erros++;
        await marcarSync(supabase, {
          fonte: "armacao_codetapa15",
          data_alvo: dataConsulta,
          status: "bridge_down",
          erro_msg: `HTTP ${bridgeResp.status}`,
        });
        continue;
      }
      const bridgeJson = await bridgeResp.json();
      const rows: Array<Record<string, unknown>> = Array.isArray(bridgeJson?.data)
        ? bridgeJson.data
        : Array.isArray(bridgeJson) ? bridgeJson : [];

      console.log(`[regua-armacao] data=${dataConsulta} → ${rows.length} OS retornadas`);
      totalRows += rows.length;

      // Dedup por (os, loja) dentro da mesma data
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

        // Idempotência: já enviou aviso pra essa OS+loja?
        const { data: jaEnviado } = await supabase
          .from("os_avisos_armacao_log")
          .select("id")
          .eq("os_numero", os_numero)
          .eq("loja_nome", loja_nome)
          .maybeSingle();
        if (jaEnviado) { pulados++; continue; }

        if (!contato_id) {
          detalhes.push({ data: dataConsulta, os_numero, loja_nome, skipped: "sem_contato" });
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
          await supabase.from("os_avisos_armacao_log").insert({
            os_numero,
            loja_nome,
            cod_empresa: codEmpresa,
            contato_id,
            cliente_telefone,
            data_movimentacao: dataConsulta,
            template_alias: "aviso_aguardando_armacao",
            status: "sent",
            payload: { cliente_nome, produto_descricao, raw_produtos: produtos },
          });
          enviados++;
          detalhes.push({ data: dataConsulta, os_numero, loja_nome, sent: true });
        } else {
          await supabase.from("os_avisos_armacao_log").insert({
            os_numero,
            loja_nome,
            cod_empresa: codEmpresa,
            contato_id,
            cliente_telefone,
            data_movimentacao: dataConsulta,
            status: "error",
            payload: { error: tplJson },
          });
          erros++;
          detalhes.push({ data: dataConsulta, os_numero, loja_nome, error: tplJson });
        }
      }

      // Marca data como sincronizada com sucesso (mesmo se rows=0, foi consultada)
      await marcarSync(supabase, {
        fonte: "armacao_codetapa15",
        data_alvo: dataConsulta,
        status: rows.length === 0 ? "vazio" : "ok",
        linhas_recebidas: rows.length,
      });
    }

    console.log(`[regua-armacao] enviados=${enviados} pulados=${pulados} erros=${erros}`);
    return json({ ok: true, datas, codEtapa, total: totalRows, enviados, pulados, erros, detalhes });
  } catch (e) {
    console.error("regua-disparo-aguardando-armacao error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
