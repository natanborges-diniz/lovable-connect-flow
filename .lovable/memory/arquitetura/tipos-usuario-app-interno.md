---
name: Tipos de usuário e permissões — fonte única user_acessos
description: user_acessos é fonte única de permissões em Atrium E Messenger. profiles.tipo_usuario é derivado. Menu do Messenger lê módulos (menu_loja, demandas_minhas_lojas, chat_1a1, chat_grupo), nunca tipo_usuario.
type: feature
---

## Fonte única: user_acessos

`user_acessos` (modulos, lojas, setores, acesso_total) é a ÚNICA fonte de permissão tanto no Atrium web quanto no InFoco Messenger. `profiles.tipo_usuario`/`lojas`/`setor_id` e `user_roles` são DERIVADOS pelo trigger `sync_from_user_acessos`.

## Módulos do Messenger

Definidos em `src/lib/acessos.ts` (`MODULOS_MESSENGER`):
- `chat_1a1` — conversas individuais
- `chat_grupo` — grupos
- `demandas_minhas_lojas` — caixa do supervisor (vê demandas das lojas no escopo)
- `menu_loja` — habilita "Abrir / Agenda / Minhas" (fluxos do bot da loja)

## Messenger usa user_acessos diretamente

`useLojaContext` no projeto Messenger (2d68a67b-…) lê `user_acessos` e expõe booleans por módulo:
- `podeMenuLoja` → "Abrir / Agenda / Minhas Demandas"
- `podeSupervisao` → caixa "Demandas das minhas lojas"
- `podeChat1a1`, `podeChatGrupo`

`isLoja` é wrapper de `podeMenuLoja` para compat. NUNCA usar `tipo_usuario` para gate de menu/página no Messenger — tipo é apenas para regras de chat (RLS `pode_conversar_1a1`).

## RLS 1:1 (inalterado)

`pode_conversar_1a1()` continua usando `tipo_usuario`: loja↔setor proibido em chat livre, só via demanda tipada. `bot_fluxos.setor_destino_id` mapeia 14 fluxos aos setores reais para o wizard "Nova Demanda".

## Configuração (Atrium → Configurações → Usuários → Acesso)

- **Operador de loja**: `menu_loja` + `chat_1a1` (+ escopo lojas[])
- **Supervisor regional**: `chat_1a1` + `demandas_minhas_lojas` (+ escopo lojas[])
- **Operador de setor**: `chat_1a1` apenas
- **Diretor/Admin**: `acesso_total`
