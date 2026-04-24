---
name: Saudação inicial Gael — única pergunta sobre o nome
description: Na 1ª mensagem o Gael envia exatamente uma saudação + uma pergunta sobre o nome; nunca duplica/parafraseia. Guardrail intra-mensagem reforça.
type: feature
---

# Regra

Na primeira interação (`inboundCount <= 1`) com um cliente novo, o Gael deve enviar **exatamente uma** saudação seguida de **uma única** pergunta sobre o nome. Não pode complementar com uma segunda pergunta de reforço.

## Mensagens canônicas

- Sem nome capturado do WhatsApp:
  > "Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?"

- Com nome capturado do WhatsApp (`primeiroNome`):
  > "Olá! Falo com {primeiroNome}? 😊 Aqui é o Gael das Óticas Diniz Osasco."

## Proibido

- Acrescentar uma segunda pergunta sobre o nome ("Pode me dizer seu nome completo?", "Como prefere ser chamado?", "Qual seu nome?").
- Duplicar pontuação ("?.", "??", "?!").
- Parafrasear ou mesclar duas variações da mesma pergunta na mesma mensagem.

## Como é garantido

1. **Prompt** (`buildFirstContactBlock` em `supabase/functions/ai-triage/index.ts`): instrui o LLM a enviar EXATAMENTE a frase modelo, com regras explícitas de proibição.
2. **Guardrail intra-mensagem** (antes do `sendWhatsApp` em `ai-triage`): se `inboundCount <= 1` e a resposta gerada contém `gael` + (mais de 1 `?`, ou `nome` mencionado >1 vez, ou pontuação duplicada), substitui pela frase modelo determinística e loga `[GUARDRAIL] Saudação duplicada corrigida`.

## Por quê

Cliente reportou mensagem inicial repetitiva: "Posso saber seu nome, por favor?. Pode me dizer seu nome completo como prefere ser chamado?". Quebra o tom natural do Gael e parece script automático.
