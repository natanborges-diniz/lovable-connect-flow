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

## Janela outbound

`dentroDeJanelaComunicacaoCliente`: 08h–22h SP. Lembretes nunca disparam fora dessa faixa.

## O que sumiu

- Fluxo A antigo (transição cega para `lembrete_enviado` 24-48h antes, marcando `tentativas_lembrete=1` sem enviar nada).
- `processLembreteRetry` (mensagem "ainda não conseguimos confirmar" — gerava duplicação).
- `processLembreteDiaD` (lembrete fixo das 08h do dia da visita) — substituído pelo lembrete 1h antes.
