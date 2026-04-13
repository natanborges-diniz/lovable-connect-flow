

# Mensageria Interna — Chat entre Usuários do Sistema

## Contexto

Atualmente a comunicação interna ocorre apenas via comentários em solicitações e notificações passivas. Não existe um canal de **chat direto** entre usuários logados no sistema.

## Solução

Criar um módulo de **Mensageria Interna** acessível por todos os usuários, com conversas diretas (1:1) e notificação em tempo real.

## Arquitetura

```text
mensagens_internas (nova tabela)
├── id (uuid)
├── remetente_id (uuid → profiles.id)
├── destinatario_id (uuid → profiles.id)
├── conversa_id (text) — hash ordenado dos dois user_ids
├── conteudo (text)
├── lida (boolean, default false)
├── created_at (timestamptz)

Realtime: ALTER PUBLICATION supabase_realtime ADD TABLE mensagens_internas;
```

## Implementação

### 1. Migração SQL
- Criar tabela `mensagens_internas` com RLS:
  - SELECT: `remetente_id = auth.uid() OR destinatario_id = auth.uid()`
  - INSERT: `remetente_id = auth.uid()`
  - UPDATE (marcar lida): `destinatario_id = auth.uid()`
- Habilitar Realtime na tabela
- Índices em `conversa_id` e `destinatario_id`

### 2. Nova rota `/mensagens`
- Adicionar em `App.tsx` como rota protegida
- Adicionar módulo "mensagens" no `ModuleKey` e `TopNavigation`
- Ícone: `Mail` ou `MessageCircle`

### 3. Página `Mensagens.tsx` — Layout de chat
- **Painel esquerdo**: lista de conversas (agrupadas por `conversa_id`), mostrando nome do outro usuário, última mensagem e badge de não lidas
- **Painel direito**: thread de mensagens da conversa selecionada, com input de texto e envio
- Botão "Nova conversa" com dropdown de usuários ativos (query em `profiles`)

### 4. Hook `useMensagensInternas.ts`
- `useConversas()` — lista conversas do usuário com contagem de não lidas
- `useMensagensConversa(conversaId)` — mensagens de uma conversa específica
- `useEnviarMensagem()` — mutation para inserir mensagem
- `useMarcarLida()` — marca mensagens como lidas ao abrir conversa
- Realtime subscription para novas mensagens

### 5. Badge de não lidas no TopNavigation
- Ao lado do ícone de Mensagens, mostrar badge com total de mensagens não lidas (similar ao de notificações)

### 6. Acesso por role
- **Todos os roles** (admin, operador, setor_usuario) têm acesso ao módulo de mensagens
- Adicionar "mensagens" ao `SETOR_MODULE_MAP` para todos os setores

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| Migração SQL | Criar tabela `mensagens_internas` + RLS + Realtime |
| `src/pages/Mensagens.tsx` | Nova página com layout de chat (lista + thread) |
| `src/hooks/useMensagensInternas.ts` | Hook com queries, mutations e realtime |
| `src/App.tsx` | Adicionar rota `/mensagens` |
| `src/components/layout/AppLayout.tsx` | Adicionar "mensagens" ao `ModuleKey` |
| `src/components/layout/TopNavigation.tsx` | Adicionar módulo + badge de não lidas |

## Resultado

- Usuários podem conversar diretamente entre si dentro da aplicação
- Notificação visual em tempo real (badge) quando recebem mensagens
- Histórico de conversas persistente
- Segregado por RLS — cada usuário só vê suas próprias conversas

