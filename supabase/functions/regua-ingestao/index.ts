// ═══════════════════════════════════════════════════════════
// REGUA-INGESTAO — Ingestão diária da régua pós-venda
// ═══════════════════════════════════════════════════════════
// Busca na firebird-bridge três fatias do dia:
//   1. Entregas de ontem → touchpoint PRIMEIRO_CONTATO
//   2. Entregas de 7 dias atrás → touchpoint ADAPTACAO_7D
//   3. Aniversariantes de hoje → touchpoint ANIVERSARIO
//
// Grava regua_inscricao + regua_touchpoint (PENDENTE).
// NÃO envia WhatsApp nem chama send-whatsapp.
// ═══════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pingBridge,
  listarGaps,
  marcarSync,
  notificarAdminBridgeDown,
  hojeSP as bhHojeSP,
} from "../_shared/bridge-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Tipos ──────────────────────────────────────────────────

interface BridgeRecord {
  cod_cliente: number | string;
  cliente:     string | null;
  cpf:         string | null;
  telefone_celular:    string | null;
  telefone_residencial: string | null;
  data_entrega?:   string | null; // YYYY-MM-DD
  data_nascimento?: string | null;
  cod_empresa: string | number;
  numero_venda?: string | null;
}

type TipoTouchpoint = "PRIMEIRO_CONTATO" | "ADAPTACAO_7D" | "ANIVERSARIO";

interface GrupoIngestao {
  tipo:          TipoTouchpoint;
  data_prevista: string; // YYYY-MM-DD
  registros:     BridgeRecord[];
}

interface ResultadoGrupo {
  tipo:           TipoTouchpoint;
  total_bridge:   number;
  inscritos:      number;
  touchpoints:    number;
  casados_cpf:    number;
  casados_tel:    number;
  nao_casados:    number;
  erros:          number;
}

// ── Helpers ────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/** Normaliza CPF: remove tudo que não for dígito, preenche com zeros à esquerda até 11. */
function normalizarCpf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return null;
  const padded = digits.padStart(11, "0");
  return padded.length <= 14 ? padded : null; // CPF tem 11, CNPJ 14
}

/** Normaliza telefone: só dígitos. */
function normalizarTelefone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

// ── Fetch bridge ───────────────────────────────────────────

async function fetchBridge<T>(bridgeUrl: string, path: string): Promise<T[]> {
  const url = `${bridgeUrl.replace(/\/$/, "")}${path}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Bridge ${path} retornou ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  // Padrão { ok, data } da bridge
  if (json && typeof json === "object" && "data" in json) {
    return (json.data ?? []) as T[];
  }
  // Fallback: array direto
  return Array.isArray(json) ? json : [];
}

// ── Match com contatos ─────────────────────────────────────

async function matchContato(
  supabase: ReturnType<typeof createClient>,
  cpfNorm: string | null,
  telefonesNorm: (string | null)[],
): Promise<{ contato_id: string | null; match_status: string }> {

  // 1) Match por CPF (documento ou metadata->>'cpf')
  if (cpfNorm) {
    const { data: porDocumento } = await supabase
      .from("contatos")
      .select("id")
      .eq("documento", cpfNorm)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (porDocumento) {
      return { contato_id: porDocumento.id, match_status: "casado_cpf" };
    }

    // metadata->>'cpf' (armazenado sem formatação ou com)
    const { data: porMetaCpf } = await supabase
      .from("contatos")
      .select("id")
      .eq("ativo", true)
      .filter("metadata->>cpf", "eq", cpfNorm)
      .limit(1)
      .maybeSingle();

    if (porMetaCpf) {
      return { contato_id: porMetaCpf.id, match_status: "casado_cpf" };
    }
  }

  // 2) Match por telefone (campo telefone principal)
  for (const tel of telefonesNorm) {
    if (!tel) continue;

    const { data: porTelefone } = await supabase
      .from("contatos")
      .select("id")
      .eq("ativo", true)
      .or(`telefone.eq.${tel},telefone.eq.55${tel}`)
      .limit(1)
      .maybeSingle();

    if (porTelefone) {
      return { contato_id: porTelefone.id, match_status: "casado_telefone" };
    }
  }

  return { contato_id: null, match_status: "nao_casado" };
}

// ── Processamento de um grupo ──────────────────────────────

async function processarGrupo(
  supabase: ReturnType<typeof createClient>,
  grupo: GrupoIngestao,
): Promise<ResultadoGrupo> {
  const resultado: ResultadoGrupo = {
    tipo:         grupo.tipo,
    total_bridge: grupo.registros.length,
    inscritos:    0,
    touchpoints:  0,
    casados_cpf:  0,
    casados_tel:  0,
    nao_casados:  0,
    erros:        0,
  };

  for (const reg of grupo.registros) {
    try {
      const cpfNorm   = normalizarCpf(reg.cpf);
      const tel1      = normalizarTelefone(reg.telefone_celular);
      const tel2      = normalizarTelefone(reg.telefone_residencial);
      const codCliente = String(reg.cod_cliente);
      const codEmpresa = String(reg.cod_empresa);

      // Data de entrega: para ANIVERSARIO usa data_prevista do grupo
      const dataEntrega =
        grupo.tipo === "ANIVERSARIO"
          ? grupo.data_prevista
          : (reg.data_entrega ?? grupo.data_prevista);

      // Match
      const { contato_id, match_status } = await matchContato(
        supabase,
        cpfNorm,
        [tel1, tel2],
      );

      if (match_status === "casado_cpf")       resultado.casados_cpf++;
      else if (match_status === "casado_telefone") resultado.casados_tel++;
      else                                      resultado.nao_casados++;

      // Upsert regua_inscricao
      const { data: inscricao, error: errInscricao } = await supabase
        .from("regua_inscricao")
        .upsert(
          {
            contato_id,
            match_status,
            cod_cliente:    codCliente,
            cod_empresa:    codEmpresa,
            data_entrega:   dataEntrega,
            data_nascimento: reg.data_nascimento ?? null,
            numero_venda:   reg.numero_venda ?? null,
            nome_bridge:    reg.cliente ?? null,
            telefone_bridge: tel1 ?? tel2 ?? null,
            whatsapp_bridge: tel1 ?? null,
            updated_at:     new Date().toISOString(),
          },
          {
            onConflict: "cod_cliente,data_entrega",
            ignoreDuplicates: false,
          },
        )
        .select("id")
        .single();

      if (errInscricao || !inscricao) {
        console.error(`[INGESTAO] Erro upsert inscricao cod_cliente=${codCliente}:`, errInscricao);
        resultado.erros++;
        continue;
      }

      resultado.inscritos++;

      // Insert touchpoint (ON CONFLICT DO NOTHING via ignoreDuplicates)
      const { error: errTP } = await supabase
        .from("regua_touchpoint")
        .upsert(
          {
            inscricao_id:  inscricao.id,
            tipo:          grupo.tipo,
            data_prevista: grupo.data_prevista,
            status:        "PENDENTE",
          },
          {
            onConflict: "inscricao_id,tipo",
            ignoreDuplicates: true,
          },
        );

      if (errTP) {
        console.error(`[INGESTAO] Erro upsert touchpoint inscricao=${inscricao.id}:`, errTP);
        resultado.erros++;
      } else {
        resultado.touchpoints++;
      }
    } catch (e) {
      console.error("[INGESTAO] Erro inesperado no registro:", e);
      resultado.erros++;
    }
  }

  return resultado;
}

// ── Handler principal ──────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BRIDGE_URL         = Deno.env.get("BRIDGE_URL");

  if (!BRIDGE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "BRIDGE_URL não configurado nos secrets da função" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* sem body */ }

  // Parâmetros
  const empresa    = (payload.empresa  as string | number | null) ?? null;
  const dataBase   = (payload.data     as string | null) ?? null; // YYYY-MM-DD override
  const dryRun     = Boolean(payload.dry_run);

  const hoje = dataBase ? new Date(`${dataBase}T12:00:00Z`) : new Date();
  const ontem  = isoDate(addDias(hoje, -1));
  const ha7d   = isoDate(addDias(hoje, -7));
  const hojeIso = isoDate(hoje);

  const empresaParam = empresa ? `&empresa=${empresa}` : "";

  console.log(`[INGESTAO] data_base=${hojeIso} ontem=${ontem} ha7d=${ha7d} empresa=${empresa ?? "todas"} dry_run=${dryRun}`);

  // ── Busca bridge em paralelo ───────────────────────────
  let registrosOntem:   BridgeRecord[] = [];
  let registros7d:      BridgeRecord[] = [];
  let registrosAniv:    BridgeRecord[] = [];
  const errosBridge: string[] = [];

  const [resOntem, res7d, resAniv] = await Promise.allSettled([
    fetchBridge<BridgeRecord>(BRIDGE_URL, `/api/v1/crm/entregas?dataIni=${ontem}&dataFim=${ontem}${empresaParam}`),
    fetchBridge<BridgeRecord>(BRIDGE_URL, `/api/v1/crm/entregas?dataIni=${ha7d}&dataFim=${ha7d}${empresaParam}`),
    fetchBridge<BridgeRecord>(BRIDGE_URL, `/api/v1/crm/aniversariantes?data=${hojeIso}${empresaParam}`),
  ]);

  if (resOntem.status  === "fulfilled") registrosOntem = resOntem.value;
  else errosBridge.push(`entregas_ontem: ${resOntem.reason?.message ?? resOntem.reason}`);

  if (res7d.status === "fulfilled") registros7d = res7d.value;
  else errosBridge.push(`entregas_7d: ${res7d.reason?.message ?? res7d.reason}`);

  if (resAniv.status === "fulfilled") registrosAniv = resAniv.value;
  else errosBridge.push(`aniversariantes: ${resAniv.reason?.message ?? resAniv.reason}`);

  console.log(`[INGESTAO] bridge: ontem=${registrosOntem.length} 7d=${registros7d.length} aniv=${registrosAniv.length}`);

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: true,
        data_base: hojeIso,
        erros_bridge: errosBridge,
        preview: {
          PRIMEIRO_CONTATO: registrosOntem.length,
          ADAPTACAO_7D:     registros7d.length,
          ANIVERSARIO:      registrosAniv.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Processa grupos ────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Health-check + auditoria por fonte/data
  const ping = await pingBridge(BRIDGE_URL, Deno.env.get("INTERNAL_SERVICE_SECRET") ?? "");
  const fonteEntregas = "ingestao_entregas" as const;
  const fonteAniv     = "ingestao_aniv" as const;

  if (!ping.ok) {
    await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ontem,   status: "bridge_down", erro_msg: ping.error });
    await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ha7d,    status: "bridge_down", erro_msg: ping.error });
    await marcarSync(supabase, { fonte: fonteAniv,     data_alvo: hojeIso, status: "bridge_down", erro_msg: ping.error });
    await notificarAdminBridgeDown(supabase, fonteEntregas, ping.error ?? "");
  }

  const grupos: GrupoIngestao[] = [
    { tipo: "PRIMEIRO_CONTATO", data_prevista: hojeIso, registros: registrosOntem },
    { tipo: "ADAPTACAO_7D",     data_prevista: hojeIso, registros: registros7d   },
    { tipo: "ANIVERSARIO",      data_prevista: hojeIso, registros: registrosAniv },
  ];

  const resultados: ResultadoGrupo[] = [];
  for (const grupo of grupos) {
    const r = await processarGrupo(supabase, grupo);
    resultados.push(r);
    console.log(`[INGESTAO] ${r.tipo}: bridge=${r.total_bridge} inscritos=${r.inscritos} tp=${r.touchpoints} cpf=${r.casados_cpf} tel=${r.casados_tel} sem_match=${r.nao_casados} erros=${r.erros}`);
  }

  // Grava sync_log por fonte quando bridge respondeu
  if (ping.ok) {
    if (resOntem.status === "fulfilled") {
      await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ontem, status: registrosOntem.length === 0 ? "vazio" : "ok", linhas_recebidas: registrosOntem.length });
    } else {
      await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ontem, status: "bridge_down", erro_msg: String(resOntem.reason?.message ?? resOntem.reason) });
    }
    if (res7d.status === "fulfilled") {
      await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ha7d, status: registros7d.length === 0 ? "vazio" : "ok", linhas_recebidas: registros7d.length });
    } else {
      await marcarSync(supabase, { fonte: fonteEntregas, data_alvo: ha7d, status: "bridge_down", erro_msg: String(res7d.reason?.message ?? res7d.reason) });
    }
    if (resAniv.status === "fulfilled") {
      await marcarSync(supabase, { fonte: fonteAniv, data_alvo: hojeIso, status: registrosAniv.length === 0 ? "vazio" : "ok", linhas_recebidas: registrosAniv.length });
    } else {
      await marcarSync(supabase, { fonte: fonteAniv, data_alvo: hojeIso, status: "bridge_down", erro_msg: String(resAniv.reason?.message ?? resAniv.reason) });
    }
  }

  const totalErros = resultados.reduce((s, r) => s + r.erros, 0) + errosBridge.length;

  return new Response(
    JSON.stringify({
      ok: totalErros === 0,
      data_base: hojeIso,
      erros_bridge: errosBridge,
      resultados,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
