

# Evolução do INFOCO OPS — Ecossistema com Permissões Setoriais, SSO e Limpeza de Código Obsoleto

## Análise do Cenário Atual

O INFOCO OPS cresceu de um sistema de atendimento WhatsApp para um CRM completo com pipelines setoriais, bot interno, protocolo sequencial, comprovantes e comunicação interna. Porém, a operacionalidade atual tem lacunas:

- **Sem controle de acesso por setor** — qualquer usuário logado vê todos os módulos
- **Login isolado** — não integrado com o Infoco Optical Business via SSO
- **Notificações sem filtro setorial real** — a RLS filtra por `setor_id` do profile, mas o profile raramente tem `setor_id` preenchido
- **Página Index.tsx** — ainda é um placeholder não utilizado
- **Cadastro público aberto** — qualquer pessoa pode criar conta (aba "Cadastrar")
- **Código com `as any` excessivo** — tipagem fraca em vários hooks e páginas

## Plano de Implementação

### 1. Migração SQL — Permissões por Setor (user_roles)

Criar tabela `user_roles` seguindo as melhores práticas de segurança:

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'operador', 'setor_usuario');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  setor_id uuid REFERENCES setores(id) ON DELETE SET NULL,
  UNIQUE (user_id, role, setor_id)
);

-- Security definer function para evitar recursão RLS
CREATE OR REPLACE FUNCTION public.has_role(...)
CREATE OR REPLACE FUNCTION public.get_user_setor_ids(...)
```

- `admin` vê tudo
- `operador` vê tudo (back-office geral)
- `setor_usuario` vê apenas o pipeline do seu setor

### 2. Atualizar `profiles` — garantir `setor_id` preenchido

A coluna `setor_id` já existe em `profiles`. Será usada como setor principal, mas `user_roles` permite múltiplos setores.

### 3. SSO com Infoco Optical Business

Atualizar a Edge Function `sso-login`:
- Corrigir a URL de redirect (atualmente aponta para `lens-data-vision.lovable.app`, deve apontar para `atrium-link.lovable.app`)
- Incluir `setor_id` e `role` nos metadados do magic link
- Ao provisionar usuário, criar automaticamente o `user_role` adequado
- No Optical Business, o botão "Acessar INFOCO OPS" chamará esta function passando email + setor

### 4. Navegação Condicional por Permissão

**Arquivo**: `src/hooks/useAuth.tsx`
- Adicionar fetch de `user_roles` junto ao profile
- Expor `roles`, `setorIds`, `isAdmin`, `hasRole()` no contexto

**Arquivo**: `src/components/layout/TopNavigation.tsx`
- Filtrar módulos visíveis com base nas roles:
  - `admin`/`operador`: todos os módulos
  - `setor_usuario` com setor "Financeiro": apenas Dashboard + Financeiro + Solicitações + Tarefas
  - `setor_usuario` com setor "TI": apenas Dashboard + Solicitações + Tarefas

**Arquivo**: `src/components/layout/AppLayout.tsx`
- Redirecionar para o pipeline correto ao logar (ex: usuário do Financeiro cai em `/financeiro`)

### 5. Proteção de Rotas

**Arquivo**: `src/components/auth/ProtectedRoute.tsx`
- Aceitar prop `allowedRoles` e `allowedSetores`
- Redirecionar para rota padrão se o usuário não tiver permissão

**Arquivo**: `src/App.tsx`
- Aplicar `allowedRoles` nas rotas sensíveis (Configurações → apenas admin)

### 6. Notificações com Cadência Setorial

Quando uma demanda chega ao setor:
- Todos os `user_roles` com aquele `setor_id` recebem notificação
- Ao conectar via SSO, as notificações pendentes aparecem imediatamente (já funciona via Realtime)
- Adicionar som/vibração no navegador para novas notificações

### 7. Remover Auth Pública (Cadastro Aberto)

- Remover aba "Cadastrar" do `Auth.tsx` — usuários serão provisionados via SSO ou manualmente por admin
- Criar seção em Configurações para gerenciar usuários e atribuir setores/roles

### 8. Limpeza de Código Obsoleto

| Item | Ação |
|------|------|
| `src/pages/Index.tsx` | Remover (placeholder não usado, rota `/` já aponta para Dashboard) |
| `src/pages/NotFound.tsx` | Manter |
| `as any` em hooks e páginas | Substituir por tipagem correta usando os types do Supabase |
| SSO redirect URL hardcoded | Corrigir para URL real do projeto |
| Rota duplicada (`/` → Dashboard + Index) | Eliminar conflito |

### 9. Gestão de Usuários (Admin)

Nova seção em **Configurações > Estrutura**:
- Listar usuários (profiles)
- Atribuir setor e role
- Ativar/desativar usuários
- Gerar link de acesso SSO manualmente

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | `user_roles`, `app_role` enum, funções security definer |
| `supabase/functions/sso-login/index.ts` | Corrigir redirect, provisionar role/setor |
| `src/hooks/useAuth.tsx` | Carregar roles e setores do usuário |
| `src/components/layout/TopNavigation.tsx` | Filtrar módulos por permissão |
| `src/components/layout/AppLayout.tsx` | Redirect inicial por setor |
| `src/components/auth/ProtectedRoute.tsx` | Controle de acesso por role/setor |
| `src/App.tsx` | Rotas protegidas com roles |
| `src/pages/Auth.tsx` | Remover cadastro público |
| `src/pages/Index.tsx` | Deletar arquivo |
| `src/pages/Configuracoes.tsx` | Seção de gestão de usuários |
| `src/hooks/useNotificacoes.ts` | Notificação sonora |

## Resultado Esperado

- Usuário do Financeiro acessa via Optical Business → cai direto no pipeline Financeiro com notificações pendentes
- Admin vê tudo, gerencia usuários e permissões
- Código limpo, sem placeholders ou tipagem fraca
- Ecossistema integrado entre os dois projetos

