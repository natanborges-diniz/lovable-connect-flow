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
    const payload = await req.json();
    const { entity_type, entity_id, status_novo, status_anterior, coluna_id, coluna_anterior_id } = payload;

    console.log(`[AUTOMATIONS] ${entity_type} ${entity_id}: ${status_anterior || coluna_anterior_id} → ${status_novo || coluna_id}`);

    // ─── Check homologação mode ───
    const { data: homoConfig } = await supabase
      .from("configuracoes_ia")
      .select("valor")
      .eq("chave", "modo_homologacao")
      .single();

    const isHomologacao = homoConfig?.valor === "true";

    // ─── Fetch automation rules ───
    let automacoes: any[] = [];

    if (entity_type === "agendamento" && status_novo) {
      // For agendamentos, match by status_alvo
      const { data } = await supabase
        .from("pipeline_automacoes")
        .select("*")
        .eq("entidade", "agendamento")
        .eq("status_alvo", status_novo)
        .eq("ativo", true)
        .order("ordem");
      automacoes = data || [];
    } else if ((entity_type === "contato" || entity_type === "solicitacao") && coluna_id) {
      // For contatos or solicitacoes, match by pipeline_coluna_id
      const entidadeBusca = entity_type === "solicitacao" ? "solicitacao" : "contato";
      const { data } = await supabase
        .from("pipeline_automacoes")
        .select("*")
        .eq("entidade", entidadeBusca)
        .eq("pipeline_coluna_id", coluna_id)
        .eq("ativo", true)
        .order("ordem");
      automacoes = data || [];
    }

    if (!automacoes.length) {
      console.log("[AUTOMATIONS] No rules found for this transition");
      return new Response(JSON.stringify({ status: "no_rules" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Get entity context ───
    let contato_id: string | null = null;
    let atendimento_id: string | null = null;
    let contato: any = null;
    let agendamento: any = null;
    let solicitacao: any = null;

    if (entity_type === "agendamento") {
      const { data: ag } = await supabase
        .from("agendamentos")
        .select("*")
        .eq("id", entity_id)
        .single();
      agendamento = ag;
      contato_id = ag?.contato_id;
      atendimento_id = ag?.atendimento_id;
    } else if (entity_type === "solicitacao") {
      // For solicitacoes (financeiro pipeline), get contato from the solicitacao
      const { data: sol } = await supabase
        .from("solicitacoes")
        .select("*, contato:contatos(*)")
        .eq("id", entity_id)
        .single();
      solicitacao = sol;
      contato_id = sol?.contato_id;
      contato = sol?.contato;
      // Find latest atendimento for this contato
      if (contato_id) {
        const { data: at } = await supabase
          .from("atendimentos")
          .select("id")
          .eq("contato_id", contato_id)
          .neq("status", "encerrado")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        atendimento_id = at?.id || null;
      }
    } else {
      contato_id = entity_id;
      // Find latest atendimento for this contato
      const { data: at } = await supabase
        .from("atendimentos")
        .select("id")
        .eq("contato_id", entity_id)
        .neq("status", "encerrado")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      atendimento_id = at?.id || null;
    }

    if (contato_id) {
      const { data: c } = await supabase
        .from("contatos")
        .select("*")
        .eq("id", contato_id)
        .single();
      contato = c;
    }

    // ─── Check homologação whitelist ───
    if (isHomologacao && contato?.telefone) {
      const { data: wl } = await supabase
        .from("contatos_homologacao")
        .select("id")
        .eq("telefone", contato.telefone)
        .eq("ativo", true)
        .limit(1);

      if (!wl?.length) {
        console.log(`[AUTOMATIONS] Blocked by homologação: ${contato.telefone}`);
        return new Response(JSON.stringify({ status: "blocked_homologacao" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ─── Execute each automation ───
    const results: string[] = [];

    for (const auto of automacoes) {
      const config = auto.config || {};

      try {
        switch (auto.tipo_acao) {
          case "enviar_template": {
            if (!contato_id) break;
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-template`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                contato_id,
                template_name: config.template_name,
                template_params: resolveParams(config.template_params || [], contato, agendamento, solicitacao),
              }),
            });
            results.push(`template:${config.template_name}`);
            break;
          }

          case "enviar_mensagem": {
            if (!atendimento_id) break;
            const texto = resolveText(config.texto || "", contato, agendamento, solicitacao);
            await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                atendimento_id,
                texto,
                remetente_nome: "Sistema",
              }),
            });
            results.push(`mensagem:${auto.id}`);
            break;
          }

          case "atualizar_campo": {
            const tabela = config.tabela || entity_type === "agendamento" ? "agendamentos" : "contatos";
            const updates = config.updates || {};
            if (Object.keys(updates).length > 0) {
              await supabase.from(tabela).update(updates).eq("id", entity_id);
              results.push(`update:${tabela}`);
            }
            break;
          }

          case "criar_tarefa": {
            await supabase.from("tarefas").insert({
              titulo: resolveText(config.titulo || "Tarefa automática", contato, agendamento, solicitacao),
              descricao: resolveText(config.descricao || "", contato, agendamento, solicitacao),
              prioridade: config.prioridade || "normal",
              ...(config.fila_id ? { fila_id: config.fila_id } : {}),
            });
            results.push(`tarefa:${config.titulo}`);
            break;
          }

          default:
            console.warn(`[AUTOMATIONS] Unknown action type: ${auto.tipo_acao}`);
        }
      } catch (err) {
        console.error(`[AUTOMATIONS] Error executing ${auto.tipo_acao}:`, err);
        results.push(`error:${auto.tipo_acao}`);
      }
    }

    // ─── Log CRM event ───
    if (contato_id) {
      await supabase.from("eventos_crm").insert({
        contato_id,
        tipo: "automacao_pipeline",
        descricao: `Automações executadas: ${results.join(", ")}`,
        referencia_tipo: entity_type,
        referencia_id: entity_id,
        metadata: { status_novo, status_anterior, coluna_id, coluna_anterior_id, results },
      });
    }

    console.log(`[AUTOMATIONS] Executed: ${results.join(", ")}`);
    return new Response(JSON.stringify({ status: "ok", executed: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[AUTOMATIONS] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Helpers ───

function resolveParams(params: string[], contato: any, agendamento: any): string[] {
  return params.map((p) => resolveText(p, contato, agendamento));
}

function resolveQuando(dataHorario: string): string {
  if (!dataHorario) return "";
  const now = new Date();
  const dt = new Date(dataHorario);
  const hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  // Compare dates in SP timezone
  const nowSP = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dtSP = new Date(dt.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const nowDay = new Date(nowSP.getFullYear(), nowSP.getMonth(), nowSP.getDate()).getTime();
  const dtDay = new Date(dtSP.getFullYear(), dtSP.getMonth(), dtSP.getDate()).getTime();
  const diffDays = Math.round((dtDay - nowDay) / 86400000);

  if (diffDays === 0) return `hoje às ${hora}`;
  if (diffDays === 1) return `amanhã às ${hora}`;
  if (diffDays > 1 && diffDays <= 6) {
    const diaSemana = dt.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
    return `${diaSemana} às ${hora}`;
  }
  return `dia ${dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às ${hora}`;
}

function resolveText(template: string, contato: any, agendamento: any): string {
  if (!template) return "";
  
  const firstName = contato?.nome?.split(" ")[0] || "Cliente";
  const loja = agendamento?.loja_nome || "";
  
  let hora = "";
  let quando = "";
  let diaSemana = "";
  if (agendamento?.data_horario) {
    const dt = new Date(agendamento.data_horario);
    hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    quando = resolveQuando(agendamento.data_horario);
    diaSemana = dt.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
  }

  return template
    .replace(/\{\{nome\}\}/g, contato?.nome || "Cliente")
    .replace(/\{\{primeiro_nome\}\}/g, firstName)
    .replace(/\{\{loja\}\}/g, loja)
    .replace(/\{\{hora\}\}/g, hora)
    .replace(/\{\{quando\}\}/g, quando)
    .replace(/\{\{dia_semana\}\}/g, diaSemana)
    .replace(/\{\{telefone\}\}/g, contato?.telefone || "")
    .replace(/\{\{data\}\}/g, agendamento?.data_horario
      ? new Date(agendamento.data_horario).toLocaleDateString("pt-BR")
      : "");
}
