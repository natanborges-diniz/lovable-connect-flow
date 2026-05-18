## Fix: gênero da mensagem do Gael (masculino)

Trocar "Obrigada" por "Obrigado" na resposta determinística do handler `recupera_nao` em `supabase/functions/ai-triage/index.ts` (linha 8477).

**Antes:**
```ts
await sendWhatsApp(..., "Compreendo! Obrigada pelo retorno. Quando precisar, estaremos por aqui 😊");
```

**Depois:**
```ts
await sendWhatsApp(..., "Compreendo! Obrigado pelo retorno. Quando precisar, estaremos por aqui 😊");
```

Após o ajuste, redeploy da edge function `ai-triage`. Nenhuma outra ocorrência de "Obrigada" foi encontrada em `supabase/functions`, `src/` ou memórias.