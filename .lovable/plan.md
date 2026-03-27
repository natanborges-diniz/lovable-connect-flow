

## Plano: Edge Function para Revelar Service Role Key

### O que será feito
Criar uma edge function temporária `reveal-secret` que retorna o valor da `SUPABASE_SERVICE_ROLE_KEY`, protegida pelo `INTERNAL_SERVICE_SECRET` já configurado no projeto.

### Como funciona
- Endpoint: `POST /functions/v1/reveal-secret`
- Header obrigatório: `x-internal-secret` com o valor do `INTERNAL_SERVICE_SECRET`
- Retorna as chaves: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` e `SUPABASE_ANON_KEY`

### Detalhes técnicos
- Arquivo: `supabase/functions/reveal-secret/index.ts`
- Validação do header `x-internal-secret` contra `INTERNAL_SERVICE_SECRET` (já existe nos secrets)
- CORS habilitado
- Após copiar as chaves, a função deve ser removida por segurança

### Como usar
Após deploy, chamar:
```
curl -X POST https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/reveal-secret \
  -H "x-internal-secret: SEU_INTERNAL_SERVICE_SECRET"
```

### Segurança
- Função protegida por token interno
- Recomendação: deletar a função após copiar os valores

