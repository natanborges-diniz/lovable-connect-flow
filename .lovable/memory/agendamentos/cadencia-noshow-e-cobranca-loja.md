---
name: Cadência No-show + Cobrança da Loja
description: Cadência definitiva de recuperação cliente (3x/72h) e cobrança da loja (2h+10:00 dia seguinte+48h tarefa supervisor) com pontuação de comparecimento
type: feature
---
**Cadência cliente após no_show** (em `agendamentos-cron`):
- 1ª retomada IA imediata ao virar `no_show`.
- 2ª em 24h (`HORAS_SEGUNDA_RECUPERACAO`).
- 3ª em mais 24h (`HORAS_TERCEIRA_RECUPERACAO`).
- Em 72h (`HORAS_ABANDONO`) sem inbound: envia despedida fixa ("Tudo bem, como não consegui retorno…") e na rodada seguinte (≥1h depois) marca `abandonado` + evento_crm `agendamento_perdido`.
- Cliente respondendo a qualquer momento → status volta para `recuperacao` e IA conduz.

**Cobrança da loja** (no Messenger, via `notificacoes`+push, NUNCA WhatsApp):
- 1ª: 2h após o horário marcado (`HORAS_PRIMEIRA_COBRANCA_LOJA`).
- 2ª: 10:00 SP do dia seguinte ao agendamento (cron filtra `getHours()===10`).
- 48h (`HORAS_TIMEOUT_LOJA`) sem resposta → **tarefa interna detalhada** com prioridade alta para o setor responsável da loja (resolvido via `resolver_destinatarios_loja`), evento_crm `loja_silenciou` para placar de comparecimento, e agendamento vira `no_show` automaticamente.
- A descrição da tarefa traz: dados do cliente/loja, horário, e checklist de cobrança (ligar, atualizar status manual, registrar motivo).

**Ações da loja no Messenger (LojaAgenda.tsx)**:
- Confirmar presença → `compareceu`.
- Marcar No-show → `no_show` + evento `loja_marcou_noshow`, dispara cadência IA cliente.
- Reverter no-show → permite quando status=`no_show`/`recuperacao`; volta para `compareceu`, zera `tentativas_recuperacao`.
- Reagendar → DateTimePicker; status `reagendado`, zera flags (lembrete/cobrança/recuperação) e IA confirma novo horário.
- Venda fechada → form valor + numero_venda + numeros_os[]; status `venda_fechada`.

**Eventos pontuados em eventos_crm** (formam placar futuro da loja):
`loja_confirmou_comparecimento`, `loja_marcou_noshow`, `loja_reverteu_noshow`, `loja_reagendou`, `loja_silenciou`, `venda_fechada`, `agendamento_perdido`.

**Janela calendário Messenger**: mês navegado livre (qualquer mês passado/futuro) + lista próximos 60 dias.
