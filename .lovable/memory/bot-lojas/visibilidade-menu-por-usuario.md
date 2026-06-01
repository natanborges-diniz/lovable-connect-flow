---
name: Visibilidade granular do menu do bot por usuário
description: bot_menu_opcoes.usuarios_visiveis (uuid[]) whitelist por usuário sobrescreve cargos_visiveis. RPC get_menu_opcoes_para_usuario resolve cargo do profile.
type: feature
---

## Modelo

`bot_menu_opcoes` agora tem dois filtros:
- `cargos_visiveis text[]` — vazio = todos os cargos
- `usuarios_visiveis uuid[]` — whitelist por `profiles.id`. **Quando não vazia, SOBREPÕE** `cargos_visiveis`: só esses usuários veem o item.

## RPCs

`public.get_menu_opcoes_para_cargo(_tipo_bot, _parent_id, _cargo, _user_id DEFAULT NULL)` — filtro combinado.

`public.get_menu_opcoes_para_usuario(_tipo_bot, _parent_id, _user_id)` — açúcar que resolve o cargo do perfil automaticamente. **Use esta nos consumidores** (InFoco Messenger).

## UI

`BotMenuCard` (Configurações → Bot) tem coluna "Visibilidade" e popover `VisibilidadePicker` nos forms Create/Edit. Mostra cargos como badges toggleáveis e lista de usuários com busca + checkbox. Empty state = "todos".

## Compatibilidade

Migration adiciona coluna com default `'{}'` — nenhum item muda de visibilidade até ser editado. RPC antiga continua funcionando (assinatura mantida com 3 args via DEFAULT).
