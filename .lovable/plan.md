## Problema

Na primeira mensagem o Gael está enviando duas perguntas sobre o nome em sequência:

> "Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?. Pode me dizer seu nome completo como prefere ser chamado?"

A causa está no bloco `buildFirstContactBlock` em `supabase/functions/ai-triage/index.ts` (linhas 830-853). A instrução atual fornece a frase modelo entre aspas, mas não proíbe explicitamente o modelo de adicionar uma segunda pergunta de reforço, o que faz o LLM parafrasear/duplicar.

Também não existe um guardrail intra-mensagem que detecte duas perguntas sobre o mesmo tópico (nome) na mesma resposta.

## Correção (escopo enxuto)

### 1. Endurecer o prompt da primeira interação
Arquivo: `supabase/functions/ai-triage/index.ts`, função `buildFirstContactBlock`.

Reescrever os dois blocos (com nome capturado e sem nome capturado) para:

- Deixar a frase modelo como **mensagem final exata** ("envie EXATAMENTE esta mensagem, sem reformular nem adicionar frases extras").
- Adicionar regra explícita: **uma única pergunta** sobre o nome; **proibido** repetir, parafrasear ou complementar com "como prefere ser chamado", "nome completo", "pode me dizer", etc.
- Manter limite de 1 frase de saudação + 1 pergunta (sem ponto final duplicado tipo "?.").
- Manter as duas variações (com/sem nome do WhatsApp), só ajustando as regras anti-duplicação.

### 2. Guardrail leve intra-mensagem
Arquivo: `supabase/functions/ai-triage/index.ts` (no validador pós-LLM já existente, citado em `mem://ia/validacao-respostas-guardrails`).

Adicionar uma checagem específica: se for primeira interação (`inboundCount <= 1`) e a resposta gerada contiver **mais de uma frase interrogativa** OU mencionar "nome" mais de uma vez, reescrever para a frase modelo determinística do bloco (a mesma do prompt). Isso garante o resultado mesmo se o LLM ignorar a instrução.

### 3. Memória de regra
Criar `mem://ia/saudacao-primeira-mensagem-unica` documentando: na 1ª mensagem, Gael envia exatamente uma saudação + uma pergunta sobre o nome; nunca duplicar/parafrasear.

## Fora de escopo

- Não mexer em `buildContinuityBlock` (já está ok, problema é só na 1ª interação).
- Não alterar tom ou identidade do Gael.
- Não tocar nas regras de fechamento de LC implementadas anteriormente.

## Resultado esperado

Mensagem inicial passa a ser, por exemplo:

> "Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?"

Sem segunda pergunta, sem "?." duplicado.

## Deploy

Redeploy da edge function `ai-triage` após a alteração.
