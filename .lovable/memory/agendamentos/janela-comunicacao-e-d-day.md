---
name: Janela de comunicação e política de lembrete único
description: 1 lembrete único por agendamento. Véspera (08h SP) para dias futuros; 1h antes para o mesmo dia; nada se marcado com <60min de antecedência. Cliente que já confirmou nunca recebe lembrete. Janela de envio outbound: 08h–22h SP.
type: feature
---

## Regra de lembretes (agendamentos-cron)

| Caso | Lembrete |
|---|---|
| Agendamento marcado para HOJE com ≥60min de antecedência | **1 lembrete** ~1h antes (`processLembrete1hAntes`) |
| Agendamento marcado para HOJE com <60min de antecedência | **NENHUM** lembrete (evento `lembrete_1h_skip_janela_curta`) |
| Agendamento para dia futuro | **1 lembrete** às 08h SP do dia anterior (`processLembreteVespera`) |
| Cliente já respondeu confirmando (`metadata.cliente_confirmou_at`) | **NENHUM** lembrete adicional |

Sempre **máximo 1 lembrete** por agendamento. Sem reenvio. Sem segunda tentativa. A mensagem "ainda não conseguimos confirmar" foi removida.

## Idempotência

- Lock atômico via `metadata.lembrete_enviado_at` (CAS: `.is("metadata->>lembrete_enviado_at", null)`).
- `metadata.lembrete_tipo` = `"vespera"` ou `"1h_antes"`.
- `metadata.lembrete_skip_motivo = "janela_curta"` quando agendamento for marcado <60min antes.
- Status do agendamento vai para `lembrete_enviado` apenas após o envio efetivo (não mais transição cega 24-48h antes).

## Marcação de "cliente já confirmou"

- `whatsapp-webhook` (auto-confirm por keyword) grava `metadata.cliente_confirmou_at`.
- `ai-triage` (override `dia_d_confirm`) grava `metadata.cliente_confirmou_at` + `confirmado_pelo_cliente_at` (legado).

## Guard-rails contra confirmação fantasma

- **`pipeline-automations`**: bloqueia transições regressivas em agendamento (`ORDEM`: agendado<lembrete_enviado<confirmado<no_show<recuperacao<venda_fechada). Se `status_novo` < `status_anterior`, nenhuma automação dispara — evita "Seu agendamento foi confirmado" quando o status volta de `lembrete_enviado` para `agendado`.
- **`pipeline-automations`**: se `agendamento.metadata.cliente_confirmou_at` existir, filtra automações de `enviar_mensagem`/`enviar_template` (mantém tarefas/notificações internas). Cliente nunca recebe duas confirmações.
- **Automação `2a9f41ef-93cd-4339-a2f5-beb53171d700`** (`status_alvo=agendado`, "Perfeito! Seu agendamento foi confirmado") está **desativada** — a IA já manda a confirmação no momento certo após `agendar_visita`. A automação `e254400e…` (`status_alvo=confirmado`, "Show, presença confirmada") segue ativa.
- **`agendar-cliente`**: rejeita `data_horario` sem timezone explícito (regex `[+-]\d{2}:?\d{2}$|Z$`). Previne render de horário errado quando AI manda string sem offset.
- **`watchdog-inbound-orfao`**: skip se cliente confirmou agendamento nos últimos 60min (evita re-disparo de IA logo após "SIM").

## Janela outbound

`dentroDeJanelaComunicacaoCliente`: 08h–22h SP. Lembretes nunca disparam fora dessa faixa.

## O que sumiu

- Fluxo A antigo (transição cega para `lembrete_enviado` 24-48h antes, marcando `tentativas_lembrete=1` sem enviar nada).
- `processLembreteRetry` (mensagem "ainda não conseguimos confirmar" — gerava duplicação).
- `processLembreteDiaD` (lembrete fixo das 08h do dia da visita) — substituído pelo lembrete 1h antes.
- Automação `2a9f41ef…` ("Seu agendamento foi confirmado" no `status_alvo=agendado`) — gerava confirmação fantasma em transições regressivas.
