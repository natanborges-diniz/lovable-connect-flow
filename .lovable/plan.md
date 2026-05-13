# Diversificar marcas no orçamento de lentes

## Diagnóstico

**1) "Por que não continuou após a confirmação?"**
A IA continuou normalmente. Olhando o `atendimento_id=661a27c7…`, depois do "Isso" do Rogerio:
- 13:39 – mandou as 3 faixas de orçamento + CTA de visita
- 13:40 – Rogerio: "Não tem como fazer tudo por aqui, estou em Trancoso e moro no Guarujá"
- 13:41 – IA: "Entendo… atendemos presencialmente em Osasco… qual unidade prefere?"
- 13:41 – Rogerio: "Venho uma vez por mês em Osasco"
- 13:41/42 – IA: "Já te mandei as opções acima 😊 quer detalhar ou agendar?" + "Quer apenas retirar na loja ou entregar em Trancoso?"
- 13:43 – Rogerio: "Como assim as armações?" → fluxo segue ativo.

Conclusão: **não há gap de continuidade**. O que provavelmente passou despercebido é que a UI do CRM mostrou só até "Isso" no momento da consulta. Vou apenas registrar isto no resumo final, sem mexer em código.

**2) "Está enviando apenas lentes Hoya, enviar também outras marcas." — bug real.**

Para a receita do Rogerio (single_vision, esf máx -0,50, cil máx -0,25), o catálogo cobre **20 lentes** (log: `[QUOTE] Found 20 lenses…`). A query atual em `runConsultarLentes` (`ai-triage/index.ts` ~6096):

```ts
.in("category", categories)
.order("priority", { ascending: true })
.order("price_brl", { ascending: true })
.limit(20)
```

Como a Hoya tem MUITAS entradas baratas (Maxxee Pronta R$ 99, Hilux R$ 198, Hilux Pronta R$ 199, Nulux R$ 390, etc.), o top-20 ordenado por preço fica dominado por Hoya. O LLM então sintetiza 2 picks Hoya + uma frase genérica "premium a partir de R$ 2.679 (ZEISS/ESSILOR)".

DNZ HDI 1.67 R$ 520 e DMAX, embora cubram a receita, ficam fora da janela top-20 ou não viram pick por estarem entre Hoyas mais baratas.

## Solução

Adicionar **diversificação por marca** dentro de `runConsultarLentes` antes de devolver à LLM, garantindo pelo menos 1 representante de cada marca disponível para a faixa.

### Mudanças (apenas em `supabase/functions/ai-triage/index.ts`)

1. **Aumentar limite e re-ranquear por marca** dentro de `runConsultarLentes`:
   - Subir `.limit(20)` para `.limit(60)` (continua barato — receita é uma só por chamada).
   - Após o fetch, agrupar por `brand` (case-insensitive — note que existem `Hoya` e `HOYA` como duplicatas; normalizar `toUpperCase`).
   - Para cada marca, pegar **a mais barata** + **a melhor custo-benefício** (segunda faixa).
   - Montar o array final intercalando marcas: 1 entrada-de-cada-marca primeiro (ordenadas por preço asc), depois preenche o resto com as próximas mais baratas globais.

2. **Passar até 6 lentes para a LLM** (em vez do top-2 que ela escolhe hoje), com tag explícita de marca + faixa (econômica / intermediária / premium) já calculada deterministicamente, para reduzir alucinação ("a partir de R$ 2.679") quando o catálogo realmente tem opções mais baixas em outras marcas.

3. **Atualizar o template de resposta** que `runConsultarLentes` devolve hoje (formato `🟢 Mais em conta / 🟡 Um passo acima / 📌 premium`) para suportar **3 faixas com 1–2 marcas cada**, no padrão:

   ```
   🔍 Opções pra OD <rx> | OE <rx>:

   🟢 Econômica:
     • HOYA Hilux 1.50 AR — R$ 198
     • DNZ HDI 1.67 AR Verde — R$ 520

   🟡 Intermediária:
     • HOYA Nulux 1.60 Blue — R$ 390
     • ESSILOR <família> — R$ <preço>

   💎 Premium:
     • ZEISS SmartLife BlueGuard 1.50 — R$ 1.490
     • HOYA Nulux iDentity V+ — R$ 890

   Quer que eu detalhe alguma ou prefere ver pessoalmente na loja?
   ```

   Faixas calculadas por percentil dos preços do conjunto retornado (≤33% = econômica, 34–66% = intermediária, >66% = premium).

4. **Corrigir inconsistência de marca** (`Hoya` vs `HOYA` na tabela): aplicar `brand.toUpperCase()` no agrupamento e normalizar o display para Title Case ao montar a resposta. Não vou tocar nos dados — só normalizar em runtime.

5. **Sanidade — bypass para `preferencia_marca`**: se o cliente pediu uma marca específica, manter o comportamento atual (não diversificar).

### Arquivos

- `supabase/functions/ai-triage/index.ts`
  - `runConsultarLentes` (~linha 6080–6180): nova lógica de diversificação + nova montagem da resposta.
  - **Não** mexer em `runConsultarLentesEstimativa`, `interpretar_receita`, anti-loop nem fluxo pós-confirmação — a continuidade já funciona.

### Validação

- Caso Rogerio (esf -0,50 / cil -0,25): esperar Hoya + DNZ no econômico, Hoya + Essilor no intermediário, Zeiss + Hoya iDentity no premium.
- Caso multifocal cyl alto (já coberto por `consultar_lentes_estimativa`) — não regride.
- Caso `preferencia_marca='hoya'` — só Hoya (mantém).
- Rodar a EF via `supabase--test_edge_functions` simulando o `tool_call` `consultar_lentes` com a Rx do Rogerio e conferir o output formatado.

### Memória

Criar `mem://ia/orcamento-diversificacao-marcas` registrando: orçamento sempre intercala marcas (Hoya / DNZ / Essilor / Zeiss) por faixa econômica/intermediária/premium; bypass quando `preferencia_marca` definida.
