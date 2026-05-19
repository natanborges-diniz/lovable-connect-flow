---
name: Receita Pending Anti-Loop Pós-Cotação
description: Gate de confirmação de receita em ai-triage limpa pending automaticamente se uma cotação (faixas 🟢/🟡/💎 ou Econômica/Intermediária/Premium com R$) já foi enviada (humano ou IA). Evita loop "Li sua receita assim, confere?" eterno.
type: feature
---

## Problema (Mai/2026, caso Wilson)

Operador humano enviou cotação manual com receita já lida (multifocal ESF +0,50/+1,00 ADD +2). Cliente respondeu com dúvidas ("qual melhor: intermediária ou premium?", desconforto com celular/claridade). IA voltou em loop disparando `buildMsgConfirmarReceita` porque `metadata.receita_confirmacao.pending` continuava true.

Causa: gate na linha 3334 só limpa pending em "sim"/"confere" explícito; qualquer outro texto re-dispara confirmação.

## Fix

No início do gate `isReceitaPending`, antes da lógica principal:

- Junta `recentOutbound` (últimas 10 outbounds).
- Se contém marcadores de cotação (`🟢|🟡|💎|Econômica|Intermediária|Premium`) **+** `R$`, considera cotação já enviada.
- Se cliente NÃO está confirmando, rejeitando, nem corrigindo receita por texto → limpa `pending=false`, marca `confirmed_via=cotacao_ja_enviada_implicito`, registra evento `receita_confirmada_implicita_pos_cotacao` e deixa o LLM responder a dúvida real.

Não interfere quando cotação ainda não foi enviada (fluxo normal de confirmação segue).
