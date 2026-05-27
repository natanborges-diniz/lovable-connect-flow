// Cria 1 card de "Confirmação de peça em estoque" por loja e gera a demanda
// no canal Atrium Messenger (reusa criar-demanda-loja).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LojaSchema = z.object({
  nome_loja: z.string().min(1),
  telefone: z.string().optional().nullable(),
});

const BodySchema = z.object({
  referencia: z.string().trim().min(1).max(80),
  codigo_produto: z.string().trim().min(1).max(80),
  descricao_peca: z.string().trim().max(300).optional().nullable(),
  observacao_estoque: z.string().trim().max(500).optional().nullable(),
  foto_url: z.string().url().optional().nullable(),
  lojas: z.array(LojaSchema).min(1),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SRK);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    // Coluna inicial "Aguardando loja" do setor
    const SETOR_ID = "0e7b7572-4581-4e74-88eb-afca41ab71cf";
    const { data: coluna } = await supabase
      .from("pipeline_colunas")
      .select("id")
      .eq("setor_id", SETOR_ID)
      .eq("tipo_acao", "confirmacao_estoque_pendente")
      .maybeSingle();
    if (!coluna) throw new Error("Coluna 'Aguardando loja' não encontrada");

    const { data: profile } = await supabase
      .from("profiles").select("nome").eq("id", user.id).maybeSingle();
    const solicitanteNome = profile?.nome || user.email || "Estoque";

    const ano = new Date().getFullYear();
    const results: Array<Record<string, unknown>> = [];

    for (const loja of body.lojas) {
      // 1) Cria card
      const { data: card, error: cardErr } = await supabase
        .from("confirmacoes_estoque")
        .insert({
          protocolo: `CEA-${ano}-PENDING`,
          referencia: body.referencia,
          codigo_produto: body.codigo_produto,
          descricao_peca: body.descricao_peca ?? null,
          foto_url: body.foto_url ?? null,
          observacao_estoque: body.observacao_estoque ?? null,
          loja_nome: loja.nome_loja,
          loja_telefone: loja.telefone ?? null,
          pipeline_coluna_id: coluna.id,
          status: "aguardando",
          solicitante_id: user.id,
          solicitante_nome: solicitanteNome,
          proximo_lembrete_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        .select()
        .single();
      if (cardErr) throw cardErr;
      const protocolo = `CEA-${ano}-${String(card.numero_curto).padStart(5, "0")}`;
      await supabase.from("confirmacoes_estoque").update({ protocolo }).eq("id", card.id);

      // 2) Cria demanda no canal Atrium (loja única). Reusa lógica de broadcast.
      const pergunta = [
        `🔎 *Confirmação de peça em estoque* — ${protocolo}`,
        ``,
        `*Referência:* ${body.referencia}`,
        `*Código:* ${body.codigo_produto}`,
        body.descricao_peca ? `*Descrição:* ${body.descricao_peca}` : null,
        body.observacao_estoque ? `\n📝 ${body.observacao_estoque}` : null,
        ``,
        `Por favor, confirme abaixo se a peça está disponível na loja.`,
        `Use os botões *✅ Tenho a peça* ou *❌ Não tenho* (campo de observação opcional).`,
      ].filter(Boolean).join("\n");

      const demandaRes = await fetch(`${SUPABASE_URL}/functions/v1/criar-demanda-loja`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader, // mantém o user JWT pra criar-demanda-loja aceitar
        },
        body: JSON.stringify({
          loja_nome: loja.nome_loja,
          loja_telefone: loja.telefone ?? "__INTERNO__",
          pergunta,
          assunto: `Confirmação de peça — REF ${body.referencia} • COD ${body.codigo_produto}`,
          anexo_url: body.foto_url ?? null,
          anexo_mime: body.foto_url ? "image/jpeg" : null,
        }),
      });
      const demandaJson = await demandaRes.json();
      if (!demandaRes.ok) throw new Error("Falha criar-demanda-loja: " + (demandaJson?.error || demandaRes.status));

      // 3) Marca tipo_chave + metadata na demanda para a UI da loja renderizar os botões
      await supabase.from("demandas_loja").update({
        tipo_chave: "confirmacao_estoque",
        setor_destino_id: SETOR_ID,
        metadata: {
          tipo_chave: "confirmacao_estoque",
          confirmacao_estoque_id: card.id,
          confirmacao_protocolo: protocolo,
          referencia: body.referencia,
          codigo_produto: body.codigo_produto,
          descricao_peca: body.descricao_peca,
          foto_url: body.foto_url,
        },
      }).eq("id", demandaJson.demanda_id);

      // 4) Vincula demanda ao card
      await supabase.from("confirmacoes_estoque")
        .update({ demanda_id: demandaJson.demanda_id })
        .eq("id", card.id);

      results.push({
        confirmacao_id: card.id,
        protocolo,
        demanda_id: demandaJson.demanda_id,
        loja: loja.nome_loja,
        destinatarios_internos: demandaJson.destinatarios_internos ?? 0,
      });
    }

    return new Response(JSON.stringify({ status: "ok", cards: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[criar-confirmacao-estoque] error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
