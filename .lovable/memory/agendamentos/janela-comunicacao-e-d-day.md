---
name: Janela de comunicação outbound e D-Day idempotente
description: Lembretes ao cliente só saem 08-21h SP, com lock atômico no D-day e validação de expediente da loja antes do envio.
type: feature
---

Comunicações automáticas ao cliente em `agendamentos-cron`:

- **Janela 08:00–21:00 (SP)**: `processLembreteRetry` e demais envios outbound de lembrete/cobrança ao cliente nunca disparam fora dessa janela. Função `dentroDeJanelaComunicacaoCliente(now)` é o guard único.
- **D-Day idempotente**: `processLembreteDiaD` aplica lock atômico via `UPDATE ... WHERE metadata->>'lembrete_dia_d_at' IS NULL RETURNING id` ANTES de chamar `send-whatsapp`. Elimina duplicação quando o cron de 5 min roda concorrente.
- **Validação de expediente da loja**: antes de enviar o D-Day, busca `horario_abertura/fechamento` em `telefones_lojas`. Se o horário do agendamento estiver fora do expediente ou for domingo, NÃO envia, registra `agendamento_horario_invalido` em `eventos_crm` e força `atendimento.modo = 'humano'` para revisão.

Em `ai-triage`, o handler de `agendar_visita`/`reagendar_visita` faz **validação de coerência**: se o horário citado em `args.resposta` (regex `\d+h|\d+:\d+`) divergir da hora de `args.data_horario` em SP, aborta a criação, loga `agendamento_horario_divergente` e pede confirmação ao cliente ("foi às Xh ou Yh?").

Janela humana (Seg-Sex 09-18, Sáb 08-12) continua sendo só para escalada — comunicação automática usa janela mais permissiva 08-21.
