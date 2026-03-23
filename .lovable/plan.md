

## Diagnóstico: IA "alucinada" e não responde ao contexto do cliente

### Problema identificado

Analisando os logs, a IA classifica tudo como `precisa_humano=true` e `ainda_precisa=true` sem realmente processar o conteúdo das mensagens. Dois problemas técnicos causam isso:

1. **Modelo fraco para a tarefa**: O modelo `google/gemini-3-flash-preview` é rápido mas tem baixa capacidade de raciocínio com múltiplos system prompts + tool calling. Ele "preenche os campos da ferramenta" sem ler o contexto real.

2. **Mensagem atual não está destacada**: O histórico de chat é injetado como mensagens user/assistant, mas a mensagem ATUAL do cliente não é diferenciada das anteriores. A IA não sabe qual é a mensagem que precisa responder.

### Solução (2 mudanças no `ai-triage/index.ts`)

**1. Trocar o modelo para `google/gemini-2.5-pro`**

Modelo com raciocínio muito superior, melhor aderência a instruções e capacidade de analisar contexto real. É o equivalente ao GPT que o usuário menciona como "muito melhor".

**2. Destacar a mensagem atual do cliente**

Após o chat history, adicionar uma mensagem explícita: `"MENSAGEM ATUAL DO CLIENTE (responda a esta): [texto]"` para que o modelo saiba exatamente o que precisa responder.

| Arquivo | Alteração |
|---|---|
| `supabase/functions/ai-triage/index.ts` | 1) Trocar modelo de `gemini-3-flash-preview` para `gemini-2.5-pro`. 2) Extrair a última mensagem inbound do histórico e adicioná-la como mensagem user destacada após as instruções de classificação, garantindo que a IA saiba exatamente o que responder. |

### Resultado esperado

A IA vai de fato ler e analisar o que o cliente diz, respondendo com relevância ao conteúdo da mensagem em vez de ignorar e repetir padrões genéricos.

