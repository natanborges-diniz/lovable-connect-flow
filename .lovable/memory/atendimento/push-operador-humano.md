---
name: Push ao operador atribuído no atendimento humano
description: Push (SW) + toast/bipe in-app quando atendimento vira humano e a cada inbound; auto-claim ao abrir + fallback admin/colaborador. Bloqueia loja.
type: feature
---

## Fluxo
- `atendimentos.atendente_user_id` é setado por auto-claim quando o operador abre o detail dialog (mutation `useClaimAtendimento`, UPDATE idempotente `WHERE atendente_user_id IS NULL`).
- Trigger `trg_atendimento_modo_humano` (AFTER UPDATE OF modo) insere `notificacoes` (`tipo='atendimento_humano'`) via `resolver_destinatarios_atendimento`.
- Trigger `trg_mensagem_inbound_humano` (AFTER INSERT em mensagens) faz o mesmo para cada inbound enquanto `modo='humano'` e `status<>'encerrado'` (`tipo='atendimento_inbound'`).
- `trg_push_nova_notificacao` envia Web Push com `url=/crm/conversas?open={id}` e `tag=at_{id}`.

## In-app
- `useAtendimentoNotifier` (mount em `AppLayout`) escuta INSERT em `notificacoes` para o usuário logado e dispara toast + bipe WebAudio.

## `resolver_destinatarios_atendimento` (ordem)
1. `atendente_user_id` se preenchido (respeitado mesmo se for loja — claim explícito).
2. Fallback por setor da coluna do contato — **exclui `tipo_usuario='loja'`**.
3. Fallback final: profiles ativos com `tipo_usuario IN ('admin','colaborador')`.

## Regra crítica
**Conta `tipo_usuario='loja'` NUNCA recebe `atendimento_inbound`/`atendimento_humano` do CRM** por fallback — só recebe se for atendente explicitamente atribuído. Isso evita vazamento de conversas do consultor para contas de loja no InFoco Messenger.

## Derivação correta de `tipo_usuario`
- `sync_from_user_acessos()` usa `COALESCE(array_length(...),0) > 0` (não `IS NOT NULL AND array_length>0`) — caso contrário arrays vazios geram NULL e a regra cai em `colaborador` por engano, contaminando o fallback corporativo.
- `lojas` preenchidas + `setores` vazio → `tipo='loja'` + `user_roles.role='setor_usuario'` com `loja_nome`.

## Reset
- `useLiberarAtendimento` zera `atendente_user_id`/`atendente_nome`.
