---
name: Watchdog Inbound Órfão
description: Cron 1min detects atendimentos modo=ia where last message is inbound >2min without outbound reply, force-fires ai-triage to recover silent drops
type: feature
---

# Watchdog Inbound Órfão (sistema)

## Problema
Mensagens inbound podem chegar logo após uma outbound (durante debounce/lock) e o `whatsapp-webhook` pular o disparo do `ai-triage` sem reagendar. Resultado: cliente fica sem resposta indefinidamente (ex: caso Laleska — pergunta às 13:14, sem resposta por horas, modo ainda IA).

## Solução
Edge function `watchdog-inbound-orfao` rodando a cada 1 minuto via pg_cron:

1. Lista atendimentos `modo='ia'` e `status != 'encerrado'`
2. Para cada um, pega a última mensagem
3. Se for `direcao='inbound'` com idade entre 2min e 180min → órfão candidato
4. Anti-corrida: ignora se `metadata.orfao_watchdog_last_at` < 90s
5. Marca timestamp, dispara `ai-triage` com `trigger='orfao_watchdog'`
6. Loga `orfao_pos_resposta_recuperado` em `eventos_crm`

## Limites
- Janela mínima 2min: respeita debounce normal do ai-triage
- Janela máxima 180min: conversas mais antigas vão pro fluxo manual `recuperar-atendimentos` (página de Recuperação)
- Roda só em `modo=ia`: humano/híbrido não é responsabilidade dele
- Marca timestamp ANTES da chamada (evita disparo duplo se ai-triage demora)

## Diferença vs watchdogs existentes
- `watchdog-loop-ia` → escala para humano quando IA repete frases
- `watchdog-inbound-orfao` → re-dispara IA quando ela ficou silenciosa
- `recuperar-atendimentos` → ferramenta manual pós-downtime (idade >15min default)

## Auditoria
Evento `orfao_pos_resposta_recuperado` com `metadata.idade_min` e `triage_status` permite contar quantas vezes o sistema autocorrigiu silent-drops.
