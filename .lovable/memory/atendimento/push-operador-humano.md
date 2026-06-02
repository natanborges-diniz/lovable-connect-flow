---
name: Push ao operador atribuído no atendimento humano
description: Push (SW) + toast/bipe in-app quando atendimento vira humano e a cada inbound; auto-claim ao abrir + fallback admin/colaborador
type: feature
---

## Fluxo
- `atendimentos.atendente_user_id` é setado por auto-claim quando o operador abre o detail dialog (mutation `useClaimAtendimento`, UPDATE idempotente `WHERE atendente_user_id IS NULL`).
- Trigger `trg_atendimento_modo_humano` (AFTER UPDATE OF modo) insere `notificacoes` (`tipo='atendimento_humano'`) via `resolver_destinatarios_atendimento`.
- Trigger `trg_mensagem_inbound_humano` (AFTER INSERT em mensagens) faz o mesmo para cada inbound enquanto `modo='humano'` e `status<>'encerrado'` (`tipo='atendimento_inbound'`).
- `trg_push_nova_notificacao` envia Web Push com `url=/crm/conversas?open={id}` (rota real) e `tag=at_{id}` (colapsa duplicatas no device).
- Som de background = padrão do device. Som in-app = bipe WebAudio (880Hz, ~0.35s).

## In-app (app aberto)
- `useAtendimentoNotifier` (mount em `AppLayout`) escuta INSERT em `notificacoes` com `usuario_id=eq.{me}` (RLS).
- Para `tipo IN (atendimento_humano, atendimento_inbound)`: dispara `toast()` com ação **Abrir** → `navigate('/crm/conversas?open={referencia_id}')` + bipe WebAudio.
- Dedup local via `seenRef` para evitar duplicar se a aba reabrir a subscription.

## `resolver_destinatarios_atendimento` (ordem de fallback)
1. `atendente_user_id` se preenchido.
2. Profiles ativos do `setor_id` da `pipeline_coluna_id` do contato (via `profiles.setor_id` OU `user_roles.setor_id`).
3. Fallback final: todos profiles ativos com `tipo_usuario IN ('admin','colaborador')`.

## Reset
- `useLiberarAtendimento` zera `atendente_user_id`/`atendente_nome`; o próximo a abrir reassume.
