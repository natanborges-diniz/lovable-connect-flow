import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { contato_id, atendimento_id, loja_nome, loja_telefone, data_horario, observacoes } = await req.json();

    if (!contato_id || !loja_nome || !data_horario) {
      throw new Error("contato_id, loja_nome and data_horario are required");
    }

    // Exige timezone explícito para evitar interpretar horário local como UTC
    // (bug "agendado às 17:30 SP" virar "20:30 SP" depois do render).
    if (!/[+-]\d{2}:?\d{2}$|Z$/.test(String(data_horario))) {
      console.warn(`[agendar-cliente] data_horario sem timezone: ${data_horario}`);
      return new Response(JSON.stringify({
        error: "data_horario_sem_timezone",
        motivo: "Use ISO 8601 com offset (ex: 2026-05-04T17:30:00-03:00)",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get contato info
    const { data: contato } = await supabase
      .from("contatos")
      .select("nome, telefone")
      .eq("id", contato_id)
      .single();

    if (!contato) throw new Error("Contato not found");

    // ── VALIDAÇÃO DE HORÁRIO DE FUNCIONAMENTO DA LOJA ──
    // Resolve loja_id por nome e consulta loja_status_no_dia. Se a loja estiver
    // fechada na data, ou se a hora estiver fora do intervalo de funcionamento,
    // aborta a criação e devolve erro estruturado para a IA reformular.
    try {
      const { data: lojaRow } = await supabase
        .from("telefones_lojas")
        .select("id, nome_loja")
        .ilike("nome_loja", loja_nome)
        .eq("ativo", true)
        .maybeSingle();

      if (lojaRow?.id) {
        const dataIso = String(data_horario);
        const dataDia = dataIso.substring(0, 10); // YYYY-MM-DD
        const { data: status } = await supabase.rpc("loja_status_no_dia", {
          _loja_id: lojaRow.id,
          _data: dataDia,
        }) as any;

        if (status && status.aberta === false) {
          console.warn(`[agendar-cliente] LOJA FECHADA — ${lojaRow.nome_loja} em ${dataDia}: ${status.motivo}`);
          await supabase.from("eventos_crm").insert({
            contato_id,
            tipo: "agendamento_dia_fechado",
            descricao: `Tentativa bloqueada: ${lojaRow.nome_loja} não abre em ${dataDia} (${status.motivo})`,
            referencia_tipo: "atendimento",
            referencia_id: atendimento_id || null,
            metadata: { loja_nome, data_horario, status },
          });
          return new Response(JSON.stringify({
            error: "loja_fechada_no_dia",
            motivo: status.motivo,
            feriado_nome: status.feriado_nome || null,
            loja_nome: lojaRow.nome_loja,
            data: dataDia,
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Loja aberta: valida hora dentro do intervalo
        if (status && status.aberta === true && status.abre && status.fecha) {
          const horaSP = new Date(dataIso).toLocaleTimeString("en-GB", {
            hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
          }); // "HH:MM"
          if (horaSP < status.abre || horaSP >= status.fecha) {
            console.warn(`[agendar-cliente] FORA DO HORÁRIO — ${lojaRow.nome_loja} em ${dataDia} ${horaSP} (abre ${status.abre}–${status.fecha})`);
            await supabase.from("eventos_crm").insert({
              contato_id,
              tipo: "agendamento_fora_horario",
              descricao: `Tentativa bloqueada: ${horaSP} fora de ${status.abre}–${status.fecha} em ${lojaRow.nome_loja}`,
              referencia_tipo: "atendimento",
              referencia_id: atendimento_id || null,
              metadata: { loja_nome, data_horario, status, hora_solicitada: horaSP },
            });
            return new Response(JSON.stringify({
              error: "fora_do_horario",
              loja_nome: lojaRow.nome_loja,
              data: dataDia,
              hora_solicitada: horaSP,
              abre: status.abre,
              fecha: status.fecha,
            }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      } else {
        console.warn(`[agendar-cliente] loja "${loja_nome}" não encontrada em telefones_lojas — pulando validação de horário`);
      }
    } catch (e) {
      console.error("[agendar-cliente] validação de horário falhou (prossegue):", e);
    }

    // ── IDEMPOTÊNCIA: se já existe agendamento ativo equivalente, retorna o existente ──
    // Critérios:
    //  (a) mesma loja (case-insensitive) e mesma data (YYYY-MM-DD) → mesmo agendamento.
    //  (b) qualquer agendamento ativo (agendado/lembrete_enviado/confirmado) nas
    //      próximas 24h para o mesmo contato → considera duplicidade e devolve o existente.
    const targetIso = String(data_horario);
    const targetDay = targetIso.substring(0, 10);
    const targetTs = new Date(targetIso).getTime();

    const { data: ativos } = await supabase
      .from("agendamentos")
      .select("id, loja_nome, data_horario, status, observacoes")
      .eq("contato_id", contato_id)
      .in("status", ["agendado", "lembrete_enviado", "confirmado"]) as any;

    const existente = (ativos || []).find((a: any) => {
      const sameStore = String(a.loja_nome || "").toLowerCase() === String(loja_nome || "").toLowerCase();
      const sameDay = String(a.data_horario || "").substring(0, 10) === targetDay;
      if (sameStore && sameDay) return true;
      // Janela de 24h: trata como mesmo agendamento mesmo se loja/dia divergirem (cliente repetindo "agendar")
      const ts = new Date(a.data_horario).getTime();
      if (Number.isFinite(ts) && Math.abs(ts - targetTs) < 24 * 60 * 60 * 1000) return true;
      return false;
    });

    if (existente) {
      console.log(`[agendar-cliente] Idempotent hit — returning existing agendamento ${existente.id}`);
      await supabase.from("eventos_crm").insert({
        contato_id,
        tipo: "agendamento_duplicado_evitado",
        descricao: `Tentativa de criar agendamento duplicado bloqueada — existente: ${existente.loja_nome} em ${existente.data_horario}`,
        referencia_tipo: "agendamento",
        referencia_id: existente.id,
        metadata: { tentativa: { loja_nome, data_horario }, existente },
      });
      return new Response(JSON.stringify({ status: "ok", agendamento: existente, duplicate: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create agendamento
    const { data: agendamento, error: agErr } = await supabase
      .from("agendamentos")
      .insert({
        contato_id,
        atendimento_id: atendimento_id || null,
        loja_nome,
        loja_telefone: loja_telefone || null,
        data_horario,
        status: "agendado",
        observacoes: observacoes || null,
      })
      .select()
      .single();

    if (agErr) throw agErr;

    // Format date for message (sempre em America/Sao_Paulo)
    const dt = new Date(data_horario);
    const dataFormatada = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
    const horaFormatada = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

    // NOTE: WhatsApp confirmation is sent by the AI in ai-triage (args.resposta).
    // This function only creates the record and logs the CRM event.

    // Log CRM event
    await supabase.from("eventos_crm").insert({
      contato_id,
      tipo: "agendamento_criado",
      descricao: `Agendamento: ${loja_nome} em ${dataFormatada} às ${horaFormatada}`,
      referencia_tipo: "agendamento",
      referencia_id: agendamento.id,
      metadata: { loja_nome, data_horario, loja_telefone },
    });

    return new Response(JSON.stringify({ status: "ok", agendamento }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("agendar-cliente error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
