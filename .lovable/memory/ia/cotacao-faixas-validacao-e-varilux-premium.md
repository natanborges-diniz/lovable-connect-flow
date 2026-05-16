---
name: Cotação Faixas — Validação Anti-Inversão e Premium Varilux
description: runConsultarLentes ordena por preço no branch preferencia_marca, prioriza Varilux em Premium multifocal, valida Eco ≤ Inter ≤ Prem, persiste snapshot ultima_cotacao e detecta reclamação pré-LLM
type: feature
---

## Regras

1. **Branch `preferencia_marca`**: sempre ordenar `lenses` por `price_brl` ASC antes de pegar economy/mid/premium. A query original ordena por `priority, price` — quando há SKUs da mesma marca com priority distinta, `lenses[0]/[last]` ficam fora de ordem de preço. Skip mid/prem se preço não for estritamente maior que economy.

2. **Premium multifocal sem marca pedida**: dentro de `pickPorFaixa("prem")`, quando `rxType==="progressive"` e `!args.preferencia_marca`, ranquear o pool colocando Varilux/Essilor primeiro (empate desfaz por preço). Garante que Premium multifocal seja dominado por Varilux Comfort/Physio/X sempre que houver no catálogo compatível.

3. **Validador anti-inversão**: após montar eco/inter/prem (incluindo etapa 4 de inclusão de marcas órfãs), calcular `min(price)` de cada faixa. Se `min(eco) > min(inter)` OU `min(inter) > min(prem)` OU `min(eco) > min(prem)`, logar `eventos_crm: cotacao_faixas_inconsistentes` e re-particionar por preço puro via `sorted.slice(0,n/3) / (n/3,2n/3) / (2n/3,end)`.

4. **Snapshot `atendimento.metadata.ultima_cotacao`**: ao final de `runConsultarLentes` sucesso (não-duplicate), persiste `{ at, args, rx_type, lentes[] }`. Habilita o detector pre-LLM e auditoria.

5. **Detector pre-LLM de reclamação de inversão**: em `ai-triage`, após carregar `recentOutbound`, se `ultima_cotacao` existe há <30min E última outbound bateu regex de orçamento E inbound bate `/mais\s+car[oa].*(que|do\s+que)|econ[ôo]mica.*car|premium.*barat|invertid[ao]|t[áa]\s+errad[ao].*pre[çc]o/i`, re-executa `runConsultarLentes` com os args salvos, envia prefixado com "Você tem razão, deixa eu refazer as faixas certinho" e retorna sem LLM. Loga `cotacao_reexecutada_reclamacao_inversao`.

## Caso de origem

**Natan 16/05/2026 — multifocal -2/-0.5, -1.75/-0.75, ADD +2**:
- 1ª cotação livre listou DNZ Pro 1.50 + Hoya MySelf como Premium → faltava Varilux.
- 2ª cotação com filtro Essilor: Econômica R$2.135 > Intermediária R$1.199 > Premium R$1.699 (inversão).
- IA repetiu sem reconhecer quando cliente apontou.

Arquivos:
- `supabase/functions/ai-triage/index.ts` (runConsultarLentes ~6979-7050; detector pre-LLM ~2768).
