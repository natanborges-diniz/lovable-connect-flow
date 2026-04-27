---
name: Receita Vazia + Shorthand de Correção
description: Receita salva com rx_type=unknown e olhos vazios não conta como receita; parser aceita shorthand óptico ("-400"→-4.00) e espaço entre sinal e número
type: feature
---

# Receita Vazia e Shorthand na Correção (ai-triage)

## Problema (caso Jardel — 2026-04-25)
1. OCR inicial salvou `rx_type=unknown`, `eyes.od={}`, `eyes.oe={}` com `confidence=0.75`.
2. A partir daí, `receitas.length > 0` passou a indicar “tem receita” → o sistema parou de forçar `interpretar_receita` e caiu no fluxo de orçamento.
3. Cliente corrigiu por texto: `Od -400 / Oe - 425`. Parser:
   - Salvou `OD=-400` literal (sem normalizar pra -4.00).
   - Não capturou OE porque havia espaço entre `-` e `425`.
4. Motor de orçamento buscou lente para grau impossível e respondeu "não localizei combinações" → escalada humana.

## Correções
### `isReceitaValida` / `hasReceitasValidas`
Receita só conta como válida quando `rx_type` ≠ `unknown`/vazio E pelo menos um olho tem `sphere` ou `cylinder` numérico. Substitui `receitas.length > 0` nos pontos críticos:
- `detectForcedToolIntent`
- hint de "FLUXO PÓS-RECEITA"
- hint "PRIORIDADE MÁXIMA — RECEITA PENDENTE"
- `detectPendingIntent`
- `precisaForcarInterpretacao` (retry forçado de OCR)
- `isImageContext`

Resultado: receita vazia/`unknown` = trata como sem receita → re-dispara `interpretar_receita`.

### Parser `detectPrescriptionCorrection`
- Pré-processa: `(- 425)` → `(-425)` e `(+ 200)` → `(+200)`.
- Novo `parseDiopter`:
  - Aceita formatos com vírgula/ponto (`-9,25`, `+0.50`).
  - Shorthand óptico SEM separador: `400` → 4.00, `425` → 4.25, `175` → 1.75.
  - 3+ dígitos sem decimal → últimos 2 viram fração.
- `parseAxis` separado (0–180, sem normalização decimal).

### Fallback de `consultar_lentes`
Quando `rx_type=unknown`, sem esfera, ou esfera absurda (|v|>25), pede valores objetivos por texto em vez de culpar o grau:
> "Pra montar o orçamento certinho, me confirma os valores da receita por texto…"

## Salvaguardas
- Log `[RX-VALID]` quando receita salva existe mas é inválida.
- Log `[QUOTE]` registra rxType / sphereCount / absurd flag no fallback.
- Casos legados (`receitas.length > 0` sem validação) mantidos onde só servem para exibição/contexto.
