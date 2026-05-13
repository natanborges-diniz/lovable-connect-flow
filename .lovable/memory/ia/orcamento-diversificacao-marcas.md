---
name: Orçamento de Lentes Diversifica Marcas
description: runConsultarLentes intercala HOYA + DNZ + DMAX + ESSILOR + ZEISS por faixa econômica/intermediária/premium em vez de top-N por preço; bypass quando preferencia_marca está setada
type: feature
---

# Orçamento de Lentes — Diversificação por Marca

## Problema (Mai/2026, caso Rogerio)

Para receita single_vision -0,50/-0,25 o catálogo cobre 20+ lentes mas a query
ordenada por `priority asc, price_brl asc` LIMIT 20 era dominada por Hoya (Maxxee
R$99, Hilux R$198, Hilux Pronta R$199, Nulux R$390…). LLM sintetizava 2 picks
Hoya + frase genérica "premium a partir de R$ 2.679 (ZEISS/ESSILOR)". DNZ HDI
R$ 520 e Essilor/Zeiss intermediárias ficavam fora.

## Comportamento atual (`runConsultarLentes` em `ai-triage/index.ts`)

1. Query `LIMIT 60` (era 20).
2. Se `preferencia_marca` setado → mantém 3-pick legado (econ/inter/premium da
   mesma marca).
3. Senão:
   - Particiona o catálogo em **3 faixas por percentil** de preço (≤33% eco,
     33–66% inter, >66% prem).
   - Para cada faixa, pega até **2 lentes com marcas distintas**.
   - Marcas presentes no catálogo que não entraram em nenhuma faixa são
     adicionadas à faixa equivalente à sua entrada mais barata (até 2/faixa).
4. `brand` é normalizado em runtime (`HOYA`/`Hoya` colapsam) — não muda dados.

## Output

```
🔍 Opções de lentes para o seu grau:
OD -0.5/-0.25 | OE -0.5/—

🟢 Econômica:
  • HOYA Hilux 1.50 AR — R$ 198,00
  • DNZ HDI 1.67 AR Verde — R$ 520,00

🟡 Intermediária:
  • HOYA Nulux 1.60 Blue — R$ 390,00
  • ESSILOR <família> — R$ <preço>

💎 Premium:
  • ZEISS SmartLife BlueGuard 1.50 — R$ 1.490,00
  • HOYA Nulux iDentity V+ — R$ 890,00

[CTA agendamento]
```

## Regex de detecção (anti-loop)

`orcamentoOutboundRegex` em `ai-triage/index.ts` já cobre os labels novos
("Econômica:", "Intermediária:", "Premium:"). Não regride.
