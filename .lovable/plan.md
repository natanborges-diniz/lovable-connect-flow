# Cotação de lentes — corrigir inversão de faixas e priorizar Varilux no Premium

## Pontos divergentes encontrados na conversa

**1. Premium da 1ª cotação sem Varilux** (orçamento livre, sem marca pedida)
A IA listou como Premium: *DNZ Pro 1.50 Fast* e *Hoya MySelf 1.50*. Para multifocal, Premium tem que ser dominado por Varilux (Comfort / Physio / X). DNZ Pro em Premium descaracteriza o posicionamento comercial.

**2. Faixas com preço invertido após o cliente pedir Varilux** (3ª mensagem da IA)
- 💚 Econômica: Varilux Liberty + Crizal Prevencia — **R$ 2.135,00**
- 💛 Intermediária: Varilux Liberty 3.0 sem AR — **R$ 1.199,00**
- 💎 Premium: Varilux Comfort Max sem AR — **R$ 1.699,00**

Econômica > Premium > Intermediária. Comercialmente desastroso, e quando o cliente apontou, a IA repetiu sem reconhecer.

## Causa-raiz no código (`supabase/functions/ai-triage/index.ts`)

### Bug A — branch `preferencia_marca` não ordena por preço (linhas 6981-6988)
```ts
if (args?.preferencia_marca) {
  const economy = lenses[0];
  const premium = lenses[lenses.length - 1];
  const midIndex = Math.floor(lenses.length / 2);
  const mid = lenses.length >= 3 ? lenses[midIndex] : null;
```
A query (linha 6777) ordena por `priority ASC, price_brl ASC`. Quando o filtro de marca casa SKUs com `priority` diferente, `lenses[0]` e `lenses[last]` ficam ordenados por prioridade, não por preço. Resultado: econômica mais cara que premium.

### Bug B — Premium genérico (sem marca) é por percentil de preço puro (linhas 7022-7037)
`pickPorFaixa("prem")` pega as mais caras de marcas distintas, sem considerar a regra comercial: **em multifocal, Premium prioriza Essilor/Varilux**. DNZ Pro e Hoya MySelf entraram porque eram caras, mas Varilux Comfort/Physio deveria abrir a faixa.

### Bug C — sem validador final
Não há checagem `min(eco) ≤ min(inter) ≤ min(prem)` antes de devolver `quoteMsg`. Faixa inconsistente passa silenciosamente.

### Bug D — IA ignora reclamação sobre inversão
Quando cliente diz "a econômica está mais cara que a intermediária", não há router pre-LLM que detecte isso e force re-cotação. O LLM degrada para "já te mandei as opções acima".

## Plano de correção

### 1. Reordenar por preço no branch `preferencia_marca` (~linha 6981)
```ts
if (args?.preferencia_marca) {
  const sortedByPrice = [...lenses].sort((a, b) => Number(a.price_brl) - Number(b.price_brl));
  const economy = sortedByPrice[0];
  const premium = sortedByPrice[sortedByPrice.length - 1];
  const mid = sortedByPrice.length >= 3 ? sortedByPrice[Math.floor(sortedByPrice.length / 2)] : null;
  // Se premium.price <= economy.price → faixa achatada, mostrar só 1 opção
}
```

### 2. Priorizar Varilux em Premium quando `rxType === "progressive"` e sem marca pedida (~linha 7022)
Dentro de `pickPorFaixa("prem")`, quando `rxType==="progressive"` e `!args?.preferencia_marca`, **ranquear o pool antes do loop** colocando primeiro itens cuja `brand` casa Essilor e `family` casa Varilux. Empate desfaz por preço. Garante que o representante da faixa Premium em multifocal seja Varilux sempre que existir no catálogo compatível com o grau.

### 3. Validador final anti-inversão (logo antes do `return { resposta: quoteMsg }`)
Calcular `minPrice` de cada faixa renderizada. Se a ordem `eco ≤ inter ≤ prem` quebrar:
- Logar `eventos_crm: cotacao_faixas_inconsistentes` com snapshot dos itens.
- Recompor as 3 faixas por percentil puro de preço (descarta diversificação de marca nesse caso) e re-renderizar.
- Esse fallback nunca produz inversão porque é matemático.

### 4. Detector pre-LLM de "preço invertido" reclamado pelo cliente
Em `ai-triage`, antes da chamada ao LLM, se a última outbound bateu `orcamentoOutboundRegex` (já existe, linha 3783) **e** o inbound atual casa regex tipo:
```
/(mais\s+car[oa].*(que|do\s+que))|(econ[ôo]mica.*car)|(premium.*barat)|(invertid[ao])|(t[áa]\s+errad[ao].*pre[çc]o)/i
```
→ Forçar re-execução de `runConsultarLentes` com os mesmos args anteriores (recuperados de `eventos_crm` ou do snapshot em `atendimento.metadata.ultima_cotacao`). A nova cotação já passa pelos fixes 1–3, então sai correta. Prefixar com `"Você tem razão, deixa eu refazer as faixas certinho:"`.

### 5. Persistir snapshot da última cotação
No final de `runConsultarLentes` (sucesso), gravar `atendimento.metadata.ultima_cotacao = { args, faixas: [{tier, brand, family, price}…], at }`. Habilita o detector do passo 4 e melhora auditoria.

### 6. Memória
Criar `mem://ia/cotacao-faixas-validacao-e-varilux-premium.md` documentando: ordenação por preço em `preferencia_marca`, prioridade Varilux em Premium multifocal, validador anti-inversão, detector de reclamação. Atualizar `index.md` em `## Core` com regra curta: *"Cotação multifocal: Premium prioriza Varilux. Faixas sempre validadas Eco ≤ Inter ≤ Prem."*

## Escopo

Apenas `supabase/functions/ai-triage/index.ts` + memória. Sem migração de banco. Sem mudança no esquema da tool. Sem mexer em LC ou agendamento. Deploy apenas de `ai-triage`.

## Validação

- Simular `runConsultarLentes` com a receita do Natan (OD -2/-0.5, OE -1.75/-0.75, ADD +2) **sem** `preferencia_marca`: Premium deve conter Varilux Comfort/Physio.
- Simular **com** `preferencia_marca="ESSILOR"`: faixas Varilux ordenadas Liberty 3.0 < Liberty+Crizal < Comfort Max (preço crescente).
- Curl no `ai-triage` enviando "a econômica está mais cara que a intermediária" após uma cotação real → deve disparar re-cotação prefixada.
- Log `[QUOTE] faixas validadas: eco=X inter=Y prem=Z` em todas as execuções.
