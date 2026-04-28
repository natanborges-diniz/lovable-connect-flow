---
name: Tipos de usuário no InFoco Messenger
description: Profiles.tipo_usuario (loja|colaborador|setor_operador|admin) governa quem pode iniciar 1:1 com quem. Loja/colab nunca abrem chat solto com setor — só por demanda tipada.
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
- Backfill inicial: usuários com `user_roles.role='admin'` → `admin`; com `user_roles.loja_nome` preenchido → `loja`; demais → `setor_operador`. Admin ajusta manualmente novos cadastros via aba "Tipos de Usuário" em `/configuracoes`.

## Mapeamento bot_fluxos → setor

Os 14 fluxos em `bot_fluxos` agora têm `setor_destino_id` preenchido (Financeiro, TI, Atendimento Corporativo, Loja). Wizard "Nova Demanda" no InFoco Messenger usa esse mapping para rotear a quem o setor correto, eliminando dependência só de `loja_nome` em `criar-demanda-loja`.
