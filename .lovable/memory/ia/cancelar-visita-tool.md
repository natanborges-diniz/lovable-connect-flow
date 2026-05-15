---
name: Tool cancelar_visita — persistência real do cancelamento
description: Tool dedicada para Gael cancelar agendamento ativo no banco em vez de apenas dizer "cancelei" em texto. Hint pré-LLM força a tool quando cliente pede desmarcar/cancelar OU confirma curto após oferta do assistant. Salvaguarda na despedida determinística descarta agendamentos com metadata.cancelado_em ou cujo último outbound contém "cancelei seu horário".
type: feature
---

## Contexto / Bug original
Cliente pediu para desmarcar, Gael respondeu "Prontinho, cancelei seu horário" mas **nenhuma tool foi chamada**. Agendamento ficou `status=lembrete_enviado` no banco. Em seguida, a despedida determinística (`isShortNoToHelp`) leu `agAtivoRecentEarly` e assinou "Te espero sexta-feira, 15/05 às 17:30 na DINIZ PRIMITIVA I 👋", contradizendo o cancelamento.

## Solução em 3 camadas (`supabase/functions/ai-triage/index.ts`)

### 1. Tool nova `cancelar_visita`
Schema: `{ motivo?: string, resposta: string }` (resposta obrigatória).
Executor:
- Busca agendamento ativo (`agendado|lembrete_enviado|confirmado`); fallback `agAtivoRecentEarly`.
- `UPDATE agendamentos SET status='cancelado', metadata = metadata || { cancelado_em, cancelado_por:'cliente_via_ia', cancelado_motivo }`.
- Loga `eventos_crm.tipo='agendamento_cancelado_cliente'` (referencia_tipo='agendamento').
- Idempotente: se já cancelado, só responde sem rewrite.
- Sem agendamento ativo: responde + loga `cancelar_visita_sem_alvo`.

### 2. Hint pré-LLM forçando a tool
No bloco `[AGENDAMENTO ATIVO]`, branch novo dispara quando `hasAgendamentoAtivo` E:
- `wantsCancel` = cliente diz cancelar/desmarcar/"não vou conseguir ir" SEM mencionar nova data, OU
- `offeredCancel && shortYesToCancel` = último outbound do assistant ofereceu cancelamento (regex `cancelar (agora )?seu (horário|agendamento)|posso cancelar|deixar para remarcar depois`) e cliente respondeu curto positivo (`pode|sim|ok|cancela`).

Hint: `[CANCELAR AGENDAMENTO]` instrui chamar `cancelar_visita` AGORA, proíbe responder só com texto, proíbe assinatura "Te espero …" pós-cancelamento.

A frase final do hint anti-duplicação principal também passa a citar `cancelar_visita`.

### 3. Salvaguarda na despedida determinística
Em `agAtivoRecentEarly` (seção pós-`recentOutbound`):
- Filtra fora agendamentos com `metadata.cancelado_em` no `_agendamentosFuturos` E no fallback.
- Se último outbound contém regex `cancelei (seu )?(horário|agendamento|atendimento)|desmarquei (seu )?(horário|agendamento)`, anula `agAtivoRecentEarly` e loga `[FAREWELL] agendamento descartado por evidência textual de cancelamento`.

## Interação com outros sistemas
- `agendamentos-cron` (lembrete dia-D, no-show) já filtra por status — `cancelado` não dispara.
- `vendas-recuperacao-cron` segue lógica de inbound silencioso; sem agendamento ativo, conversa segue para encerramento normal.
- `pipeline-automations` por `status_alvo='cancelado'` pode ser configurado se quisermos automações específicas (ex.: enviar template de retorno depois de N dias).

## Auditoria
Após implantação rodar `compile-prompt` para que a tool apareça nas instruções/exemplos materializados em `prompt_atendimento`.
