# Diagnóstico — Fran Borges sem push/som

Verifiquei a conta da Fran (`8ca94d4c-c60f-4876-b231-1772188c70a4`) no banco e duas coisas estão impedindo as notificações:

## Causa 1 — `profiles.ativo = false` (bloqueia tudo)

A linha da Fran em `profiles` está com `ativo: false`. Isso quebra **toda** a cadeia de notificação dela:

- `resolver_destinatarios_atendimento` (fallback por setor e fallback final admin/colaborador) só considera profiles com `ativo = true` → ela é excluída quando o atendimento não tem `atendente_user_id` setado (caso CLEBER).
- `dispatch-push` faz `.eq("ativo", true)` ao buscar push_token, então mesmo se chegasse uma notificação direcionada, o push não sairia.
- Resultado prático: em 790 notificações de `atendimento_inbound`/`atendimento_humano` no sistema, **zero foram para a Fran**.

## Causa 2 — Sem assinatura Web Push

A tabela `push_subscriptions` não tem nenhuma linha para o user_id dela. Ou seja, ela nunca apertou "Ativar notificações" no botão `PushNotificationsButton` neste navegador/PWA, ou negou a permissão antes. Sem isso, `send-push` não tem endpoint pra entregar — mesmo com tudo certo no resto, push de background não chega.

(O som in-app via `useAtendimentoNotifier` também não dispara porque depende de a notificação ter sido criada para o `usuario_id` dela — e o item 1 impede isso.)

## Plano de correção

1. **Reativar a conta da Fran**
   - UPDATE em `profiles` setando `ativo = true` para o id `8ca94d4c-c60f-4876-b231-1772188c70a4`.
   - Isso restaura o fallback de destinatários e libera o `dispatch-push`.

2. **Garantir que ela vire destinatária mesmo sem `atendente_user_id`**
   - Já temos o fallback do trigger `trg_mensagem_inbound_humano` via `resolver_destinatarios_atendimento`. Com `ativo=true` ela passa a entrar no fallback final (`admin/colaborador`).
   - O auto-claim do `Atendimentos.tsx` (já implementado em loop anterior) vai gravar `atendente_user_id` assim que ela responder, fazendo as próximas inbound notificações irem direto pra ela.

3. **Assinar Web Push neste navegador**
   - A Fran precisa abrir o INFOCO OPS, clicar em **PushNotificationsButton** (sininho no header) e permitir notificações.
   - Em iPhone, precisa instalar como PWA antes (Adicionar à Tela de Início), e iOS 16.4+.
   - Em Android/desktop, basta clicar e permitir.
   - Sem essa ação manual dela, nenhuma migration resolve — push do navegador exige consentimento explícito.

4. **(Opcional) Diagnóstico exposto na UI**
   - Adicionar no `PushNotificationsButton` um indicador visual quando `profile.ativo = false` ("Sua conta está inativa — peça ao admin pra reativar") para que situações assim sejam óbvias sem precisar abrir o banco.

## Detalhes técnicos

- Migration única para o item 1:
  ```sql
  UPDATE public.profiles SET ativo = true, updated_at = now()
   WHERE id = '8ca94d4c-c60f-4876-b231-1772188c70a4';
  ```
- Itens 2 e 3 não exigem código novo — dependem da Fran logar e assinar push.
- Item 4 é uma melhoria pequena em `src/components/layout/PushNotificationsButton.tsx` para evitar reincidência (posso pular se você quiser manter o escopo mínimo).

## Pergunta antes de implementar

Quer que eu (a) só reative a conta e te oriente a pedir pra ela ativar o sininho, ou (b) reative + adicione o aviso "conta inativa" no botão de push?
