## Diagnóstico

Na conversa da Thaynara, o Gael nunca pediu a receita porque a mensagem **"Eu tenho a receita … já tenho a armação"** caiu num router que existe ANTES do fluxo normal de receita: o **POST-DATA ROUTER de "modelos / armações"** em `supabase/functions/ai-triage/index.ts` linhas 2036–2080.

Esse router é acionado pela regex:

```
/\b(modelo|modelos|armac|armaç|armacao|armação|armações|armacoes)\b/
```

E só é bloqueado quando a mesma mensagem contém `lente|lentes|grau|orcamento de lente`. Como a frase da cliente **mencionou "armação" mas não "lente/grau"**, o router disparou e respondeu com o convite presencial padrão.

Pior: nas mensagens seguintes ("não preciso de armação" / "não preciso de armação" / "não") a palavra "armação" continuou batendo na regex e o router repetiu a mesma resposta 3 vezes — clássico loop, até o `loop-escalation` chutar e jogar pro humano.

Causa-raiz: a regex trata QUALQUER menção a "armação" como **pedido** de armação, incluindo:
- Resposta a uma pergunta da IA ("já tenho armação")
- Negação explícita ("não preciso de armação")
- Recusa curta sem contexto ("não")

E ignora completamente o fato de a cliente ter dito **"tenho receita atualizada"** — sinal de que o próximo passo natural era pedir a foto da receita para gerar orçamento de lentes.

## Correção

Editar **um único bloco** em `supabase/functions/ai-triage/index.ts` (linhas 2036–2080):

1. **Estreitar o gatilho `isArmacaoIntent`** para exigir VERBO de pedido/curiosidade junto da palavra armação. Aceitar apenas frases como "quero ver armações", "que armações vocês têm", "mostra modelos", "tem Ray-Ban?". Rejeitar quando a frase contém:
   - Negação: `\b(n[ãa]o|sem)\b` próxima de "armação/modelo"
   - Posse: `\b(j[áa]\s+tenho|tenho\s+(a|minha))\b` próxima de "armação"
   - Resposta curta de confirmação a pergunta anterior da IA sobre armação

2. **Bypass do router quando a IA acabou de perguntar sobre receita+armação**: se a última mensagem outbound da IA contém algo como "tem receita … armação" e o inbound do cliente confirma posse de receita, o router NÃO deve disparar — em vez disso, o fluxo segue para a lógica normal que pede a foto da receita (`responder_pedindo_receita`).

3. **Bypass se cliente afirma ter receita**: detectar `\b(tenho|tenho a|j[áa] tenho|sim,? tenho)\b.*\breceita\b` no inbound atual ou nos últimos 2 inbounds e, nesse caso, pular o router de armações e seguir para o pedido de foto da receita.

4. **Anti-loop duro**: se `contatoMeta.armacoes_orientado === true` (já mandamos o convite uma vez nesta conversa), o router não dispara de novo — devolve `null` e deixa o LLM decidir.

## Resultado esperado

Para a próxima Thaynara:

```
Cliente: oculos de grau
Gael:    [pergunta receita + armação]
Cliente: tenho a receita e já tenho a armação
Gael:    Perfeito! Me manda uma foto da receita que eu já te passo as opções de lente
         compatíveis 😊  (em vez do convite presencial repetido)
```

Caso a cliente realmente queira ver armações, basta dizer "quero ver armações / mostra modelos" → router dispara normalmente.

## Arquivos alterados

- `supabase/functions/ai-triage/index.ts` (apenas o bloco 2036–2080)

Sem migrações, sem mudança de schema, sem mexer em outros fluxos.