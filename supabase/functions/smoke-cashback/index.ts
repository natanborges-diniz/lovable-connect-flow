import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── a) Pega 1 contato e 1 cod_empresa válidos ──────────────
  const { data: contatoRow, error: errContato } = await supabase
    .from("contatos")
    .select("id")
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();

  const { data: empresaRow } = await supabase
    .from("regua_inscricao")
    .select("cod_empresa")
    .not("cod_empresa", "is", null)
    .limit(1)
    .maybeSingle();

  const contato_id  = contatoRow?.id ?? null;
  const cod_empresa = String(empresaRow?.cod_empresa ?? "1");

  if (!contato_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "Nenhum contato ativo encontrado", errContato }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── b) cashback_registrar_resgate ──────────────────────────
  const { data: resgate, error: errResgate } = await supabase.rpc(
    "cashback_registrar_resgate",
    {
      p_contato_id:    contato_id,
      p_numero_venda:  "SMOKETEST1",
      p_valor_total:   100,
      p_valor_desconto: 0,
      p_cod_empresa:   cod_empresa,
      p_cpf:           null,
    },
  );

  // ── c) cashback_consultar_saldo ────────────────────────────
  const { data: consulta, error: errConsulta } = await supabase.rpc(
    "cashback_consultar_saldo",
    { p_contato_id: contato_id },
  );

  // ── d) Limpeza ─────────────────────────────────────────────
  let limpeza_ok   = true;
  const erros_limpeza: string[] = [];

  const inscricao_id = (resgate as any)?.inscricao_id ?? null;

  if (inscricao_id) {
    const { error: eCred } = await supabase
      .from("cashback_credito")
      .delete()
      .eq("inscricao_id", inscricao_id);
    if (eCred) { limpeza_ok = false; erros_limpeza.push("cashback_credito: " + eCred.message); }
  }

  const { error: eInsc } = await supabase
    .from("regua_inscricao")
    .delete()
    .eq("numero_venda", "SMOKETEST1");
  if (eInsc) { limpeza_ok = false; erros_limpeza.push("regua_inscricao: " + eInsc.message); }

  // ── e) Resultado ───────────────────────────────────────────
  return new Response(
    JSON.stringify({
      contato_id,
      cod_empresa,
      resgate,
      resgate_error:  errResgate  ? { message: errResgate.message,  details: (errResgate as any).details  } : null,
      consulta,
      consulta_error: errConsulta ? { message: errConsulta.message, details: (errConsulta as any).details } : null,
      limpeza_ok,
      erros_limpeza:  erros_limpeza.length ? erros_limpeza : null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
