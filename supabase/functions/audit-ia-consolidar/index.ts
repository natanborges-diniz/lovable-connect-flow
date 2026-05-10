// audit-ia-consolidar
// Agrupa achados (ia_auditorias) de uma run por causa-raiz e propõe correções únicas por grupo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Achado = {
  id: string;
  severidade: string;
  diagnostico: string;
  problemas: any[];
  flags: any[];
};

function primaryType(a: Achado): string {
  const p = (a.problemas?.[0]?.tipo) || (a.flags?.[0]?.tipo) || "outro";
  return String(p);
}

async function consolidarChunk(
  achados: Achado[],
  jaExistentes: { regras: string[]; exemplos: string[]; instrucoes: string[] },
): Promise<any> {
  const sys = `Você é engenheiro de prompts e de operações. Recebe uma LISTA de achados de auditoria (cada um é uma conversa com problema) e deve AGRUPAR por causa-raiz comum, propondo a correção UMA ÚNICA VEZ por grupo (evita duplicatas).

A conversa com o cliente é regida por VÁRIOS sistemas. Antes de propor a ação, você DEVE identificar qual VETOR é a causa-raiz do grupo:

VETOR A — Texto/decisão da IA durante o turno conversacional
  Controles: ia_instrucoes_prompt, ia_regras_proibidas, ia_exemplos
  Tipos válidos: ajuste_prompt | regra_proibida | exemplo

VETOR B — Disparos PROATIVOS (fora do turno; a IA não decide)
  B1 vendas-recuperacao-cron .... retomada 1h/24h, despedida → Perdidos
  B2 agendamentos-cron .......... lembrete véspera, no-show, confirmação
  B3 watchdog-inbound-orfao ..... re-fire da IA em silent drop (1min)
  B4 watchdog-loop-ia ........... move lead para Perdidos/Humano (2min)
  B5 recuperar-atendimentos ..... recuperação manual >15min
  B6 pipeline-automations ....... mensagens disparadas por movimento de coluna / status_alvo
  Tipo válido: ajustar_cron (alvo_ref = nome do cron/automação)

  AUTO-APLICÁVEL quando o ajuste é apenas numérico em cron_jobs.payload.thresholds.
  Whitelist por funcao_alvo (use EXATAMENTE estas chaves; valor numérico):
    - watchdog-inbound-orfao: idade_min_min (1-60), idade_max_min (10-720), antiduplo_seg (30-600), pular_se_confirmou_horas (0-24)
    - watchdog-loop-ia: outbound_min_minutos (2-30), similaridade_minima (0.5-0.95), lead_silencioso_horas (1-12)
  Quando aplicável, INCLUA "payload_patch" na ação. Sem payload_patch → vira tarefa pra TI.

VETOR C — Texto fora da janela 24h Meta
  Controles: whatsapp_templates + template_aliases
  Tipo válido: ajustar_template (alvo_ref = alias ou nome do template)

VETOR D — Tools / parsers / detectores no código
  D1 ai-triage tool selection (agendar_visita, interpretar_receita, consultar_lentes_*, registrar_nome_cliente)
  D2 sanitização anti-vazamento de prompt
  D3 detector pós-LLM (auto-persiste agendamento prometido)
  D4 despedida determinística
  Tipo válido: tarefa_ti (alvo_ref = nome do arquivo/tool)

VETOR E — Fluxos do bot de lojas/B2B
  Controle: bot_fluxos (etapas, menus)
  Tipo válido: ajustar_bot_fluxo (alvo_ref = chave do fluxo)

VETOR F — Configurações operacionais
  Controle: app_config (horário humano, homologação, cadências, janelas) ou feriados
  Tipo válido: ajustar_config (alvo_ref = chave em app_config)

VETOR G — Mensagens fixas determinísticas (sem LLM)
  Controle: ia_mensagens_fixas (chaves: despedida_explicit_close, despedida_thanks, despedida_short_no, escalada_fora_horario, pedir_receita_texto, recuperacao_ia_despedida_final)
  Tipo válido: ajustar_mensagem_fixa (alvo_ref = chave da mensagem; sugestao = novo texto com {placeholders} preservados)
  Use quando o problema é o TEXTO de uma mensagem disparada de forma determinística (não passou pelo LLM): despedida canônica, escalada fora-horário, despedida final de recuperação ou pedido de receita por texto.

HEURÍSTICAS DE ROTEAMENTO (use SEMPRE antes de escolher tipo):
- Menciona "template", "fora da janela 24h", "retomada de contexto", "marketing/utility"  → VETOR C
- "follow-up automático", "depois de N min sem resposta", "silêncio pós-inbound", "watchdog" → B3/B4
- "lembrete", "no-show", "confirmação automática", "véspera"                                → B2
- "retomada 1h/24h", "lead frio", "despedida proativa"                                      → B1
- "tool não disparou", "não persistiu", "não detectou imagem", "OCR falhou", "regex"        → VETOR D
- "menu do bot", "opção 1/2/3", "fluxo da loja"                                             → VETOR E
- "horário comercial", "fim de semana", "feriado", "janela de envio", "cadência"            → VETOR F
- Tom, persuasão, perguntas redundantes, alucinação de preço/marca, terminologia            → VETOR A

REGRAS:
- Mesmo padrão de erro em conversas diferentes = MESMO grupo. Ex: "IA citou preço Kodak" em 5 conversas = 1 grupo.
- NÃO proponha regras/exemplos/diretrizes que já existam (lista abaixo).
- NUNCA proponha "ajuste_prompt" para coisas que o prompt não controla (cron, template, watchdog, tool, config). Use o tipo correto do vetor.
- Sempre português, imperativo, conciso. Inclua "alvo_ref" sempre que possível.

SHAPE DAS AÇÕES (escolha UM tipo por ação):
  { "tipo": "regra_proibida",  "vetor": "A",  "texto": "...",                "categoria": "informacao_falsa|preco|tom|..." }
  { "tipo": "exemplo",         "vetor": "A",  "pergunta": "...",             "resposta_ideal": "...", "categoria": "..." }
  { "tipo": "ajuste_prompt",   "vetor": "A",  "instrucao": "...",            "categoria": "fluxo|tom|seguranca|fechamento" }
  { "tipo": "ajustar_cron",    "vetor": "B1..B6", "alvo_ref": "<cron>",      "titulo": "...", "descricao": "...", "sugestao": "...", "payload_patch": { "thresholds": { "<chave_whitelisted>": <numero> } } }
  { "tipo": "ajustar_template","vetor": "C",  "alvo_ref": "<alias|template>","titulo": "...", "descricao": "...", "sugestao": "..." }
  { "tipo": "ajustar_bot_fluxo","vetor": "E", "alvo_ref": "<chave_fluxo>",   "titulo": "...", "descricao": "...", "sugestao": "..." }
  { "tipo": "ajustar_config",  "vetor": "F",  "alvo_ref": "<chave_app_config>","titulo": "...", "descricao": "...", "sugestao": "..." }
  { "tipo": "ajustar_mensagem_fixa", "vetor": "G", "alvo_ref": "<chave_mensagem>", "titulo": "...", "descricao": "...", "sugestao": "<novo_texto_com_placeholders>" }
  { "tipo": "tarefa_ti",       "vetor": "D",  "alvo_ref": "<arquivo/tool>",  "titulo": "...", "descricao": "..." }

Retorne JSON estrito: {"grupos":[{"titulo":"...","descricao":"...","severidade":"critical|warn|info","auditoria_ids":["uuid"],"acoes":[...]}]}`;

  const user = `ACHADOS (${achados.length}):
${JSON.stringify(achados)}

JÁ EXISTEM (não duplicar):
- Regras: ${JSON.stringify(jaExistentes.regras.slice(0, 30))}
- Exemplos (perguntas): ${JSON.stringify(jaExistentes.exemplos.slice(0, 30))}
- Diretrizes: ${JSON.stringify(jaExistentes.instrucoes.slice(0, 30))}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
      max_completion_tokens: 16000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const finishReason = data.choices?.[0]?.finish_reason;
  const usage = data.usage;
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = cleaned.search(/[\{\[]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    console.error("[consolidar] JSON parse falhou.", { len: raw.length, finishReason, usage, preview: raw.slice(0, 300) });
    return { grupos: [] };
  }
}

function mergeGrupos(parciais: any[]): any[] {
  const map = new Map<string, any>();
  for (const lote of parciais) {
    for (const g of (lote?.grupos || [])) {
      const key = String(g.titulo || "").trim().toLowerCase().slice(0, 80) || crypto.randomUUID();
      if (map.has(key)) {
        const cur = map.get(key);
        const ids = new Set([...(cur.auditoria_ids || []), ...(g.auditoria_ids || [])]);
        cur.auditoria_ids = Array.from(ids);
        cur.acoes = [...(cur.acoes || []), ...(g.acoes || [])];
      } else {
        map.set(key, { ...g });
      }
    }
  }
  return Array.from(map.values());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { run_id } = await req.json();
    if (!run_id) {
      return new Response(JSON.stringify({ error: "run_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("ia_auditorias_grupos").delete().eq("run_id", run_id).eq("status", "pendente");

    const { data: auditorias, error: errA } = await supabase
      .from("ia_auditorias")
      .select("id, severidade, diagnostico, problemas, flags_heuristicos, status")
      .eq("run_id", run_id)
      .in("severidade", ["warn", "critical"])
      .neq("status", "ignorado");
    if (errA) throw errA;

    const trimItem = (p: any) => ({
      tipo: p?.tipo,
      severidade: p?.severidade,
      trecho: typeof p?.trecho === "string" ? p.trecho.slice(0, 160) : undefined,
    });
    const achados: Achado[] = (auditorias || [])
      .filter((a: any) => a.status !== "aplicado")
      .map((a: any) => ({
        id: a.id,
        severidade: a.severidade,
        diagnostico: (a.diagnostico || "").slice(0, 240),
        problemas: (Array.isArray(a.problemas) ? a.problemas : []).slice(0, 3).map(trimItem),
        flags: (Array.isArray(a.flags_heuristicos) ? a.flags_heuristicos : []).slice(0, 3).map(trimItem),
      }));

    if (achados.length === 0) {
      return new Response(JSON.stringify({ grupos: [], total: 0, motivo: "sem_achados_elegiveis" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: regras }, { data: exemplos }, { data: instr }] = await Promise.all([
      supabase.from("ia_regras_proibidas").select("regra").eq("ativo", true).limit(80),
      supabase.from("ia_exemplos").select("pergunta").eq("ativo", true).limit(80),
      supabase.from("ia_instrucoes_prompt").select("instrucao").eq("ativo", true).limit(80),
    ]);
    const ja = {
      regras: (regras || []).map((r: any) => r.regra),
      exemplos: (exemplos || []).map((e: any) => e.pergunta),
      instrucoes: (instr || []).map((i: any) => i.instrucao),
    };

    // Pré-clusteriza por tipo de problema para que cada chunk vá com achados similares juntos
    const byType = new Map<string, Achado[]>();
    for (const a of achados) {
      const t = primaryType(a);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(a);
    }
    const ordered: Achado[] = [];
    for (const arr of byType.values()) ordered.push(...arr);

    const CHUNK = 25;
    const chunks: Achado[][] = [];
    for (let i = 0; i < ordered.length; i += CHUNK) chunks.push(ordered.slice(i, i + CHUNK));

    console.log(`[consolidar] achados=${achados.length} chunks=${chunks.length} types=${byType.size}`);

    const parciais: any[] = [];
    for (const c of chunks) {
      try {
        const r = await consolidarChunk(c, ja);
        parciais.push(r);
      } catch (e: any) {
        console.error("[consolidar] chunk falhou:", e.message);
      }
    }

    const merged = mergeGrupos(parciais);
    const validIds = new Set(achados.map((a) => a.id));
    const inseridos: any[] = [];

    // Classificação de modo de aplicação por tipo de ação.
    // 'auto'   = botão aplica 100% sem precisar de deploy (mexe em tabela controlada pela auditoria).
    // 'codigo' = aplicar = abrir tarefa pra TI; precisa de mudança em código + deploy.
    // 'decisao'= mudança sensível, mostra diff e exige confirmação extra (reservado para evolução futura).
    const MODO_POR_TIPO: Record<string, "auto" | "codigo" | "decisao"> = {
      regra_proibida: "auto",
      exemplo: "auto",
      ajuste_prompt: "auto",
      ajustar_mensagem_fixa: "auto",
      ajustar_cron: "codigo",
      ajustar_template: "codigo",
      ajustar_bot_fluxo: "codigo",
      ajustar_config: "codigo",
      tarefa_ti: "codigo",
    };
    const classificarModo = (tipo: string): "auto" | "codigo" | "decisao" =>
      MODO_POR_TIPO[tipo] || "codigo";

    for (const g of merged) {
      const ids = (g.auditoria_ids || []).filter((id: string) => validIds.has(id));
      if (ids.length === 0) continue;
      const acoesRaw = Array.isArray(g.acoes) ? g.acoes : [];
      const acoes = acoesRaw.map((ac: any) => ({
        ...ac,
        modo_aplicacao: ac?.modo_aplicacao || classificarModo(String(ac?.tipo || "")),
      }));
      const { data, error } = await supabase
        .from("ia_auditorias_grupos")
        .insert({
          run_id,
          titulo: String(g.titulo || "Sem título").slice(0, 200),
          descricao: g.descricao || null,
          severidade: ["critical", "warn", "info"].includes(g.severidade) ? g.severidade : "warn",
          auditoria_ids: ids,
          acoes_propostas: acoes,
          status: "pendente",
        })
        .select()
        .single();
      if (error) {
        console.error("[consolidar] insert grupo falhou", error);
        continue;
      }
      inseridos.push(data);
    }

    const motivo = inseridos.length === 0
      ? (merged.length === 0 ? "llm_sem_grupos" : "grupos_sem_ids_validos")
      : undefined;

    return new Response(JSON.stringify({ grupos: inseridos, total: inseridos.length, motivo, debug: { achados: achados.length, chunks: chunks.length, merged: merged.length } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[audit-ia-consolidar]", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
