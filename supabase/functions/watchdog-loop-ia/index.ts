// Watchdog: detects atendimentos stuck in IA loop and escalates to human.
// Triggered every 2 minutes by pg_cron.
//
// Criteria for escalation:
//   - atendimento.modo = 'ia'
//   - last message is outbound (from IA), older than 5 minutes
//   - there is at least one inbound BEFORE that outbound (client replied)
//   - last 2 outbound messages have similarity > 70%
//
// Action:
//   - flip atendimento.modo to 'humano'
//   - create eventos_crm entry: 'loop_ia_escalado_watchdog'
//   - create notificacao for visibility
//   - send a discreet message to the client

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function norm(t: string): string {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function similarity(a: string, b: string): number {
  const wa = new Set(norm(a).split(/\s+/).filter((w) => w.length > 3));
  const wb = new Set(norm(b).split(/\s+/).filter((w) => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

// ── Horário comercial humano (America/Sao_Paulo) ──
function spNow() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  const wkMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return { dow: wkMap[get("weekday")] ?? 0, hour: parseInt(get("hour"),10), minute: parseInt(get("minute"),10) };
}
function isHorarioHumano(): boolean {
  const { dow, hour, minute } = spNow();
  const t = hour * 60 + minute;
  if (dow >= 1 && dow <= 5) return t >= 9 * 60 && t < 18 * 60;
  if (dow === 6) return t >= 8 * 60 && t < 12 * 60;
  return false;
}
function proximaAberturaHumana(): string {
  const { dow, hour, minute } = spNow();
  const t = hour * 60 + minute;
  if (dow >= 1 && dow <= 5 && t < 9 * 60) return "hoje às 09:00";
  if (dow === 6 && t < 8 * 60) return "hoje às 08:00";
  if (dow === 0) return "amanhã às 09:00";
  if (dow === 6) return "segunda às 09:00";
  if (dow === 5) return "amanhã às 08:00";
  return "amanhã às 09:00";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Fetch open atendimentos in IA mode
    const { data: atendimentos, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, modo, status, updated_at")
      .eq("modo", "ia")
      .neq("status", "encerrado")
      .lt("updated_at", fiveMinAgo)
      .limit(200);

    if (atErr) throw atErr;
    if (!atendimentos || atendimentos.length === 0) {
      return new Response(JSON.stringify({ status: "ok", checked: 0, escalated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let escalated = 0;
    const details: any[] = [];

    for (const at of atendimentos) {
      // Pull last 5 messages
      const { data: msgs } = await supabase
        .from("mensagens")
        .select("id, direcao, conteudo, created_at, remetente_nome")
        .eq("atendimento_id", at.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!msgs || msgs.length < 2) continue;
      const ordered = [...msgs].reverse();
      const last = ordered[ordered.length - 1];

      // Last must be outbound
      if (last.direcao !== "outbound") continue;
      // Older than 5 min
      const lastMs = new Date(last.created_at).getTime();
      if (Date.now() - lastMs < 5 * 60 * 1000) continue;
      // Skip if message is from a human operator (only loop on IA-generated outbound)
      const sender = String(last.remetente_nome || "").toLowerCase();
      if (sender && !["assistente ia", "sistema", "recuperação", "bot lojas"].includes(sender.trim())) {
        continue;
      }

      // There must be an inbound earlier in the window (client replied)
      const hasPriorInbound = ordered.slice(0, -1).some((m) => m.direcao === "inbound");
      if (!hasPriorInbound) continue;

      // Last 2 outbound must be highly similar
      const outbounds = ordered.filter((m) => m.direcao === "outbound");
      if (outbounds.length < 2) continue;
      const sim = similarity(outbounds[outbounds.length - 1].conteudo, outbounds[outbounds.length - 2].conteudo);
      if (sim <= 0.7) continue;

      // ── ESCALATE ──
      console.log(`[WATCHDOG] Escalating atendimento ${at.id} — similarity=${(sim * 100).toFixed(0)}%`);

      await supabase.from("atendimentos").update({ modo: "humano" }).eq("id", at.id);

      await supabase.from("eventos_crm").insert({
        contato_id: at.contato_id,
        tipo: "loop_ia_escalado_watchdog",
        descricao: `Watchdog escalou atendimento em loop (similaridade ${(sim * 100).toFixed(0)}%)`,
        metadata: {
          similarity: sim,
          last_outbound: String(outbounds[outbounds.length - 1].conteudo).substring(0, 200),
          minutes_inactive: Math.round((Date.now() - lastMs) / 60000),
        },
        referencia_tipo: "atendimento",
        referencia_id: at.id,
      });

      await supabase.from("notificacoes").insert({
        tipo: "loop_ia",
        titulo: "Card em loop — requer atenção",
        mensagem: `Atendimento em modo IA repetiu a mesma resposta sem avançar. Foi movido para Humano.`,
        referencia_id: at.id,
      });

      // Fora do horário humano: avisa o cliente que o time retorna no próximo expediente
      if (!isHorarioHumano()) {
        try {
          const aviso = `Pra te ajudar melhor, vou acionar nossa equipe humana 🙌 Nosso time atende de seg a sex das 09h às 18h e sábado das 08h às 12h. Como estamos fora do horário, assim que abrir o próximo expediente (${proximaAberturaHumana()}) eles te respondem por aqui 😉`;
          await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ atendimento_id: at.id, texto: aviso }),
          });
        } catch (e) {
          console.error("[WATCHDOG] Falha ao enviar aviso fora-horário:", e);
        }
      }
      escalated++;
      details.push({ atendimento_id: at.id, similarity: sim });
    }

    console.log(`[WATCHDOG] checked=${atendimentos.length} escalated=${escalated}`);
    await supabase.from("cron_jobs").update({ ultimo_disparo: new Date().toISOString() }).eq("funcao_alvo", "watchdog-loop-ia");
    return new Response(JSON.stringify({ status: "ok", checked: atendimentos.length, escalated, details }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[WATCHDOG] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
