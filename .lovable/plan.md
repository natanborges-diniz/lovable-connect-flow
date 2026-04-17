
## O que isso significa, em português claro

Hoje o sistema só mostra os menus “certos” quando a sessão da Marilene chega aqui com o setor/perfil reconhecido.

O código do menu já está preparado para mostrar:
- Interno
- Mensagens
- Tarefas

para quem é de **Dpto Armações**.

Então, se isso ainda não aparece, o problema restante não é “o menu em si”. O problema está na forma como a sessão da Marilene está sendo hidratada aqui após o login vindo do Em Foco.

## Diagnóstico mais provável

Há um ponto frágil no fluxo atual:

1. O Em Foco já envia `departamento`.
2. O `sso-login` daqui tenta transformar isso em `setor_id` e criar/garantir `user_roles`.
3. Mas a UI ainda depende demais de `user_roles` já estar carregado perfeitamente no primeiro momento da sessão.

Se isso falhar, atrasar, ou o `departamento` não casar exatamente com o setor local naquele login:
- a Marilene entra,
- mas a navegação não entende corretamente que ela é do setor,
- e os menus esperados não aparecem.

## Plano de correção

### 1. Parar de depender só de `user_roles` no front
Ajustar a autenticação para que o app considere também o `profile.setor_id` como fallback de setor.

Arquivos:
- `src/hooks/useAuth.tsx`
- `src/components/layout/TopNavigation.tsx`
- `src/components/layout/AppLayout.tsx`

Resultado:
- mesmo se `user_roles` atrasar ou não vier no primeiro ciclo,
- a Marilene ainda verá o menu do setor dela.

### 2. Endurecer o `sso-login`
Melhorar a resolução de `departamento -> setor_id` para ficar mais robusta com:
- acentos
- maiúsculas/minúsculas
- variações como `dpto_armacoes`, `Dpto Armações`, `dpto armacoes`

Arquivo:
- `supabase/functions/sso-login/index.ts`

Resultado:
- o login vindo do Em Foco deixa de depender de casamento “sensível” do nome do departamento.

### 3. Garantir provisionamento de role sempre
No `sso-login`, além de atualizar `profiles.setor_id`, garantir de forma mais defensiva que exista o `user_roles` compatível para aquele usuário.

Arquivo:
- `supabase/functions/sso-login/index.ts`

Resultado:
- a sessão fica consistente para navegação, permissões e telas setoriais.

### 4. Adicionar rastreio temporário de diagnóstico
Adicionar logs temporários no fluxo de autenticação para verificar, no login da Marilene:
- qual `departamento` chegou
- qual `setor_id` foi resolvido
- quais roles foram carregadas no front

Arquivos:
- `supabase/functions/sso-login/index.ts`
- `src/hooks/useAuth.tsx`

Resultado:
- se ainda falhar, fica visível exatamente em qual etapa quebrou.

### 5. Validar com teste real da Marilene
Depois da correção, testar especificamente:
1. logout completo
2. login no Em Foco
3. entrada aqui via SSO
4. confirmar que aparecem:
   - `Interno`
   - `Mensagens`
   - `Tarefas`
5. confirmar que ela cai em rota compatível com o setor

## Arquivos que pretendo ajustar
- `src/hooks/useAuth.tsx`
- `src/components/layout/TopNavigation.tsx`
- `src/components/layout/AppLayout.tsx`
- `supabase/functions/sso-login/index.ts`

## Resultado esperado
Depois disso, a Marilene deve entrar e ver imediatamente as opções compatíveis com o setor dela, sem depender de um carregamento “perfeito” de role logo no primeiro instante do login.

## Detalhes técnicos
- Hoje o menu usa `getUserSetorIds()`, que depende de `roles`.
- O setor da Marilene também precisa poder ser inferido por `profile.setor_id`.
- O `sso-login` já tenta resolver `departamento`, mas a resolução ainda pode ser frágil.
- A correção será feita em duas camadas:
  - backend: garantir setor/role no login
  - frontend: usar fallback seguro para o setor durante a hidratação da sessão
