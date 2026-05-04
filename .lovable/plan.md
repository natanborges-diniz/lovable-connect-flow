## Contexto

Anna Paula informou:
- ESF: -2,75 OD / -2,25 OE
- "tem astigmatismo e um pouco de miopia" (sem CIL/AX)
- Quer **multifocal + antirreflexo**

A IA respondeu corretamente "preciso da ADD e dos cilindros pra fechar" — mas só ofereceu o piso "a partir de R$298", sem mostrar uma **faixa estimada** com os dados que ela já tem. Resultado: a cliente sente que não foi orçada.

A regra atual `consultar_lentes` exige `add_min/add_max` para retornar produtos progressivos. Quando ADD ausente, a IA cai no fallback "a partir de R$X" e fica travada pedindo dados.

## Objetivo

Quando o cliente sinaliza **multifocal** mas faltam ADD e/ou CIL, a IA deve:
1. Confirmar o que entendeu (ESF que ela passou, astigmatismo presente).
2. Apresentar **3 faixas estimadas** (econômica / intermediária / premium) usando ESF informado + ADD presumida média (+1.50 a +2.50) e marcando "estimativa — fechamos com receita completa".
3. Continuar pedindo CIL/AX/ADD em paralelo, mas sem bloquear o orçamento estimado.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts`

**a) Nova helper `estimateMultifocalRange(rx_parcial)`**
- Se `rx_type === "progressive"` OU mensagem do cliente contém `"multifocal" | "progressiva"`, e `add` ausente:
  - Roda `consultar_lentes` 3 vezes com `add=1.50`, `add=2.00`, `add=2.50` mantendo ESF/CIL informados (CIL=0 se ausente).
  - Pega `min`, `mediana` e `max` dos preços retornados.
  - Retorna objeto `{ economica, intermediaria, premium, observacao: "estimativa — confirmamos com ADD/CIL exatos" }`.

**b) System prompt (`buildSystemPrompt`)**
Adicionar bloco "Orçamento parcial":
```
- Se cliente pediu MULTIFOCAL/PROGRESSIVA mas falta ADD ou CIL:
  → use a tool consultar_lentes_estimativa com os dados parciais.
  → Apresente 3 faixas: "Econômica a partir de R$X | Intermediária a partir de R$Y | Premium a partir de R$Z".
  → SEMPRE diga "valores estimativos; com a receita completa eu fecho o exato."
  → Em seguida peça ADD e CIL/AX em UMA mensagem só (não em duas).
- NUNCA responda só "preciso da ADD pra fechar" sem antes apresentar a faixa estimada.
```

**c) Nova tool `consultar_lentes_estimativa`** — wrapper que chama `consultar_lentes` 3x e devolve o range, registrada junto às outras tools (linha ~840).

### 2. `supabase/functions/ai-triage/index.ts` — anti-loop

No detector de loop (`watchdog-loop-ia`), adicionar exceção: se as 2 últimas outbound foram "preciso da ADD" e a inbound seguinte trouxe ESF, considerar progresso e disparar a estimativa em vez de escalar.

### 3. Memory

Criar `mem://ia/orcamento-multifocal-parcial.md` documentando a regra: "dados parciais NUNCA bloqueiam orçamento — sempre apresentar faixa estimada antes de pedir o que falta."

Atualizar `mem://index.md` adicionando o novo memory abaixo de "Lentes Contato Orçamento".

## Fora de escopo

- Não mexe em pipeline, agendamento, ou cadastro de receita.
- Não cria nova tabela — usa `pricing_table_lentes` existente.
- Não altera lentes de contato (já tem fluxo próprio com `consultar_lentes_contato`).

## Resposta imediata para Anna Paula

Após implementação, na próxima mensagem dela a IA responderá algo como:

> Com o que você passou (-2,75 OD / -2,25 OE com astigmatismo), uma estimativa de multifocal com antirreflexo:
> • Econômica a partir de R$ 298
> • Intermediária a partir de R$ 698
> • Premium (Varilux/Zeiss) a partir de R$ 1.498
>
> *Valores estimativos — com a ADIÇÃO e o cilindro/eixo exatos eu fecho o orçamento certinho.* Consegue me enviar foto da receita ou os números de ADD e CIL/AX de cada olho?
