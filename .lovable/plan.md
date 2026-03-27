

## Plano: Remover temporariamente a autenticação do reveal-secret

### Problema
Você precisa do `INTERNAL_SERVICE_SECRET` para chamar a função `reveal-secret`, mas não consegue copiar o valor dos Secrets na interface — criando um ciclo sem saída.

### Solução
Modificar temporariamente a função `reveal-secret` para aceitar chamadas **sem** o header `x-internal-secret`, retornando as chaves diretamente.

### Passos
1. Remover a validação do `x-internal-secret` na função `reveal-secret`
2. Fazer deploy automático
3. Você acessa via navegador: `https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/reveal-secret` e copia as chaves
4. Imediatamente após copiar, restauramos a proteção ou deletamos a função

### Segurança
- A função ficará aberta por poucos minutos, apenas o tempo de copiar
- Após copiar, deletamos a função completamente

