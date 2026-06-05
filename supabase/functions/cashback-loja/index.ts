// cashback-loja — backend do cashback de balcão para o app InFoco Messenger
// Auth via JWT da loja (Bearer token). NÃO recria lógica de dinheiro — chama RPCs validadas.
// Ações: "consultar" (saldo do cliente) e "registrar" (registrar venda + uso de cashback).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve contato por telefone (com/sem prefixo 55), depois documento, depois metadata->>'cpf'.
// Porta o helper do bot-lojas adaptado para cpf e telefone separados.
async function resolverContato(
  supabase: ReturnType<typeof createClient>,
  cpf?: string | null,
  telefone?: string | null,
): Promise<{ id: string; nome: string } | null> {
  if (telefone) {
    const digits = telefone.replace(/\D/g, "");
    const phones = new Set([digits]);
    if (digits.startsWith("55") && digits.length > 11) phones.add(digits.slice(2));
    else if (digits.length <= 11) phones.add("55" + digits);
    for (const phone of phones) {
      const { data } = await supabase
        .from("contatos")
        .select("id, nome")
        .eq("telefone", phone)
        .maybeSingle();
      if (data) return data as { id: string; nome: string };
    }
  }
  if (cpf) {
    const digits = cpf.replace(/\D/g, "");
    if (digits.length >= 11) {
      const { data } = await supabase
        .from("contatos")
        .select("id, nome")
        .eq("documento", digits)
        .maybeSingle();
      if (data) return data as { id: string; nome: string };
    }
    const { data } = await supabase
      .from("contatos")
      .select("id, nome")
      .eq("metadata->>cpf", digits)
      .maybeSingle();
    if (data) return data as { id: string; nome: string };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth ──
    const auth  = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "").trim();

    // Client admin: bypassa RLS, sem identidade (auth.uid() = null).
    // Usado para validar JWT, leituras e inserts que NÃO dependem de auth.uid().
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Client autenticado como a loja: service-role + Authorization do usuário.
    // auth.uid() = user.id dentro das RPCs (necessário p/ regua_registrar_venda).
    const supabaseAsUser = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const supabase = supabaseAdmin; // alias para manter o resto do arquivo intacto

    const { data: userData } = await supabaseAdmin.auth.getUser(token);
    const user = userData?.user;
    if (!user) return jsonResp({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, nome, tipo_usuario")
      .eq("id", user.id)
      .single();
    if (!profile || !["loja", "colaborador"].includes(profile.tipo_usuario)) {
      return jsonResp({ error: "Apenas usuários loja/colaborador podem usar cashback de balcão" }, 403);
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("loja_nome")
      .eq("user_id", user.id)
      .not("loja_nome", "is", null)
      .limit(1)
      .maybeSingle();
    const nomeLoja = (roleRow as any)?.loja_nome || "";
    if (!nomeLoja) {
      return jsonResp({ error: "Loja não identificada para o usuário" }, 400);
    }

    // cod_empresa via telefones_lojas
    const { data: telRow } = await supabase
      .from("telefones_lojas")
      .select("cod_empresa")
      .ilike("nome_loja", `%${nomeLoja}%`)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();
    const codEmpresa: string = (telRow as any)?.cod_empresa || "";

    // ── Body ──
    const body   = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // ══════════════════════════════════════════════
    // AÇÃO: consultar
    // ══════════════════════════════════════════════
    if (action === "consultar") {
      const contato = await resolverContato(supabase, body.cpf, body.telefone);
      if (!contato) return jsonResp({ status: "nao_encontrado" });

      const [{ data: saldo }, { data: cfgRow }] = await Promise.all([
        supabase.rpc("cashback_consultar_saldo", { _contato_id: contato.id }),
        supabase
          .from("cashback_config")
          .select("fator_resgate")
          .order("atualizado_em", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const s = saldo as any;
      return jsonResp({
        status:            "ok",
        cliente:           { id: contato.id, nome: contato.nome },
        estado_geral:       s?.estado_geral       ?? "nenhum",
        saldo_usavel:       Number(s?.saldo_usavel       ?? 0),
        saldo_em_carencia:  Number(s?.saldo_em_carencia  ?? 0),
        proximo_vencimento: s?.proximo_vencimento ?? null,
        proxima_liberacao:  s?.proxima_liberacao  ?? null,
        total_usado:        Number(s?.total_usado         ?? 0),
        fator_resgate:      Number((cfgRow as any)?.fator_resgate ?? 3),
      });
    }

    // ══════════════════════════════════════════════
    // AÇÃO: registrar
    // ══════════════════════════════════════════════
    if (action === "registrar") {
      const { cpf, telefone, nome, numero_venda, valor_informado, cashback_usado } = body;

      if (!numero_venda || valor_informado == null || cashback_usado == null) {
        return jsonResp({ error: "numero_venda, valor_informado e cashback_usado são obrigatórios" }, 400);
      }
      if (!cpf && !telefone) {
        return jsonResp({ error: "Informe CPF ou telefone para identificar o cliente" }, 400);
      }

      // Resolve ou cria contato mínimo
      let contato = await resolverContato(supabase, cpf, telefone);
      if (!contato) {
        const cpfDigits = cpf ? cpf.replace(/\D/g, "") : null;
        const telDigits = telefone ? telefone.replace(/\D/g, "") : null;
        // Normaliza telefone: adiciona 55 se necessário
        const telNorm = telDigits
          ? (telDigits.startsWith("55") && telDigits.length > 11
              ? telDigits
              : telDigits.length <= 11 ? "55" + telDigits : telDigits)
          : null;

        const { data: novo, error: cErr } = await supabase
          .from("contatos")
          .insert({
            nome:      nome || "Cliente",
            telefone:  telNorm,
            documento: cpfDigits,
            tipo:      "cliente",
            metadata:  cpfDigits ? { cpf: cpfDigits } : {},
          })
          .select("id, nome")
          .single();
        if (cErr || !novo) {
          return jsonResp({ error: "Erro ao criar contato: " + (cErr?.message ?? "desconhecido") }, 500);
        }
        contato = novo as { id: string; nome: string };
      }

      // Lê saldo + fator_resgate ANTES da RPC para mapear erros com max_desconto
      const [{ data: saldoPre }, { data: cfgRowReg }] = await Promise.all([
        supabase.rpc("cashback_consultar_saldo", { _contato_id: contato.id }),
        supabase
          .from("cashback_config")
          .select("fator_resgate")
          .order("atualizado_em", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const saldoDisp    = Number((saldoPre as any)?.saldo_usavel ?? 0);
      const fatorResgate = Number((cfgRowReg as any)?.fator_resgate ?? 3);

      // Chama a RPC de resgate USANDO o client autenticado, para propagar auth.uid().
      const { data: resgate, error: errResgate } = await supabaseAsUser.rpc(
        "cashback_registrar_resgate",
        {
          _contato_id:         contato.id,
          _numero_venda:       String(numero_venda),
          _valor_informado:    Number(valor_informado),
          _cashback_usado:     Number(cashback_usado),
          _cod_empresa:        codEmpresa || null,
          _usuario_lancamento: user.id,
        },
      );

      if (errResgate) {
        const msg = errResgate.message ?? "";
        console.warn(`[cashback-loja] RPC erro contato=${contato.id} venda=${numero_venda}: ${msg}`);

        if (msg.includes("trava_3x")) {
          const maxDesconto = Math.floor(
            Math.min(saldoDisp, Number(valor_informado) / fatorResgate) * 100,
          ) / 100;
          return jsonResp({
            status:        "erro",
            motivo:        "trava_3x",
            mensagem:      `A compra precisa ser de pelo menos ${fatorResgate}× o cashback usado.`,
            max_desconto:  maxDesconto,
            fator_resgate: fatorResgate,
          });
        }
        if (msg.includes("saldo_insuficiente")) {
          return jsonResp({
            status:           "erro",
            motivo:           "saldo_insuficiente",
            saldo_disponivel: saldoDisp,
            mensagem:         `Saldo disponível insuficiente (R$ ${saldoDisp.toFixed(2)}).`,
          });
        }
        if (msg.includes("valor_invalido")) {
          return jsonResp({ status: "erro", motivo: "valor_invalido", mensagem: "Valor informado inválido." });
        }
        return jsonResp({ status: "erro", motivo: "desconhecido", mensagem: msg });
      }

      const r = resgate as any;

      // Loga evento CRM
      await supabase.from("eventos_crm").insert({
        contato_id:      contato.id,
        tipo:            "cashback_resgate_balcao",
        descricao:       `Cashback registrado no balcão — venda ${numero_venda} na loja ${nomeLoja}`,
        metadata: {
          numero_venda,
          valor_informado,
          cashback_usado,
          loja:           nomeLoja,
          cod_empresa:    codEmpresa,
          usuario_id:     user.id,
          ja_processado:  r?.ja_existia_inscricao ?? false,
          credito_gerado: r?.credito_gerado ?? null,
        },
        referencia_tipo: "contato",
        referencia_id:   contato.id,
      });

      console.log(
        `[cashback-loja] OK contato=${contato.id} venda=${numero_venda} ` +
        `cashback_usado=${cashback_usado} ja_processado=${r?.ja_existia_inscricao}`,
      );

      return jsonResp({
        status:         "ok",
        cliente:        { id: contato.id, nome: contato.nome },
        ja_processado:  r?.ja_existia_inscricao ?? false,
        credito_gerado: r?.credito_gerado ?? null,
        saldo_atual:    Number(r?.saldo_total_atual ?? 0),
      });
    }

    return jsonResp(
      { error: `Ação desconhecida: "${action}". Use "consultar" ou "registrar".` },
      400,
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cashback-loja] Erro inesperado:", msg);
    return jsonResp({ error: "Erro interno" }, 500);
  }
});
