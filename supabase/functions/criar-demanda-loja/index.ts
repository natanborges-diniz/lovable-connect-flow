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

    // ── Service-call bypass: chamadas internas (reconciliação, crons) ──
    // Header x-service-call:1 + Authorization Bearer <SERVICE_ROLE_KEY> pula auth de usuário.
    // solicitante_id fica NULL e solicitante_nome vem do body (default "Sistema").
    const isServiceCall = req.headers.get("x-service-call") === "1";
    let user: { id: string; email?: string } | null = null;
    {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (isServiceCall) {
        if (token !== SUPABASE_SERVICE_ROLE_KEY) {
          return new Response(JSON.stringify({ error: "Service call requires service role token" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { data: userData } = await supabase.auth.getUser(token);
        user = userData?.user ?? null;
        if (!user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const body = await req.json();
    const { atendimento_id, pergunta, assunto } = body;
    // Anexo opcional já uploadado em mensagens-anexos; URL pública + mime
    const anexo_url: string | null = body.anexo_url || null;
    const anexo_mime: string | null = body.anexo_mime || null;
    // Modo loja única: loja_telefone + loja_nome
    // Modo grupo: lojas: [{nome_loja, telefone}, ...] (snapshot)
    const lojasGrupo: Array<{ nome_loja: string; telefone: string }> | undefined = body.lojas;
    const isGrupo = Array.isArray(lojasGrupo) && lojasGrupo.length > 0;
    const loja_telefone: string = isGrupo ? "__GRUPO__" : body.loja_telefone;
    const loja_nome: string = isGrupo ? "__GRUPO__" : body.loja_nome;
    const tipo_chave_body: string | null = body.tipo_chave ?? null;
    const metadata_body: Record<string, unknown> = (body.metadata && typeof body.metadata === "object") ? body.metadata : {};

    if (!pergunta || (!isGrupo && (!loja_telefone || !loja_nome))) {
      return new Response(JSON.stringify({ error: "pergunta e (loja_telefone+loja_nome ou lojas[]) são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // atendimento_id é opcional (pode abrir demanda avulsa pelo botão global em /demandas)
    let atendimento: any = null;
    if (atendimento_id) {
      const { data: at, error: atErr } = await supabase
        .from("atendimentos")
        .select("id, contato_id, modo, contatos(nome)")
        .eq("id", atendimento_id)
        .single();
      if (atErr || !at) throw new Error("Atendimento não encontrado");
      if (!isServiceCall && (at as any).modo !== "humano") {
        return new Response(JSON.stringify({ error: "Demandas vinculadas a atendimento exigem modo humano" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      atendimento = at;
    }

    let operadorNome: string = (body.solicitante_nome as string) || "Sistema";
    if (user) {
      const { data: profile } = await supabase
        .from("profiles").select("nome").eq("id", user.id).single();
      operadorNome = profile?.nome || user.email || "Operador";
    }
    const clienteNome = atendimento?.contatos?.nome || null;

    const ano = new Date().getFullYear();

    // Cria demanda (loja única ou grupo com snapshot)
    const demandaMetadata: Record<string, unknown> = {
      ...(isGrupo
        ? {
            grupo: true,
            lojas_nomes: lojasGrupo!.map((l) => l.nome_loja),
            lojas_telefones: lojasGrupo!.map((l) => l.telefone),
            snapshot_at: new Date().toISOString(),
          }
        : {}),
      ...metadata_body,
      ...(tipo_chave_body ? { tipo_chave: tipo_chave_body } : {}),
    };

    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .insert({
        protocolo: `DEM-${ano}-PENDING`,
        atendimento_cliente_id: atendimento_id ?? null,
        contato_cliente_id: atendimento?.contato_id ?? null,
        loja_telefone,
        loja_nome,
        solicitante_id: user?.id ?? null,
        solicitante_nome: operadorNome,
        assunto: assunto ?? null,
        pergunta,
        status: "aberta",
        ...(tipo_chave_body ? { tipo_chave: tipo_chave_body } : {}),
        metadata: demandaMetadata,
      })
      .select()
      .single();
    if (demErr) throw demErr;


    const protocolo = `DEM-${ano}-${String(demanda.numero_curto).padStart(5, "0")}`;
    await supabase.from("demandas_loja").update({ protocolo }).eq("id", demanda.id);

    // Mensagem inicial direto na thread oficial (fonte de verdade do painel)
    await supabase.from("demanda_mensagens").insert({
      demanda_id: demanda.id,
      direcao: isServiceCall ? "sistema" : "operador_para_loja",
      autor_id: user?.id ?? null,
      autor_nome: operadorNome,
      conteudo: pergunta,
      anexo_url: anexo_url,
      anexo_mime: anexo_mime,
      metadata: { bootstrap: true, ...(isServiceCall ? { origem: "service" } : {}) },
    });


    // Resolve destinatários internos (app Atrium Messenger)
    // Em modo grupo, união dos usuários de todas as lojas do snapshot
    const lojasDestino: string[] = isGrupo
      ? lojasGrupo!.map((l) => l.nome_loja)
      : [loja_nome];

    const destSet = new Map<string, { user_id: string; setor_id: string | null }>();
    for (const ln of lojasDestino) {
      const { data } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: ln });
      for (const d of (data || []) as Array<{ user_id: string; setor_id: string | null }>) {
        if (!destSet.has(d.user_id)) destSet.set(d.user_id, d);
      }
    }
    const dests = Array.from(destSet.values());
    console.log(`[criar-demanda-loja] Demanda ${protocolo} (${isGrupo ? "GRUPO " + lojasDestino.length + " lojas" : loja_nome}) → ${dests.length} destinatário(s)`);

    // Conversa-demanda: mesma conversa_id para todos os destinatários (broadcast)
    const conversa_id = `demanda_${demanda.id}`;
    const headerLoja = isGrupo ? `Grupo (${lojasDestino.length} lojas)` : loja_nome;
    const titulo = `Nova demanda ${protocolo} (${headerLoja})`;
    const linhaCliente = clienteNome ? `Cliente: ${clienteNome}\n` : "";
    const corpoChat = `📌 *${protocolo}* — ${headerLoja}\n${linhaCliente}\n${pergunta}${anexo_url ? `\n\n📎 ${anexo_url}` : ""}\n\n_Responda aqui ou envie /encerrar para fechar._`;
    const resumoCliente = clienteNome ? `${operadorNome} sobre cliente ${clienteNome}: ${pergunta}` : `${operadorNome}: ${pergunta}`;

    for (const d of dests) {
      await supabase.from("notificacoes").insert({
        usuario_id: d.user_id,
        setor_id: d.setor_id,
        tipo: "demanda_loja",
        titulo,
        mensagem: resumoCliente,
        referencia_id: demanda.id,
      });

      await supabase.from("mensagens_internas").insert({
        remetente_id: user.id,
        destinatario_id: d.user_id,
        conversa_id,
        conteudo: corpoChat,
        anexo_url: anexo_url,
        anexo_tipo: anexo_mime,
      });
    }

    if (dests.length === 0) {
      console.warn(`[criar-demanda-loja] Nenhum destinatário interno para "${headerLoja}".`);
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demanda.id,
        direcao: "sistema",
        autor_nome: "Sistema",
        conteudo: `⚠️ ${headerLoja} sem usuários internos vinculados no app InFoco Messenger. Cadastre em Configurações → Lojas / Usuários.`,
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
