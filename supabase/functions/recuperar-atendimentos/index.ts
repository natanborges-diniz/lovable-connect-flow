import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface OrfaoRow {
  atendimento_id: string;
  contato_id: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  modo: string;
  status: string;
  ultima_mensagem_at: string;
  ultima_mensagem_conteudo: string;
  setor_id: string | null;
  setor_nome: string | null;
  minutos_pendente: number;
}

// Setor "Atendimento Corporativo" — comunicação interna (lojas, colaboradores, departamentos)
const ATENDIMENTO_CORPORATIVO_SETOR_ID = "32cbd99c-4b20-4c8b-b7b2-901904d0aff6";

async function getSetoresInternos(supabase: any): Promise<string[]> {
  // Setores considerados "internos": Atendimento Corporativo + qualquer setor configurado (Lojas, Financeiro, TI…)
  // Heurística: todo setor com setor_id NÃO-NULO em pipeline_colunas é "interno". Vendas/CRM tem setor_id=NULL.
  const { data } = await supabase.from("setores").select("id").eq("ativo", true);
  const ids = (data || []).map((s: any) => s.id);
  // Garante que o corporativo entra mesmo se inativo
  if (!ids.includes(ATENDIMENTO_CORPORATIVO_SETOR_ID)) ids.push(ATENDIMENTO_CORPORATIVO_SETOR_ID);
  return ids;
}

async function detectarOrfaos(
  supabase: any,
  filters: {
    idade_min_min?: number;
    setor_id?: string | null;
    modo?: string | null;
    publico?: "clientes" | "internos" | "todos" | null;
    setores_internos?: string[];
  }
): Promise<OrfaoRow[]> {
  const idadeMin = filters.idade_min_min ?? 15;

  // Buscar atendimentos não encerrados
  const { data: ats, error } = await supabase
    .from("atendimentos")
    .select(
      "id, contato_id, modo, status, fila_id, fila:filas(setor_id, setor:setores(id, nome)), contato:contatos(nome, telefone)"
    )
    .neq("status", "encerrado");
  if (error) throw error;
  if (!ats?.length) return [];

  const atIds = ats.map((a: any) => a.id);
  const { data: msgs, error: mErr } = await supabase
    .from("mensagens")
    .select("atendimento_id, direcao, conteudo, created_at")
    .in("atendimento_id", atIds)
    .order("created_at", { ascending: false });
  if (mErr) throw mErr;

  const lastByAt = new Map<string, any>();
  for (const m of msgs || []) {
    if (!lastByAt.has(m.atendimento_id)) lastByAt.set(m.atendimento_id, m);
  }

  const cutoff = Date.now() - idadeMin * 60_000;
  const out: OrfaoRow[] = [];
  for (const a of ats as any[]) {
    const last = lastByAt.get(a.id);
    if (!last) continue;
    if (last.direcao !== "inbound") continue;
    const ts = new Date(last.created_at).getTime();
    if (ts > cutoff) continue;

    const setorId = a.fila?.setor_id || null;
    if (filters.setor_id && setorId !== filters.setor_id) continue;
    if (filters.modo && a.modo !== filters.modo) continue;

    // Filtro de público (clientes vs internos)
    if (filters.publico === "clientes") {
      // Cliente final = sem setor associado (CRM vendas)
      if (setorId !== null) continue;
    } else if (filters.publico === "internos") {
      // Interno = qualquer setor cadastrado (Corporativo, Lojas, Financeiro, TI…)
      if (setorId === null) continue;
    }

    out.push({
      atendimento_id: a.id,
      contato_id: a.contato_id,
      contato_nome: a.contato?.nome ?? null,
      contato_telefone: a.contato?.telefone ?? null,
      modo: a.modo,
      status: a.status,
      ultima_mensagem_at: last.created_at,
      ultima_mensagem_conteudo: (last.conteudo || "").slice(0, 280),
      setor_id: setorId,
      setor_nome: a.fila?.setor?.nome ?? null,
      minutos_pendente: Math.round((Date.now() - ts) / 60_000),
    });
  }
  out.sort((x, y) => y.minutos_pendente - x.minutos_pendente);
  return out;
}

async function logRecuperacao(
  supabase: any,
  atendimentoId: string,
  contatoId: string,
  acao: string,
  detalhes: Record<string, any>,
) {
  await supabase.from("eventos_crm").insert({
    contato_id: contatoId,
    referencia_id: atendimentoId,
    referencia_tipo: "atendimento",
    tipo: "recuperacao_orfao",
    descricao: `Recuperação manual: ${acao}`,
    metadata: { acao, ...detalhes },
  });
}

async function acionarIA(supabase: any, row: { atendimento_id: string; contato_id: string; ultima_mensagem_conteudo: string }, prefixo?: string) {
  const mensagemEfetiva = prefixo
    ? `${prefixo}\n\n${row.ultima_mensagem_conteudo}`
    : row.ultima_mensagem_conteudo;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-triage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      atendimento_id: row.atendimento_id,
      contato_id: row.contato_id,
      mensagem_texto: mensagemEfetiva,
      forcar_processamento: true,
    }),
  });
  const txt = await resp.text();
  await logRecuperacao(supabase, row.atendimento_id, row.contato_id, "acionar_ia", {
    prefixo: prefixo ?? null,
    status: resp.status,
    response: txt.slice(0, 500),
  });
  return { ok: resp.ok, status: resp.status, body: txt };
}

async function enviarWhatsApp(atendimento_id: string, mensagem: string) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ atendimento_id, conteudo: mensagem }),
  });
  return { ok: resp.ok, status: resp.status, body: await resp.text() };
}

async function escalarHumano(
  supabase: any,
  row: { atendimento_id: string; contato_id: string; setor_id: string | null },
  mensagemDesculpas: string | null,
) {
  // Atualiza modo=humano
  await supabase
    .from("atendimentos")
    .update({ modo: "humano", metadata: { recuperacao_orfao_at: new Date().toISOString() } })
    .eq("id", row.atendimento_id);

  // Sobe prioridade na solicitacao
  const { data: at } = await supabase
    .from("atendimentos")
    .select("solicitacao_id")
    .eq("id", row.atendimento_id)
    .single();
  if (at?.solicitacao_id) {
    await supabase.from("solicitacoes").update({ prioridade: "alta" }).eq("id", at.solicitacao_id);
  }

  // Notifica setor
  if (row.setor_id) {
    await supabase.from("notificacoes").insert({
      setor_id: row.setor_id,
      tipo: "recuperacao_orfao",
      titulo: "🔥 Atendimento recuperado — precisa de humano",
      mensagem: "Conversa pendente foi escalada após downtime. Atender com prioridade.",
      referencia_id: row.atendimento_id,
    });
  }

  // Manda mensagem de desculpas
  let waResult: any = null;
  if (mensagemDesculpas && mensagemDesculpas.trim()) {
    waResult = await enviarWhatsApp(row.atendimento_id, mensagemDesculpas.trim());
  }

  await logRecuperacao(supabase, row.atendimento_id, row.contato_id, "escalar_humano", {
    enviou_desculpas: !!mensagemDesculpas,
    wa_status: waResult?.status ?? null,
  });

  return { ok: true, wa: waResult };
}

async function enviarMensagemDesculpas(supabase: any, row: { atendimento_id: string; contato_id: string }, mensagem: string) {
  const wa = await enviarWhatsApp(row.atendimento_id, mensagem);
  await logRecuperacao(supabase, row.atendimento_id, row.contato_id, "mensagem_desculpas", {
    wa_status: wa.status,
  });
  return wa;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    if (req.method === "GET" || action === "list") {
      const idade = parseInt(url.searchParams.get("idade_min") || "15", 10);
      const setorId = url.searchParams.get("setor_id");
      const modo = url.searchParams.get("modo");
      const orfaos = await detectarOrfaos(supabase, {
        idade_min_min: idade,
        setor_id: setorId === "all" || !setorId ? null : setorId,
        modo: modo === "all" || !modo ? null : modo,
      });
      return new Response(JSON.stringify({ total: orfaos.length, orfaos }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const acao = body.acao as "acionar_ia" | "escalar_humano" | "mensagem_desculpas" | "lote_inteligente";
    const atendimentoIds: string[] = Array.isArray(body.atendimento_ids) ? body.atendimento_ids : [];
    const mensagem: string = body.mensagem || "Olá! Desculpe a demora em responder, estamos retomando seu atendimento agora. Em instantes nossa equipe vai te atender. 🙏";

    // Recarrega rows alvo
    const orfaos = await detectarOrfaos(supabase, { idade_min_min: 0 });
    const alvo = orfaos.filter((o) => atendimentoIds.includes(o.atendimento_id));

    const results: any[] = [];
    for (const row of alvo) {
      try {
        if (acao === "acionar_ia") {
          const r = await acionarIA(supabase, row);
          results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "acionar_ia" });
        } else if (acao === "escalar_humano") {
          const r = await escalarHumano(supabase, row, mensagem);
          results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "escalar_humano" });
        } else if (acao === "mensagem_desculpas") {
          const r = await enviarMensagemDesculpas(supabase, row, mensagem);
          results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "mensagem_desculpas" });
        } else if (acao === "lote_inteligente") {
          const min = row.minutos_pendente;
          if (min < 60) {
            const r = await acionarIA(supabase, row);
            results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "acionar_ia" });
          } else if (min < 360) {
            const r = await acionarIA(supabase, row, "(retomando após instabilidade — desculpe a demora)");
            results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "acionar_ia_com_desculpa" });
          } else {
            const r = await escalarHumano(supabase, row, mensagem);
            results.push({ atendimento_id: row.atendimento_id, ok: r.ok, action: "escalar_humano" });
          }
        }
      } catch (e: any) {
        results.push({ atendimento_id: row.atendimento_id, ok: false, error: e.message });
      }
    }

    return new Response(JSON.stringify({ processados: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[recuperar-atendimentos] error", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
