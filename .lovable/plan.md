# Plano

## O que aconteceu
O vazamento veio de uma combinação de duas regras:

1. O usuário `diniz.super` está hoje no banco como `profiles.tipo_usuario = 'colaborador'` e com `user_roles.role = 'operador'`, mesmo tendo `user_acessos.lojas = ['DINIZ SUPER SHOPPING']` e `user_acessos.setores = []`.
2. O resolvedor de notificações humanas do CRM envia `atendimento_inbound` para todos os `tipo_usuario IN ('admin', 'colaborador')` quando a conversa está sem atendente atribuído e sem fallback de setor.

Resultado: como a conta da loja ficou classificada como `colaborador`, ela entrou no fallback corporativo e recebeu notificação de conversa do CRM.

## Evidência já confirmada
Estado atual de `diniz.super` no banco:
- `tipo_usuario = colaborador`
- `ua_lojas = ['DINIZ SUPER SHOPPING']`
- `ua_setores = []`
- `user_roles = [{ role: 'operador' }]`

Ou seja: o dado de escopo da loja está certo, mas a derivação do tipo/role ficou errada para esse usuário.

## Causa raiz
A regra antiga de `sync_from_user_acessos()` classificava como `colaborador` quando o usuário tinha módulos web ativos (`lojas`, `mensagens`, `tarefas`, `demandas`), mesmo sendo operador de loja.

Isso bate exatamente com o perfil rápido atual de “Operador de loja”, que marca esses módulos web junto com a loja. Então:
- o escopo dizia “loja”
- mas a derivação antiga dizia “colaborador”

Depois disso, o fallback de `resolver_destinatarios_atendimento()` puxou esse usuário por ser `colaborador`.

## Correção proposta
### 1) Reaplicar a sincronização dos acessos
Criar uma migration de correção para recalcular todos os usuários com a regra nova já desejada:
- se `user_acessos.lojas` tiver valor e `user_acessos.setores` estiver vazio, o usuário vira `tipo_usuario = 'loja'`
- nesse mesmo caso, `user_roles` deve virar `role = 'setor_usuario'` com `loja_nome` preenchido

Isso corrige `diniz.super` e todas as demais lojas que ficaram presas como `colaborador`.

### 2) Blindar o resolvedor de notificações do CRM
Ajustar `resolver_destinatarios_atendimento()` para nunca incluir usuários de loja nos destinatários de `atendimento_inbound` humano:
- no fallback por setor, excluir `profiles.tipo_usuario = 'loja'`
- no fallback final, manter somente operadores corporativos (`admin`, `colaborador`)

Assim, mesmo se algum dado voltar a ficar inconsistente no futuro, a notificação humana do CRM não vaza para contas de loja.

### 3) Limpar ruído já criado
Remover notificações antigas do tipo `atendimento_inbound` que foram gravadas para usuários de loja, para o Messenger parar de exibir esse histórico indevido.

## Impacto esperado
Depois da correção:
- contas de loja continuam recebendo o que é delas (agendamentos, demandas, fluxo da loja)
- deixam de receber notificações humanas do CRM
- o perfil “Operador de loja” pode continuar usando módulos web operacionais sem ser tratado como corporativo

## Detalhes técnicos
- Fonte do problema: derivação de `profiles.tipo_usuario` e `user_roles` a partir de `user_acessos`
- Funções envolvidas:
  - `public.sync_from_user_acessos()`
  - `public.resolver_destinatarios_atendimento(uuid)`
- Ajuste de dados necessário:
  - backfill para recalcular `profiles` e `user_roles`
  - limpeza de `notificacoes.tipo = 'atendimento_inbound'` para `profiles.tipo_usuario = 'loja'`

## Validação após implementar
Vou validar com consultas no banco que:
- `diniz.super` passa para `tipo_usuario = 'loja'`
- `user_roles` desse usuário passa a conter `loja_nome = 'DINIZ SUPER SHOPPING'`
- não existem mais `atendimento_inbound` para usuários `tipo_usuario = 'loja'`
- novas notificações humanas do CRM deixam de cair em contas de loja