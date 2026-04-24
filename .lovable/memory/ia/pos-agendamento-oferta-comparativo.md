---
name: Pós-agendamento — oferta de comparativo e despedida
description: Após confirmar o agendamento, Gael pode oferecer um comparativo das marcas que o cliente teve dúvida. Define como tratar SIM/NÃO, despedida final e proibições. Implementa detector de oferta pendente em ai-triage.
type: feature
---

## Contexto

Após `agendar_visita` confirmado, Gael frequentemente oferece de forma proativa um comparativo das 2 marcas do orçamento sobre as quais o cliente demonstrou dúvida. Ex:

> "Posso já deixar separado um comparativo Essilor x ZEISS pra você ver na hora?"

A resposta do cliente é tipicamente **curta** ("sim", "não", "pode", "tranquilo") — sem mencionar marca nem usar verbos como "detalhe/compare". Isso quebrava o detector `isDetalhamentoContext` antigo (que exigia intent ou marca) → IA caía em fallback genérico.

## Fluxo desejado

```text
IA oferece comparativo (Essilor x Zeiss)
    │
    ├── Cliente: "Sim" / "Pode" / "Quero ver"
    │       ↓
    │   IA envia 1 parágrafo curto por marca + fechamento:
    │   "Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."
    │   (NÃO pergunta "quer fechar com uma delas?" — agendamento já existe)
    │
    └── Cliente: "Não" / "Tranquilo" / "Depois"
            ↓
        IA: "Tranquilo, [Nome]! Posso te ajudar em mais alguma coisa antes de finalizar?"
            │
            ├── Cliente: "Sim, …" → continua ajudando normalmente
            │
            └── Cliente: "Não" / "Tudo certo" / "Era só isso"
                    ↓
                IA: "Combinado, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."
                (intencao = "encerramento_pos_agendamento", sem mais perguntas)
```

## Implementação (ai-triage/index.ts)

### Detector `pendingComparativoOffer`
Varre últimas 2 outbound; aceita match se:
- Regex: `comparativ|deixar separado|posso (te|já)? (mostrar|enviar|deixar|preparar|separar) … (diferen|comparativ|opç)|quer que eu (detalhe|compare|envie|mostre|prepare) …`
- E menciona ≥2 marcas conhecidas: `Essilor|Zeiss|DNZ|Hoya|Kodak|DMAX|Solflex`.

### Resposta curta classificada
- `isShortYes`: `^(sim|isso|pode|claro|por favor|quero|manda|vamos|bora|show|beleza|ok|perfeito|com certeza|👍|👌)$` → ativa `isDetalhamentoContext` e força `orcamentoBrandsList = pendingComparativoOffer.marcas`.
- `isShortNo`: `^(não|nao|tranquilo|depois|deixa pra lá|tô bem|tudo certo|sem necessidade|n|nn|nao precisa)$`.
- `isShortNoToHelp`: `isShortNo` E última outbound contém "posso ajudar em mais alguma coisa" → ativa despedida final.

### Bloco `[FLUXO DETALHAMENTO]` adaptado
Quando há `agendamentoFmt` (data/hora/loja), substitui a regra "termine perguntando se quer fechar" por: "FECHE com 'Te espero [agendamentoFmt] 👋 Qualquer dúvida é só me chamar.'". Sem ofertas de novo agendamento.

### Bloco `[FLUXO DISPENSA COMPARATIVO]` (novo)
Texto canônico: `"Tranquilo, [Nome]! Posso te ajudar em mais alguma coisa antes de finalizar?"` — uma única pergunta.

### Bloco `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]` (novo)
Texto canônico: `"Combinado, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar."` — sem nenhuma pergunta. Marca `intencao = "encerramento_pos_agendamento"`.

### Validador
- **Bypass dispensa**: respostas dos blocos novos podem ter similaridade alta com mensagens prévias (citam loja/data) — bypass quando `(isShortNo || isShortNoToHelp) && resposta entre 20–240 chars`.
- **Fallback determinístico**: se LLM falhar, monta a frase canônica com `contatoNomeAtual.split(" ")[0]` + `agendamentoFmt`. Nunca cai em pool genérico nesses contextos.

## Proibições

- Reapresentar o orçamento quando cliente disse "sim" ao comparativo (LLM já tem o contexto, vai direto às 2 marcas).
- Perguntar "quer fechar com uma delas?" depois do comparativo se já há agendamento ativo.
- Oferecer agendamento de novo (já está marcado).
- Perguntar 2× se pode ajudar em mais alguma coisa (cliente já disse não → vai direto pra despedida).
- Cair em "Me explica melhor sua necessidade" / "Conta pra mim com mais detalhes" nesses fluxos.

## Resultado esperado

```
Cliente: Sim
Gael: A *Essilor Eyezen Boost* … [parágrafo]
      A *Zeiss SmartLife Individual* … [parágrafo]
      Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.

Cliente: Não
Gael: Tranquilo, Artur! Posso te ajudar em mais alguma coisa antes de finalizar?
Cliente: Não
Gael: Combinado, Artur! Te espero sábado, 25/04 às 17:00 na Diniz Primitiva I 👋 Qualquer dúvida é só me chamar.
```
