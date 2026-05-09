---
name: Receita Vazia + Shorthand de Correção
description: Receita salva com rx_type=unknown e olhos vazios não conta como receita; parser aceita shorthand óptico ("-400"→-4.00) e espaço entre sinal e número
type: feature
---

## Caso Yuri (Mai/2026) — foto não-receita + confidence alta

Cliente mandou foto que não era receita. Modelo retornou `eyes.od={}`/`eyes.oe={}` (todos null) **com `confidence ≥ 0.80`**. Ramos antigos no `interpretar_receita` (~linha 4000):

- `rxJustValid` falso (sem números) → não pediu confirmação canônica.
- `needsHumanReview` falso (confidence alta) → não caiu em `MSG_PEDIR_RECEITA_TEXTO`.
- Ramo `else` final usava `args.resposta` cru → LLM **alucinou** o template `"Li sua receita assim, ESF ? CIL ? EIXO ?°"`. Quando cliente respondeu "Isso", gate `~2257` aceitaria a confirmação e dispararia `runConsultarLentes` com receita zerada.

### Hard guard pós-OCR (`fn === "interpretar_receita"`)

Antes de salvar a receita, computa:

```
odNumCount + oeNumCount === 0     // nenhum número em qualquer olho
|| (só sphere=0/null em ambos sem cyl/axis/add)
|| rxType === "unknown"
```

Se `ocrInutil`: NÃO salva em `receitas[]`, NÃO marca `pending`, grava evento `receita_ocr_inutil` e responde `MSG_PEDIR_RECEITA_TEXTO` — **independente de `confidence`**.

### Sanitizer pós-LLM

Antes de qualquer `sendWhatsApp` no fluxo de OCR, regex `/ESF\s*\?|CIL\s*\?|EIXO\s*\?°/` substitui por `MSG_PEDIR_RECEITA_TEXTO` e marca `rx_sanitize_empty_template`.

### Defesa no gate de confirmação (~linha 2251)

Se `isReceitaPending` e `lastRx` falha em `isReceitaValida`, limpa `pending=false` + `invalidada_at`, grava `receita_pending_invalidada` e responde `MSG_PEDIR_RECEITA_TEXTO`. Idempotente para conversas já corrompidas.

### Backfill

Migration limpa `pending=true` em contatos cuja última receita tem `rx_type` em `('','unknown')`.


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
