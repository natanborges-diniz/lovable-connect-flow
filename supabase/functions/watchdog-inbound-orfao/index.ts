// Watchdog Inbound Órfão
// Detecta atendimentos em modo=ia onde a última mensagem é INBOUND há >2min
// e nenhuma OUTBOUND foi gerada depois. Força chamada ao ai-triage.
// Roda a cada 1 minuto via pg_cron.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Janela mínima e máxima (em minutos) para considerar inbound órfão.
// - min 2min: dá tempo do debounce normal do ai-triage executar
// - max 180min: evita reativar conversas muito antigas (já são caso para "recuperar-atendimentos")
const IDADE_MIN_MIN = 2;
const IDADE_MAX_MIN = 180;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = Date.now();

  try {
    // 1) Pega atendimentos abertos em modo IA
    const { data: ats, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, modo, status, metadata")
      .eq("modo", "ia")
      .neq("status", "encerrado");
    if (atErr) throw atErr;
    if (!ats?.length) {
      console.log("[ORFAO-WATCHDOG] nenhum atendimento em modo IA aberto");
      return jsonOk({ checked: 0, recovered: 0 });
    }

    const atIds = ats.map((a: any) => a.id);

    // 2) Última mensagem de cada atendimento
    const { data: msgs, error: mErr } = await supabase
      .from("mensagens")
      .select("atendimento_id, direcao, created_at, conteudo, tipo_conteudo")
      .in("atendimento_id", atIds)
      .order("created_at", { ascending: false });
    if (mErr) throw mErr;

    const lastByAt = new Map<string, any>();
    for (const m of msgs || []) {
      if (!lastByAt.has(m.atendimento_id)) lastByAt.set(m.atendimento_id, m);
    }

    const now = Date.now();
    const orfaos: { atendimento_id: string; contato_id: string; idade_min: number }[] = [];

    for (const a of ats as any[]) {
      const last = lastByAt.get(a.id);
      if (!last) continue;
      if (last.direcao !== "inbound") continue;

      const ageMs = now - new Date(last.created_at).getTime();
      const ageMin = Math.floor(ageMs / 60_000);
      if (ageMin < IDADE_MIN_MIN || ageMin > IDADE_MAX_MIN) continue;

      // Anti-duplo-disparo: ignora se já foi processado nos últimos 90s
      const meta = (a.metadata as any) || {};
      const lastTrig = meta?.orfao_watchdog_last_at
        ? new Date(meta.orfao_watchdog_last_at).getTime()
        : 0;
      if (now - lastTrig < 90_000) continue;

      orfaos.push({ atendimento_id: a.id, contato_id: a.contato_id, idade_min: ageMin });
    }

    if (!orfaos.length) {
      console.log(`[ORFAO-WATCHDOG] checked=${ats.length} orfaos=0`);
      return jsonOk({ checked: ats.length, recovered: 0 });
    }

    console.log(`[ORFAO-WATCHDOG] detectados=${orfaos.length} (de ${ats.length} ativos)`);

    let recovered = 0;
    for (const o of orfaos) {
      try {
        // Marca trigger antes de chamar (evita corrida)
        await supabase
          .from("atendimentos")
          .update({
            metadata: {
              ...(ats.find((x: any) => x.id === o.atendimento_id)?.metadata || {}),
              orfao_watchdog_last_at: new Date().toISOString(),
            },
          })
          .eq("id", o.atendimento_id);

        // Dispara ai-triage com flag de recuperação (não bloqueante)
        const triageRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-triage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            atendimento_id: o.atendimento_id,
            contato_id: o.contato_id,
            trigger: "orfao_watchdog",
            idade_min: o.idade_min,
          }),
        });

        const ok = triageRes.ok;
        await supabase.from("eventos_crm").insert({
          contato_id: o.contato_id,
          tipo: "orfao_pos_resposta_recuperado",
          descricao: `Watchdog detectou inbound sem resposta há ${o.idade_min}min e re-disparou ai-triage`,
          referencia_id: o.atendimento_id,
          referencia_tipo: "atendimento",
          metadata: {
            idade_min: o.idade_min,
            triage_status: triageRes.status,
            triage_ok: ok,
          },
        });

        if (ok) recovered++;
      } catch (e) {
        console.error(`[ORFAO-WATCHDOG] erro at=${o.atendimento_id}:`, e);
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      `[ORFAO-WATCHDOG] checked=${ats.length} detectados=${orfaos.length} recovered=${recovered} elapsed=${elapsed}ms`
    );
    return jsonOk({ checked: ats.length, detectados: orfaos.length, recovered });
  } catch (e) {
    console.error("[ORFAO-WATCHDOG] erro fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonOk(data: any) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
