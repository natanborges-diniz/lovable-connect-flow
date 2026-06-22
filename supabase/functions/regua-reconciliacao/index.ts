// ═══════════════════════════════════════════════════════════
// REGUA-RECONCILIACAO — Reconciliação diária das inscrições
// ═══════════════════════════════════════════════════════════
// Para cada regua_inscricao com status = 'aguardando_entrega':
//   1. Chama /api/v1/crm/venda?numero=<numero_venda>&empresa=<cod_empresa>
//   2. Upsert em regua_os (entrega_valida, devolvida, produto, data_pronto)
//   3. Atualiza valor_total_validado e valor_status na inscrição
//   4. Enriquece contatos.data_nascimento (só se NULL, sem sobrescrever)
//   5. Se CPF do Firebird divergir do informado, apenas loga (não sobrescreve)
//   6. Ancora de entrega:
//      - Só imediata: data_entrega_ancora = max(data_entrega) das imediatas
//      - Tem produção: ancora quando TODAS as OS de produção têm entrega_valida=1
//                      data_entrega_ancora = max(data_entrega) das de produção
//      - Se falta alguma: segue em aguardando_entrega
//   7. Quando ancora é setada: status = 'ativa'
//
// NÃO dispara WhatsApp. NÃO cria touchpoints.
// ═══════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Tipos ──────────────────────────────────────────────────

interface OsRow {
  os_numero:      string | number;
  classificacao:  string;       // 'producao' | 'imediata'
  data_pronto:    string | null;
  data_entrega:   string | null;
  cpf:            string | null;
  produto:        string | null;
  devolvida:      0 | 1;
  is_garantia:    0 | 1;
  data_nascimento: string | null;
  entrega_valida: 0 | 1;
}

interface VendaBridge {
  numerovenda:  number | string | null;
  valor_total:  number | null;
  os:           OsRow[];
}

interface Inscricao {
  id:                    string;
  numero_venda:          string;
  cod_empresa:           string | null;
  contato_id:            string | null;
  cpf:                   string | null;
  valor_total_informado: number | null;
  nome_cliente:          string | null;
  tentativas_reconciliacao: number | null;
  demanda_divergencia_id: string | null;
  valor_status:          string | null;
}


type ResultadoInscricao = "anchorada" | "aguardando" | "sem_venda" | "erro";

// ── Helpers ────────────────────────────────────────────────

function normalizarCpf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return null;
  const padded = digits.padStart(11, "0");
  return padded.length <= 14 ? padded : null;
}

function computeValorStatus(
  informado: number | null,
  validado: number | null,
): string {
  if (validado === null || informado === null) return "sem_referencia";
  return Math.abs(validado - informado) <= 0.5 ? "ok" : "divergente";
}

/** Retorna YYYY-MM-DD da âncora ou null se ainda não pode setar. */
function computeAncora(os: OsRow[]): string | null {
  if (os.length === 0) return null;

  const osProducao = os.filter((o) => o.classificacao?.trim() === "producao");

  if (osProducao.length === 0) {
    // Venda apenas imediata: ancora = max(data_entrega) das imediatas
    const datas = os
      .map((o) => o.data_entrega)
      .filter((d): d is string => !!d)
      .sort();
    return datas.length > 0 ? datas[datas.length - 1] : null;
  }

  // Tem OS de produção: todas devem ter entrega_valida=1
  if (!osProducao.every((o) => o.entrega_valida === 1)) return null;

  const datas = osProducao
    .map((o) => o.data_entrega)
    .filter((d): d is string => !!d)
    .sort();
  return datas.length > 0 ? datas[datas.length - 1] : null;
}

// ── Fetch bridge venda ─────────────────────────────────────

async function fetchVenda(
  bridgeUrl: string,
  numero: string,
  empresa: string | null,
): Promise<VendaBridge | null> {
  const empresaQ = empresa ? `&empresa=${empresa}` : "";
  const url = `${bridgeUrl.replace(/\/$/, "")}/api/v1/crm/venda?numero=${encodeURIComponent(numero)}${empresaQ}`;

  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Bridge /venda retornou ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json();

  // Padrão { ok, data } da bridge
  const data = json?.data ?? json;
  if (!data || !data.os) return null;
  return data as VendaBridge;
}

// ── Processa uma inscrição ─────────────────────────────────

async function processarInscricao(
  supabase: ReturnType<typeof createClient>,
  insc: Inscricao,
  bridgeUrl: string,
): Promise<ResultadoInscricao> {
  let venda: VendaBridge | null;
  try {
    venda = await fetchVenda(bridgeUrl, insc.numero_venda, insc.cod_empresa);
  } catch (e) {
    console.error(`[RECONCIL] Erro bridge insc=${insc.id} venda=${insc.numero_venda}:`, e);
    return "erro";
  }

  if (!venda) {
    // ── SEM VENDA: incrementa tentativas; após 5x marca persistente + notifica supervisor (INTERNO) ──
    const tentativas = (insc.tentativas_reconciliacao ?? 0) + 1;
    const updates: Record<string, unknown> = {
      tentativas_reconciliacao: tentativas,
      ultima_tentativa_at: new Date().toISOString(),
    };
    if (tentativas >= 5 && insc.valor_status !== "sem_venda_persistente") {
      updates.valor_status = "sem_venda_persistente";
      console.warn(`[RECONCIL] insc=${insc.id} venda=${insc.numero_venda} marcada sem_venda_persistente após ${tentativas} tentativas`);
      // Notificação INTERNA ao supervisor (sem qualquer comunicação ao cliente)
      await supabase.from("notificacoes").insert({
        tipo: "cashback_sem_venda_persistente",
        titulo: "Cashback sem venda no Firebird",
        mensagem: `Inscrição ${insc.numero_venda} (${insc.nome_cliente ?? "—"}) sem venda após ${tentativas} tentativas. Auditoria de cashback.`,
        metadata: { inscricao_id: insc.id, numero_venda: insc.numero_venda, cod_empresa: insc.cod_empresa },
      } as never);
    }
    await supabase.from("regua_inscricao").update(updates).eq("id", insc.id);
    return "sem_venda";
  }

  const os = venda.os ?? [];

  // 1. Upsert regua_os
  if (os.length > 0) {
    const { error: errOs } = await supabase
      .from("regua_os")
      .upsert(
        os.map((o) => ({
          inscricao_id:    insc.id,
          os_numero:       String(o.os_numero),
          classificacao:   (o.classificacao ?? "desconhecida").trim(),
          data_entrega:    o.data_entrega  ?? null,
          reconciliado_at: new Date().toISOString(),
        })),
        { onConflict: "inscricao_id,os_numero" },
      );

    if (errOs) {
      console.error(`[RECONCIL] Erro upsert regua_os insc=${insc.id}:`, errOs);
      return "erro";
    }
  }

  // 2. Valor
  const valorValidado = venda.valor_total ?? null;
  const valorStatus   = computeValorStatus(insc.valor_total_informado, valorValidado);

  // 2.5 CONFIRMAÇÃO DE CASHBACK D+1 — apenas auto-aprova quando bate (ou tolerância 0,50).
  // Comunicação ao cliente é EXCLUSIVAMENTE no ato do PIN; aqui é SILENCIOSO.
  // - valor_status='ok'         → aprova automaticamente via cashback_confirmar_credito
  // - valor_status='divergente' → NÃO confirma; cria/atualiza demanda interna p/ a loja
  // - valor_status='sem_referencia' → mantém provisório
  if (valorStatus === "ok" && valorValidado !== null) {
    const { data: cbResult, error: cbErr } = await supabase.rpc(
      "cashback_confirmar_credito",
      { _inscricao_id: insc.id, _valor_validado: valorValidado },
    );
    console.info(`[RECONCIL] auto-aprovado insc=${insc.id}:`, cbErr ? cbErr.message : cbResult);
    if (insc.contato_id) {
      await supabase.from("eventos_crm").insert({
        contato_id: insc.contato_id,
        tipo: "cashback_confirmado",
        descricao: "Cashback confirmado automaticamente após reconciliação D+1 (silencioso ao cliente)",
        referencia_tipo: "regua_inscricao",
        referencia_id: insc.id,
        metadata: { numero_venda: insc.numero_venda, valor: valorValidado, automatico: true },
      } as never);
    }
  } else if (valorStatus === "divergente" && valorValidado !== null) {
    // Cria demanda interna (NÃO envia nada ao cliente)
    if (!insc.demanda_divergencia_id) {
      await abrirDemandaDivergencia(supabase, insc, valorValidado);
    } else {
      console.log(`[RECONCIL] insc=${insc.id} já possui demanda divergência ${insc.demanda_divergencia_id}`);
    }
  }

  // 3. CPF
  const cpfBridgeRaw = os.find((o) => o.cpf)?.cpf ?? null;
  const cpfBridge    = normalizarCpf(cpfBridgeRaw);
  const cpfInsc      = normalizarCpf(insc.cpf);
  if (cpfInsc && cpfBridge && cpfBridge !== cpfInsc) {
    console.warn(`[RECONCIL] CPF divergente insc=${insc.id}`);
  }

  // 4. data_nascimento
  if (insc.contato_id) {
    const dataNasc = os.find((o) => o.data_nascimento)?.data_nascimento ?? null;
    if (dataNasc) {
      await supabase.from("contatos")
        .update({ data_nascimento: dataNasc })
        .eq("id", insc.contato_id)
        .is("data_nascimento", null);
    }
  }

  // 5. Âncora
  const ancora = computeAncora(os);

  // 6. Update
  const updatePayload: Record<string, unknown> = {
    valor_total_validado: valorValidado,
    valor_status:         valorStatus,
    tentativas_reconciliacao: (insc.tentativas_reconciliacao ?? 0) + 1,
    ultima_tentativa_at: new Date().toISOString(),
  };
  if (ancora) {
    updatePayload.data_entrega_ancora = ancora;
    updatePayload.status              = "ativa";
  }

  const { error: errUpdate } = await supabase
    .from("regua_inscricao").update(updatePayload).eq("id", insc.id);
  if (errUpdate) {
    console.error(`[RECONCIL] Erro update insc=${insc.id}:`, errUpdate);
    return "erro";
  }

  const resultado: ResultadoInscricao = ancora ? "anchorada" : "aguardando";
  console.log(`[RECONCIL] insc=${insc.id} valor_status=${valorStatus} ancora=${ancora ?? "—"}`);
  return resultado;
}

// ── Abrir demanda interna p/ loja em caso de divergência (SILENCIOSO ao cliente) ──
async function abrirDemandaDivergencia(
  supabase: ReturnType<typeof createClient>,
  insc: Inscricao,
  valorSistema: number,
): Promise<void> {
  const valorLancado = Number(insc.valor_total_informado ?? 0);
  const diff = valorSistema - valorLancado;
  const cliente = insc.nome_cliente ?? "cliente";
  const pergunta = [
    `⚠️ *Divergência de cashback* — venda ${insc.numero_venda}`,
    ``,
    `Cliente: *${cliente}*`,
    `Valor lançado no Atrium: *R$ ${valorLancado.toFixed(2)}*`,
    `Valor confirmado no sistema: *R$ ${valorSistema.toFixed(2)}*`,
    `Diferença: *R$ ${diff.toFixed(2)}*`,
    ``,
    `O cashback do cliente ficou *provisório* até a loja decidir:`,
    `✅ *Ajustar para o valor do sistema (R$ ${valorSistema.toFixed(2)})* — aprova na hora`,
    `📝 *Manter o valor lançado (R$ ${valorLancado.toFixed(2)})* — vai para o supervisor aprovar`,
    ``,
    `_O cliente não recebe nenhuma mensagem sobre isso._`,
  ].join("\n");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Reusa criar-demanda-loja com service role
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/criar-demanda-loja`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SRK}`,
      "apikey": SRK,
    },
    body: JSON.stringify({
      loja_nome: insc.cod_empresa ?? "loja",
      loja_telefone: "__INTERNO__",
      pergunta,
      assunto: `Divergência cashback — venda ${insc.numero_venda}`,
      origem: "sistema",
    }),
  });
  const json = await resp.json().catch(() => ({} as Record<string, unknown>));
  if (!resp.ok) {
    console.error("[RECONCIL] falha criar demanda divergência:", json);
    return;
  }
  const demandaId = (json as Record<string, unknown>).demanda_id as string | undefined;
  if (!demandaId) return;

  await supabase.from("demandas_loja").update({
    tipo_chave: "cashback_divergencia",
    metadata: {
      tipo_chave: "cashback_divergencia",
      inscricao_id: insc.id,
      numero_venda: insc.numero_venda,
      cod_empresa: insc.cod_empresa,
      cliente_nome: cliente,
      valor_lancado: valorLancado,
      valor_sistema: valorSistema,
      diff,
      silencioso_cliente: true,
    },
  }).eq("id", demandaId);

  await supabase.from("regua_inscricao")
    .update({ demanda_divergencia_id: demandaId })
    .eq("id", insc.id);

  if (insc.contato_id) {
    await supabase.from("eventos_crm").insert({
      contato_id: insc.contato_id,
      tipo: "cashback_divergente",
      descricao: "Divergência de cashback aberta com a loja (silencioso ao cliente)",
      referencia_tipo: "regua_inscricao",
      referencia_id: insc.id,
      metadata: { numero_venda: insc.numero_venda, valor_lancado: valorLancado, valor_sistema: valorSistema, demanda_id: demandaId },
    } as never);
  }
}


// ── Handler principal ──────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BRIDGE_URL   = Deno.env.get("BRIDGE_URL");

  if (!BRIDGE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "BRIDGE_URL não configurado" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* sem body */ }

  const dryRun  = Boolean(payload.dry_run);
  const empresa = (payload.empresa as string | null) ?? null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Busca todas as inscrições pendentes (sem limite paginado — volume esperado baixo)
  let query = supabase
    .from("regua_inscricao")
    .select("id, numero_venda, cod_empresa, contato_id, cpf, valor_total_informado, nome_cliente, tentativas_reconciliacao, demanda_divergencia_id, valor_status")
    .eq("status", "aguardando_entrega");

  if (empresa) {
    query = query.eq("cod_empresa", empresa);
  }

  const { data: inscricoes, error: errFetch } = await query;

  if (errFetch) {
    return new Response(
      JSON.stringify({ ok: false, error: errFetch.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const lista = (inscricoes ?? []) as Inscricao[];
  console.log(`[RECONCIL] total aguardando_entrega=${lista.length} dry_run=${dryRun}`);

  if (dryRun) {
    // Simula sem gravar: chama bridge, computa tudo, retorna detalhes por inscrição.
    const detalhes = [];
    let semVendaCount = 0;

    for (const insc of lista) {
      let venda: VendaBridge | null;
      try {
        venda = await fetchVenda(BRIDGE_URL, insc.numero_venda, insc.cod_empresa);
      } catch (e) {
        detalhes.push({ id: insc.id, numero_venda: insc.numero_venda, resultado: "erro", erro: String(e) });
        continue;
      }

      if (!venda) {
        semVendaCount++;
        detalhes.push({ id: insc.id, numero_venda: insc.numero_venda, resultado: "sem_venda" });
        continue;
      }

      const os = venda.os ?? [];
      const valorValidado = venda.valor_total ?? null;
      const valorStatus   = computeValorStatus(insc.valor_total_informado, valorValidado);
      const ancora        = computeAncora(os);

      const cashbackWouldCall = valorStatus !== "sem_referencia" && valorValidado !== null;
      if (cashbackWouldCall) {
        console.info(
          `[RECONCIL] dry_run — CHAMARIA cashback_confirmar_credito insc=${insc.id} valor_validado=${valorValidado}`,
        );
      }

      detalhes.push({
        id:                    insc.id,
        numero_venda:          insc.numero_venda,
        valor_total_informado: insc.valor_total_informado,
        valor_total_validado:  valorValidado,
        valor_status:          valorStatus,
        os: os.map((o) => ({
          os_numero:      o.os_numero,
          classificacao:  o.classificacao?.trim(),
          data_entrega:   o.data_entrega,
          entrega_valida: o.entrega_valida,
          devolvida:      o.devolvida,
          is_garantia:    o.is_garantia,
        })),
        ancora,
        cashback_would_call: cashbackWouldCall,
        resultado: ancora ? "anchorada" : "aguardando",
      });
    }

    return new Response(
      JSON.stringify({
        ok:        true,
        dry_run:   true,
        total:     lista.length,
        sem_venda: semVendaCount,
        detalhes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const contadores = { anchorada: 0, aguardando: 0, sem_venda: 0, erro: 0 };

  for (const insc of lista) {
    const res = await processarInscricao(supabase, insc, BRIDGE_URL);
    contadores[res]++;
  }

  return new Response(
    JSON.stringify({
      ok:    contadores.erro === 0,
      total: lista.length,
      ...contadores,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
