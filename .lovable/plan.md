## Contexto

O InFoco Messenger (`desktop-joy-app.lovable.app`) **não tem backend próprio em uso**. Ele aponta o cliente Supabase direto pro mesmo projeto do Atrium (`kvggebtnqmxydtwaumqz`), reutilizando `auth.users`, `profiles`, `user_roles`, etc.

Conclusão: **não precisa** de SSO cross-project, nem service_role key de outro projeto, nem deploy de edge function lá. O usuário criado aqui já existe no Auth do Messenger. O que falta é apenas o **magic link redirecionar para o domínio certo**.

Hoje a função `admin-magic-link` usa o `origin` de quem chama (Atrium) como `redirectTo`. Resultado: o link autentica, mas devolve o usuário pro Atrium, não pro Messenger.

## O que mudar

### 1. Edge Function `admin-magic-link`

Aceitar (e priorizar) um `redirect_to` explícito do front. Manter a lógica atual como fallback. Sem alterar autenticação, RLS ou permissões.

### 2. UI `GestaoUsuariosCard.tsx` — botão "Gerar link de acesso"

- Adicionar constante `INFOCO_MESSENGER_URL = "https://desktop-joy-app.lovable.app"` no topo do arquivo.
- Passar `redirect_to: INFOCO_MESSENGER_URL` na chamada de `supabase.functions.invoke("admin-magic-link", ...)`.
- Atualizar o texto do toast/tooltip para deixar claro: "Link de acesso ao InFoco Messenger".

### 3. Garantir que a URL do Messenger esteja na allowlist do Auth

O Supabase só aceita `redirectTo` que esteja em **Site URL** ou em **Additional Redirect URLs**. Verificar/adicionar `https://desktop-joy-app.lovable.app` (e o domínio de preview, se houver) na config de Auth do projeto `kvggebtnqmxydtwaumqz`. Se não estiver, o link continuaria caindo no Site URL atual (Atrium).

### 4. Wizard de cadastro em lote (`BulkUserProvisioningWizard.tsx`)

Mesma correção: quando gerar magic link em massa, passar `redirect_to` do Messenger. Manter coluna que copia o link pronto.

## Fora do escopo (confirmado descartado)

- ❌ Criar `admin-magic-link` no projeto InFoco Messenger
- ❌ Pedir/armazenar `service_role` key cross-project
- ❌ Função `sso-login` cross-project
- ❌ Mexer no `client.ts` ou `.env` de qualquer um dos dois projetos

## Critério de aceite

1. Admin clica "Gerar link de acesso" no Atrium → toast com URL `https://desktop-joy-app.lovable.app/...#access_token=...`.
2. Abrir o link em janela anônima → cai logado no InFoco Messenger.
3. Mesmo funcionário criado em massa (e-mail fictício `@infocomessenger`) consegue acessar pelo link sem precisar de senha.

## Confirmação necessária antes de executar

A URL pública do InFoco Messenger é `https://desktop-joy-app.lovable.app` (vista no seu próprio relato). Confirme se é essa mesma — ou se você usa um domínio custom — pra eu já deixar fixo no código e na allowlist do Auth.
