

## Correção: `max_tokens` incompatível com modelo

O erro nos logs é claro:

```
"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
```

O modelo `openai/gpt-5` (via gateway) exige `max_completion_tokens` em vez de `max_tokens`.

### Mudança

**Arquivo**: `supabase/functions/ai-triage/index.ts` (linha 466)

Trocar `max_tokens: 500` por `max_completion_tokens: 500`.

Correção de uma linha. Sem outras alterações necessárias.

