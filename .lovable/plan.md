

## Plano Atualizado: Modo Híbrido Inteligente + Terminologia "Consultor Especializado"

### Mudança adicional

Em toda comunicação da IA com o cliente, o atendente humano deve ser referenciado **exclusivamente** como **"Consultor especializado"**. Nunca "atendente", "operador", "humano", "agente" etc.

Isso se aplica a:
- Prompt do modo híbrido (quando IA informa que um humano foi acionado)
- Qualquer resposta gerada pela IA que mencione escalação
- Descrição do campo `resposta` na tool

### Mudanças completas

| Arquivo | Alteração |
|---|---|
| `supabase/functions/ai-triage/index.ts` | 1) Aceitar `modo === "hibrido"` (não pular). 2) Prompt híbrido: "Um Consultor especializado foi solicitado...". 3) Adicionar campo `ainda_precisa_humano` na tool. 4) Se `false`, reverter modo para `"ia"`. 5) Na escalação, usar `"hibrido"` em vez de `"humano"`. 6) Em TODAS as instruções/prompts, substituir "atendente"/"humano" por "Consultor especializado". 7) Adicionar regra explícita no system prompt: "NUNCA use os termos 'atendente', 'operador', 'humano' ou 'agente'. Use SEMPRE 'Consultor especializado'." |
| `supabase/functions/whatsapp-webhook/index.ts` | Disparar `ai-triage` também quando `modo === "hibrido"` |
| `src/pages/Pipeline.tsx` | Badge "IA Monitorando" (amarelo) para cards em modo híbrido |

### Prompt híbrido (trecho)

> "Um Consultor especializado foi solicitado anteriormente mas ainda não assumiu. Você continua respondendo normalmente — trate qualquer assunto dentro do seu escopo. REGRA DE TERMINOLOGIA: ao mencionar atendimento humano, use SEMPRE o termo 'Consultor especializado'. NUNCA diga 'atendente', 'operador', 'humano' ou 'agente'."

### Fluxo

```text
Cliente envia msg → IA responde (modo "ia")
  ↓ IA detecta necessidade de humano
Modo → "hibrido", card → coluna Atendimento Humano
IA diz: "Vou acionar um Consultor especializado para te ajudar..."
  ↓ Cliente pergunta algo novo dentro do escopo
IA responde normalmente + reavalia: ainda_precisa_humano?
  ↓ false → modo volta para "ia"
  ↓ true → mantém híbrido
  ↓ Operador envia mensagem manual
Modo → "humano", IA para completamente
```

