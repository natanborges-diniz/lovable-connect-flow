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

// Defaults — sobrescritos por cron_jobs.payload.thresholds (auto-editável via auditoria IA).
const DEFAULTS = {
  idade_min_min: 2,           // min: dá tempo ao debounce do ai-triage
  idade_max_min: 180,         // max: > isso vira caso de "recuperar-atendimentos"
  antiduplo_seg: 90,          // anti-duplo-disparo
  pular_se_confirmou_horas: 1 // skip se cliente confirmou agendamento recém
};

async function loadThresholds(supabase: any) {
  try {
    const { data } = await supabase
      .from("cron_jobs").select("payload")
      .eq("funcao_alvo", "watchdog-inbound-orfao").maybeSingle();
    const t = (data?.payload?.thresholds) || {};
    return {
      idade_min_min: Number(t.idade_min_min ?? DEFAULTS.idade_min_min),
      idade_max_min: Number(t.idade_max_min ?? DEFAULTS.idade_max_min),
      antiduplo_seg: Number(t.antiduplo_seg ?? DEFAULTS.antiduplo_seg),
      pular_se_confirmou_horas: Number(t.pular_se_confirmou_horas ?? DEFAULTS.pular_se_confirmou_horas),
    };
  } catch { return { ...DEFAULTS }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = Date.now();
  const TH = await loadThresholds(supabase);
  const IDADE_MIN_MIN = TH.idade_min_min;
  const IDADE_MAX_MIN = TH.idade_max_min;
  const ANTIDUPLO_MS = TH.antiduplo_seg * 1000;
  const CONFIRMOU_WINDOW_MS = TH.pular_se_confirmou_horas * 60 * 60 * 1000;

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

      // Anti-duplo-disparo
      const meta = (a.metadata as any) || {};
      const lastTrig = meta?.orfao_watchdog_last_at
        ? new Date(meta.orfao_watchdog_last_at).getTime()
        : 0;
      if (now - lastTrig < ANTIDUPLO_MS) continue;

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
        // Skip se cliente acabou de confirmar agendamento (evita re-disparo após "SIM")
        const { data: agConf } = await supabase
          .from("agendamentos")
          .select("id, metadata")
          .eq("contato_id", o.contato_id)
          .in("status", ["agendado", "lembrete_enviado", "confirmado"])
          .order("created_at", { ascending: false })
          .limit(3);
        const recemConfirmou = (agConf || []).some((ag: any) => {
          const at = ag?.metadata?.cliente_confirmou_at;
          if (!at) return false;
          return now - new Date(at).getTime() < CONFIRMOU_WINDOW_MS;
        });
        if (recemConfirmou) {
          console.log(`[ORFAO-WATCHDOG] skip ${o.atendimento_id}: cliente confirmou agendamento <1h`);
          continue;
        }

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

    // ── PASSO 2: "analisando" órfão (última outbound da IA é "Recebi sua receita... analisando")
    // sem follow-up. Caso Emerson (12/05/2026): forced retry inline falhou e nada chamou
    // o cliente pra digitar valores. Aqui detectamos e enviamos MSG_PEDIR_RECEITA_TEXTO.
    const ANALISANDO_RE = /recebi sua receita|peguei a imagem|t[oôó]\s*lendo|estou analisando|analisando aqui/i;
    let pedidosTexto = 0;
    let escalouHumano = 0;
    try {
      // Carrega MSG_PEDIR_RECEITA_TEXTO de ia_mensagens_fixas (com fallback)
      let MSG_PEDIR_RECEITA_TEXTO =
        "Tô com dificuldade de ler sua receita 😅 Pode me passar por texto? OD esférico/cilíndrico/eixo e OE esférico/cilíndrico/eixo. Se não tiver os valores, é só me avisar que eu chamo alguém da equipe pra te ajudar.";
      try {
        const { data: fixas } = await supabase
          .from("ia_mensagens_fixas").select("texto, ativo").eq("chave", "pedir_receita_texto").maybeSingle();
        if (fixas?.ativo !== false && typeof fixas?.texto === "string" && fixas.texto.length > 0) {
          MSG_PEDIR_RECEITA_TEXTO = fixas.texto;
        }
      } catch (_) { /* noop */ }

      // Index última outbound por atendimento
      const lastOutByAt = new Map<string, any>();
      for (const m of msgs || []) {
        if (m.direcao !== "outbound") continue;
        if (!lastOutByAt.has(m.atendimento_id)) lastOutByAt.set(m.atendimento_id, m);
      }

      // Indexa última inbound por atendimento (já temos em lastByAt mas só se for a mais recente)
      const lastInByAt = new Map<string, any>();
      for (const m of msgs || []) {
        if (m.direcao !== "inbound") continue;
        if (!lastInByAt.has(m.atendimento_id)) lastInByAt.set(m.atendimento_id, m);
      }

      const candidatos: any[] = [];
      for (const a of ats as any[]) {
        const last = lastByAt.get(a.id);
        if (!last || last.direcao !== "outbound") continue;
        if (!ANALISANDO_RE.test(String(last.conteudo || ""))) continue;

        const ageMs = now - new Date(last.created_at).getTime();
        const ageMin = Math.floor(ageMs / 60_000);
        if (ageMin < 2 || ageMin > 30) continue;

        // anti-duplo
        const meta = (a.metadata as any) || {};
        const lastTrig = meta?.analisando_orfao_last_at
          ? new Date(meta.analisando_orfao_last_at).getTime() : 0;
        if (now - lastTrig < ANTIDUPLO_MS * 5) continue; // 7.5min

        candidatos.push({ atendimento_id: a.id, contato_id: a.contato_id, ageMin, sentAt: last.created_at, meta });
      }

      for (const c of candidatos) {
        try {
          // Verifica eventos posteriores que indiquem que receita foi resolvida
          const { data: ev } = await supabase
            .from("eventos_crm")
            .select("tipo, created_at")
            .eq("contato_id", c.contato_id)
            .gte("created_at", c.sentAt)
            .in("tipo", [
              "receita_interpretada",
              "receita_confirmacao_solicitada",
              "receita_ocr_failsafe_pedido_texto",
              "receita_texto_recusada_escalado_humano",
              "receita_pending_invalidada",
            ])
            .limit(1);
          if (ev && ev.length > 0) continue; // já houve follow-up

          // Marca trigger antes
          await supabase.from("atendimentos").update({
            metadata: { ...(c.meta || {}), analisando_orfao_last_at: new Date().toISOString() },
          }).eq("id", c.atendimento_id);

          // Conta falha de OCR
          const { data: cData } = await supabase.from("contatos").select("metadata, nome").eq("id", c.contato_id).maybeSingle();
          const cMeta = (cData?.metadata as any) || {};
          const novasFalhas = Number(cMeta.ocr_falhas_count || 0) + 1;
          await supabase.from("contatos").update({
            metadata: { ...cMeta, ocr_falhas_count: novasFalhas, ocr_falhas_last_at: new Date().toISOString() },
          }).eq("id", c.contato_id);

          if (novasFalhas >= 2) {
            // Escala humano direto
            const np = String(cData?.nome || "").split(/\s+/)[0] || "";
            const msgEscala = `Tô com dificuldade de ler sua receita aqui mesmo nas tentativas, ${np || "amigo(a)"}. Vou chamar alguém da equipe pra te ajudar com isso, tá? 🙌`;
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ atendimento_id: c.atendimento_id, mensagem: msgEscala }),
            });
            await supabase.from("atendimentos").update({
              modo: "humano",
              status: "aguardando",
              updated_at: new Date().toISOString(),
              metadata: {
                ...(c.meta || {}),
                analisando_orfao_last_at: new Date().toISOString(),
                revisao_humana_pendente: true,
                revisao_humana_motivo: "ocr_orfao_2_falhas",
                escalado_humano_at: new Date().toISOString(),
              },
            }).eq("id", c.atendimento_id);
            await supabase.from("eventos_crm").insert({
              contato_id: c.contato_id,
              tipo: "ocr_orfao_escalado_humano",
              descricao: `2 falhas consecutivas de OCR sem follow-up — escalando para humano`,
              referencia_id: c.atendimento_id,
              referencia_tipo: "atendimento",
              metadata: { ocr_falhas_count: novasFalhas, idade_min: c.ageMin },
            });
            escalouHumano++;
          } else {
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ atendimento_id: c.atendimento_id, mensagem: MSG_PEDIR_RECEITA_TEXTO }),
            });
            await supabase.from("eventos_crm").insert({
              contato_id: c.contato_id,
              tipo: "receita_ocr_orfao_pedido_texto",
              descricao: `Watchdog detectou 'analisando' órfão há ${c.ageMin}min — pedindo valores por texto`,
              referencia_id: c.atendimento_id,
              referencia_tipo: "atendimento",
              metadata: { ocr_falhas_count: novasFalhas, idade_min: c.ageMin },
            });
            pedidosTexto++;
          }
        } catch (e) {
          console.error(`[ORFAO-WATCHDOG][ANALISANDO] erro at=${c.atendimento_id}:`, e);
        }
      }
    } catch (e) {
      console.error("[ORFAO-WATCHDOG][ANALISANDO] erro fatal:", e);
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      `[ORFAO-WATCHDOG] checked=${ats.length} detectados=${orfaos.length} recovered=${recovered} analisando_pedidos=${pedidosTexto} analisando_escalou=${escalouHumano} elapsed=${elapsed}ms`
    );
    await supabase.from("cron_jobs").update({ ultimo_disparo: new Date().toISOString() }).eq("funcao_alvo", "watchdog-inbound-orfao");
    return jsonOk({ checked: ats.length, detectados: orfaos.length, recovered, analisando_pedidos: pedidosTexto, analisando_escalou: escalouHumano });
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
