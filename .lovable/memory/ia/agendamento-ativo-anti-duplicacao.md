---
name: Agendamento ativo — anti-duplicação e proibições
description: Quando o cliente já tem agendamento ativo (agendado/lembrete_enviado/confirmado), Gael não pode chamar agendar_visita nem perguntar "manter ou cancelar" sem pedido explícito. Mensagens curtas tipo "Agendar", "Manter", "Sim", "Obg" são tratadas como confirmação do existente. Bloqueio em 3 camadas: hint pré-LLM, guardrail no executor da tool e idempotência em agendar-cliente. Cobre também o lembrete dia-D (08h) e suas respostas.
type: feature
---

## Regra
Se há agendamento em status `agendado`/`lembrete_enviado`/`confirmado` para o contato e o cliente NÃO pediu explicitamente alteração (palavras: remarcar, reagendar, mudar/trocar horário/dia/data/loja, cancelar, antecipar, adiar, outro horário/dia, outra loja, "não vou conseguir", "não consigo", imprevisto), Gael:

- Não chama `agendar_visita` nem `reagendar_visita`.
- Não pergunta "mantemos ou prefere cancelar?".
- Não oferece cancelamento.
- Trata "Agendar", "Manter", "Sim", "Ok", "Confirmado", "Obg" como confirmação do existente: "Tudo certo, te espero {agendamentoFmt} 👋" e segue comparativo/encerramento.

## Seleção do agendamento ativo (agAtivoRecentEarly)
Quando o contato tem múltiplos agendamentos, o ai-triage prioriza o **futuro mais próximo** (`data_horario ≥ now − 6h`) ordenado crescente. Status considerados ativos: `agendado`, `confirmado`, `lembrete_enviado`. Fallback: primeiro com status ativo; depois primeiro registro. Evita assinar despedida (`Te espero {agendamentoFmt}`) com agendamento PASSADO quando existe outro futuro pendente — bug observado: cliente com `confirmado` antigo + `lembrete_enviado` novo recebia despedida com data antiga.

## Implementação (`supabase/functions/ai-triage/index.ts`)

1. **Hint pré-LLM** (antes do `callAI`): se `hasAgendamentoAtivo && !explicitChange`, injeta system message proibindo: (a) chamadas a `agendar_visita`/`reagendar_visita`; (b) perguntas de cancelamento; (c) chamadas a `consultar_lentes`/`consultar_lentes_contato` apenas porque o cliente mencionou tratamento/material/cor/marca/estilo (transitions, filtro azul, preto, clássica, varilux etc.) — tratar como PREFERÊNCIA registrada para a visita; (d) perguntas de região/bairro/"loja mais próxima" (a loja já está fixada). Exceção (c): se o cliente pedir preço/orçamento explicitamente AGORA, libera consultar_lentes mas mantém proibição de perguntar região.
2. **Loop-detector + intent agendar**: quando `forcedIntent.tool === "agendar_cliente_intent"` e há agendamento ativo, troca o prompt forçado por reafirmação do existente.
3. **Guardrail no executor de `agendar_visita`**: antes de criar o registro, se já existe ativo e o cliente não pediu mudança, retorna mensagem "Tudo certo, seu agendamento segue mantido — {agendamentoFmt}" e grava `agendamento_duplicado_evitado`. **Exceção:** `isDiaDReschedule = true` libera o agendamento (cliente respondeu ao lembrete dia-D pedindo remarcar).

## Anti-duplicação `resposta` + `proximo_passo`
No merge das tool args (`responder` e retry), se `resposta` já termina com `?` E `proximo_passo` também é pergunta, o `proximo_passo` é descartado — evita "Qual você prefere?. Qual horário você prefere: ...?" no mesmo balão.

## Lembrete dia-D (08:00 SP) e respostas

- O cron `agendamentos-cron` envia, entre 08:00 e 08:59 (SP) do dia da visita, uma mensagem reabrindo a conversa: "Bom dia, {nome}! Lembrando da sua visita hoje às {hora} na *Diniz {loja}*. Posso confirmar?". Idempotente via `agendamentos.metadata.lembrete_dia_d_at`.
- Se não há atendimento aberto, registra `eventos_crm.tipo='lembrete_dia_d_skip'` (envio HSM fica para futuro).
- **Resposta do cliente** detectada em `ai-triage`:
  - **Confirmação** (`sim|vou|ok|combinado|estarei|👍|👌|✅|...`) → override determinístico: "Maravilha, {nome}! 🙌 Nosso consultor já fica te aguardando com muito entusiasmo. Até daqui a pouco!" + `agendamentos.status='confirmado'` + evento `agendamento_confirmado_cliente`.
  - **Remarcação** (`remarcar|reagendar|mudar|outro dia|outro horário|não vou/consigo|cancelar|adiar|imprevisto`) → libera guardrail anti-duplicação e injeta hint para o LLM oferecer 2-3 opções de dia/horário próximas e chamar `agendar_visita` apenas após a escolha.

## Idempotência (`supabase/functions/agendar-cliente/index.ts`)
Antes do `INSERT`, busca agendamentos ativos do contato. Se houver um com mesma loja+dia ou em janela de ±24h, retorna o existente com `duplicate: true` e grava `agendamento_duplicado_evitado`. No caso de remarcação dia-D (que SAI da janela), gera novo registro normalmente.

## Fuso horário
Datas e horários sempre formatados em `America/Sao_Paulo` em ai-triage, agendar-cliente e cron.
