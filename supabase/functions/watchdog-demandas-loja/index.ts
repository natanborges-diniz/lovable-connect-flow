// watchdog-demandas-loja
// Escalonamento progressivo de demandas sem resposta da loja.
// SLA padrão (editável via cron_jobs.payload.thresholds, minutos):
//   T+15  → lembrete push aos operadores da loja
//   T+30  → 2º lembrete + escala para SUPERVISOR
//   T+60  → escala para GERENTE regional
//   T+120 → status='sem_resposta', notifica solicitante; demanda NÃO é encerrada
//
// Idempotência: cada nível é registrado em metadata.escalonamentos.{tNN_at}
// e nunca dispara de novo. Conta apenas demandas com status='aberta'.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Thresholds = { t15: number; t30: number; t60: number; t120: number };
const DEFAULTS: Thresholds = { t15: 15, t30: 30, t60: 60, t120: 120 };

async function loadThresholds(admin: ReturnType<typeof createClient>): Promise<Thresholds> {
  try {
    const { data } = await admin
      .from("cron_jobs")
      .select("payload")
      .eq("nome", "watchdog-demandas-loja")
      .maybeSingle();
    const t = (data as any)?.payload?.thresholds ?? {};
    return {
      t15: Number(t.t15) || DEFAULTS.t15,
      t30: Number(t.t30) || DEFAULTS.t30,
      t60: Number(t.t60) || DEFAULTS.t60,
      t120: Number(t.t120) || DEFAULTS.t120,
    };
  } catch {
    return DEFAULTS;
  }
}

function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

async function pushUsers(
  admin: ReturnType<typeof createClient>,
  userIds: string[],
  title: string,
  body: string,
  demandaId: string,
  tag: string,
) {
  if (!userIds.length) return 0;
  await admin.rpc("fn_send_push", {
    _user_ids: userIds,
    _title: title,
    _body: body,
    _url: `/demandas?demanda=${demandaId}`,
    _tag: tag,
  });
  return userIds.length;
}

async function destinatariosNivel(
  admin: ReturnType<typeof createClient>,
  lojaNome: string,
  nivel: "operador" | "supervisor" | "gerente",
): Promise<string[]> {
  const { data, error } = await admin.rpc("resolver_destinatarios_loja_por_nivel", {
    _loja_nome: lojaNome,
    _nivel: nivel,
  });
  if (error) {
    console.error("[watchdog-demandas-loja] resolver error:", error);
    return [];
  }
  return ((data as any[]) || []).map((r) => r.user_id).filter(Boolean);
}

async function postMensagemSistema(
  admin: ReturnType<typeof createClient>,
  demandaId: string,
  conteudo: string,
) {
  // Linha do tempo dentro do thread da demanda (sem criar conversa nova)
  await admin.from("demanda_mensagens").insert({
    demanda_id: demandaId,
    direcao: "sistema",
    autor_id: null,
    autor_nome: "Sistema",
    conteudo,
    metadata: { kind: "escalonamento_sla" },
  } as any);
}

async function processOne(admin: ReturnType<typeof createClient>, d: any, th: Thresholds) {
  const lojaNome: string = d.loja_nome;
  const demandaId: string = d.id;
  const proto: string = d.protocolo || `#${d.numero_curto}`;
  const meta = (d.metadata || {}) as Record<string, any>;
  const esc = (meta.escalonamentos || {}) as Record<string, string>;

  // Usa updated_at como ancora — é tocado por bridge-demanda em qualquer atividade.
  const idleMin = minutesSince(d.updated_at || d.created_at);
  const actions: string[] = [];

  // T+15 → operadores
  if (idleMin >= th.t15 && !esc.t15_at) {
    const ops = await destinatariosNivel(admin, lojaNome, "operador");
    await pushUsers(
      admin,
      ops,
      `⏰ Demanda aguardando ${proto}`,
      `Loja ${lojaNome} ainda não respondeu (${idleMin}min).`,
      demandaId,
      `sla_t15_${demandaId}`,
    );
    esc.t15_at = new Date().toISOString();
    actions.push(`T+15 (${ops.length} ops)`);
  }

  // T+30 → 2º lembrete + supervisor
  if (idleMin >= th.t30 && !esc.t30_at) {
    const ops = await destinatariosNivel(admin, lojaNome, "operador");
    const sups = await destinatariosNivel(admin, lojaNome, "supervisor");
    const all = Array.from(new Set([...ops, ...sups]));
    await pushUsers(
      admin,
      all,
      `🚨 ATRASADA — ${proto}`,
      `${idleMin}min sem resposta. Supervisor notificado.`,
      demandaId,
      `sla_t30_${demandaId}`,
    );
    if (sups.length > 0) {
      await postMensagemSistema(
        admin,
        demandaId,
        `🚨 Supervisor da loja ${lojaNome} foi notificado — demanda sem resposta há ${idleMin}min.`,
      );
    }
    esc.t30_at = new Date().toISOString();
    actions.push(`T+30 (sup=${sups.length})`);
  }

  // T+60 → gerente
  if (idleMin >= th.t60 && !esc.t60_at) {
    const gers = await destinatariosNivel(admin, lojaNome, "gerente");
    if (gers.length > 0) {
      await pushUsers(
        admin,
        gers,
        `⚠️ Demanda crítica — ${proto}`,
        `${lojaNome} sem resposta há ${idleMin}min. Cobrança gerencial.`,
        demandaId,
        `sla_t60_${demandaId}`,
      );
      await postMensagemSistema(
        admin,
        demandaId,
        `⚠️ Gerente regional notificado — demanda sem resposta há ${idleMin}min.`,
      );
    }
    esc.t60_at = new Date().toISOString();
    actions.push(`T+60 (ger=${gers.length})`);
  }

  // T+120 → status=sem_resposta + notifica solicitante
  if (idleMin >= th.t120 && !esc.t120_at) {
    const solicitanteId = d.solicitante_id as string | null;
    if (solicitanteId) {
      await admin.from("notificacoes").insert({
        usuario_id: solicitanteId,
        tipo: "demanda_sem_resposta",
        titulo: `Demanda sem resposta — ${proto}`,
        mensagem: `Loja ${lojaNome} não respondeu em ${idleMin}min. Marcada como SEM RESPOSTA.`,
        referencia_id: demandaId,
      } as any);
    }
    await postMensagemSistema(
      admin,
      demandaId,
      `❌ Demanda marcada como SEM RESPOSTA após ${idleMin}min. Cobrança manual necessária.`,
    );
    esc.t120_at = new Date().toISOString();
    actions.push("T+120 (sem_resposta)");
  }

  if (actions.length === 0) return null;

  const updates: Record<string, any> = {
    metadata: { ...meta, escalonamentos: esc },
  };
  // T+120 troca status para 'sem_resposta' (mas NÃO encerra).
  if (esc.t120_at && d.status === "aberta") {
    updates.status = "sem_resposta";
  }

  const { error: upErr } = await admin
    .from("demandas_loja")
    .update(updates)
    .eq("id", demandaId);
  if (upErr) console.error("[watchdog-demandas-loja] update error:", demandaId, upErr);

  return { id: demandaId, proto, idleMin, actions };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const th = await loadThresholds(admin);

    // Janela: demandas em 'aberta' há pelo menos t15 minutos.
    // Encerradas, respondidas, sem_resposta e aguardando_complemento não entram.
    const minIdle = Math.min(th.t15, th.t30, th.t60, th.t120);
    const cutoff = new Date(Date.now() - minIdle * 60_000).toISOString();

    const { data: candidatas, error } = await admin
      .from("demandas_loja")
      .select("id, numero_curto, protocolo, loja_nome, status, solicitante_id, created_at, updated_at, metadata")
      .eq("status", "aberta")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(100);

    if (error) throw error;

    const results: any[] = [];
    for (const d of candidatas || []) {
      try {
        const r = await processOne(admin, d, th);
        if (r) results.push(r);
      } catch (e) {
        console.error("[watchdog-demandas-loja] processOne error:", d.id, e);
        results.push({ id: d.id, error: String(e) });
      }
    }

    // Atualiza ultimo_disparo
    await admin
      .from("cron_jobs")
      .update({ ultimo_disparo: new Date().toISOString() })
      .eq("nome", "watchdog-demandas-loja");

    return new Response(
      JSON.stringify({
        ok: true,
        thresholds: th,
        avaliadas: candidatas?.length || 0,
        escaladas: results.length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[watchdog-demandas-loja] fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
