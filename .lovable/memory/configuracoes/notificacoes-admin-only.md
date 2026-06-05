---
name: Notificações admin-only + fallback configurável
description: Quem recebe push/notificação de atendimento é decidido por admin via notificacao_preferencias + configuracoes_ia.fallback_destinatarios_atendimento; default do nível 3 é "ninguém"
type: feature
---
- Tabela `public.notificacao_preferencias` (user_id, tipo, escopo, setor_ids, ativo). RLS exclusiva para `has_role(auth.uid(),'admin')` — usuários comuns nem leem nem editam. UI em Configurações → Usuários (ícone Bell por linha → `NotificacaoPrefsDialog`).
- Tipos suportados: `atendimento_inbound`, `atendimento_humano`, `demanda_loja`, `mensagem_interna` (+ wildcard `*`). Escopos: `todos` / `nenhum` / `meus_setores` / `setores_especificos`.
- `resolver_destinatarios_atendimento(_atendimento_id, _tipo text)` aplica filtro de preferências após resolver atendente → setor da coluna → fallback. Usuário sem registro = recebe (comportamento legado).
- Nível 3 NÃO é mais "todos admin/colaborador". Lê `configuracoes_ia.fallback_destinatarios_atendimento` = `{ setor_id, user_ids[], incluir_admins }`. Default vazio → ninguém recebe (evita ruído). Admin configura via `FallbackNotificacoesCard` na aba Usuários.
- Triggers `trg_push_inbound_humano` e `trg_push_atendimento_humano` passam o tipo correto.
- Backfill: Natan (`420c274c-…`) tem `escopo='nenhum'` para `atendimento_inbound`/`atendimento_humano`.
