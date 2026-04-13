

# Setor e Role Padrão para Novos Usuários

## Problema
Quando um usuário entra no sistema (via SSO ou primeiro login), ele não recebe nenhum `user_role`, ficando sem acesso configurado.

## Solução
Armazenar uma configuração de "setor padrão" e "role padrão" na tabela `configuracoes_ia` (que já serve como key-value store) e aplicar automaticamente no trigger `handle_new_user` quando um novo usuário é criado.

## Implementação

### 1. Configuração na UI (GestaoUsuariosCard)
Adicionar no topo do card uma seção "Padrão para novos usuários" com dois dropdowns:
- **Role padrão** (admin / operador / setor_usuario) — salva em `configuracoes_ia` com chave `default_role`
- **Setor padrão** (lista de setores ativos) — salva em `configuracoes_ia` com chave `default_setor_id`

### 2. Migração SQL — Atualizar `handle_new_user`
Modificar a função `handle_new_user` para, após criar o profile, buscar as configurações padrão e inserir automaticamente um registro em `user_roles`:

```sql
-- Dentro do handle_new_user, após INSERT INTO profiles:
SELECT valor INTO _default_role FROM configuracoes_ia WHERE chave = 'default_role';
SELECT valor INTO _default_setor FROM configuracoes_ia WHERE chave = 'default_setor_id';

IF _default_role IS NOT NULL THEN
  INSERT INTO user_roles (user_id, role, setor_id)
  VALUES (NEW.id, _default_role::app_role, _default_setor::uuid)
  ON CONFLICT DO NOTHING;
  
  -- Atualizar setor no profile
  IF _default_setor IS NOT NULL THEN
    UPDATE profiles SET setor_id = _default_setor::uuid WHERE id = NEW.id;
  END IF;
END IF;
```

### 3. Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | Atualizar função `handle_new_user` para aplicar role/setor padrão |
| `src/components/configuracoes/GestaoUsuariosCard.tsx` | Seção de configuração de defaults com dois dropdowns |

