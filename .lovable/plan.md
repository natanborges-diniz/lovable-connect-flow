## Problema observado

No diálogo, após o agendamento confirmado o Gael ficou em loop e nunca finalizou:

1. Cliente: "Pode deixar o comparativo aqui." → IA: "Sobre o que estávamos falando, quer retomar?" (deveria ter enviado o comparativo das 2 marcas).
2. Cliente: "Não" / "Obg" → IA: "Me diz com mais detalhes…" / "Pra eu te ajudar certinho preciso entender…" (deveria ter despedido).
3. Cliente: "Agendar" → IA reconfirmou e ofereceu comparativo DNZ/DMAX/Essilor.
4. Cliente: "Não" → IA: "Tranquilo, Artur! Posso te ajudar em mais alguma coisa antes de finalizar?**. Tem mais algum detalhe que você queira ver agora?**" (LLM ignorou a regra de UMA pergunta só e duplicou).
5. Cliente: "Não. Obg." → IA: "Conta pra mim com mais detalhes o que você precisa…" (deveria ser a despedida final pós-agendamento, com os dados do agendamento).

## Causas raiz em `supabase/functions/ai-triage/index.ts`

- **Regex de SIM/NÃO curto é estrito demais**: `^(n[aã]o|...)$` não casa com "Não. Obg.", "não obrigado" com pontuação no meio, "ok obrigado", etc. O `msgTrim` só remove `.`/`!`/`…` no final.
- **Janela do detector de oferta**: `pendingComparativoOffer` varre só as últimas 2 outbound. Quando o cliente já passou por uma rodada de "Não → pergunta de ajuda → Não", a oferta original sai da janela e o `isShortYes` para de funcionar.
- **Aceite com palavras adicionais**: "Pode deixar o comparativo aqui", "quero ver sim, manda", "pode mandar" — variações comuns não batem em `^(sim|pode|...)$`.
- **LLM não respeita "uma pergunta só"** no template `[FLUXO DISPENSA COMPARATIVO]`. Texto curto e canônico precisa ser injetado deterministicamente, ignorando a saída do LLM.
- **Despedida pós-agendamento não é forçada quando o cliente agradece**: "Obg", "Obrigado", "valeu" após o agendamento devem encerrar com a frase canônica de despedida com `agendamentoFmt`, mesmo que `pendingComparativoOffer` não esteja mais na janela.

## Mudanças propostas

### 1. Normalização da mensagem do cliente
- Remover pontuação interna e sufixos comuns: `obg`, `obrigad[oa]`, `valeu`, `vlw`, `tks`, `thx`, `brigad[oa]`. Após strip, reaplicar regex.
- `msgTrim2 = msgTrim.replace(/[.,!…]+/g," ").replace(/\b(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx)\b/g,"").replace(/\s+/g," ").trim()`.

### 2. Detector de "agradecimento de encerramento" (novo)
- `isThanksClose = /^(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx|ok obrigad[oa]|t[aá] bom obrigad[oa])$/i.test(msgTrim2)` **OU** combinação `n[aã]o` + agradecimento.
- Quando `isThanksClose` e existe `agendamentoFmt` ativo → forçar `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]` independentemente de `pendingComparativoOffer`/`askedHelpMore`.

### 3. Ampliar `pendingComparativoOffer`
- Varrer últimas **6 outbound** (não 2) para sobreviver a 1-2 rodadas de pergunta de ajuda.
- Aceitar segunda oferta nova (DNZ/DMAX/Essilor) sobrescrevendo a anterior.

### 4. Aceite afirmativo com cauda
- Adicionar regex `isLongYes` que aceita `^(pode|quero|claro|manda|vamos|bora|ok|sim|adoraria) .{0,80}(comparativ|opç|diferen|ver|aqui|mostra|envia|prepara)`.
- Exemplos: "pode deixar o comparativo aqui", "manda o comparativo", "quero ver as opções", "claro pode mostrar".
- Quando `isLongYes` e há `pendingComparativoOffer` → mesmo tratamento que `isShortYes`.

### 5. `isShortNo` / `isShortNoToHelp` independentes de `pendingComparativoOffer`
- Hoje `isShortNo` requer `pendingComparativoOffer`. Trocar para: requer `pendingComparativoOffer` **OU** `askedHelpMore` **OU** existência de `agendamentoFmt` ativo + última outbound oferecendo algo.
- Garantir que após cair em `[FLUXO DISPENSA]` uma vez, o próximo "não/obg" entre direto em `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]`.

### 6. Override determinístico da resposta (não confiar no LLM)
Para os 3 fluxos canônicos curtos, **substituir a resposta do LLM** pela frase canônica antes do envio, em vez de só fallback quando o LLM falha:

```text
[FLUXO DISPENSA COMPARATIVO]
"Tranquilo, {Nome}! Posso te ajudar em mais alguma coisa antes de finalizar?"

[FLUXO DESPEDIDA PÓS-AGENDAMENTO]
"Combinado, {Nome}! Te espero {agendamentoFmt} 👋 Qualquer dúvida é só me chamar."

[FLUXO AGRADECIMENTO PÓS-AGENDAMENTO] (novo)
"De nada, {Nome}! Te espero {agendamentoFmt} 👋 Qualquer dúvida é só me chamar."
```

Aplicar via post-processing: se `isShortNo && !isShortNoToHelp` → forçar texto dispensa; se `isShortNoToHelp || isThanksClose` → forçar texto despedida. Marcar `intencao = "encerramento_pos_agendamento"` e `proximo_passo = ""`.

### 7. Logs
- `[OFERTA-COMP] match-window=N rounds-back=K` para diagnosticar futuros casos.
- `[CLOSE] thanksClose=true → DESPEDIDA forçada`.

## Arquivos editados

- `supabase/functions/ai-triage/index.ts` — itens 1-7.
- `.lovable/memory/ia/pos-agendamento-oferta-comparativo.md` — adicionar regras de "obg/obrigado", aceite longo e override determinístico.
- `.lovable/plan.md` — registrar correção.

## Resultado esperado

```text
Cliente: Pode deixar o comparativo aqui.
Gael: A *Essilor*… [parágrafo] / A *Zeiss*… [parágrafo] / Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋

Cliente: Não
Gael: Tranquilo, Artur! Posso te ajudar em mais alguma coisa antes de finalizar?

Cliente: Não. Obg.
Gael: Combinado, Artur! Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.
(encerramento_pos_agendamento — sem mais perguntas)

Cliente: Obg. (sem "não" antes)
Gael: De nada, Artur! Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.
```

Após aprovação eu aplico as mudanças e redeploy do `ai-triage`.