## Problema

Caso **Ivani Mendes Ferreira** (06/05 20:42 → 20:50):

```text
20:39  outbound  [Template: link_pagamento_cliente_v3] R$ 1,07
20:42  outbound  [Template: link_pagamento_cliente_v3] R$ 1.070,00
20:50  inbound   [image]   ← era o COMPROVANTE de pagamento
20:51  outbound  IA: "Recebi sua receita 👀 Já estou analisando…"
22:00  outbound  [Template: retomada_contexto_1]   ← cliente nunca foi respondido
```

A IA tratou o comprovante de pagamento como receita ocular e disparou `interpretar_receita`. A interpretação obviamente falha (não é receita), a conversa morre, e horas depois o watchdog dispara retomada — péssima experiência logo após o cliente pagar.

## Causa raiz

Em `ai-triage/index.ts`, quando chega uma `[image]` o motor assume **sempre** que é receita:
- `detectForcedToolIntent` (linha ~482) → força `interpretar_receita`
- Fallback de imagem (linha ~675) → "Recebi sua receita…"
- Hint de prioridade máxima (linha ~2492) → ordena ao LLM chamar `interpretar_receita`

Não existe nenhuma checagem do contexto recente de **link de pagamento enviado**. Qualquer imagem após template de pagamento é interpretada como Rx.

## Correção proposta

Adicionar detecção de **contexto de pagamento pendente** que tem prioridade sobre o fluxo de receita.

### 1. Helper `hasPendingPaymentContext(recentOutbound, atendimentoId)`

Retorna `true` quando, nas últimas N (≈10) mensagens outbound:
- Existe `[Template: link_pagamento_*]` enviado nas últimas 24h, **ou**
- Existe solicitação `tipo='link_pagamento'` com `status` em (`aberta`,`enviado`,`pendente`) sem `metadata.comprovante_recebido_at`

Implementação: regex no array `recentOutbound` (já carregado) + 1 query leve em `solicitacoes` quando regex bater.

### 2. Novo branch no início de `runImageHandling` / antes do force `interpretar_receita`

Se `hasPendingPaymentContext` **e** mensagem inbound é imagem:
- **NÃO** chamar `interpretar_receita`
- **NÃO** mandar "Recebi sua receita…"
- Resposta: `"Recebi seu comprovante 🙌 Vou validar com a equipe e te confirmo já já. Qualquer coisa, é só me chamar por aqui."`
- `precisa_humano: true`, `pipeline_coluna: "Aguardando Pagamento"` (ou a coluna atual de pagamento — confirmar com `pipeline_colunas` do setor Financeiro)
- Marcar `solicitacao.metadata.comprovante_recebido_at = now()` + `tipo_imagem='comprovante'` na mensagem
- Inserir `eventos_crm` `comprovante_pagamento_recebido`
- Notificar fila Financeiro (push + notificação Atrium) para validação manual do TID/NSU

### 3. Bloquear hints conflitantes

Nos pontos onde se monta hint `"PRIORIDADE MÁXIMA — RECEITA PENDENTE"` (linha ~2492) e o force-retry de `interpretar_receita` (linha ~3941), adicionar guarda: se `hasPendingPaymentContext`, pular esses hints/retries.

### 4. Memória

Criar `mem://ia/comprovante-vs-receita-prioridade.md` documentando a regra: imagem inbound após link de pagamento = comprovante, nunca receita.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — helper + branch + 2 guardas
- `mem://ia/comprovante-vs-receita-prioridade.md` — nova memória
- (opcional) atualizar índice de memórias

## Fora do escopo

- OCR de comprovante / extração automática de TID — fica manual no Atrium por enquanto
- Mudanças em `payment-webhook` ou templates

Aprovação?
