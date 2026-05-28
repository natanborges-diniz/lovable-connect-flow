# Plano — IA responde formas de pagamento sem escalar

## Problema observado

No atendimento da Tay, após receber a cotação a cliente perguntou:
1. *"Qual é a forma de pagamento?"* → IA respondeu evasivo ("Já te mandei as opções acima")
2. *"Somente à vista?"* → IA escalou para humano

Isso é um intent comercial básico que a IA deve resolver sozinha, sem queimar fila humana nem perder o momento de compra.

## Solução

Adicionar conhecimento determinístico sobre formas de pagamento + intent detector no `ai-triage`, espelhando o padrão já usado para "Consulta de OS" (router pre-LLM + mensagem fixa editável).

## Mudanças

### 1. Nova mensagem fixa editável

Inserir em `ia_mensagens_fixas` a chave `formas_pagamento` com o conteúdo padrão (editável depois pela equipe via UI de auditoria/configurações):

```
Trabalhamos com várias formas pra facilitar pra você 😊

💳 *Cartão de crédito* — em até *10x sem juros*
💰 *PIX / dinheiro* — com *desconto à vista*
🧾 *Boleto* — à vista ou parcelado
📋 *Crediário próprio Óticas Diniz* — análise na hora, sem cartão

Posso já agendar uma visita na loja mais próxima pra você fechar o pedido? Me conta seu bairro 📍
```

### 2. Router pre-LLM no `ai-triage`

Adicionar detector análogo ao `os_intent`:
- Keywords: `forma de pagamento`, `formas de pagamento`, `como pago`, `como posso pagar`, `parcela`, `parcelar`, `parcelado`, `à vista`, `a vista`, `pix`, `boleto`, `cartão`, `crediário`, `crediario`, `aceita cartão`, `só à vista`, `somente à vista`
- Keywords editáveis em `configuracoes_ia.pagamento_intent_keywords` (JSONB)
- Match: envia `ia_mensagens_fixas.formas_pagamento` direto (cache 60s + fallback), bypassando LLM
- Mantém modo IA (não escala) e não dispara `agendar_visita` automaticamente — só sugere
- Skip do detector se já houver `[Template: link_pagamento_*]` recente ou comprovante pendente (delega ao fluxo financeiro)

### 3. Reforço no prompt compiler

Adicionar 1 bullet curto na seção de regras comerciais:
> *Pagamento:* nunca responder "já mandei acima" nem escalar. Formas aceitas: crédito 10x sem juros, PIX/dinheiro à vista, boleto, crediário próprio. Conduzir para agendamento.

### 4. Auditoria

Auditor pode editar a mensagem via tool `ajustar_mensagem_fixa` (já existente) e as keywords via tool de configuração (padrão já existente para `os_intent_keywords`).

## Detalhes técnicos

**Arquivos:**
- `supabase/functions/ai-triage/index.ts` — adicionar `runPagamentoIntentRouter()` antes do LLM, após router OS
- Migration: insert em `ia_mensagens_fixas` (chave `formas_pagamento`) + insert/default em `configuracoes_ia.pagamento_intent_keywords`
- Memória nova: `mem://ia/formas-pagamento-router` documentando o padrão

**Não muda:**
- Fluxo de link de pagamento (`payment-webhook`, templates `link_pagamento_*`)
- Pipeline financeiro
- UI cliente

## Critério de pronto

- Tay perguntando "qual a forma de pagamento?" → IA responde com as 4 formas + CTA agendamento, sem escalar
- "Somente à vista?" → mesma resposta (re-trigger pelo intent detector)
- Edição da mensagem via UI reflete em até 60s no próximo atendimento
