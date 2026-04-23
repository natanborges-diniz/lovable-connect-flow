

## Adicionar usuário "Fran" ao sistema

### Objetivo
Criar a usuária Fran para que ela apareça automaticamente na lista de "Nova conversa" do módulo de mensagens internas.

### Diagnóstico

A lista de "Nova conversa" é alimentada pela tabela `public.profiles` (filtro `ativo = true`). Para um usuário aparecer ali, ele precisa existir em:

1. `auth.users` (autenticação)
2. `public.profiles` (criado automaticamente pelo trigger `handle_new_user`)
3. opcionalmente `public.user_roles` (para acessar módulos)

Hoje **não existe fluxo de UI para criar usuários novos** — `GestaoUsuariosCard` só lista/edita os existentes. Novos usuários só entram via signup direto ou SSO.

### Plano

#### 1) Edge function `admin-create-user`
Nova função protegida.

- Valida o JWT do chamador e verifica `is_admin(auth.uid())` — só admin pode criar usuários.
- Recebe `{ email, nome, cargo?, setor_id?, role?, loja_nome? }`.
- Usa `supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nome } })`.
- O trigger `handle_new_user` já cria o `profile` com `ativo = true`.
- Atualiza `profiles.cargo` e `profiles.setor_id` quando informados.
- Faz upsert em `user_roles` com `role` (default `setor_usuario`), `setor_id` e `loja_nome`.
- Gera magic link de convite com `auth.admin.generateLink({ type: 'invite' })` e retorna a URL para o admin compartilhar.
- Retorna `{ user_id, email, invite_url }`.

#### 2) UI em `GestaoUsuariosCard`
- Botão "Novo usuário" no topo (visível só para admin).
- Dialog com campos: Nome, E-mail, Cargo, Setor (select de `setores`), Função (select: admin / operador / setor_usuario), Loja (opcional).
- Ao salvar: chama `supabase.functions.invoke('admin-create-user', ...)`.
- Em sucesso: toast + botão "Copiar link de convite" com a URL retornada.
- Refetch da lista de usuários e invalida a query usada por "Nova conversa".

#### 3) Criar a Fran usando o novo fluxo
Após implementar o fluxo:
- Abrir o dialog e cadastrar **Fran** com o e-mail informado pelo usuário.
- Confirmar criação:
  - linha em `auth.users`, `profiles` (`ativo = true`) e `user_roles`.
- Abrir **Mensagens → Nova conversa** e validar que "Fran" aparece na lista.
- Entregar o link de convite para que ela defina senha/acesse.

### Pergunta antes de executar
Para cadastrar a Fran preciso de:
- E-mail dela
- Setor (ex.: Atendimento Corporativo, Loja, TI, Financeiro, Dpto Armações) — opcional
- Função: `admin`, `operador` ou `setor_usuario` (default sugerido: `setor_usuario`)

Posso seguir com placeholders se preferir e você me passa esses dados depois — ou me responde aqui e já cadastro junto.

### Detalhes técnicos
- Arquivos novos: `supabase/functions/admin-create-user/index.ts`.
- Arquivos alterados: `src/components/configuracoes/GestaoUsuariosCard.tsx`.
- Sem mudanças de schema — `handle_new_user`, `profiles` e `user_roles` já cobrem o caso.
- Segurança: função usa `service_role` internamente, mas só executa após validar `is_admin` do JWT recebido.

