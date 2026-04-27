
# Por que a IA não enviou o valor das lentes (caso Paulo Henrique 16:48–16:52)

## O que aconteceu de fato

Reli o histórico completo do atendimento `26464d89` direto no banco:

```
16:47  Paulo: "Aguardando orçamento"
16:48  Operador (manual): orçamento DNZ/DMAX/HOYA + endereço Osasco
16:48  IA  : "Beleza! Já vou te mandar as opções..."             ← prometeu, não rodou tool
16:49  Paulo: "Quero orçamento da 1 e 2 por favor"
16:49  IA  : "Para esse grau específico, vou encaminhar para
              um Consultor que pode detalhar..."                  ← FALLBACK hardcoded
16:51  Paulo: "Ol"
16:52  Paulo: "Ol" / "Ol"
16:52  IA  : opções *ESSILOR Eyezen + ZEISS SmartLife*
              "Vou encaminhar pra um Consultor confirmar a
               disponibilidade da sua armação..."                 ← TEMPLATE hardcoded
16:53  IA  : "Me explica melhor a sua necessidade..." ×3          ← VALIDATOR_FAILED_POOL em loop
       → atendimento terminou em modo=humano, status=aguardando
```

A correção anterior (André/Paulo Henrique 1ª rodada) atacou o **prompt** mas **3 textos fixos no código** continuaram vencendo o hint:

## As 3 falhas reais

### 1. `runConsultarLentes` linha 3859 — escalada embutida no template
A função que devolve o orçamento concatena à força:
```ts
quoteMsg += "\n\nVou encaminhar pra um Consultor confirmar a disponibilidade da sua armação na loja e te ajudar a fechar 🤝 Em qual região você está?";
```
Por isso o orçamento ESSILOR/ZEISS de 16:52 saiu já com a frase de escalada. O hint "PROIBIDO escalar" é ignorado porque o texto é montado em código, não pelo LLM.

### 2. `runConsultarLentes` linha 3840 — fallback hardcoded
Quando o filtro não casa nenhuma lente (categoria errada, range fora, etc.) a função retorna:
```ts
"Para esse grau específico, vou encaminhar para um Consultor que pode detalhar as melhores opções."
```
Foi exatamente isso que saiu às 16:49 quando o cliente disse "Quero orçamento da 1 e 2". A IA tentou rodar `consultar_lentes` referenciando "1 e 2" do orçamento humano anterior, o argumento veio sem categoria correta → zero resultados → fallback de escalada.

### 3. Categoria errada no orçamento de 16:52
Receita -2.00 / -2.50 sem adição → deveria ser `single_vision`. O orçamento que saiu é de **progressivas Eyezen** (lentes para perto/computador) — sinal de que o LLM passou `category` incorreta ou a busca casou com adição zero. Resultado: opções caríssimas (R$1.985–2.190) e desalinhadas com o orçamento manual do operador (DNZ/DMAX/HOYA).

### 4. `VALIDATOR_FAILED_POOL` não escala
Quando o cliente bate "Ol", "Ol", "Ol" o validador rejeita e o pool de fallback genérico ("Me explica melhor...") foi enviado 3× seguidas — pickFallback dedupa por similaridade mas o relógio do debounce + corridas paralelas deixaram passar.

## Correções

### A. `supabase/functions/ai-triage/index.ts` linha 3859
Trocar a frase "Vou encaminhar pra um Consultor..." por encerramento orientado a venda local:
```
"Posso te indicar a loja mais próxima pra você ver pessoalmente e fechar a melhor opção? Em qual região/bairro você está?"
```
Sem mencionar "Consultor". O fechamento é feito na loja, não escalando humano.

### B. linha 3840 — fallback de "zero opções"
Substituir por mensagem que reconhece o gap **sem escalar**:
```
"Pra esses graus específicos preciso confirmar disponibilidade na loja antes de te passar o valor exato. Em qual região/bairro você está? Já te indico a unidade mais próxima pra você ver as opções pessoalmente."
```
Mantém o cliente engajado e empurra pra loja em vez de descartar pra humano.

### C. linha 1300 — instrução do prompt
Remover a sugestão "Vou encaminhar para um Consultor especializado" do bloco MODO RESTRITO. Substituir por: "Se não souber: peça mais detalhes ou sugira agendamento na loja mais próxima."

### D. `consultar_lentes` — passar categoria explícita pós-OCR
No auto-chain (linha ~2768) e no force-tool, passar explicitamente `category: rxType === "progressive" ? "progressive" : "single_vision"` em vez de deixar o LLM decidir. Isso evita o caso de retornar Eyezen para uma receita simples de miopia.

### E. Detectar "quero orçamento da 1 e 2" como referência ao orçamento anterior
Em `detectForcedToolIntent`, quando o cliente referencia números/itens (`/\b(op[cç][aã]o\s*\d|da\s*\d\s*e\s*\d|n[uú]mero\s*\d)\b/i`) e a última outbound (humano OU IA) contém um orçamento já formatado (com "R$"), retornar `{ tool: "responder", reason: "cliente referenciou opção do orçamento anterior" }` com hint:
```
"O cliente está pedindo detalhes/preço de opções específicas do orçamento que você (ou um operador) já enviou. Recapitule SOMENTE as opções pedidas (1, 2, etc.) com nome e valor + pergunte se quer agendar pra ver na loja. NÃO rode consultar_lentes de novo, NÃO escale, NÃO mande nova lista completa."
```

### F. `VALIDATOR_FAILED_POOL` — escala após 1 fallback consecutivo
Mudar `pickFallback` para retornar `null` (escala) já no segundo fallback consecutivo, não no exaure-pool. Hoje permite 5 fallbacks antes de escalar; reduzir para 1 evita o loop de "Me explica melhor..." 3× visto às 16:53.

### G. Recuperação manual do Paulo
Atendimento `26464d89` está em `modo=humano, status=aguardando` há ~1h. Não tocar — operador já está na fila humana. Apenas registrar evento `eventos_crm` documentando o caso para auditoria.

### H. Atualizar memória
`mem://ia/auto-receita-e-anti-loop` — adicionar 4ª seção "Caso Paulo Henrique 2ª rodada (templates hardcoded)" documentando que correções de prompt não bastam quando há texto fixo no código.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — A, B, C, D, E, F
- `.lovable/memory/ia/auto-receita-e-anti-loop.md` — H
- `eventos_crm` — insert auditoria do caso

## Resultado esperado

Próxima vez que o cliente pedir "Quero orçamento da 1 e 2":
- IA detecta referência → recapitula só as 2 opções com nome/valor → pergunta se quer agendar.
- Se rodar `consultar_lentes` para receita -2.00/-2.50, retorna DNZ/DMAX/HOYA single_vision (não Eyezen) e termina perguntando região, sem mencionar Consultor.
- Se filtro não casar nada, encaminha pra loja física, não escala humano.
- "Ol" repetido escala em 1 fallback, não em 3.
