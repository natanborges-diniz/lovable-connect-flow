---
name: Orçamento estimado com receita parcial
description: Quando o cliente declara o tipo de lente (multifocal/progressiva/visão simples) e fornece pelo menos o esférico, mas faltam ADIÇÃO/CIL/AX, a IA usa a tool consultar_lentes_estimativa pra devolver 3 faixas (Econômica/Intermediária/Premium) marcadas como "valores estimativos" — e só DEPOIS pede os dados que faltam. Nunca trava o cliente sem dar uma estimativa primeiro.
type: feature
---

## Tool: `consultar_lentes_estimativa`

Definida em `supabase/functions/ai-triage/index.ts`. Parâmetros:
- `rx_type` ('progressive' | 'single_vision') — obrigatório
- `sphere_od`, `sphere_oe` — esféricos com sinal (negativo p/ miopia)
- `cylinder_hint` — opcional (se cliente disse só "tem astigmatismo" sem número, OMITIR — a tool usa -0.75 como default conservador)
- `filtro_blue`, `filtro_photo` — opcionais

Implementação: `runConsultarLentesEstimativa()` varre `pricing_table_lentes` filtrando por categoria + esférico/cilindro do cliente. Para multifocal roda 3 ADDs (+1.50, +2.00, +2.50) e funde resultados. Dedup por brand+family+treatment, escolhe econômica (menor preço), premium (maior) e intermediária (mediana).

## Regra no system prompt (`buildOrcamentoParcialBlock`)

> Se cliente declarou tipo + esférico mas faltam ADD/CIL: SEMPRE chamar `consultar_lentes_estimativa` ANTES de pedir os dados que faltam.
> PROIBIDO responder só "preciso da ADD pra fechar" — sempre dar a faixa primeiro.

## Resposta gerada

```
Com o que você passou (OD -2.75 / OE -2.25 com astigmatismo), uma estimativa de multifocal com antirreflexo:

🟢 Econômica — DNZ Próton: a partir de R$ 298,00
🟡 Intermediária — DMAX Plus: a partir de R$ 698,00
💎 Premium — Varilux Comfort: a partir de R$ 1.498,00

_Valores estimativos — com a ADIÇÃO e o cilindro/eixo exatos eu fecho o orçamento certinho._

Consegue me enviar foto da receita ou os números de ADD e CIL/AX de cada olho?
```

## Por que existe

Antes, IA respondia "multifocal a partir de R$298" e ficava em loop pedindo ADD. Cliente desistia. Agora tem 3 referências de preço REAIS do catálogo, mantém engajamento e pede o resto em paralelo.

## Não usar

- Se já há receita completa salva → use `consultar_lentes` normal.
- Para lentes de contato → use `consultar_lentes_contato`.
- Se cliente não declarou nem o tipo nem o esférico → peça foto da receita.
