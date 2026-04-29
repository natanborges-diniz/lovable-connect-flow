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

      // ── RESGATE OCR: se o loop é "estou analisando" / "recebi sua receita" e ainda
      // não há receita válida salva, em vez de escalar pedimos os valores por texto.
      // Caso Renata 2026-04-28 04:50: 2× "Recebi sua receita" → watchdog escalava direto.
      const ANALISANDO_RE = /recebi sua receita|peguei a imagem|t[oôó]\s*lendo|estou analisando|analisando aqui/i;
      const last2OutboundsAnalisando = outbounds.slice(-2).every((o) => ANALISANDO_RE.test(String(o.conteudo || "")));
      if (last2OutboundsAnalisando) {
        // Confere se já pedimos texto antes (qualquer das últimas 5 outbound)
        const PEDIDO_TEXTO_RE = /me passar por texto|valores por texto|esf[eé]rico\s*\/\s*cil[ií]ndrico|n[aã]o estou conseguindo ler/i;
        const jaPediuTexto = outbounds.some((o) => PEDIDO_TEXTO_RE.test(String(o.conteudo || "")));

        // Confere se o contato tem receita válida salva
        const { data: contato } = await supabase
          .from("contatos")
          .select("metadata")
          .eq("id", at.contato_id)
          .single();
        const meta = (contato?.metadata as Record<string, any>) || {};
        const receitas = Array.isArray(meta.receitas) ? meta.receitas : [];
        const hasReceitaValida = receitas.some((rx: any) => {
          if (!rx || !rx.eyes) return false;
          if (!rx.rx_type || rx.rx_type === "unknown") return false;
          const od = rx.eyes.od || {};
          const oe = rx.eyes.oe || {};
          return [od.sphere, od.cylinder, oe.sphere, oe.cylinder].some((v: any) => typeof v === "number");
        });

        if (!hasReceitaValida && !jaPediuTexto) {
          const aviso = "Tô tendo dificuldade de ler os valores na foto 😅 Pode me passar por texto, por favor?\n\nPreciso de:\n• *OD* (olho direito): esférico / cilíndrico / eixo (e adição se tiver)\n• *OE* (olho esquerdo): esférico / cilíndrico / eixo (e adição se tiver)\n\nEx: *OD -2,00 cil -0,75 eixo 180* / *OE -1,75 cil -0,50 eixo 170*\n\nSe preferir, mande outra foto com a receita inteira no enquadramento e boa iluminação 📸";
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ atendimento_id: at.id, texto: aviso }),
            });
            await supabase.from("eventos_crm").insert({
              contato_id: at.contato_id,
              tipo: "loop_ia_resgate_pedindo_texto",
              descricao: `Watchdog detectou loop "analisando" sem receita válida — pediu valores por texto em vez de escalar (sim ${(sim * 100).toFixed(0)}%)`,
              metadata: { similarity: sim },
              referencia_tipo: "atendimento",
              referencia_id: at.id,
            });
            console.log(`[WATCHDOG] Resgate OCR no atendimento ${at.id} — pedido de texto enviado, sem escalar`);
          } catch (e) {
            console.error("[WATCHDOG] Falha no resgate OCR:", e);
          }
          details.push({ atendimento_id: at.id, similarity: sim, action: "resgate_ocr_pedindo_texto" });
          continue; // não escala
        }
      }

      // ── LEAD SILENCIOSO → PERDIDOS (não Humano) ──
      // Se o cliente está em silêncio há horas e os outbounds recentes são apenas
      // templates de retomada/IA, isso NÃO é loop conversacional — é lead que
      // não respondeu. Move direto para "Perdidos" em vez de sujar a fila humana.
      const inboundsRecentes = ordered.filter((m) => m.direcao === "inbound");
      const lastInbound = inboundsRecentes[inboundsRecentes.length - 1];
      const horasDesdeUltimoInbound = lastInbound
        ? (Date.now() - new Date(lastInbound.created_at).getTime()) / (1000 * 60 * 60)
        : 999;
      const TEMPLATE_OU_RETOMADA_RE = /\[template:\s*retomada|retomada_contexto|despedida|n[ãa]o quero te incomodar|agrade[çc]o muito o seu contato/i;
      const ultimosDoisOutboundsSaoTemplate = outbounds.slice(-2).every((o) =>
        TEMPLATE_OU_RETOMADA_RE.test(String(o.conteudo || ""))
      );

      if (horasDesdeUltimoInbound >= 2 && ultimosDoisOutboundsSaoTemplate) {
        console.log(`[WATCHDOG] Lead silencioso ${at.id} — movendo para Perdidos (último inbound há ${horasDesdeUltimoInbound.toFixed(1)}h)`);

        // Busca coluna "Perdidos" do CRM (sem setor)
        const { data: perdidosCol } = await supabase
          .from("pipeline_colunas")
          .select("id")
          .eq("nome", "Perdidos")
          .is("setor_id", null)
          .eq("ativo", true)
          .limit(1)
          .single();

        // Encerra atendimento e move contato
        await supabase.from("atendimentos")
          .update({ status: "encerrado", fim_at: new Date().toISOString(), modo: "ia" })
          .eq("id", at.id);

        if (perdidosCol?.id) {
          await supabase.from("contatos")
            .update({ pipeline_coluna_id: perdidosCol.id })
            .eq("id", at.contato_id);
        }

        await supabase.from("eventos_crm").insert({
          contato_id: at.contato_id,
          tipo: "lead_silencioso_perdido",
          descricao: `Watchdog moveu lead silencioso para Perdidos (último inbound há ${horasDesdeUltimoInbound.toFixed(1)}h, similaridade ${(sim*100).toFixed(0)}%)`,
          metadata: {
            similarity: sim,
            horas_silencio: horasDesdeUltimoInbound,
            last_outbound: String(outbounds[outbounds.length - 1].conteudo).substring(0, 200),
          },
          referencia_tipo: "atendimento",
          referencia_id: at.id,
        });

        details.push({ atendimento_id: at.id, similarity: sim, action: "movido_para_perdidos" });
        continue; // não escala para humano
      }

      // ── ESCALATE PARA HUMANO (apenas quando há diálogo ativo travado) ──
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
