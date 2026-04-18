---
name: Marca Kodak — escalada manual obrigatória
description: Kodak Precise existe na operação mas ainda não foi cadastrada em pricing_table_lentes; sempre escalar para humano, nunca prometer valor
type: feature
---

# Kodak — regra operacional

## Realidade
- **Trabalhamos sim com Kodak** (linha Precise multifocal, com Transitions Gen S + Blue UV).
- A tabela de preços oficial existe fisicamente, mas **ainda não foi alimentada** em `pricing_table_lentes`.
- Faixa de referência (uso interno, não responder ao cliente): a partir de R$ 969 (Trio Easy Clean) até R$ 3.584 (Crizal Prevencia + Transitions ativado em poly).

## Regra para o Gael
1. Se o cliente perguntar "vocês trabalham com Kodak?" → **confirmar SIM** ("Trabalhamos sim com Kodak ✅").
2. **NUNCA citar valores** de Kodak (não estão no banco — risco de inventar).
3. **Sempre escalar para humano** com tag/contexto `kodak_orcamento_manual`.
4. Resposta padrão: "Trabalhamos sim com Kodak ✅ Vou te conectar agora com um consultor pra passar os valores certinhos da linha Precise."

## Por que não cair no fluxo normal de quote
O `quote-engine` consulta `pricing_table_lentes` (DNZ, DMAX, HOYA, ESSILOR, ZEISS). Como Kodak não está lá, qualquer tentativa de orçar resultaria em:
- "Não temos Kodak" (falso) ❌
- Equivalente em outra marca sem o cliente pedir ❌
- Valor inventado ❌

## Quando remover esta regra
Quando a tabela Kodak Precise (1.50 Transitions Gen S Blue UV + 1.50 Poly Polywave Blue UV, com tratamentos Crizal Prevencia/Sapphire HR/Rock/Easy Pro, Optifog, No Reflex, Trio Easy Clean, Sem AR) for cadastrada em `pricing_table_lentes` com `brand='KODAK'`.

## Implementação
- 1 regra em `ia_regras_proibidas` (categoria `informacao_falsa`)
- 1 exemplo em `ia_exemplos`
- Injetadas automaticamente pelo `compile-prompt`
