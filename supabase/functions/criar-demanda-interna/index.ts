// Cria demanda interna (loja/colaborador → setor) a partir do wizard "Nova Demanda"
// no app InFoco Messenger. Sem vínculo com cliente final.
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
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tipo_chave, assunto, descricao, anexo_url, anexo_mime } = body as {
      tipo_chave: string;
      assunto: string;
      descricao: string;
      anexo_url?: string | null;
      anexo_mime?: string | null;
    };

    if (!tipo_chave || !assunto || !descricao) {
      return new Response(JSON.stringify({ error: "tipo_chave, assunto e descricao são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Profile do solicitante
    const { data: profile } = await supabase
      .from("profiles")
      .select("nome, tipo_usuario, setor_id")
      .eq("id", user.id)
      .single();

    if (!profile || !["loja", "colaborador", "admin"].includes(profile.tipo_usuario)) {
      return new Response(JSON.stringify({ error: "Apenas lojas e colaboradores podem abrir demandas internas." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Loja (nome/telefone) via user_roles
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("loja_nome")
      .eq("user_id", user.id)
      .not("loja_nome", "is", null)
      .limit(1)
      .maybeSingle();

    const lojaNome = roleRow?.loja_nome || profile.nome || "—";

    let lojaTelefone = "";
    if (roleRow?.loja_nome) {
      const { data: tl } = await supabase
        .from("telefones_lojas")
        .select("telefone")
        .ilike("nome_loja", roleRow.loja_nome)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      lojaTelefone = tl?.telefone || "";
    }

    // Resolve setor de destino: bot_menu_opcoes (folha) → sobe parents até achar setor_id;
    // fallback: bot_fluxos.setor_destino_id
    let setorDestinoId: string | null = null;

    const { data: menuLeaf } = await supabase
      .from("bot_menu_opcoes")
      .select("id, parent_id, setor_id, fluxo, titulo")
      .eq("chave", tipo_chave)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    let menuTitulo = menuLeaf?.titulo as string | undefined;

    if (menuLeaf) {
      setorDestinoId = menuLeaf.setor_id ?? null;
      let cursorParent = menuLeaf.parent_id as string | null;
      let safety = 0;
      while (!setorDestinoId && cursorParent && safety < 6) {
        const { data: parent } = await supabase
          .from("bot_menu_opcoes")
          .select("parent_id, setor_id")
          .eq("id", cursorParent)
          .maybeSingle();
        setorDestinoId = parent?.setor_id ?? null;
        cursorParent = parent?.parent_id ?? null;
        safety++;
      }
    }

    if (!setorDestinoId) {
      const { data: fluxo } = await supabase
        .from("bot_fluxos")
        .select("setor_destino_id, nome")
        .eq("chave", tipo_chave)
        .eq("ativo", true)
        .maybeSingle();
      setorDestinoId = fluxo?.setor_destino_id ?? null;
      if (!menuTitulo) menuTitulo = fluxo?.nome;
    }

    if (!setorDestinoId) {
      return new Response(JSON.stringify({ error: "Tipo de demanda sem setor configurado." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ano = new Date().getFullYear();
    const perguntaCompleta = `[${assunto}]\n\n${descricao}`;

    // Cria demanda
    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .insert({
        protocolo: `DEM-${ano}-PENDING`,
        loja_telefone: lojaTelefone,
        loja_nome: lojaNome,
        solicitante_id: user.id,
        solicitante_nome: profile.nome || user.email || "Usuário",
        pergunta: perguntaCompleta,
        status: "aberta",
        origem: "interna",
        tipo_chave,
        assunto,
        setor_destino_id: setorDestinoId,
        metadata: { menu_titulo: menuTitulo || tipo_chave },
      })
      .select()
      .single();
    if (demErr) throw demErr;

    const protocolo = `DEM-${ano}-${String(demanda.numero_curto).padStart(5, "0")}`;
    await supabase.from("demandas_loja").update({ protocolo }).eq("id", demanda.id);

    // Mensagem inicial na thread oficial
    await supabase.from("demanda_mensagens").insert({
      demanda_id: demanda.id,
      direcao: "loja_to_operador",
      autor_id: user.id,
      autor_nome: profile.nome || user.email,
      conteudo: perguntaCompleta,
      anexo_url: anexo_url ?? null,
      anexo_mime: anexo_mime ?? null,
      tipo_conteudo: anexo_url ? "anexo" : "text",
      metadata: { bootstrap: true, origem: "interna" },
    });

    // Destinatários: operadores ativos do setor de destino
    const { data: destProfiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("setor_id", setorDestinoId)
      .eq("ativo", true);

    const conversa_id = `demanda_${demanda.id}`;
    const titulo = `Nova demanda ${protocolo} — ${assunto}`;
    const corpoChat = `📌 *${protocolo}* — ${menuTitulo || tipo_chave}\nDe: ${lojaNome}\n\n*${assunto}*\n${descricao}\n\n_Responda aqui ou marque como resolvida._`;

    let entregues = 0;
    for (const d of (destProfiles || [])) {
      await supabase.from("notificacoes").insert({
        usuario_id: d.id,
        setor_id: setorDestinoId,
        tipo: "demanda_loja",
        titulo,
        mensagem: `${lojaNome}: ${assunto}`,
        referencia_id: demanda.id,
      });
      await supabase.from("mensagens_internas").insert({
        remetente_id: user.id,
        destinatario_id: d.id,
        conversa_id,
        conteudo: corpoChat,
      });
      entregues++;
    }

    if (entregues === 0) {
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demanda.id,
        direcao: "sistema",
        autor_nome: "Sistema",
        conteudo: `⚠️ Setor de destino sem operadores ativos. Cadastre em Configurações.`,
      });
    }

    return new Response(JSON.stringify({
      status: "ok",
      demanda_id: demanda.id,
      protocolo,
      setor_destino_id: setorDestinoId,
      destinatarios: entregues,
      conversa_id,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("criar-demanda-interna error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
