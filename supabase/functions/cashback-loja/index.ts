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

    // ══════════════════════════════════════════════
    // AÇÕES DE PIN — validação do telefone + LGPD
    // ══════════════════════════════════════════════
    const TERMOS_VERSAO = "v1-2026-06";

    async function hashPin(pin: string, salt: string): Promise<string> {
      const data = new TextEncoder().encode(`${salt}:${pin}`);
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    function gerarPinRandomico(): string {
      return String(Math.floor(1000 + Math.random() * 9000));
    }

    if (action === "gerar_pin" || action === "reenviar_pin") {
      const inscricao_id = String(body.inscricao_id || "");
      if (!inscricao_id) return jsonResp({ error: "inscricao_id obrigatório" }, 400);

      const { data: insc } = await supabase
        .from("regua_inscricao")
        .select("id, contato_id, whatsapp, nome_cliente, pin_confirmado_at")
        .eq("id", inscricao_id)
        .maybeSingle();
      if (!insc) return jsonResp({ error: "inscricao não encontrada" }, 404);
      if ((insc as any).pin_confirmado_at) return jsonResp({ status: "ja_confirmado" });

      const pin = gerarPinRandomico();
      const pin_hash = await hashPin(pin, inscricao_id);
      const expira = new Date(Date.now() + 15 * 60_000).toISOString();

      await supabase
        .from("regua_inscricao")
        .update({ pin_hash, pin_expira_at: expira, pin_tentativas: 0 })
        .eq("id", inscricao_id);

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({
            contato_id: (insc as any).contato_id,
            template_alias: "cashback_pin_validacao",
            template_params: [pin],
          }),
        });
      } catch (e) {
        console.warn("[cashback-loja] falha ao disparar template PIN:", e);
      }

      return jsonResp({ status: "pin_enviado", expira_at: expira });
    }

    if (action === "confirmar_pin") {
      const inscricao_id = String(body.inscricao_id || "");
      const pin_informado = String(body.pin || "").replace(/\D/g, "");
      if (!inscricao_id || pin_informado.length !== 4) {
        return jsonResp({ error: "inscricao_id e pin (4 dígitos) obrigatórios" }, 400);
      }

      const { data: insc } = await supabase
        .from("regua_inscricao")
        .select("id, contato_id, whatsapp, pin_hash, pin_expira_at, pin_tentativas, pin_confirmado_at")
        .eq("id", inscricao_id)
        .maybeSingle();
      if (!insc) return jsonResp({ error: "inscricao não encontrada" }, 404);
      const i = insc as any;
      if (i.pin_confirmado_at) return jsonResp({ status: "ja_confirmado" });
      if (!i.pin_hash) return jsonResp({ status: "erro", motivo: "pin_nao_gerado" }, 400);
      if (i.pin_expira_at && new Date(i.pin_expira_at) < new Date()) {
        return jsonResp({ status: "erro", motivo: "pin_expirado" }, 410);
      }
      if ((i.pin_tentativas ?? 0) >= 3) {
        return jsonResp({ status: "erro", motivo: "tentativas_excedidas" }, 429);
      }

      const hash = await hashPin(pin_informado, inscricao_id);
      if (hash !== i.pin_hash) {
        await supabase.from("regua_inscricao")
          .update({ pin_tentativas: (i.pin_tentativas ?? 0) + 1 })
          .eq("id", inscricao_id);
        return jsonResp({
          status: "erro",
          motivo: "pin_incorreto",
          tentativas_restantes: Math.max(0, 2 - (i.pin_tentativas ?? 0)),
        }, 400);
      }

      const xff = req.headers.get("x-forwarded-for") || "";
      const ip = xff.split(",")[0].trim() || null;

      await supabase.from("regua_inscricao").update({
        pin_confirmado_at: new Date().toISOString(),
        consentimento_status: "aceito",
        consentimento_at: new Date().toISOString(),
        canal_consentimento: "pin_whatsapp",
        termos_versao: TERMOS_VERSAO,
        ip_origem_consultor: ip,
      }).eq("id", inscricao_id);

      if (i.whatsapp) {
        await supabase.rpc("canal_registrar_evento", {
          _telefone: String(i.whatsapp),
          _evento: "validado",
          _motivo: null,
          _canal_consentimento: "pin_whatsapp",
          _termos_versao: TERMOS_VERSAO,
        });
      }

      if (i.contato_id) {
        await supabase.from("eventos_crm").insert({
          contato_id: i.contato_id,
          tipo: "cashback_pin_confirmado",
          descricao: "Cliente confirmou PIN — telefone validado, termos LGPD aceitos",
          metadata: { inscricao_id, termos_versao: TERMOS_VERSAO, ip },
          referencia_tipo: "regua_inscricao",
          referencia_id: inscricao_id,
        });
      }

      return jsonResp({ status: "validado", termos_versao: TERMOS_VERSAO });
    }

    return jsonResp(
      { error: `Ação desconhecida: "${action}". Use "consultar" | "registrar" | "gerar_pin" | "confirmar_pin" | "reenviar_pin".` },
      400,
    );

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cashback-loja] Erro inesperado:", msg);
    return jsonResp({ error: "Erro interno" }, 500);
  }
});
