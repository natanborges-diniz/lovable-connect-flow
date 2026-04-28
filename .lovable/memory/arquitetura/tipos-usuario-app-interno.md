---
name: Tipos de usuário no InFoco Messenger
description: Profiles.tipo_usuario (loja|colaborador|setor_operador|admin) governa quem inicia 1:1 com quem. Wizard de cadastro em lote provisiona usuários a partir de telefones_lojas e fluxo_responsaveis.
type: feature
---

## Regra

`profiles.tipo_usuario` (text, NOT NULL, default `setor_operador`, check em 4 valores) define o eixo de UX/segurança no InFoco Messenger. Setor + loja seguem em `user_roles`/`profiles.setor_id`.

| tipo_usuario | Pode iniciar 1:1 com |
|---|---|
| `loja` | outras lojas, colaboradores, admin |
| `colaborador` | lojas, outros colaboradores, admin |
| `setor_operador` | apenas operadores do MESMO setor (`setor_id` igual), admin |
| `admin` | qualquer um |

**Bloqueado**: loja/colaborador → setor_operador (e vice-versa) em chat solto. Comunicação só por demanda tipada (`conversa_id LIKE 'demanda_%'` segue liberado pela RLS).

## Implementação

- Função `public.pode_conversar_1a1(_remetente uuid, _destinatario uuid) RETURNS boolean` SECURITY DEFINER decide.
- RLS `Users can send 1to1 or system messages` em `mensagens_internas` chama essa função para INSERTs cujo `conversa_id` não comece com `demanda_` ou `ponte_`.
- `bot_fluxos.setor_destino_id` mapeia 14 fluxos aos setores reais para o wizard "Nova Demanda".

## Provisionamento em lote (Atrium → Messenger)

InFoco Messenger não tem cadastro próprio — login é SSO via `sso-login` EF. Todos os usuários são criados no Atrium em `/configuracoes` → "Cadastro em lote" (`BulkUserProvisioningWizard`).

**Fluxo do wizard (4 passos):**
1. **Fonte** — escolhe `telefones_lojas` (lojas/colaboradores/departamentos) ou `fluxo_responsaveis` (operadores de setor).
2. **Seleção** — checklist com telefones já existentes marcados como "já cadastrado" (match via `profiles.metadata->>telefone`). Operador preenche email (botão "Sugerir e-mails" gera `nome.usuario@oticasdiniz.local`).
3. **Mapeamento** — confirma `tipo_usuario` (auto: `loja`→loja, `colaborador`→colaborador, `departamento`/`fluxo_responsaveis`→setor_operador) e setor (de `telefones_lojas.setor_destino_id` ou `bot_fluxos.setor_destino_id` via `fluxo_chave`).
4. **Envio** — dispara `admin-bulk-provision-users` em chunks de 10. Mostra resultado por linha com `invite_url` copiável (botão "Copiar todos").

**Edge function `admin-bulk-provision-users`** (idempotente, admin-only):
- Lista até 50 candidatos por chamada.
- Para cada: cria `auth.users` (ou reaproveita se já existe), atualiza `profiles.tipo_usuario/cargo/setor_id/metadata`, reseta `user_roles` com `role='setor_usuario'` (ou `admin`) + `setor_id`/`loja_nome`.
- Persiste `profiles.metadata = { telefone, origem_cadastro, loja_nome }` para alimentar badges e match futuro.
- Retorna `{ status: created|exists|error, invite_url, message }` por linha.

## Badges visuais

- `GestaoUsuariosCard`: coluna "Tipo (Messenger)" com select inline trocando `tipo_usuario` (badge colorido por tipo).
- `TelefonesLojasCard`: coluna "Messenger" com badge ✓ Cadastrado / Pendente comparando telefone com `profiles.metadata->>telefone`.
- `FluxoResponsaveisSection`: badge ✓ Messenger / Pendente em cada responsável.
