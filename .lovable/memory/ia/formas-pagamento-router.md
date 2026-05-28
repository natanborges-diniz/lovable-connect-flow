---
name: Formas de Pagamento Router Determinístico
description: Router pre-LLM em ai-triage detecta intent de pagamento (forma/parcela/à vista/PIX/boleto/cartão/crediário) e responde com ia_mensagens_fixas.formas_pagamento sem escalar; skip se houver template link_pagamento ativo
type: feature
---

# Formas de pagamento — resposta determinística

## Problema
IA respondia "já mandei acima" ou escalava quando cliente pergunta forma de pagamento. Queima fila humana num intent comercial básico que deve ser auto-resolvido.

## Solução
Router pre-LLM em `ai-triage/index.ts` (após router OS), análogo ao OS:

- **Keywords editáveis:** `configuracoes_ia.pagamento_intent_keywords` (JSON array). Default cobre "forma de pagamento", "parcela", "à vista", "pix", "boleto", "crediário", "aceita cartão", "em quantas vezes", etc.
- **Regex núcleo:** sempre ativo, cobre paráfrases ("como posso pagar", "qual a forma", "tem cartão", "somente à vista").
- **Mensagem:** `ia_mensagens_fixas.formas_pagamento` (editável). Default lista 4 formas: crédito 10x s/juros, PIX/dinheiro à vista (desconto), boleto, crediário próprio Óticas Diniz. Termina com CTA agendamento + pergunta bairro.

## Gate de skip
Se últimos 5 outbounds contiverem `[Template: link_pagamento*]`, **delega ao fluxo financeiro** e não responde (evita atropelar comprovante/pagamento em curso).

## Saída
- `sendWhatsApp` direto (não escala, mantém modo IA).
- Evento `eventos_crm.tipo=duvida_pagamento` com `mensagem_cliente` + modo.
- Retorno `tools_used: ["router_formas_pagamento"]`, `intencao: "duvida_pagamento"`.

## Auditoria
- Mensagem editável via tool `ajustar_mensagem_fixa(chave='formas_pagamento', ...)`.
- Keywords editáveis via tool de config (mesmo padrão de `os_intent_keywords`).
- Cache 60s no edge function.

## Branding
Mensagem assina/menciona "Óticas Diniz" (crediário próprio) — segue regra de branding cliente final.
