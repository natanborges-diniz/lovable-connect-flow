

# Segregação de Agendamentos por Loja — Permissões por Unidade

## Problema

O setor chamado "Agendamentos" é na verdade o setor das **Lojas**. Cada loja (ex: DINIZ PRIMITIVA I) precisa ver **apenas os agendamentos da sua unidade**, enquanto admin/operador vê tudo. Hoje não existe vínculo entre o usuário e a loja específica.

## Solução

### 1. Renomear setor "Agendamentos" → "Loja"

Atualizar o registro na tabela `setores` (id: `277307f3-...`) de "Agendamentos" para "Loja".

### 2. Adicionar campo `loja_nome` na tabela `user_roles`

Novo campo opcional que identifica **qual loja específica** o `setor_usuario` do setor "Loja" pode ver. Exemplo: um usuário com `setor_id = Loja` e `loja_nome = "DINIZ PRIMITIVA I"` só verá agendamentos dessa unidade.

```text
user_roles
├── user_id
├── role (setor_usuario)
├── setor_id → setores.id (Loja)
└── loja_nome (NEW) → "DINIZ PRIMITIVA I"
```

### 3. Filtro automático no Pipeline de Agendamentos

Em `PipelineAgendamentos.tsx`:
- Se `isAdmin` ou `isOperador`: mostra tudo (com filtro manual por loja)
- Se `setor_usuario` com setor "Loja": aplica `filtroLoja` automático com o `loja_nome` do `user_roles`, sem dropdown de troca

### 4. Atualizar navegação

Em `TopNavigation.tsx`, adicionar mapeamento:
- Setor "loja" → módulos: `["dashboard", "agendamentos"]`

### 5. Gestão de Usuários — seleção de loja

Em `GestaoUsuariosCard.tsx`, quando o admin atribui setor "Loja" a um usuário, mostrar um dropdown adicional com as lojas de `telefones_lojas` (tipo = 'loja') para definir o `loja_nome`.

### 6. Expor `loja_nome` no useAuth

Atualizar `useAuth.tsx` para incluir `loja_nome` dos roles do usuário, disponibilizando para o pipeline filtrar automaticamente.

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | `ALTER TABLE user_roles ADD COLUMN loja_nome text` |
| Data update | `UPDATE setores SET nome = 'Loja' WHERE id = '277307f3-...'` |
| `src/hooks/useAuth.tsx` | Expor `loja_nome` do user_role |
| `src/pages/PipelineAgendamentos.tsx` | Auto-filtrar por `loja_nome` para `setor_usuario` |
| `src/components/layout/TopNavigation.tsx` | Mapear setor "loja" → `["dashboard", "agendamentos"]` |
| `src/components/configuracoes/GestaoUsuariosCard.tsx` | Dropdown de loja ao atribuir setor "Loja" |

## Resultado

- DINIZ PRIMITIVA I loga → vê apenas seus agendamentos
- Admin/Operador → vê todas as lojas com filtro manual
- Gestão centralizada: admin atribui loja + setor em Configurações

