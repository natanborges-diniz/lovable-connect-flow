---
name: Bloqueio de retomada pós encerramento/cancelamento
description: Flag persistente nao_retornar_automaticamente em atendimentos.metadata impede vendas-recuperacao-cron de disparar retomada_contexto_* após cliente encerrar, agradecer pós-agendamento, dispensar ajuda ou cancelar visita.
type: feature
---

## Problema
Cliente cancelava a visita (cancelar_visita) ou pedia "Encerrar atendimento" e horas depois recebia `retomada_contexto_1` ("Estávamos conversando sobre as lentes..."). Risco de bloqueio do número na Meta.

## Solução
`ai-triage/index.ts` grava `atendimentos.metadata.nao_retornar_automaticamente=true` (+ `encerrado_pelo_cliente_at`, `encerrado_motivo`) em 3 pontos:
- despedida determinística `isExplicitClose` (também seta `status='encerrado'` + `fim_at`)
- despedida determinística `isThanksClose` / `isShortNoToHelp`
- tool `cancelar_visita` (motivo=`cancelamento_cliente`)

`vendas-recuperacao-cron/index.ts` lê esse flag no início de `processContato` (antes do branch IA/humano) e retorna sem disparar template/IA quando true.

## Reentrada
Quando o cliente volta a falar, `whatsapp-webhook` abre/reativa o atendimento normalmente. Se a IA julgar que voltou a haver intent ativo (preço, agendar, foto, "?"), ela retoma a conversa. O flag não é limpo automaticamente — quem reabre o ciclo é o próprio cliente; o cron só deixa de bloquear quando um novo atendimento é criado, ou quando o operador remove o flag manualmente.

## Motivos registrados
- `encerramento_explicito` — cliente disse "encerrar atendimento"
- `agradecimento_pos_agendamento` — "obg" após agendamento confirmado
- `dispensou_ajuda` — "não" após "posso ajudar em mais alguma coisa?"
- `cancelamento_cliente` — tool cancelar_visita executou
