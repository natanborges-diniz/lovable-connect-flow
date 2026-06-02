---
name: Push ao operador atribuído no atendimento humano
description: Notificação push (som padrão) quando atendimento vira humano e a cada inbound; auto-claim ao abrir + fallback admin/colaborador
type: feature
---

## Fluxo
- `atendimentos.atendente_user_id` é setado por auto-claim quando o operador abre o detail dialog (mutation `useClaimAtendimento`, UPDATE idempotente `WHERE atendente_user_id IS NULL`).
- Trigger `trg_atendimento_modo_humano` (AFTER UPDATE OF modo em atendimentos) insere `notificacoes` (`tipo='atendimento_humano'`) via `resolver_destinatarios_atendimento`.
- Trigger `trg_mensagem_inbound_humano` (AFTER INSERT em mensagens) faz o mesmo para cada inbound enquanto `modo='humano'` e `status<>'encerrado'` (`tipo='atendimento_inbound'`).
- `trg_push_nova_notificacao` usa `url=/atendimentos?atendimento={id}` e `tag=at_{id}` para `atendimento_*` (Web Push tag colapsa duplicatas).
- Som = padrão do device (sw.js `vibrate` + Notification nativo).

## `resolver_destinatarios_atendimento` (ordem de fallback)
1. `atendente_user_id` se preenchido.
2. Profiles ativos do `setor_id` da `pipeline_coluna_id` do contato (via `profiles.setor_id` OU `user_roles.setor_id`).
3. **Fallback final**: todos profiles ativos com `tipo_usuario IN ('admin','colaborador')` — operadores corporativos sem setor formal. Sem isso, atendimentos em colunas sem `setor_id` (ex.: `Novo Contato`, `Atendimento Humano`) nunca notificavam ninguém.

## Reset
- `useLiberarAtendimento` zera `atendente_user_id`/`atendente_nome`; o próximo a abrir reassume.
