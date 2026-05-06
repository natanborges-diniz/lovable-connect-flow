---
name: Comprovante vs Receita — prioridade pós-link
description: Imagem inbound após template link_pagamento_* (ou solicitação tipo=link_pagamento aberta) é tratada como comprovante e escala humano; nunca dispara interpretar_receita
type: feature
---

## Regra
Se `lastIsImage` E (regex `[Template: link_pagamento*]` em `recentOutbound[-10]` OU existe `solicitacoes.tipo='link_pagamento'` últimas 24h sem `metadata.comprovante_recebido_at`) → **short-circuit** em `ai-triage`:

1. Envia: "Recebi seu comprovante 🙌 Vou validar com a equipe e te confirmo já já. Qualquer coisa, é só me chamar por aqui."
2. `atendimentos.modo = 'humano'`
3. Marca `solicitacoes.metadata.comprovante_recebido_at = now()` na solicitação de pagamento mais recente
4. Insere `eventos_crm` `comprovante_pagamento_recebido`
5. Retorna sem chamar LLM nem `interpretar_receita`

## Por quê
Sem isso, o motor assume que toda imagem é receita ocular (caso Ivani Mendes 06/05). `interpretar_receita` falha em comprovante, conversa morre, watchdog dispara retomada — péssimo logo após o cliente pagar.

## Ponto de inserção
Logo após `isImageContext` em `supabase/functions/ai-triage/index.ts` (~linha 2004). Roda antes de qualquer prompt/LLM.
