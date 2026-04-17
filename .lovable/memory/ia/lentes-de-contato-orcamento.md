---
name: Lentes de Contato — Orçamento e Combo
description: Catálogo pricing_lentes_contato + tool consultar_lentes_contato. Calcula combo 3+1 (mensais/quinzenais) por unidades_por_caixa × dias_por_unidade ÷ 2 olhos. Tórica obrigatória se cilindro ≥ 0.75 (sob encomenda). Prioriza DNZ. Diárias sem combo.
type: feature
---

## Tabela
`pricing_lentes_contato` com colunas: fornecedor, produto, descarte (diario|quinzenal|mensal), unidades_por_caixa, dias_por_unidade, sphere_min/max, cylinder_min/max, is_toric, is_dnz, combo_3mais1, price_brl, priority.

## Tool: consultar_lentes_contato
Filtra por sphere/cylinder da receita salva (metadata.receitas[]). Se `|cyl| ≥ 0.75` em qualquer olho ⇒ força `is_toric=true`. Ordena por `is_dnz desc, priority asc, price asc`. Retorna até 3 opções diversas (fornecedor + descarte).

## Combo 3+1 (mensais/quinzenais)
- 1 unidade = 1 mês (mensal) ou 15 dias (quinzenal) por OLHO
- Mesma dioptria OD=OE: 1 caixa atende ambos → divide duração por 2
- Dioptrias diferentes: 1 caixa por olho (mín. 2 caixas)
- 3 caixas pagas + 1 grátis = 4 caixas → ~12 meses (1 ano completo)
- Diárias: combo NÃO se aplica

## Tóricas
Cilíndrico ≥ 0.75 ⇒ obrigatória. Sempre SOB ENCOMENDA — pagamento confirma o pedido.

## Regra desativada
`lentes_de_contato` em `ia_regras_proibidas` foi desativada (id 489cef81-bbc9-4d87-b1f3-0a785afcca21).
