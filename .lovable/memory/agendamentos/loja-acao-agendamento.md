---
name: Loja age via Atrium Messenger (compareceu / noshow / venda fechada)
description: EF loja-acao-agendamento autenticada por JWT recebe ações da loja a partir do InFoco Messenger. Cards de cobrança chegam como notificacoes com tipo cobranca_comparecimento_loja / _2 e botões 3-em-1.
type: feature
---

## Endpoint
POST `/functions/v1/loja-acao-agendamento` (verify_jwt=true)
Body: `{ agendamento_id, acao: "compareceu"|"noshow"|"reverter_noshow"|"venda_fechada", valor_venda?, numero_venda?, numeros_os?, observacao? }`

Permissão: usuário precisa estar nos `resolver_destinatarios_loja(loja_nome)` ou ser admin.

## Efeitos
- compareceu → status=compareceu, loja_confirmou_presenca=true, evento_crm `loja_confirmou_comparecimento`.
- noshow → status=no_show, evento `loja_marcou_noshow` (motivo opcional). Dispara cadência IA via trigger.
- reverter_noshow → volta para compareceu, zera tentativas_recuperacao, evento `loja_reverteu_noshow`.
- venda_fechada → status=venda_fechada + valor/numero/OS, evento `venda_fechada`.
- Marca como lidas todas notificacoes relacionadas (cobrança e avisos) deste agendamento.

## Tipos de notificação que o Messenger reconhece (botões 3-em-1)
- `agendamento_novo_loja` (no momento do agendar)
- `agendamento_confirmado_loja` (no dia-D quando cliente confirma)
- `cobranca_comparecimento_loja` (1ª, 2h após o horário)
- `cobranca_comparecimento_loja_2` (2ª, 10h SP do dia seguinte)

Após 48h sem ação, agendamentos-cron cria tarefa supervisor + status=no_show.
