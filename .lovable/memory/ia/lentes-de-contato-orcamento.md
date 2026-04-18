---
name: Lentes de Contato — Orçamento e Combo
description: Catálogo pricing_lentes_contato + tool consultar_lentes_contato. Pós-receita = fluxo obrigatório (tool→2-3 opções com descartes variados→região→agendar). Esporte = dica consultiva, não filtro. Combo 3+1 mensais/quinzenais. Tórica obrigatória se cyl≥0.75 (sob encomenda). Prioriza DNZ.
type: feature
---

## Tabela
`pricing_lentes_contato`: fornecedor, produto, descarte (diario|quinzenal|mensal|anual), unidades_por_caixa, dias_por_unidade, sphere/cylinder min/max, is_toric, is_dnz, combo_3mais1, price_brl, priority.

## Tool: consultar_lentes_contato
Filtra por sphere/cylinder da receita (`metadata.receitas[ultimo]`). Se `|cyl| ≥ 0.75` em qualquer olho ⇒ força `is_toric=true` (sob encomenda). Ordena por `is_dnz desc, priority asc, price asc`.

## Fluxo obrigatório pós-receita LC (igual a óculos)
Hint determinístico em `ai-triage` (`detectPendingIntent` + `detectForcedToolIntent`) detecta contexto LC ("lente de contato", "LC", "diária/quinzenal/mensal", "tórica", "esporte/academia/corrida/futebol/natação/treino") e força:
1. `consultar_lentes_contato` (NÃO `consultar_lentes`)
2. Apresentar **2-3 opções com descartes VARIADOS** — mín. 2 categorias diferentes entre diária + quinzenal + mensal
3. Perguntar região
4. Sugerir agendamento na loja mais próxima

Proibido encerrar pedindo apenas marca/tipo quando já há receita salva.

## Esporte = dica consultiva, NUNCA filtro
Se cliente menciona esporte/academia/corrida/futebol/natação:
- Recomenda DIÁRIA como mais indicada (frase curta: "lente nova a cada uso, sem estojo, sem solução, zero risco com suor")
- **SEMPRE** apresenta também quinzenal/mensal — cliente decide
- Nunca remove opções por causa do uso esportivo

## Combo 3+1 (mensais/quinzenais)
- 1 unidade = 1 mês (mensal) ou 15 dias (quinzenal) por OLHO
- Mesma dioptria OD=OE: 1 caixa atende ambos → divide duração por 2
- Dioptrias diferentes: 1 caixa por olho (mín. 2 caixas)
- 3 caixas pagas + 1 grátis = 4 caixas → ~12 meses
- Diárias: combo NÃO se aplica

## Tóricas
Cilíndrico ≥ 0.75 ⇒ obrigatória. Sempre SOB ENCOMENDA — pagamento confirma o pedido.

## Receita ilegível / baixa confiança
Se `confidence < 0.6` ou `needs_human_review=true` ou eyes vazios: pedir valores por texto (OD esf/cil + OE esf/cil) MAS já apresentar 2-3 opções genéricas do catálogo (DNZ 1 Day diária, DNZ Mensal, Biofinity) com preços base — não travar.

## Caso Guilherme Gomes (5511992589925, 18-04-2026)
Após enviar receita (leitura parcial, eyes vazios), IA travou em "Lentes de contato é com nosso Consultor especializado..." pedindo marca/tipo. Cliente respondeu "uso pra esporte" e ficou parado. Correção: fluxo pós-receita LC agora obrigatório. Mensagem manual enviada via Gael com 3 opções (DNZ 1 Day R$204,99 + DNZ Mensal combo R$614,97 + Biofinity Energys combo R$930) + pedido de receita por texto + pergunta de região.

## Regra desativada
`lentes_de_contato` em `ia_regras_proibidas` foi desativada (id 489cef81-bbc9-4d87-b1f3-0a785afcca21).
