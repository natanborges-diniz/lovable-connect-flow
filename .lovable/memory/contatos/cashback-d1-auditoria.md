---
name: Cashback D+1 — Reconciliação e Auditoria
description: Cron 07h, auto-aprovação silenciosa, demanda interna à loja em divergência; cliente nunca é notificado
type: feature
---

## Regra dura — comunicação ao cliente

A ÚNICA comunicação ao cliente sobre cashback acontece no **ato da venda** (PIN + saldo gerado).
**Toda** a reconciliação D+1 é silenciosa: confirmação automática, abertura de divergência, decisão da loja, aprovação do supervisor, cancelamento — nada disso dispara WhatsApp, push ou template ao cliente final.
Ao consultar saldo no atendimento, o cliente vê o valor já "disponível" sem nunca ter sabido que esteve "provisório".

## Fluxo

1. Cron `regua-reconciliacao-diaria-07h-sp` (cron_jobs schedule_id=12) roda **07:00 SP / 10:00 UTC**.
2. `regua-reconciliacao` para cada `regua_inscricao.status='aguardando_entrega'`:
   - Consulta bridge `/api/v1/crm/venda`.
   - `valor_status='ok'` → chama `cashback_confirmar_credito` automaticamente + evento interno `cashback_confirmado`.
   - `valor_status='divergente'` → NÃO confirma; chama `criar-demanda-loja` (loja `cod_empresa`, telefone `__INTERNO__`) e marca `tipo_chave='cashback_divergencia'` com metadata `{ inscricao_id, numero_venda, valor_lancado, valor_sistema, diff, silencioso_cliente: true }`. Salva `regua_inscricao.demanda_divergencia_id`. Evento interno `cashback_divergente`.
   - `sem_venda` → incrementa `tentativas_reconciliacao`; ao chegar em 5x marca `valor_status='sem_venda_persistente'` e cria notificação interna `cashback_sem_venda_persistente`.

## RPCs

- `cashback_aprovar_divergencia(_inscricao_id, _valor_aceito, _origem, _motivo)` — recalcula `cashback_credito` com `_valor_aceito`, marca `valor_status='ok'`, encerra demanda associada com metadata `cashback_decisao`. Origens válidas: `loja_ajustou_sistema`, `loja_manteve_lancado`, `supervisor_override`, `supervisor_aprovou_sistema`, `supervisor_aprovou_lancado`.
- `cashback_cancelar_inscricao(_inscricao_id, _motivo)` — zera o crédito (status=cancelado), marca inscrição como cancelada, encerra demanda.

Ambas registram `eventos_crm` interno e **não** enviam nada ao cliente.

## UI

- **Loja (DemandaThreadView)**: quando `tipo_chave='cashback_divergencia'` renderiza `<CashbackDivergenciaCard>` com 2 botões — "Ajustar para sistema" (`loja_ajustou_sistema`) e "Manter lançado" (`loja_manteve_lancado` → aguarda supervisor).
- **Supervisor (`/regua/auditoria`)**: tabela filtrada por status (divergente / sem_venda_persistente / todas), ações Sistema / Lançado / Cancelar / Reprocessar.

## Reativação

Se uma divergência precisa de novo ciclo, basta apagar `demanda_divergencia_id` e rodar a edge function — ela reabre.
