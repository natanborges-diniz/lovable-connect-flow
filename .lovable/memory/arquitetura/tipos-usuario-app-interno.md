---
name: Tipos de usuário e cargo no InFoco Messenger
description: profiles.tipo_usuario + cargo_loja + lojas[] como fonte da verdade. Trigger sync_user_roles_from_profile espelha em user_roles. tipo=loja só usa Messenger.
type: feature
---

## Modelo

`profiles` carrega tudo:
- `tipo_usuario` (loja|colaborador|setor_operador|admin)
- `cargo_loja` (supervisor|gerente|operador) — só quando `tipo_usuario='loja'`
- `lojas text[]` — lojas que o usuário cobre (multi)
- `setor_id` — só quando `tipo_usuario='setor_operador'`

`user_roles` é **espelho** mantido pelo trigger `sync_user_roles_from_profile()` (AFTER INSERT/UPDATE em profiles). Admin não edita user_roles diretamente — edita profiles e o trigger reescreve.

## Acesso ao Atrium web

`ProtectedRoute` redireciona qualquer usuário com `tipo_usuario='loja'` para `/somente-messenger` (página com botão para abrir o app). Eles autenticam pelo Atrium só para gerar magic link, mas não navegam internamente.

## Menu de demandas por cargo

`bot_menu_opcoes.cargos_visiveis text[]` — lista de cargos que enxergam aquela opção. Vazio = todos. A função `get_menu_opcoes_para_cargo(_tipo_bot, _parent_id, _cargo)` filtra. O consumidor (InFoco Messenger) chama essa RPC passando `profiles.cargo_loja` do solicitante.

## Cadastro

Em `/configuracoes` → Gestão de Usuários, o botão ✏️ abre um diálogo único: **Tipo → (se loja) Cargo + Lojas (checklist multi) → (se setor) Setor**. Salvar grava `profiles`; o trigger sincroniza `user_roles`.

## RLS 1:1

`pode_conversar_1a1()` continua valendo: loja↔setor segue proibido em chat livre (só via demanda tipada).
