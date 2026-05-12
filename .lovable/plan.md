## Problema

Thais digitou:
```
OD: Esférico Plano / -2,5 cil / 05 eixo
OE: Esférico Plano / -2,75 cil / 175 eixo
```

A IA ignorou e escalou para humano. A causa está em `detectPrescriptionCorrection` (`supabase/functions/ai-triage/index.ts` ~linhas 769-900):

1. Linhas 791-792 normalizam `pl|plano|neutro|zerado|zero` → `0` no texto de trabalho `t`. Isso é correto: dá `sphere = 0` para os dois olhos.
2. **Mas a validação anti-hallucination (linhas 874-898) reconstrói `sourceNumbers` a partir do texto ORIGINAL (`text`)** — onde "Plano" é palavra, não número. O `0.00` da esfera não está em `sourceNumbers`, então `validateField` descarta ambas as esferas.
3. Linha 900: `if (od.sphere == null && oe.sphere == null) return null;` — função retorna `null`, parser não detecta correção, fluxo cai no LLM que escala para humano.

A receita do cliente é totalmente válida (esférico zero + cilindro = puramente astigmática) e o parser tinha extraído tudo certo antes da validação descartar.

## Mudança

Em `detectPrescriptionCorrection` (linha ~877), aplicar as mesmas normalizações de keyword óptica → `0` ao construir `rawNorm` antes de extrair `sourceNumbers`. Assim "plano/pl/neutro/zerado/zero/sc" também viram `0` no haystack e a validação não descarta `sphere=0` legítimo.

Patch (~linha 877):
```ts
const rawNorm = text.toLowerCase()
  .replace(/([+\-])\s+(\d)/g, "$1$2")
  .replace(/\*/g, " ")
  .replace(/-\s*(pl|plano|neutro|zerado|zero)\b/g, "0")
  .replace(/\b(pl|plano|neutro|zerado)\b/g, "0")
  .replace(/\bsc\b/g, "");
```

Adicionar log `[RX-VALIDATE] sphere=0 aceito via keyword 'plano'` para auditoria quando aplicável (opcional, via flag local).

## Validação

- Mensagem da Thais reprocessada → `correction` retorna `{ od:{sphere:0,cylinder:-2.5,axis:5}, oe:{sphere:0,cylinder:-2.75,axis:175} }`. Como `iaJustAskedForText=true` (a outbound anterior é exatamente o template `MSG_PEDIR_RECEITA_TEXTO`), entra no modo `client_typed_first`, salva receita e força `consultar_lentes`.
- Caso Manel (correção alto impacto via texto) e Bianca (`Od -4.50 / Oe -pl`) continuam funcionando — o segundo `replace` cobre `-pl`/`pl`.
- Anti-hallucination continua bloqueando números fantasma reais: só relaxa para tokens que já eram normalizados pelo próprio parser.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — patch de ~6 linhas em `detectPrescriptionCorrection` (~linha 877).

Sem migração, sem secrets, sem cron.
