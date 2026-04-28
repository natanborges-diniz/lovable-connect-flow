---
name: Receita Digitada por Texto (Primeira ou Correção)
description: Aceita receita digitada como PRIMEIRA leitura (quando IA pediu por texto após OCR falhar) ou como correção; entende pl/plano/neutro=0 e esf-only; bypassa loop_escalation quando aplicada
type: feature
---

# Receita por Texto — Primeira leitura OU correção (ai-triage)

## Problema
OCR falha → IA pede valores por texto → cliente digita → IA escala mesmo assim.

Antes o `detectPrescriptionCorrection` só rodava se já houvesse receita salva (`receitas.length > 0`), então a primeira leitura digitada era ignorada. Além disso, o parser exigia ≥2 números numéricos, não conhecia `pl/plano` (plano = 0,00), e o loop_escalation disparava antes do detector ter chance de redirecionar.

## Solução
1. **Modo "first" + "correction"**: detector roda mesmo sem receita prévia desde que a IA tenha pedido por texto recentemente (regex em `recentOutbound[-2..]` casa com `MSG_PEDIR_RECEITA_TEXTO`).
2. **Convenções ópticas**: pré-normalização aceita `pl`, `plano`, `neutro`, `zerado`, `zero` → `0`. `sc` (sem cilindro) é removido. "OD/OE explícitos" valem como gate mesmo com 1 marker + 1 número.
3. **Esf-only é válido**: `Od -4.50 / Oe pl` é receita single_vision aceita; cilindro/eixo permanecem null.
4. **Bypass do loop**: `if (loopCheck.detected && !correctionApplied)` — se a receita acabou de ser gravada, segue o fluxo normal (hint pós-correção força `consultar_lentes`).
5. **Persistência**: cria entrada com `source: "client_typed_first"` ou `"client_correction"`, `confidence: 0.99`, label `"digitada pelo cliente"`. Loga `receita_digitada_pelo_cliente` ou `receita_corrigida_pelo_cliente` em `eventos_crm`.

## Padrões parseados
- `OD <esf> com <cil> [eixo <axis>] [add <add>]`
- `OD: esf -9 cil -2,75 eixo 180 add +2,00`
- `LONGE: OD 0.00 com -2,25` / `PERTO: -0,25 com -2,00 eixo 180`
- `Od -400 / Oe -425` (shorthand sem decimal)
- **`Od -4.50 / Oe -pl`** ou `OE plano` (esf-only com convenção plano=0)
- Aceita vírgula ou ponto decimal, sinal opcional, espaço entre sinal e número

## Salvaguardas
- Se cliente manda padrão de receita SEM IA ter pedido (false positive), não persiste — exige `iaJustAskedForText` em modo "first".
- No modo correção mantém merge parcial (cliente corrige só um campo).
- Hint força reconhecimento curto da correção/leitura antes do orçamento (UX).

## Casos
- **Jardel (25/04)**: shorthand "-400" + espaço sinal — corrigido no parser.
- **Bianca (28/04 12:07)**: OCR falhou 2x, cliente digitou `Od -4.50 / Oe -pl`, IA escalou. Causa: gate exigia receita prévia + parser rejeitava "pl" + loop disparou. Corrigido. Recuperação: receita gravada manualmente, atendimento devolvido para IA, orçamento DNZ R$520 + Eyezen R$699 enviado.
