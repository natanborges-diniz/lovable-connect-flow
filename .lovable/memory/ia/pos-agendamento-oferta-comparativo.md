---
name: Pós-agendamento — oferta de comparativo, despedida e agradecimento
description: Após agendar_visita, Gael pode oferecer comparativo de marcas. Define fluxo SIM/NÃO/agradecimento, despedida final, override determinístico e proibições. Implementa detector de oferta pendente em ai-triage com janela de 6 outbound, normalização de "obg/obrigado" e aceite afirmativo longo.
type: feature
---

## Contexto

Após `agendar_visita` confirmado, Gael frequentemente oferece de forma proativa um comparativo das 2 marcas do orçamento sobre as quais o cliente teve dúvida. Ex:

> "Posso já deixar separado um comparativo Essilor x ZEISS pra você ver na hora?"

A resposta do cliente é tipicamente **curta** ("sim", "não", "pode", "obg") ou com **cauda** ("pode deixar o comparativo aqui", "manda o comparativo", "Não. Obg.").

## Fluxo desejado

```text
IA oferece comparativo (Essilor x Zeiss)
    │
    ├── Cliente: SIM ("Sim", "Pode", "Pode deixar o comparativo aqui", "Manda")
    │       ↓
    │   IA envia 1 parágrafo curto por marca + fechamento:
    │   "Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."
    │
    ├── Cliente: NÃO ("Não", "Tranquilo", "Depois")
    │       ↓
    │   IA: "Tranquilo, [Nome]! Posso te ajudar em mais alguma coisa antes de finalizar?"
    │       │
    │       ├── Cliente: NÃO / "Não. Obg." / "Tudo certo"
    │       │       ↓
    │       │   IA: "Combinado, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."
    │       │
    │       └── Cliente: SIM, …  → continua ajudando
    │
    └── Cliente: AGRADECIMENTO PURO ("Obg", "Obrigado", "Valeu")
            ↓
        IA: "De nada, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."
```

## Implementação (ai-triage/index.ts)

### Detector `pendingComparativoOffer`
- Varre últimas **6 outbound** (não 2 — sobrevive a rodadas intermediárias).
- Regex de oferta + ≥2 marcas conhecidas (Essilor|Zeiss|DNZ|Hoya|Kodak|DMAX|Solflex).

### Normalização da mensagem
- `msgTrim2 = msgTrim.replace(/[.,!…]+/g," ").replace(/\b(obg|obrigad[oa]|valeu|vlw|brigad[oa]|tks|thx)\b/g,"").trim()` — permite que "Não. Obg." case com regex de "não".

### Classificação
- `isShortYes` (regex curto) **OU** `isLongYes` (`^(pode|quero|claro|manda|...)\b.{0,80}\b(comparativ|opç|diferen|ver|aqui|mostra|envia|prepara|deixa|aceito)`) → ativa detalhamento + força `orcamentoBrandsList = pendingComparativoOffer.marcas`.
- `isShortNo` agora aceita 3 contextos: `pendingComparativoOffer` OU `askedHelpMore` OU `hasAgendamentoAtivo` (independente da janela de oferta).
- `isShortNoToHelp`: 2ª negativa após "posso ajudar em mais alguma coisa" **OU** agradecimento puro pós-agendamento sem oferta pendente → despedida final.
- `isThanksClose`: agradecimento puro + agendamento ativo + sem pergunta de ajuda prévia → "De nada + despedida".

### Override determinístico (antes do validator)
**Substitui a resposta do LLM** pelas frases canônicas, em vez de só fallback. Necessário porque o LLM frequentemente adiciona segunda pergunta ou varia o texto:

```ts
if (isThanksClose && agendamentoFmt) {
  resposta = `De nada, ${nome}! Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`;
} else if (isShortNoToHelp) {
  resposta = `Combinado, ${nome}! Te espero ${agendamentoFmt} 👋 Qualquer dúvida é só me chamar.`;
} else if (isShortNo && !isDetalhamentoContext) {
  resposta = `Tranquilo, ${nome}! Posso te ajudar em mais alguma coisa antes de finalizar?`;
}
```

## Proibições

- Reapresentar o orçamento quando cliente disse "sim" ao comparativo.
- Perguntar "quer fechar com uma delas?" depois do comparativo se já há agendamento ativo.
- Oferecer agendamento de novo (já está marcado).
- Fazer 2 perguntas no mesmo turno do FLUXO DISPENSA (override força UMA pergunta só).
- Cair em "Me explica melhor sua necessidade" / "Conta pra mim com mais detalhes" nesses fluxos.
- Pedir ao cliente que repita após "Obg" — interpretar como encerramento educado.

## Resultado esperado

```
Cliente: Pode deixar o comparativo aqui.
Gael: A *Essilor* … / A *Zeiss* … / Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋

Cliente: Não
Gael: Tranquilo, Artur! Posso te ajudar em mais alguma coisa antes de finalizar?

Cliente: Não. Obg.
Gael: Combinado, Artur! Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.

Cliente: Obg. (sem "não" antes)
Gael: De nada, Artur! Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.
```
