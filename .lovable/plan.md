## Problema

Quando o cliente pede para detalhar/comparar opções já apresentadas no orçamento, a IA não responde adequadamente:

```
[outbound] 🔍 Opções de lentes... DNZ HDI / Essilor Eyezen / Zeiss SmartLife
[inbound]  Qual a diferença entre a Essilor e Zeiss?
[outbound] Já te mandei as opções acima 😊 Quer que eu detalhe alguma delas, ou prefere agendar uma visita?
[inbound]  Detalhe a essilor e a zeiss
[outbound] Conta pra mim com mais detalhes o que você precisa que eu te dou um retorno certeiro!  ← FALHA
```

A última resposta caiu no `VALIDATOR_FAILED_POOL` (`pickFallback`) — sinal de que o LLM gerou uma resposta similar à anterior (>70% similaridade) e o sistema usou fallback genérico.

### Causas

1. **Sem instrução explícita para a tarefa "detalhar/comparar opções"** — quando o cliente pede comparação ou detalhamento de uma marca/lente já cotada, o prompt do Gael não tem regra orientando o que fazer. O modelo tende a parafrasear "quer que eu detalhe?" em loop em vez de efetivamente detalhar.
2. **Detalhamento não é uma tool** — `consultar_lentes` cota; `responder` é genérico. Não há um caminho determinístico que monte uma comparação a partir das marcas/lentes do orçamento anterior.
3. **Validador rejeita por similaridade**, manda pro retry com "gere algo diferente", e ainda assim o modelo não tem dados nem instrução para escrever a comparação técnica → cai no fallback genérico.
4. **Catálogo `pricing_table_lentes`** tem só campos técnicos (brand, family, index_name, treatment, blue, photo, price). Não há descrição livre, então a comparação precisa ser narrativa (gerada pelo LLM) usando esses campos + conhecimento de marca.

## Correção (escopo enxuto)

### 1. Memória rica de marcas para o LLM

Criar `mem://ia/comparacao-lentes-detalhamento.md` documentando as características-chave de cada marca/família que aparece no catálogo:

- **DNZ HDI** — linha própria/entrada, custo-benefício.
- **Essilor Eyezen Boost / Varilux / Crizal** — premium global, foco em fadiga visual digital, antirreflexo Crizal Prevencia (luz azul).
- **Zeiss SmartLife / Individual / DuraVision / BlueGuard** — alemã, design sob medida (Individual), proteção UV total + filtro azul integrado, melhor visão periférica e adaptação a diferentes distâncias.
- **Hoya, Kodak, Solflex** — referências secundárias.

Esse memo é injetado como conhecimento adicional no system prompt quando o contexto for "detalhar/comparar lente".

### 2. Detector de intent "detalhar/comparar"

Em `supabase/functions/ai-triage/index.ts`, adicionar um detector determinístico (junto com `detectPendingIntent` / `detectForcedToolIntent`) que dispara quando:

- Mensagem do cliente contém: `detalh|diferença|diferenca|comparar|compare|qual a melhor|por que|porque a|vantagem`
- E há uma mensagem outbound recente (últimas 3) com formato de orçamento (contém `🔍 *Opções` ou `Econômica:` ou `Premium:`)
- E menciona pelo menos uma das marcas presentes nesse orçamento (extraídas via regex das linhas `*BRAND family*`)

Quando dispara, injeta no system prompt um bloco **`[FLUXO DETALHAMENTO/COMPARAÇÃO DE LENTES]`** com:

- O texto do orçamento anterior (recortado das últimas mensagens outbound).
- A memória de marcas (`mem://ia/comparacao-lentes-detalhamento`).
- Regras: responder com 1 parágrafo curto por marca solicitada (3–4 linhas cada), destacando 2–3 diferenciais técnicos relevantes (índice, tratamento, filtro azul, design, indicação de uso), terminar com **uma** pergunta sugerindo a escolha ou o agendamento.
- Proibido: repetir "quer que eu detalhe?", "já mandei as opções acima", ou pedir mais informação ("me conta mais").

### 3. Bypass do validador de similaridade no contexto de detalhamento

A resposta legítima de detalhamento naturalmente reusa termos do orçamento (nomes das marcas, "índice", "filtro azul"), o que pode disparar o detector de similaridade >70%. No caminho de validação (linha 2790+), adicionar:

```ts
if (isDetalhamentoContext) {
  // tolerância maior para reuso de termos técnicos
  // pular checagem de similaridade; manter apenas blacklist e "no question/action"
}
```

### 4. Fallback determinístico para detalhamento

Se o LLM ainda assim falhar (retry rejeitado, etc.) no contexto de detalhamento, em vez de usar `VALIDATOR_FAILED_POOL` ("conta pra mim mais detalhes…"), montar uma resposta determinística mínima a partir dos dados das lentes citadas no orçamento anterior (parser simples extrai brand/family/index/treatment/preço das linhas `*...*`), formatando algo como:

```
A Essilor Eyezen Boost 0.6 (R$ 2.135) tem foco em conforto pra quem usa muita tela — antirreflexo Crizal + filtro azul.
A Zeiss SmartLife Individual 3 (R$ 2.190) é premium alemã, design sob medida pro seu rosto, com DuraVision Platinum + BlueGuard integrado pra UV e luz azul.
Quer fechar com a Essilor, a Zeiss, ou prefere agendar pra ver na loja?
```

Nunca cair no pool genérico nesse contexto.

### 5. Memória da regra

Atualizar `mem://ia/lentes-de-contato-orcamento.md` (ou criar entrada própria em `mem://ia/`) registrando o caso Artur Borges (24-04-2026) e a regra: **após enviar orçamento de lentes, se o cliente pedir detalhe/comparação, a IA DEVE responder com um parágrafo técnico curto por marca, nunca devolver "quer que eu detalhe?" ou cair em fallback genérico.**

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — detector + injeção de bloco no prompt + bypass parcial do validador + fallback determinístico de detalhamento.
- `.lovable/memory/ia/comparacao-lentes-detalhamento.md` — novo (conhecimento de marca).
- `.lovable/memory/ia/lentes-de-contato-orcamento.md` ou novo memo — regra de fluxo pós-orçamento.

## Fora de escopo

- Adicionar coluna `descricao` em `pricing_table_lentes` (não necessário — o LLM sintetiza com a memória de marca).
- Mudar formato do orçamento original.
- Tocar em fluxo de LC, fechamento, ou agendamento.

## Resultado esperado

Cliente: *"Detalhe a Essilor e a Zeiss"*

Gael: parágrafo curto e técnico de cada uma, com diferenças de design/tratamento/proteção, fechando com pergunta clara entre Essilor / Zeiss / agendar visita. Sem fallback genérico, sem loop "quer que eu detalhe?".

## Deploy

Redeploy de `ai-triage` após a alteração.
