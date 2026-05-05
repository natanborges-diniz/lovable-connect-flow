## Problema

Quando o cliente diz explicitamente algo como **"Encerrar atendimento"**, **"Pode encerrar"**, **"Finalizar"**, etc., a IA não tem um detector dedicado. Hoje só existem heurísticas para:
- `isThanksOnly` ("obg", "valeu") — exige `hasAgendamentoAtivo`
- `isShortNoToHelp` (cliente diz "não" após pergunta "posso te ajudar em mais alguma coisa?")
- `isThanksClose` (agradecimento + agendamento ativo)

Se o cliente vier direto com "encerrar atendimento" sem ter passado por essas condições (ex.: sem agendamento ativo, ou no meio de outra conversa), a IA cai no LLM e pode responder qualquer coisa em vez de despedida + agradecimento.

## Solução

Adicionar em `supabase/functions/ai-triage/index.ts` um novo detector determinístico **`isExplicitClose`** que captura comandos explícitos de encerramento e dispara uma despedida calorosa com agradecimento — independente de ter agendamento ativo ou não.

### 1. Novo regex (próximo às linhas 2179-2209)

```ts
const EXPLICIT_CLOSE_RE = /^(pode (encerrar|finalizar|fechar)( o)?( atendimento| chat| conversa)?|encerrar( atendimento)?|finalizar( atendimento)?|fechar( atendimento)?|encerra( a[ií])?|encerra ai|pode (fechar|encerrar) por aqui|j[aá] resolveu|era (s[oó] )?isso( mesmo)?,? obrigad[oa])$/i;
const isExplicitClose = EXPLICIT_CLOSE_RE.test(msgTrim2);
```

### 2. Hint pro LLM (junto ao bloco que injeta `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]`, ~linha 2331)

```ts
isExplicitClose
  ? `[FLUXO ENCERRAMENTO EXPLÍCITO] Cliente pediu para encerrar o atendimento. Despeça-se de forma calorosa, AGRADEÇA o contato e NÃO pergunte mais nada. Use exatamente esta estrutura: "Foi um prazer te atender${contatoNomeAtual ? ", " + contatoNomeAtual.split(" ")[0] : ""}! 🙏 Obrigado pelo contato${agendamentoFmt ? ` — te espero ${agendamentoFmt}` : ""}. Qualquer coisa, é só me chamar 👋". Tool responder, proximo_passo vazio.`
  : ...
```

### 3. Override determinístico (junto aos overrides ~linha 3424)

```ts
if (resposta && isExplicitClose) {
  const _despedida = agendamentoFmt
    ? `Foi um prazer te atender${_nomePrim ? ", " + _nomePrim : ""}! 🙏 Obrigado pelo contato — te espero ${agendamentoFmt}. Qualquer coisa, é só me chamar 👋`
    : `Foi um prazer te atender${_nomePrim ? ", " + _nomePrim : ""}! 🙏 Obrigado pelo contato. Qualquer coisa, é só me chamar 👋`;
  resposta = _despedida;
  intencao = "encerramento_explicito";
  validatorFlags.push("override_explicit_close");
  console.log("[OVERRIDE] explicit_close → despedida + agradecimento");
}
```

### 4. Integrar com a dedup já existente (linha 3405)

Adicionar `isExplicitClose` à lista de gatilhos que detecta despedida duplicada, para que o cliente não receba duas despedidas se mandar "encerrar" + "obg" em sequência:

```ts
if (_despedidaJaEnviada && (isThanksClose || isShortNoToHelp || isThanksOnly || isExplicitClose || SHORT_NO_RE.test(msgTrim2))) { ... }
```

Também atualizar o regex `_despedidaJaEnviada` para reconhecer a nova frase canônica:
```ts
const _despedidaJaEnviada =
  /Qualquer d[úu]vida [ée] s[óo] me chamar|Qualquer coisa,? [ée] s[óo] me chamar/i.test(_lastOut)
  && (/Te espero|Qualquer coisa estou por aqui|Foi um prazer te atender/i.test(_lastOut));
```

### 5. Bypass do early-return (linha 2257)

Estender o gate `if (isThanksClose || isShortNoToHelp)` para também aceitar `isExplicitClose`, garantindo que o fluxo de despedida pegue antes de qualquer outra regra (ex.: pergunta proativa).

## Arquivos alterados

- `supabase/functions/ai-triage/index.ts` (5 edits localizados)

Sem migrations. Sem mudanças em UI.

## Validação

- "Encerrar atendimento" sem agendamento → "Foi um prazer te atender, X! 🙏 Obrigado pelo contato. Qualquer coisa, é só me chamar 👋"
- "Pode encerrar" com agendamento ativo → mesma frase + "te espero {data}"
- "Encerrar" + "Obg" em sequência → segunda mensagem suprimida pela dedup já existente
- Evento `eventos_crm.tipo='encerramento_explicito'` registrado via `validatorFlags`

## Memória

Atualizar `mem://crm/fluxo-encerramento-atendimento` (ou criar se não existir) descrevendo o detector `isExplicitClose` e a frase canônica.
