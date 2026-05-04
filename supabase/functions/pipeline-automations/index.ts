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

    // ─── Guard: bloquear transições regressivas em agendamentos ───
    // Ex.: lembrete_enviado → agendado não deve disparar a automação de "confirmado"
    // (acontece quando agendar_visita roda novamente sobre um agendamento já existente).
    if (entity_type === "agendamento" && status_anterior && status_novo) {
      const ORDEM: Record<string, number> = {
        agendado: 1, lembrete_enviado: 2, confirmado: 3,
        no_show: 4, recuperacao: 5, venda_fechada: 6,
      };
      const ordAnt = ORDEM[status_anterior] ?? 0;
      const ordNov = ORDEM[status_novo] ?? 0;
      if (ordAnt > 0 && ordNov > 0 && ordNov < ordAnt) {
        console.log(`[AUTOMATIONS] Skip regressive transition ${status_anterior} → ${status_novo}`);
        return new Response(JSON.stringify({ status: "skipped_regressive" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

      // ── App-only routing for B2B contacts (loja/colaborador sintéticos) ──
      // Quando o contato é interno (loja/colaborador), o retorno NUNCA vai por WhatsApp.
      // Substitui enviar_template/enviar_mensagem por aviso na demanda + notificação in-app.
      const contatoInterno = contato?.tipo === "loja" || contato?.tipo === "colaborador";
      const podeNotificarAppAuto =
        contatoInterno &&
        entity_type === "solicitacao" &&
        (auto.tipo_acao === "enviar_template" || auto.tipo_acao === "enviar_mensagem");

      try {
        if (podeNotificarAppAuto || auto.tipo_acao === "notificar_loja_app") {
          await notificarLojaApp({
            supabase,
            solicitacao,
            contato,
            colunaId: coluna_id,
            config,
            tipoAcao: auto.tipo_acao,
          });
          results.push(`app_loja:${auto.tipo_acao}`);
          continue;
        }

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

          case "enviar_resumo_cliente": {
            // Generate AI summary and send WhatsApp recap to the client when atendimento closes.
            if (!atendimento_id || !contato_id) break;
            try {
              // Generate summary via summarize-atendimento (AI condenses last messages)
              const sumResp = await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ atendimento_id, audience: "cliente" }),
              });
              if (!sumResp.ok) {
                console.error("[AUTOMATIONS] summarize-atendimento failed:", await sumResp.text());
                results.push("error:enviar_resumo_cliente");
                break;
              }
              const sumData = await sumResp.json();
              const resumoTexto = sumData?.resumo_cliente || sumData?.resumo;
              if (!resumoTexto) {
                results.push("error:enviar_resumo_cliente:no_summary");
                break;
              }
              const firstName = contato?.nome?.split(" ")[0] || "Cliente";
              const corpo = config.template
                ? resolveText(config.template, contato, agendamento, solicitacao).replace(/\{\{resumo\}\}/g, resumoTexto)
                : `Olá ${firstName}! 😊 Aqui vai um resumo do nosso atendimento:\n\n${resumoTexto}\n\nQualquer dúvida, é só chamar por aqui. Obrigado pela conversa!`;
              await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ atendimento_id, texto: corpo, remetente_nome: "Sistema" }),
              });
              results.push("resumo_cliente_enviado");
            } catch (err) {
              console.error("[AUTOMATIONS] enviar_resumo_cliente error:", err);
              results.push("error:enviar_resumo_cliente");
            }
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

function resolveParams(params: string[], contato: any, agendamento: any, solicitacao?: any): string[] {
  return params.map((p) => resolveText(p, contato, agendamento, solicitacao));
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

function resolveText(template: string, contato: any, agendamento: any, solicitacao?: any): string {
  if (!template) return "";
  
  const firstName = contato?.nome?.split(" ")[0] || "Cliente";
  const loja = agendamento?.loja_nome || "";
  const meta = solicitacao?.metadata || {};
  
  // {{nome_cliente}} = end customer name informed by the store (from solicitacao metadata)
  // {{nome}} / {{primeiro_nome}} = contact name (the store in financeiro pipeline)
  const nomeCliente = meta.nome_cliente || meta.cliente || "";
  const valorCompra = meta.valor_compra ? `R$ ${Number(meta.valor_compra).toFixed(2)}` : "";
  const valorEntrada = meta.valor_entrada ? `R$ ${Number(meta.valor_entrada).toFixed(2)}` : "";
  const valorFinanciado = meta.valor_financiado ? `R$ ${Number(meta.valor_financiado).toFixed(2)}` : "";
  const cpf = meta.cpf || "";
  
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
    .replace(/\{\{nome_cliente\}\}/g, nomeCliente)
    .replace(/\{\{loja\}\}/g, loja || contato?.nome || "")
    .replace(/\{\{hora\}\}/g, hora)
    .replace(/\{\{quando\}\}/g, quando)
    .replace(/\{\{dia_semana\}\}/g, diaSemana)
    .replace(/\{\{telefone\}\}/g, contato?.telefone || "")
    .replace(/\{\{valor_compra\}\}/g, valorCompra)
    .replace(/\{\{valor_entrada\}\}/g, valorEntrada)
    .replace(/\{\{valor_financiado\}\}/g, valorFinanciado)
    .replace(/\{\{cpf\}\}/g, cpf)
    .replace(/\{\{observacao\}\}/g, meta.observacao_dados_incompletos || "")
    .replace(/\{\{dados_faltantes\}\}/g, (meta.dados_incompletos_labels || []).join(", "))
    .replace(/\{\{data\}\}/g, agendamento?.data_horario
      ? new Date(agendamento.data_horario).toLocaleDateString("pt-BR")
      : "");
}

// ─── Notifica loja via app interno (canal único B2B) ───
// Cria comentário visível na "demanda" (solicitação) + notificação in-app/push
// para os usuários da loja resolvidos via resolver_destinatarios_loja().
async function notificarLojaApp({
  supabase,
  solicitacao,
  contato,
  colunaId,
  config,
  tipoAcao,
}: {
  supabase: any;
  solicitacao: any;
  contato: any;
  colunaId?: string | null;
  config: any;
  tipoAcao: string;
}) {
  if (!solicitacao) return;

  const meta = solicitacao.metadata || {};
  const lojaNome: string =
    meta.alias_loja || meta.loja_nome || contato?.metadata?.loja_nome || contato?.nome || "";

  // Resolve título/corpo
  let texto = "";
  if (tipoAcao === "enviar_template" && config.template_name) {
    // Mapa básico para os 3 templates da Consulta CPF
    const nomeCliente = meta.nome_cliente || meta.cliente || "";
    const cpf = meta.cpf || "";
    const labels = (meta.dados_incompletos_labels || []).join(", ");
    const obs = meta.observacao_dados_incompletos || "";
    if (config.template_name === "dados_incompletos") {
      texto =
        `⚠️ Consulta CPF — Dados Incompletos\n` +
        `Cliente: ${nomeCliente}${cpf ? ` (CPF ${cpf})` : ""}\n` +
        `Pendências: ${labels || "—"}` +
        (obs ? `\n\nObservação do Financeiro:\n"${obs}"` : "") +
        `\n\nReenvie a Consulta CPF com os dados corrigidos.`;
    } else {
      texto = resolveText(config.texto || "", contato, null, solicitacao);
    }
  } else {
    texto = resolveText(config.texto || config.template || "", contato, null, solicitacao);
  }

  if (!texto) {
    texto = "🔔 Sua solicitação teve um retorno do setor. Abra o card para ver os detalhes.";
  }

  const protocolo = solicitacao.protocolo ? ` #${solicitacao.protocolo}` : "";
  const titulo = `Retorno do Financeiro${protocolo}`;

  // 1) Comentário "tipo retorno_setor" — visível na demanda, somente leitura para a loja
  await supabase.from("solicitacao_comentarios").insert({
    solicitacao_id: solicitacao.id,
    tipo: "retorno_setor",
    autor_nome: "Financeiro",
    conteudo: texto,
  });

  // 2) Resolve usuários da loja
  let userIds: string[] = [];
  if (lojaNome) {
    const { data: dest } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
    userIds = Array.from(new Set((dest || []).map((d: any) => d.user_id))).filter(Boolean);
  }

  // 3) Cria notificações in-app (trigger trg_push_nova_notificacao envia push)
  if (userIds.length > 0) {
    const notifs = userIds.map((uid) => ({
      usuario_id: uid,
      titulo,
      mensagem: texto.slice(0, 200),
      tipo: "retorno_setor",
      referencia_id: solicitacao.id,
    }));
    await supabase.from("notificacoes").insert(notifs);
  } else {
    console.warn(`[AUTOMATIONS] notificar_loja_app: sem destinatários para loja "${lojaNome}"`);
  }
}
