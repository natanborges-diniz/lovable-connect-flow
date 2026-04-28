## Objetivo

Habilitar o cadastro em massa dos usuários do InFoco Messenger (lojas, colaboradores e operadores de setor) reaproveitando os dados já existentes em `telefones_lojas` e `fluxo_responsaveis`, sem digitar nada de novo. Tudo é feito no Atrium — Messenger só consome via SSO.

## Entregas

1. **Edge function `admin-bulk-provision-users`** (Etapa 3)
   - Recebe lista de candidatos (`{ email, nome, tipo_usuario, setor_id, loja_nome, cargo }`).
   - Para cada item: chama internamente o fluxo do `admin-create-user` (criar `auth.users`, atualizar `profiles.cargo/setor_id/tipo_usuario`, gravar `user_roles`) e gera `invite_url`.
   - Retorna array com `email`, `status` (created | exists | error), `invite_url`, `mensagem`.
   - Idempotente: se email já existe em `auth.users`, apenas atualiza `profiles.tipo_usuario` + role + retorna `status: "exists"`.
   - Protegido por `is_admin(auth.uid())` ou `x-internal-secret`.

2. **Wizard "Cadastrar usuários do Messenger"** (Etapa 2) — novo componente `BulkUserProvisioningWizard.tsx` aberto a partir de `GestaoUsuariosCard`.

   **Fluxo de 4 passos:**

   - **Passo 1 — Fonte:** escolher entre "Lojas e colaboradores (telefones_lojas)" ou "Operadores de setor (fluxo_responsaveis)".
   - **Passo 2 — Seleção:** tabela com checkboxes pré-marcados listando registros da fonte. Para cada linha mostra: nome, telefone, tipo sugerido, setor sugerido, status (`Já cadastrado` / `Pendente` / `Sem e-mail`). Coluna editável para `email` (obrigatório, faltando para todos hoje).
   - **Passo 3 — Mapeamento padrão:** confirma `tipo_usuario` por categoria (lojas → `loja`, colaboradores → `colaborador`, fluxo_responsaveis → `setor_operador`) e setor padrão para operadores quando o fluxo já estiver mapeado em `bot_fluxos.setor_destino_id`.
   - **Passo 4 — Revisão e envio:** chama `admin-bulk-provision-users` em lote (chunks de 10). Mostra progresso e resultado por linha com link de convite copiável.

   Lógica de auto-detecção:
   - `telefones_lojas.tipo='loja'` → `tipo_usuario='loja'`, `loja_nome` preenchido.
   - `telefones_lojas.tipo='colaborador'` → `tipo_usuario='colaborador'`, `setor_id = setor_destino_id`.
   - `telefones_lojas.tipo='departamento'` → `tipo_usuario='setor_operador'`, `setor_id = setor_destino_id`.
   - `fluxo_responsaveis` → join com `bot_fluxos.setor_destino_id` → `tipo_usuario='setor_operador'`.
   - Detecta duplicados comparando `profiles.email` ou `profiles.metadata->>telefone`.

3. **Badges visuais** (Etapa 4)
   - `GestaoUsuariosCard`: nova coluna "Tipo" exibindo badge colorido por `profiles.tipo_usuario` (loja=azul, colaborador=verde, setor_operador=roxo, admin=âmbar). Select para admin alterar inline.
   - `TelefonesLojasCard`: badge extra "✓ Cadastrado" / "Pendente" comparando telefone com `profiles.metadata->>telefone` ou email correspondente, indicando se o número virou usuário do Messenger.
   - `FluxoResponsaveisSection`: mesmo badge "✓ Cadastrado" / "Pendente" ao lado de cada responsável.

## Arquivos a criar/editar

```text
supabase/functions/admin-bulk-provision-users/index.ts   [novo]
supabase/config.toml                                     [+ verify_jwt = false]
src/components/configuracoes/BulkUserProvisioningWizard.tsx   [novo]
src/components/configuracoes/GestaoUsuariosCard.tsx      [+ botão wizard, coluna tipo, select tipo_usuario]
src/components/configuracoes/TelefonesLojasCard.tsx      [+ badge cadastrado]
src/components/configuracoes/FluxoResponsaveisSection.tsx [+ badge cadastrado]
.lovable/memory/arquitetura/tipos-usuario-app-interno.md [atualizar com fluxo de provisionamento em lote]
```

## Detalhes técnicos

- **Telefone do usuário** persistido em `profiles.metadata.telefone` para permitir match futuro com `telefones_lojas` e `fluxo_responsaveis`.
- **E-mail obrigatório**: como `telefones_lojas` não tem coluna de email, o wizard exige o operador digitar/colar email para cada linha selecionada (com sugestão automática `nomeloja@oticasdiniz.local` quando vazio, mas marcando como "placeholder" pra revisar). Linhas sem email válido ficam bloqueadas.
- **Senha**: nenhum cadastro recebe senha — todos vão pelo `generateLink({type:'invite'})`. Wizard exibe link copiável + botão "Copiar todos" para distribuir via WhatsApp interno.
- **Idempotência**: `admin-bulk-provision-users` faz `admin.auth.admin.listUsers` filtrando por email antes de criar; se existe, apenas faz `update profiles.tipo_usuario` + upsert role e retorna `status: 'exists'`.
- **Backfill de telefone**: ao criar usuário oriundo de `telefones_lojas`, grava `profiles.metadata = { telefone: <telefone>, origem_cadastro: 'telefones_lojas', loja_nome: ... }` para alimentar os badges.

## Não inclui

- Cadastro paralelo no InFoco Messenger (não existe — login é SSO via `sso-login` EF, já implementado).
- Alteração de RLS — `pode_conversar_1a1` e demais policies já cobrem os tipos.
- Rotação de senha em massa (já existe `admin-reset-password` para casos pontuais).