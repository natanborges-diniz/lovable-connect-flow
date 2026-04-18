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

    // Authenticate operator
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

    // Get atendimento + cliente info
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

    // Get operator name from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("nome")
      .eq("id", user.id)
      .single();
    const operadorNome = profile?.nome || user.email || "Operador";
    const clienteNome = (atendimento as any).contatos?.nome || "Cliente";

    // Generate protocol DEM-YYYY-NNNNN (numero_curto comes from sequence default)
    const ano = new Date().getFullYear();

    // Insert demanda (numero_curto auto from sequence)
    const { data: demanda, error: demErr } = await supabase
      .from("demandas_loja")
      .insert({
        protocolo: `DEM-${ano}-PENDING`, // updated below with real number
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

    // Update protocol with real number_curto
    const protocolo = `DEM-${ano}-${String(demanda.numero_curto).padStart(5, "0")}`;
    await supabase.from("demandas_loja").update({ protocolo }).eq("id", demanda.id);

    // First message in the demand thread
    await supabase.from("demanda_mensagens").insert({
      demanda_id: demanda.id,
      direcao: "operador_para_loja",
      autor_id: user.id,
      autor_nome: operadorNome,
      conteudo: pergunta,
    });

    // Build WA message for the store
    const waMessage = [
      `📌 *DEMANDA ${protocolo}*`,
      `Operador: ${operadorNome}`,
      `Cliente: ${clienteNome}`,
      ``,
      pergunta,
      ``,
      `────────────`,
      `💬 Responda diretamente esta mensagem. Tudo que enviar (texto, foto, áudio) será encaminhado ao operador.`,
      `🔚 Para encerrar, digite *#encerrademanda*`,
    ].join("\n");

    // Find or create atendimento for the store and send the message via send-whatsapp
    // We need a "store" atendimento to attach the outbound msg. Reuse if exists.
    let storeContatoId: string | null = null;
    {
      const cleanPhone = loja_telefone.replace(/\D/g, "");
      // BR: gera variantes com/sem 9 pra match robusto
      const variants = new Set<string>([cleanPhone, loja_telefone]);
      if (cleanPhone.length === 13 && cleanPhone.startsWith("55") && cleanPhone[4] === "9") {
        variants.add("55" + cleanPhone.substring(2, 4) + cleanPhone.substring(5));
      }
      if (cleanPhone.length === 12 && cleanPhone.startsWith("55")) {
        variants.add("55" + cleanPhone.substring(2, 4) + "9" + cleanPhone.substring(4));
      }
      const variantArr = Array.from(variants);
      const { data: storeContatos } = await supabase
        .from("contatos")
        .select("id, tipo, setor_destino, pipeline_coluna_id")
        .in("telefone", variantArr)
        .order("created_at", { ascending: true })
        .limit(1);
      const storeContato = storeContatos?.[0];
      if (storeContato) {
        storeContatoId = storeContato.id;
        // Garante tipo/setor corretos e fora do CRM
        const updates: Record<string, unknown> = {};
        if (storeContato.tipo !== "loja" && storeContato.tipo !== "colaborador") updates.tipo = "loja";
        if (storeContato.pipeline_coluna_id) updates.pipeline_coluna_id = null;
        if (Object.keys(updates).length > 0) {
          await supabase.from("contatos").update(updates).eq("id", storeContatoId);
        }
      } else {
        const { data: newCt } = await supabase
          .from("contatos")
          .insert({
            nome: loja_nome,
            tipo: "loja",
            telefone: cleanPhone,
            setor_destino: "32cbd99c-4b20-4c8b-b7b2-901904d0aff6",
            metadata: { nome_confirmado: true },
          })
          .select("id")
          .single();
        storeContatoId = newCt?.id || null;
      }
    }

    let storeAtendimentoId: string | null = null;
    if (storeContatoId) {
      const { data: openAt } = await supabase
        .from("atendimentos")
        .select("id")
        .eq("contato_id", storeContatoId)
        .eq("canal", "whatsapp")
        .neq("status", "encerrado")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (openAt) {
        storeAtendimentoId = openAt.id;
        // Ensure existing store atendimento is flagged as demand mirror to suppress IA/bot
        await supabase
          .from("atendimentos")
          .update({
            metadata: { suprimir_ia: true, suprimir_bot: true, atendimento_demanda: true },
            canal_provedor: "evolution_api",
          })
          .eq("id", openAt.id);
      } else {
        const { data: sol } = await supabase
          .from("solicitacoes")
          .insert({
            contato_id: storeContatoId,
            assunto: `Demanda ${protocolo}`,
            descricao: pergunta,
            canal_origem: "whatsapp",
            status: "aberta",
          })
          .select("id")
          .single();
        if (sol) {
          const { data: newAt } = await supabase
            .from("atendimentos")
            .insert({
              solicitacao_id: sol.id,
              contato_id: storeContatoId,
              canal: "whatsapp",
              canal_provedor: "evolution_api",
              status: "aguardando",
              modo: "ia",
              metadata: { suprimir_ia: true, suprimir_bot: true, atendimento_demanda: true },
            })
            .select("id")
            .single();
          storeAtendimentoId = newAt?.id || null;
        }
      }
    }

    // Send via WhatsApp — sempre forçar Evolution (canal não-oficial) para B2B com lojas
    if (storeAtendimentoId) {
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          atendimento_id: storeAtendimentoId,
          texto: waMessage,
          remetente_nome: `Demanda (${operadorNome})`,
          force_provider: "evolution_api",
        }),
      });
      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        console.error("send-whatsapp failed:", sendData);
        await supabase.from("demanda_mensagens").insert({
          demanda_id: demanda.id,
          direcao: "sistema",
          autor_nome: "Sistema",
          conteudo: `⚠️ Falha ao enviar WhatsApp para a loja: ${sendData?.error || "erro desconhecido"}`,
        });
      }
    }

    return new Response(JSON.stringify({ status: "ok", demanda_id: demanda.id, protocolo, numero_curto: demanda.numero_curto }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("criar-demanda-loja error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
