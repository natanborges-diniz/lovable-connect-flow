// audit-ia-rodar — Auditoria IA Sob Demanda
// Roda heurísticas determinísticas + rubrica LLM em uma janela escolhida pelo admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MAX_ATENDIMENTOS = 500;
const MAX_LLM_CALLS = 120;

type Msg = {
  id: string;
  direcao: "inbound" | "outbound";
  conteudo: string;
  tipo_conteudo: string;
  created_at: string;
};

// ---------- Heurísticas ----------

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => wb.has(w) && inter++);
  return inter / new Set([...wa, ...wb]).size;
}

function rodarHeuristicas(msgs: Msg[]): { flags: any[]; severidadeMax: string } {
  const flags: any[] = [];
  let sev = "ok";
  const bump = (s: string) => {
    const order = ["ok", "info", "warn", "critical"];
    if (order.indexOf(s) > order.indexOf(sev)) sev = s;
  };

  const outbounds = msgs.filter((m) => m.direcao === "outbound" && m.tipo_conteudo === "text");
  const inbounds = msgs.filter((m) => m.direcao === "inbound");

  // 1. Placeholder vazio na receita (caso Yuri)
  for (const m of outbounds) {
    if (/ESF\s*\?|CIL\s*\?|EIXO\s*\?°/i.test(m.conteudo)) {
      flags.push({ tipo: "placeholder_receita_vazia", severidade: "critical", trecho: m.conteudo.slice(0, 200) });
      bump("critical");
      break;
    }
  }

  // 2. Loop: 2+ outbounds consecutivas com >85% similaridade
  for (let i = 1; i < outbounds.length; i++) {
    if (jaccard(outbounds[i - 1].conteudo, outbounds[i].conteudo) > 0.85) {
      flags.push({ tipo: "loop_repeticao", severidade: "warn", trecho: outbounds[i].conteudo.slice(0, 200) });
      bump("warn");
      break;
    }
  }

  // 3. Cliente frustrado (keywords)
  const frustracao = /(j[áa] (falei|disse)|n[ãa]o entend(eu|i)|t[óo] viajando|perdi tempo|cans(ei|ado)|de novo|chato|robô)/i;
  for (const m of inbounds) {
    if (frustracao.test(m.conteudo)) {
      flags.push({ tipo: "cliente_frustrado", severidade: "warn", trecho: m.conteudo.slice(0, 200) });
      bump("warn");
      break;
    }
  }

  // 4. Marca proibida com R$ na resposta (Kodak/Transitions/Crizal/Varilux + valor)
  for (const m of outbounds) {
    if (/(kodak|transitions|crizal|varilux|essilor)[^\n]{0,80}R\$\s*\d/i.test(m.conteudo)) {
      flags.push({ tipo: "preco_marca_sensivel", severidade: "critical", trecho: m.conteudo.slice(0, 240) });
      bump("critical");
      break;
    }
  }

  // 5. Pergunta repetida do cliente sem resposta (cliente repete texto >60% similar)
  for (let i = 1; i < inbounds.length; i++) {
    if (jaccard(inbounds[i - 1].conteudo, inbounds[i].conteudo) > 0.6 && inbounds[i].conteudo.length > 15) {
      flags.push({ tipo: "cliente_repete_pergunta", severidade: "warn", trecho: inbounds[i].conteudo.slice(0, 200) });
      bump("warn");
      break;
    }
  }

  // 6. Inbound sem resposta por >10min antes de fim
  for (let i = 0; i < msgs.length - 1; i++) {
    if (msgs[i].direcao === "inbound") {
      const next = msgs[i + 1];
      if (next.direcao === "outbound") {
        const gap = (new Date(next.created_at).getTime() - new Date(msgs[i].created_at).getTime()) / 60000;
        if (gap > 10) {
          flags.push({ tipo: "silencio_pos_inbound", severidade: "info", trecho: `gap ${gap.toFixed(0)}min` });
          bump("info");
          break;
        }
      }
    }
  }

  return { flags, severidadeMax: sev };
}

function montarTranscricao(msgs: Msg[]): string {
  return msgs.slice(0, 80).map((m) => {
    const role = m.direcao === "inbound" ? "CLIENTE" : "IA";
    const txt = (m.conteudo || "").slice(0, 600);
    return `[${role}] ${txt}`;
  }).join("\n");
}

// ---------- LLM rubrica ----------

async function avaliarComLLM(transcricao: string, flags: any[]): Promise<any> {
  const sys = `Você é auditor sênior de IA conversacional para uma ótica brasileira. Avalie a conversa abaixo (CLIENTE x IA chamada Gael) e retorne JSON estrito.

Critérios de scoring 0-10:
- compreensao: a IA entendeu a real necessidade do cliente?
- tom: cordial, humano, sem soar robô?
- info: deu informação correta, sem inventar (preço, marca, prazo)?
- tool: usou as ferramentas certas (não confirmou receita vazia, não prometeu sem agendar)?
- fechamento: encaminhou bem (humano/agendamento/encerrar)?

Severidade global:
- critical: invenção, mensagem proibida, dado sensível errado, loop grave, confirmação de receita vazia
- warn: cliente frustrado, repetição, perdeu o cliente
- info: pequenas oportunidades
- ok: tudo certo

Retorne SOMENTE JSON:
{
 "score_global": 0-10,
 "severidade": "ok|info|warn|critical",
 "categorias": {"compreensao":0-10,"tom":0-10,"info":0-10,"tool":0-10,"fechamento":0-10},
 "problemas": [{"tipo":"...","severidade":"info|warn|critical","trecho":"...","motivo":"..."}],
 "diagnostico": "1-3 frases explicando o problema central, ou 'Conversa saudável.' se ok"
}`;

  const user = `FLAGS heurísticos detectados: ${JSON.stringify(flags)}\n\nTRANSCRIÇÃO:\n${transcricao}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      temperature: 0.2,
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`[LLM] ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch {
    console.error("[LLM] JSON parse failed", content?.slice(0, 200));
    return null;
  }
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const janela_inicio = body.janela_inicio;
    const janela_fim = body.janela_fim || new Date().toISOString();
    const severidade_minima = body.severidade_minima || "warn";
    const amostra_limpos_pct = Math.max(0, Math.min(100, body.amostra_limpos_pct ?? 10));
    const iniciado_por = body.iniciado_por || null;

    if (!janela_inicio) {
      return new Response(JSON.stringify({ error: "janela_inicio é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cria run
    const { data: run, error: runErr } = await supabase
      .from("ia_auditorias_runs")
      .insert({ iniciado_por, janela_inicio, janela_fim, severidade_minima, amostra_limpos_pct })
      .select()
      .single();
    if (runErr) throw runErr;

    // Busca atendimentos no período (que tiveram mensagens IA = modo ia OU modo automatico)
    const { data: atendimentos, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, modo, status, created_at, contato:contatos(id, nome, telefone)")
      .gte("updated_at", janela_inicio)
      .lte("updated_at", janela_fim)
      .order("updated_at", { ascending: false })
      .limit(MAX_ATENDIMENTOS);
    if (atErr) throw atErr;

    const lista = (atendimentos || []).filter((a: any) => a.modo === "ia" || a.modo === "automatico" || true);

    let totalFlagged = 0;
    let totalLLM = 0;
    const sevOrder = ["ok", "info", "warn", "critical"];
    const minIdx = sevOrder.indexOf(severidade_minima);

    for (const at of lista) {
      const { data: msgs } = await supabase
        .from("mensagens")
        .select("id, direcao, conteudo, tipo_conteudo, created_at")
        .eq("atendimento_id", at.id)
        .order("created_at", { ascending: true })
        .limit(200);

      if (!msgs || msgs.length < 2) continue;

      const { flags, severidadeMax } = rodarHeuristicas(msgs as Msg[]);
      const flagged = sevOrder.indexOf(severidadeMax) >= sevOrder.indexOf("warn");

      let usaLLM = flagged;
      if (!flagged && amostra_limpos_pct > 0 && Math.random() * 100 < amostra_limpos_pct) {
        usaLLM = true;
      }

      let avaliacao: any = null;
      let fonte: "heuristica" | "llm" | "amostra" = flagged ? "heuristica" : "amostra";

      if (usaLLM && totalLLM < MAX_LLM_CALLS) {
        avaliacao = await avaliarComLLM(montarTranscricao(msgs as Msg[]), flags);
        if (avaliacao) {
          totalLLM++;
          fonte = "llm";
        }
      }

      const sevFinal = avaliacao?.severidade || severidadeMax;
      if (sevOrder.indexOf(sevFinal) < minIdx && !flagged) continue;

      if (sevOrder.indexOf(sevFinal) >= sevOrder.indexOf("warn")) totalFlagged++;

      const contato: any = (at as any).contato;

      await supabase.from("ia_auditorias").insert({
        run_id: run.id,
        atendimento_id: at.id,
        contato_id: at.contato_id,
        contato_nome: contato?.nome || null,
        contato_telefone: contato?.telefone || null,
        score_global: avaliacao?.score_global ?? null,
        severidade: sevFinal,
        categorias: avaliacao?.categorias || {},
        problemas: avaliacao?.problemas || flags,
        diagnostico: avaliacao?.diagnostico || (flags.length ? `Heurísticas: ${flags.map((f) => f.tipo).join(", ")}` : null),
        flags_heuristicos: flags,
        transcricao_resumo: montarTranscricao(msgs as Msg[]).slice(0, 4000),
        fonte,
      });
    }

    await supabase.from("ia_auditorias_runs").update({
      total_atendimentos: lista.length,
      total_flagged: totalFlagged,
      total_avaliados_llm: totalLLM,
      status: "concluido",
      finalizado_at: new Date().toISOString(),
    }).eq("id", run.id);

    return new Response(JSON.stringify({
      run_id: run.id,
      total_atendimentos: lista.length,
      total_flagged: totalFlagged,
      total_avaliados_llm: totalLLM,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[audit-ia-rodar] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
