

# Separar Nível de Acesso e Áreas do Sistema — UI Clara

## Problema Atual

A tela de gestão de usuários tem **duas colunas que fazem a mesma coisa**:
- "Setor Principal" (campo `profiles.setor_id`) — dropdown de setor
- "Permissões" (registros em `user_roles` com `setor_id`) — badges com setor

O admin não sabe qual usar, e ambos gravam setor em lugares diferentes. Confusão total.

## Solução

Redesenhar a tabela com **duas colunas claras e distintas**:

```text
| Nome | E-mail | Nível de Acesso | Áreas do Sistema | Ativo |
```

### Nível de Acesso (substitui "Permissões")
- Dropdown simples: **Admin** / **Operador** / **Setor**
- Admin = tudo; Operador = vê tudo sem gerenciar; Setor = acesso restrito
- Grava em `user_roles.role`

### Áreas do Sistema (substitui "Setor Principal")
- Só aparece quando o nível é **Setor**
- Permite adicionar **múltiplos setores** (badges com "×" para remover)
- Cada badge mostra o nome do setor (ex: "Financeiro", "Loja · DINIZ PRIMITIVA I")
- Quando seleciona setor "Loja", aparece o sub-dropdown de unidade
- Grava em `user_roles` (cada setor = um registro)

### Remoção da coluna "Setor Principal"
- Remove o dropdown de `profiles.setor_id` da UI
- O `profiles.setor_id` passa a ser **sincronizado automaticamente** com o primeiro setor do `user_roles` (para manter compatibilidade com RLS de notificações)

## Implementação

### 1. Redesenhar `GestaoUsuariosCard.tsx`
- Remover coluna "Setor Principal" e a mutation `updateProfileSetor`
- Coluna "Nível de Acesso": dropdown Admin/Operador/Setor (muda o role de todos os user_roles do usuário)
- Coluna "Áreas do Sistema": lista de setores atribuídos (visível só para setor_usuario), com botão "+" para adicionar setor e "×" para remover
- Auto-sync: ao alterar user_roles, atualizar `profiles.setor_id` com o primeiro setor

### 2. Labels descritivos
- Tooltips ou subtítulos explicativos:
  - Nível de Acesso: "Define o que o usuário pode fazer"
  - Áreas do Sistema: "Define quais módulos o usuário pode ver"

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/components/configuracoes/GestaoUsuariosCard.tsx` | Redesenho completo das colunas da tabela |

## Resultado

- Admin vê claramente: "esse usuário é Operador" vs "esse usuário do Setor só acessa Financeiro e TI"
- Sem duplicidade de informação
- `profiles.setor_id` mantido em sync para RLS, mas invisível na UI

