# Item 4 — onde realmente mora o campo "Parcelas" do link de pagamento

## Diagnóstico

O Messenger tem razão: **não existe form hardcoded de link_pagamento** em lugar nenhum dos dois projetos. O único wizard com parcelas hardcoded é o de **boleto bancário** (`LojaNovaDemanda.tsx` linhas 1186-1208) — esse não é o fluxo do link.

O fluxo `link_pagamento` no Messenger é **dinâmico**: ele renderiza etapas configuradas em `bot_fluxos.etapas` (JSONB), no loop `fluxoAtivo.etapas.map(...)` (linha ~929). O label "Parcelas" que a loja vê hoje vem de `bot_fluxos.etapas[].label` — está no **banco**, não no código.

Prova: aqui no Atrium a UI que edita isso é o `BotFluxosCard.tsx` (linha 380 mostra o `tipo_solicitacao: "link_pagamento"` sendo configurado etapa a etapa).

## O que fazer (nenhum código muda)

Editar via UI, aqui mesmo no Atrium:

1. Ir em **Configurações → Bot / Fluxos das Lojas**
2. Abrir o fluxo cujo `tipo_solicitacao = link_pagamento`
3. Localizar a etapa com `campo = "parcelas"`
4. Trocar o `label` de `"Parcelas"` para:
   `"Parcelas (fixas — o cliente pagará exatamente neste número)"`
5. Salvar

O Messenger passa a mostrar o novo label imediatamente (ele lê `bot_fluxos` sob demanda).

## E o helper "Cliente não poderá alterar…"?

O schema atual de `bot_fluxos.etapas` provavelmente **não tem campo `helper_text`** (só `label`, `campo`, `tipo`, `mensagem`). Duas opções:

**Opção A — sem código (recomendada agora):** juntar tudo no label:
`"Parcelas (fixas — cliente NÃO poderá alterar. Para 'até Nx com escolha' abra chamado)"`

**Opção B — proper helper cinza abaixo do campo:** exige mudança nos dois projetos:
- Atrium: `BotFluxosCard` ganha input "Texto de ajuda" que grava em `etapas[i].helper_text`
- Messenger: no loop `fluxoAtivo.etapas.map`, se `et.helper_text`, renderiza `<p class="text-xs text-muted-foreground">…</p>` abaixo do input

Ambas opções não precisam migração — `etapas` já é JSONB livre.

## Recomendação

Faz a **Opção A** agora (só editar o label pela UI, 30 segundos, resolve). Se depois quiser o helper separado em cinza claro, me avise e eu preparo as mudanças da Opção B nos dois projetos.

## Nenhum arquivo alterado neste plano

Só orientação — a mudança é feita pela UI existente de configuração de fluxos.
