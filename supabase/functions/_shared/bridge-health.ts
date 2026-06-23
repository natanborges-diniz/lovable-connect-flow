// ═══════════════════════════════════════════════════════════
// BRIDGE-HEALTH — Resiliência da firebird-bridge
// ═══════════════════════════════════════════════════════════
// Helpers compartilhados pelos crons que dependem da bridge:
//  - pingBridge(): health-check rápido (timeout 5s)
//  - listarGaps(fonte, n): retorna datas dos últimos N dias SEM status='ok'
//  - marcarOk / marcarFalha: grava bridge_sync_log
//  - notificarAdminUmaVezPorDia: insere notificacao para admin/TI
// ═══════════════════════════════════════════════════════════

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FonteBridge =
  | "armacao_codetapa15"
  | "ingestao_entregas"
  | "ingestao_aniv"
  | "reconciliacao_vendas";

const FONTE_LABEL: Record<FonteBridge, string> = {
  armacao_codetapa15:    "Régua aguardando armação (OS etapa 15)",
  ingestao_entregas:     "Ingestão pós-venda (entregas)",
  ingestao_aniv:         "Ingestão pós-venda (aniversários)",
  reconciliacao_vendas:  "Reconciliação de vendas (cashback D+1)",
};

export async function pingBridge(
  bridgeUrl: string,
  serviceSecret: string,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${bridgeUrl.replace(/\/$/, "")}/health`;
    const r = await fetch(url, {
      headers: { "x-service-key": serviceSecret },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (r.ok) return { ok: true, status: r.status };
    return { ok: false, status: r.status, error: `HTTP ${r.status}` };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Datas (YYYY-MM-DD) nos últimos N dias para `fonte` que NÃO têm linha status='ok'. Ordem asc. */
export async function listarGaps(
  supabase: SupabaseClient,
  fonte: FonteBridge,
  diasAtras: number,
  hojeRefSP: Date,
): Promise<string[]> {
  const todas: string[] = [];
  for (let i = diasAtras; i >= 1; i--) {
    const d = new Date(hojeRefSP);
    d.setDate(d.getDate() - i);
    todas.push(isoDate(d));
  }
  const desde = todas[0];
  const ate   = todas[todas.length - 1];

  const { data, error } = await supabase
    .from("bridge_sync_log")
    .select("data_alvo, status")
    .eq("fonte", fonte)
    .gte("data_alvo", desde)
    .lte("data_alvo", ate);
  if (error) {
    console.error(`[bridge-health] listarGaps ${fonte} erro:`, error.message);
    return todas; // melhor reprocessar tudo do que perder
  }
  const okSet = new Set(
    (data ?? [])
      .filter((r: { status: string }) => r.status === "ok" || r.status === "vazio")
      .map((r: { data_alvo: string }) => r.data_alvo),
  );
  return todas.filter((d) => !okSet.has(d));
}

/**
 * Janela de catch-up dinâmica: dias desde a última sincronização `ok|vazio`.
 * - Se nunca houve `ok`, devolve `maxCap` (default 30).
 * - Se houve `ok` hoje ou ontem, devolve no mínimo `minFloor` (default 1).
 * - Caso contrário, devolve `min(dias_desde_ultimo_ok, maxCap)`.
 * Use para alimentar `listarGaps(..., janela, hoje)`.
 */
export async function janelaCatchupDinamica(
  supabase: SupabaseClient,
  fonte: FonteBridge,
  hojeRefSP: Date,
  opts: { maxCap?: number; minFloor?: number } = {},
): Promise<number> {
  const maxCap = opts.maxCap ?? 30;
  const minFloor = opts.minFloor ?? 1;
  const { data, error } = await supabase
    .from("bridge_sync_log")
    .select("data_alvo")
    .eq("fonte", fonte)
    .in("status", ["ok", "vazio"])
    .order("data_alvo", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return maxCap;
  const ultimo = new Date(`${data[0].data_alvo}T12:00:00`);
  const diffMs = hojeRefSP.getTime() - ultimo.getTime();
  const dias = Math.max(minFloor, Math.ceil(diffMs / 86_400_000));
  return Math.min(dias, maxCap);
}

export async function marcarSync(
  supabase: SupabaseClient,
  args: {
    fonte: FonteBridge;
    data_alvo: string; // YYYY-MM-DD
    status: "ok" | "bridge_down" | "parcial" | "vazio";
    linhas_recebidas?: number;
    erro_msg?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  const { error } = await supabase
    .from("bridge_sync_log")
    .upsert(
      {
        fonte: args.fonte,
        data_alvo: args.data_alvo,
        status: args.status,
        linhas_recebidas: args.linhas_recebidas ?? 0,
        erro_msg: args.erro_msg ?? null,
        payload: args.payload ?? {},
        executado_at: new Date().toISOString(),
      },
      { onConflict: "fonte,data_alvo" },
    );
  if (error) console.error(`[bridge-health] marcarSync erro:`, error.message);
}

/** Notifica admins UMA vez por dia que a bridge está fora. */
export async function notificarAdminBridgeDown(
  supabase: SupabaseClient,
  fonte: FonteBridge,
  detalhe: string,
) {
  const hoje = isoDate(hojeSP());
  const chave = `bridge_down:${fonte}:${hoje}`;

  // dedup: já existe notificacao com mesma chave hoje?
  const { data: existente } = await supabase
    .from("notificacoes")
    .select("id")
    .eq("link", `/configuracoes/bridge-saude?key=${chave}`)
    .gte("created_at", `${hoje}T00:00:00Z`)
    .limit(1)
    .maybeSingle();
  if (existente) return;

  // destinatários: admins
  const { data: admins } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  const rows = (admins ?? []).map((a: { user_id: string }) => ({
    user_id: a.user_id,
    tipo: "sistema",
    titulo: "Bridge Firebird fora do ar",
    mensagem: `Falha em ${FONTE_LABEL[fonte]} — ${detalhe}. As datas pendentes serão reprocessadas automaticamente quando a bridge voltar.`,
    link: `/configuracoes/bridge-saude?key=${chave}`,
    lida: false,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("notificacoes").insert(rows);
  if (error) console.error("[bridge-health] notificarAdmin erro:", error.message);
}

// ── helpers ────────────────────────────────────────────────
export function hojeSP(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
  );
}
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
