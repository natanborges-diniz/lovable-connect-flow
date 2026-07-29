// audit-ia-auto — Aprendizado automático semanal (zero cliques)
// fase "rodar"   → dispara audit-ia-rodar na janela pedida (default 168h)
// fase "aplicar" → consolida a última run concluída, aplica grupos 100% auto,
//                  recompila o prompt e notifica os admins.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFn(nome: string, body: unknown): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const txt = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 500) }; }
  if (!res.ok) console.error(`[audit-ia-auto] ${nome} -> ${res.status}`, txt.slice(0, 300));
  return { ok: res.ok, status: res.status, data: parsed };
}

async function notificarAdmins(supabase: any, titulo: string, mensagem: string) {
  const { data: roles } = await supabase
    .from("user_roles").select("user_id").eq("role", "admin");
  const ids = Array.from(new Set((roles || []).map((r: any) => r.user_id)));
  if (!ids.length) return 0;
  await supabase.from("notificacoes").insert(
    ids.map((uid) => ({
      usuario_id: uid,
      titulo,
      mensagem,
      tipo: "auditoria_ia",
    })),
  );
  return ids.length;
}

async function faseAplicar(supabase: any) {
  // Última run concluída (a auditoria roda 1h antes).
  const { data: run } = await supabase
    .from("ia_auditorias_runs")
    .select("id, total_flagged, created_at")
    .eq("status", "concluido")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) {
    await notificarAdmins(supabase, "Aprendizado IA", "Nenhuma auditoria concluída encontrada para consolidar.");
    return { motivo: "sem_run_concluida" };
  }

  // 1) Consolidar achados em grupos (idempotente por run: pula se já houver grupos).
  const { count: jaGrupos } = await supabase
    .from("ia_auditorias_grupos")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id);

  let consolidados = jaGrupos || 0;
  if (!jaGrupos) {
    const r = await callFn("audit-ia-consolidar", { run_id: run.id });
    consolidados = r.data?.total ?? 0;
  }

  // 2) Aplicar automaticamente só grupos cujas ações são todas 'auto'.
  const { data: grupos } = await supabase
    .from("ia_auditorias_grupos")
    .select("id, titulo, acoes_propostas, status")
    .eq("run_id", run.id)
    .eq("status", "pendente");

  let aplicados = 0;
  let pendentes = 0;
  for (const g of grupos || []) {
    const acoes = Array.isArray(g.acoes_propostas) ? g.acoes_propostas : [];
    const todasAuto = acoes.length > 0 && acoes.every((a: any) => (a?.modo_aplicacao || "codigo") === "auto");
    if (!todasAuto) { pendentes++; continue; }
    const r = await callFn("audit-ia-aplicar-grupo", { grupo_id: g.id });
    if (r.ok) aplicados++; else pendentes++;
  }

  // 3) Recompilar o prompt se algo mudou.
  if (aplicados > 0) await callFn("compile-prompt", {});

  const msg = `Auditoria da semana: ${run.total_flagged ?? 0} conversas sinalizadas, ${consolidados} grupos de causa-raiz. ` +
    `${aplicados} correções aplicadas automaticamente${aplicados ? " (prompt recompilado)" : ""}, ` +
    `${pendentes} aguardando revisão humana.`;
  await notificarAdmins(supabase, "Aprendizado IA — semana consolidada", msg);

  return { run_id: run.id, consolidados, aplicados, pendentes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const fase = body.fase || "rodar";

    if (fase === "rodar") {
      const horas = Number(body.janela_horas) || 168;
      const fim = new Date();
      const inicio = new Date(fim.getTime() - horas * 3600_000);
      const r = await callFn("audit-ia-rodar", {
        janela_inicio: inicio.toISOString(),
        janela_fim: fim.toISOString(),
        severidade_minima: body.severidade_minima || "warn",
        amostra_limpos_pct: body.amostra_limpos_pct ?? 10,
      });
      return json({ fase, ...r.data }, r.ok ? 200 : 500);
    }

    if (fase === "aplicar") {
      const out = await faseAplicar(supabase);
      return json({ fase, ...out });
    }

    return json({ error: "fase inválida (use 'rodar' ou 'aplicar')" }, 400);
  } catch (err: any) {
    console.error("[audit-ia-auto]", err);
    return json({ error: err.message }, 500);
  }
});
