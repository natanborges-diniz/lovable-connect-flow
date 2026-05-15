---
name: Watchdog Cancelamento Órfão
description: Cron 15min varre agendamentos ativos com pedido de cancelamento na conversa; cancela se bot reconheceu, senão sinaliza badge âmbar e notifica loja
type: feature
---

`watchdog-cancelamento-orfao` (cron `*/15 * * * *`) cobre regressões da tool `cancelar_visita`.

Janela: agendamentos com `status IN (agendado, lembrete_enviado, confirmado)` e `data_horario` entre `now()-12h` e `now()+48h`.

Para cada um, lê últimas 12 mensagens (≤48h):
- **Cancela direto** (`status='cancelado'`, `metadata.cancelado_origem='watchdog_cancelamento'`) quando há inbound do cliente com regex `desmarc|cancel|não vou/poderei/consigo/posso ir` SEM sinal de reagendamento (`reagendar|remarcar|outro horário`) e há outbound posterior do bot reconhecendo (`cancelei|cancelado|desmarcado|tudo certo,? vou cancel`). Insere `eventos_crm.tipo='agendamento_cancelado_cliente'`.
- **Sinaliza** (sem cancelar) quando há só inbound de cancelamento sem reconhecimento do bot. Marca `metadata.pedido_cancelamento_detectado_at`, cria `notificacoes` para a loja e `eventos_crm.tipo='agendamento_pedido_cancelamento_detectado'`. Idempotente (skip se badge já existe).

Frontend: `PipelineAgendamentos.tsx` exibe badge âmbar `⚠ Pedido de cancelamento` quando `metadata.pedido_cancelamento_detectado_at` está presente.

Thresholds editáveis em `cron_jobs.payload.thresholds` (`janela_passada_horas`, `janela_futura_horas`, `msg_lookback`, `inbound_max_horas`).
