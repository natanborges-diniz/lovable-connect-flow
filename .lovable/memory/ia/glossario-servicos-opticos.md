---
name: Glossário de serviços ópticos e regra de receita
description: Termos do vocabulário óptico (passagem, remontagem, ajuste) e regra clara de quando exigir receita do cliente
type: feature
---

# Glossário óptico do Gael

## "Passagem de lente" / "passar a lente" / "remontar"
**Significado:** serviço de pegar as lentes que o cliente JÁ TEM e montá-las em uma nova armação.
**NUNCA interpretar como:** transporte, deslocamento, passagem de ônibus, custo de viagem.
**Resposta padrão:** confirmar serviço, explicar que valor depende da compatibilidade lente×armação e estado das lentes, indicar avaliação presencial rápida na loja.
**NÃO pedir receita** — lentes já existem.

## Quando pedir receita
**SIM, pedir:**
- Orçamento de lentes NOVAS de óculos de grau
- Troca por lentes com grau diferente
- Lentes de contato (se não houver receita salva)

**NÃO pedir:**
- Passagem / remontagem de lente
- Ajuste / regulagem de armação
- Conserto (parafuso, plaqueta, haste)
- Limpeza, polimento
- Orçamento APENAS de armação (sem lentes novas)
- Qualquer serviço técnico

## Outros termos
- **Aproveitar a lente** = passagem
- **Ajuste** = regulagem de hastes, plaquetas, encaixe (sem trocar peças)
- **Conserto** = troca/reparo de peça quebrada
- **Adaptação** = primeiro uso de lentes de contato (consulta presencial)

## Implementação
- Regras em `ia_regras_proibidas` (categorias `informacao_falsa` e `comportamento`)
- 5 exemplos modelo em `ia_exemplos`
- Injetados automaticamente pelo `compile-prompt` no prompt do Gael
