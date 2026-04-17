

## Como fazer o role da Marilene chegar vindo do Em Foco

### O fluxo atual (resumido)
1. Marilene loga no **Em Foco** (`@project:e140a688...`).
2. Em Foco chama sua própria EF `cross-login`, que pega `email` + `nome` do profile dela **(no banco do Em Foco)** e chama a EF `sso-login` daqui.
3. `sso-login` (deste projeto) gera um magic link, abre `https://atrium-link.lovable.app` e o navegador autentica como Marilene.
4. O `useAuth` busca `profiles` + `user_roles` **deste projeto** (Atrium) — não do Em Foco.

### Por que o setor "some"
- O `cross-login` do Em Foco **só envia `email` e `nome`** — não envia `setor_id` nem `role`.
- O `sso-login` daqui só provisiona `user_roles` se receber `setor_id`/`role` no body (linha 71). Como vem vazio, **não cria nada**.
- Para a Marilene "funcionar" hoje, alguém criou manualmente o `user_roles` (existe `setor_id` Dpto Armações). Mas se um colega novo do mesmo departamento entrar pelo Em Foco, ele entra sem role nenhum → cai no fallback `roles.length === 0` → `TopNavigation` mostra **todos os menus** (bug).

### Decisão arquitetural
Os bancos são **independentes**. O Em Foco tem o cadastro corporativo (cargo, departamento, perfil), o Atrium tem os setores operacionais. Precisa haver um **mapeamento explícito** entre os dois.

**Opção escolhida (mais simples e robusta): o Em Foco passa a enviar o setor já resolvido.**

### Plano

**1. No projeto Em Foco — `cross-login`**
- Após buscar `profiles` (já busca `nome`), buscar também o `user_roles` da Marilene **no banco do Em Foco** para descobrir o departamento dela (campo `setor_id` ou similar) **OU** ter uma tabela de mapeamento `departamento_em_foco → setor_id_atrium`.
- Como os UUIDs de setor são diferentes entre os bancos, a forma mais limpa é: o Em Foco envia `{ email, nome, departamento: "dpto_armacoes" }` (string canônica), e o Atrium resolve o `setor_id` localmente.
- Alterar o body do `fetch(sso-login)` para incluir `departamento` (string) e opcionalmente `role` (default `setor_usuario`).

**2. Neste projeto — `sso-login`**
- Aceitar novo campo `departamento` (string) no body.
- Se vier `departamento`, fazer `SELECT id FROM setores WHERE lower(nome) = lower(_departamento) LIMIT 1` para resolver o `setor_id` local.
- Provisionar `user_roles` **sempre que tiver setor resolvido**, mesmo se o body não trouxer `role` explícito (default `setor_usuario`).
- Continuar aceitando `setor_id` direto (compatibilidade) caso algum dia o Em Foco envie o UUID já mapeado.

**3. Defesa em profundidade — `TopNavigation` (este projeto)**
- Trocar `if (roles.length === 0) return allModules` (linha 73) por: enquanto `loading` ou `roles.length === 0` E não admin/operador, mostrar **apenas** `["mensagens", "tarefas"]` (mínimo seguro). Nunca mostrar todos.
- Garante que mesmo se o provisionamento falhar, ninguém vê módulos administrativos.

**4. Defesa adicional — `useAuth.tsx` (este projeto)**
- Manter `setLoading(true)` síncrono dentro do callback `onAuthStateChange` antes do `setTimeout(0)`, evitando o flash de "roles vazias".

**5. Saneamento da Marilene**
- Como ela já tem `user_roles` correto, basta validar que após o login os menus aparecem (com a correção #3 cravada).
- Logar `roles` em `useAuth` temporariamente em produção para confirmar.

### Arquivos alterados

| Projeto | Arquivo | Mudança |
|---|---|---|
| Em Foco | `supabase/functions/cross-login/index.ts` | Buscar departamento do usuário no banco do Em Foco e enviar como string canônica em `body.departamento` ao chamar `sso-login` |
| Atrium | `supabase/functions/sso-login/index.ts` | Aceitar `departamento`; resolver `setor_id` via `SELECT` em `setores`; auto-provisionar `user_roles setor_usuario` quando setor resolvido |
| Atrium | `src/components/layout/TopNavigation.tsx` | Linha 73: nunca devolver `allModules` quando `roles.length === 0`; sempre fallback seguro `["mensagens","tarefas"]` |
| Atrium | `src/hooks/useAuth.tsx` | `setLoading(true)` síncrono no `onAuthStateChange` antes do `setTimeout` |

### Pendências de descoberta antes de implementar

- Como o **Em Foco** representa o departamento do usuário (campo? tabela? enum?). Preciso confirmar para escrever a lógica de leitura no `cross-login` lá.
- Definir as strings canônicas que o Em Foco enviará (`"dpto_armacoes"`, `"financeiro"`, `"ti"`, etc.) e garantir que existam linhas equivalentes em `setores` deste projeto (já existem: confirmei "Dpto Armações", "Atendimento Corporativo", "Financeiro", "TI").

