## Diagnóstico

Confirmado no banco: existem 7 produtos Acuvue ativos (Acuvue 2, 1-Day Acuvue Moist, Oasys 1-Day HydraLuxe, Oasys Hydraclear Plus, e tóricas) — fornecedor "Johnson & Johnson", produto "Acuvue ...".

A `BuscarLentesSheet` chama `buscar-lentes-operador` → `buscarLC` (linhas 184-232). Três bugs fazem Acuvue sumir do top 3:

### Bug 1 — filtro por marca só olha `fornecedor`
```ts
if (filtros?.preferencia_marca) q = q.ilike("fornecedor", `%${filtros.preferencia_marca}%`);
```
Se o operador digita "Acuvue", a query vira `fornecedor ILIKE '%Acuvue%'` → zero resultados (Acuvue está em `produto`; fornecedor é "Johnson & Johnson"). Mesma coisa pra "Oasys", "Biofinity", "Air Optix", "Hidrocor", "DNZ" — todas marcas-família que vivem na coluna `produto`.

### Bug 2 — top 3 puro por preço, sem separar clear de colorida/cosmética
Todas as linhas têm `priority=10`, então a ordenação efetiva é só `price_brl asc`. Resultado: as 3 mais baratas hoje são **Solótica Hidrocor Mensal**, **Solflex Natural Colors** e **Hidrocor anual** — todas coloridas/cosméticas. Acuvue 2 (R$ 219,90, transparente) cai pra 18ª posição e nunca aparece no top 3 nem nas 3 faixas.

Não há nenhuma coluna marcando "cosmética vs visão" — `Hidrocor`, `Natural Colors`, `Color Hype`, `FreshLook COLORBLENDS`, `Air Optix Colors` são lentes de uso estético e estão misturadas com lentes de visão sem distinção.

### Bug 3 — sem diversificação por descarte
`top.slice(0, 3)` pega as 3 primeiras puro preço. A memória `lentes-de-contato-orcamento` exige "2-3 descartes VARIADOS" (mín. 2 categorias entre diária / quinzenal / mensal). Hoje pode sair 3 mensais ou 3 do mesmo fornecedor.

## Plano de correção (escopo: `supabase/functions/buscar-lentes-operador/index.ts`)

1. **Filtro de marca em `fornecedor` OU `produto`**
   Trocar o `ilike("fornecedor", …)` por `or('fornecedor.ilike.%X%,produto.ilike.%X%')`. Cobre Acuvue, Oasys, Biofinity, Hidrocor, DNZ, Air Optix etc. de um golpe só.

2. **Heurística pra esconder lentes cosméticas/coloridas no top 3**
   Não dá pra alterar schema agora, então classificar in-code por regex no `produto` (`color|natural colors|hidrocor|hydrocor|freshlook|colorblends|air optix colors|solflex (color|natural)|aquarella|hidroblue|hidrosoft`). Quando o operador NÃO pediu marca cosmética explicitamente (`preferencia_marca` casa o regex) E não digitou "colorida/cor/estética" em `query_natural`, filtrar essas linhas **antes** de montar o top 3. Mantê-las só em `alternativas` (catálogo completo continua acessível pelo expand).

3. **Diversificação por descarte no top 3**
   Após filtrar cosméticas, montar `top` com no máx. 1 por `descarte` na primeira passada (diária → quinzenal → mensal nessa ordem por preço), depois completar até 3 com as próximas mais baratas se sobrar slot. Garante variedade pedida pela memória.

4. **Pequeno ajuste de UX**: quando o operador digita marca-família reconhecida (Acuvue/Oasys/Biofinity/etc.), pular a diversificação por descarte — ele quer ver opções **daquela marca**, então mostrar top 3 dessa marca por preço.

## Fora de escopo (não mexer agora)

- Não vou adicionar coluna `is_cosmetica` no schema nem rodar migration — filtro por regex resolve sem risco.
- Não vou mexer na tool `consultar_lentes_contato` do `ai-triage` (a IA já prioriza DNZ por design; bug é só no copiloto do operador). Se quiser estender a mesma correção pra IA, me avisa que faço em seguida.
- Não vou tocar UI da `BuscarLentesSheet.tsx` — input "Marca" já existe e funciona.

## Verificação

Após o patch, vou simular 3 chamadas via `curl_edge_functions`:
- marca="Acuvue" → top 3 deve trazer Acuvue 2 / 1-Day Acuvue Moist / Oasys 1-Day.
- sem marca, receita esférica simples → top 3 sem Hidrocor/Natural Colors/FreshLook, com mix de descartes.
- marca="Hidrocor" → mantém Hidrocor (operador pediu explicitamente).
