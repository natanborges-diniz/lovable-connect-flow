---
name: Push ao operador atribuído no atendimento humano
description: Notificação push (som padrão) quando atendimento vira humano e a cada inbound; auto-claim ao abrir o detalhe
type: feature
---

## Fluxo
- `atendimentos.atendente_user_id` é setado por auto-claim quando o operador abre o detail dialog de um atendimento em `modo='humano'` sem atendente (mutation `useClaimAtendimento`, UPDATE idempotente `WHERE atendente_user_id IS NULL`).
- Trigger `trg_atendimento_modo_humano` (AFTER UPDATE OF modo em atendimentos) insere `notificacoes` (`tipo='atendimento_humano'`) para o atendente, ou — se vazio — para todos os profiles ativos do setor da coluna do contato.
- Trigger `trg_mensagem_inbound_humano` (AFTER INSERT em mensagens) faz o mesmo para cada inbound enquanto `modo='humano'` e `status<>'encerrado'` (`tipo='atendimento_inbound'`).
- `trg_push_nova_notificacao` foi atualizado: para tipos `atendimento_*`, usa `url=/atendimentos?atendimento={id}` e `tag=at_{id}` (Web Push tag colapsa duplicatas).
- Som é o padrão do sistema do device — `sw.js` já tem `vibrate` e `Notification` nativo. Não há áudio custom in-app.

## Reset
- `useLiberarAtendimento` zera `atendente_user_id`/`atendente_nome`; o próximo a abrir reassume.
