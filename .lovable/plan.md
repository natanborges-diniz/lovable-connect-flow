
## Diagnóstico atualizado

As correções anteriores já cobriram o óbvio:
- fallback por `profile.setor_id`
- `sso-login` mais robusto
- `/interno` usando setor efetivo

Se ainda falhou, o problema mais provável mudou:

1. **A sessão da Marilene não está chegando “pronta” quando o app começa a consultar dados**
   - isso pode fazer queries autenticadas rodarem cedo demais
   - resultado: menu e telas setoriais continuam sem reconhecer o setor na hora certa

2. **O topo ainda depende de uma segunda consulta em `setores` para montar os módulos**
   - mesmo com `profile.setor_id` resolvido, o menu ainda espera `useSetorNames()`
   - se essa consulta falhar/atrasar no primeiro ciclo, a UI continua inconsistente

3. **Ainda falta validar o dado real da Marilene no backend**
   - hoje os logs disponíveis mostram só um admin
   - então ainda não temos a prova do que aconteceu no login real dela

## Plano de correção

### 1. Auditar o login real da Marilene no backend
Verificar no backend:
- `profiles` da Marilene
- `user_roles` da Marilene
- logs reais da função `sso-login` no momento do login
- se o `departamento` chegou
- se virou `setor_id`
- se o `user_roles` foi criado/achado

Objetivo:
- separar se o problema é **dados/provisionamento** ou **hidratação da sessão no front**

### 2. Remover a dependência frágil do menu em uma query secundária
Hoje o `TopNavigation` ainda busca nomes em `setores` para decidir os módulos.

Vou mudar para que a própria autenticação já entregue o setor efetivo pronto para uso no menu, sem depender de uma segunda consulta no primeiro render.

Objetivo:
- o menu da Marilene aparecer imediatamente quando o setor já existir no perfil/roles

### 3. Implementar “auth ready” de verdade
Ajustar a camada de autenticação para separar:
- sessão restaurada
- usuário autenticado
- perfil/roles hidratados
- app pronto para consultar dados protegidos

Depois disso, as queries e telas só rodam quando a autenticação estiver realmente pronta.

Objetivo:
- eliminar corrida de inicialização após SSO/magic link

### 4. Travar queries dependentes de login até a autenticação estar pronta
Aplicar `enabled` com estado de prontidão nas queries mais sensíveis, começando por:
- navegação/topbar
- mensagens internas
- notificações
- telas setoriais

Objetivo:
- impedir que o app monte a UI com estado incompleto

### 5. Validar o fluxo real da Marilene
Depois da correção:
1. logout completo
2. login pelo Em Foco
3. entrada aqui via SSO
4. confirmar que aparecem:
   - Interno
   - Mensagens
   - Tarefas
5. confirmar que `/interno` abre no setor correto dela

## Arquivos previstos

- `src/hooks/useAuth.tsx`
- `src/components/layout/TopNavigation.tsx`
- `src/components/layout/AppLayout.tsx`
- `src/hooks/useNotificacoes.ts`
- `src/hooks/useMensagensInternas.ts`
- possivelmente páginas com queries setoriais que dependam de auth pronta
- `supabase/functions/sso-login/index.ts` apenas se os logs mostrarem falha de provisionamento

## Resultado esperado

Depois disso, a Marilene deve:
- entrar pelo Em Foco
- ter setor reconhecido sem corrida de inicialização
- ver os menus corretos imediatamente
- cair na área setorial esperada

## Detalhes técnicos

- Estratégia nova: parar de “remendar fallback” isolado e atacar a causa raiz:
  - **auth readiness**
  - **menu sem query extra desnecessária**
  - **validação do login real no backend**
- Se os logs mostrarem que `sso-login` já entrega `profile.setor_id` e `user_roles`, a correção será 100% no frontend
- Se os logs mostrarem que o setor não está sendo persistido para a Marilene, a correção volta para o fluxo SSO/provisionamento
