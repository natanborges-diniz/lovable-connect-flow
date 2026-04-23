

## Fran não aparece em "Nova conversa" — corrigir cache de profiles

### Diagnóstico
- Fran Borges existe em `profiles` (`ativo = true`, criada hoje).
- O hook em `src/pages/Mensagens.tsx` busca `profiles-ativos` sem `staleTime` e sem refetch ao abrir o popover. Como a aba ficou aberta antes da Fran ser criada, o React Query mantém o resultado antigo em cache.
- Resultado: usuários novos só aparecem após reload manual.

### Correção
Em `src/pages/Mensagens.tsx`, ajustar a query `profiles-ativos`:

- Adicionar `staleTime: 0` e `refetchOnWindowFocus: true`.
- Expor `refetch` e chamá-lo no `onOpenChange` do Popover de "Nova conversa" (sempre que o usuário abrir, busca a lista atualizada).
- Ordenar por `nome` para a lista ficar estável.

Isso garante que qualquer novo usuário criado pelo fluxo de "Novo usuário" apareça imediatamente sem precisar recarregar a página.

### Validação
- Abrir Mensagens → clicar no botão "+" de Nova conversa → "Fran Borges" deve aparecer na lista.
- Criar outro usuário pelo fluxo admin e confirmar que ele aparece sem reload.

### Arquivos afetados
- `src/pages/Mensagens.tsx` (somente a definição da query + handler do Popover).

