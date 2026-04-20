// CANAL ÚNICO: B2B com lojas/colaboradores agora roda 100% pelo app Atrium Messenger
// (mensagens_internas + notificacoes). NENHUMA mensagem WhatsApp é disparada.
// A conversa entre operador e loja usa conversa_id = 'demanda_<id>' (broadcast 1:N).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { atendimento_id, loja_telefone, loja_nome, pergunta } = await req.json();
    if (!atendimento_id || !loja_telefone || !loja_nome || !pergunta) {
      return new Response(JSON.stringify({ error: "atendimento_id, loja_telefone, loja_nome and pergunta are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: atendimento, error: atErr } = await supabase
      .from("atendimentos")
      .select("id, contato_id, modo, contatos(nome)")
      .eq("id", atendimento_id)
      .single();
    if (atErr || !atendimento) throw new Error("Atendimento não encontrado");

    if ((atendimento as any).modo !== "humano") {
      return new Response(JSON.stringify({ error: "Demandas só podem ser abertas em modo humano" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles").select("nome").eq("id", user.id).single();
    const operadorNome = profile?.nome || user.email || "Operador";
    const clienteNome = (atendimento as any).contatos?.nome || "Cliente";

    const ano = new Date().getFullYear();

    // Cria demanda
    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .insert({
        protocolo: `DEM-${ano}-PENDING`,
        atendimento_cliente_id: atendimento_id,
        contato_cliente_id: (atendimento as any).contato_id,
        loja_telefone,
        loja_nome,
        solicitante_id: user.id,
        solicitante_nome: operadorNome,
        pergunta,
        status: "aberta",
      })
      .select()
      .single();
    if (demErr) throw demErr;

    const protocolo = `DEM-${ano}-${String(demanda.numero_curto).padStart(5, "0")}`;
    await supabase.from("demandas_loja").update({ protocolo }).eq("id", demanda.id);

    // Mensagem inicial direto na thread oficial (fonte de verdade do painel)
    await supabase.from("demanda_mensagens").insert({
      demanda_id: demanda.id,
      direcao: "operador_para_loja",
      autor_id: user.id,
      autor_nome: operadorNome,
      conteudo: pergunta,
      metadata: { bootstrap: true },
    });

    // Resolve destinatários internos (app Atrium Messenger)
    const { data: destinatarios } = await supabase
      .rpc("resolver_destinatarios_loja", { _loja_nome: loja_nome });

    const dests = (destinatarios || []) as Array<{ user_id: string; setor_id: string | null }>;
    console.log(`[criar-demanda-loja] Demanda ${protocolo} → ${dests.length} destinatário(s) interno(s)`);

    // Conversa-demanda: mesma conversa_id para todos os destinatários (broadcast)
    const conversa_id = `demanda_${demanda.id}`;
    const titulo = `Nova demanda ${protocolo} (${loja_nome})`;
    const corpoChat = `📌 *${protocolo}* — ${loja_nome}\nCliente: ${clienteNome}\n\n${pergunta}\n\n_Responda aqui ou envie /encerrar para fechar._`;

    for (const d of dests) {
      // Notificação push-friendly
      await supabase.from("notificacoes").insert({
        usuario_id: d.user_id,
        setor_id: d.setor_id,
        tipo: "demanda_loja",
        titulo,
        mensagem: `${operadorNome} sobre cliente ${clienteNome}: ${pergunta}`,
        referencia_id: demanda.id,
      });

      // Mensagem interna na conversa-demanda (broadcast). O bridge ignora pois o conteúdo
      // contém o protocolo + a pergunta original (heurística de bootstrap).
      await supabase.from("mensagens_internas").insert({
        remetente_id: user.id,
        destinatario_id: d.user_id,
        conversa_id,
        conteudo: corpoChat,
      });
    }

    if (dests.length === 0) {
      console.warn(`[criar-demanda-loja] Nenhum destinatário interno para "${loja_nome}".`);
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demanda.id,
        direcao: "sistema",
        autor_nome: "Sistema",
        conteudo: `⚠️ Loja "${loja_nome}" sem usuários internos vinculados no app Atrium Messenger. Cadastre em Configurações → Lojas / Usuários.`,
      });
    }

    return new Response(JSON.stringify({
      status: "ok",
      demanda_id: demanda.id,
      protocolo,
      numero_curto: demanda.numero_curto,
      destinatarios_internos: dests.length,
      conversa_id,
      canal: "app_atrium_messenger",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("criar-demanda-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
