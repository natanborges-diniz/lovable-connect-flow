---
name: Gestão de Usuários — fonte única user_acessos
description: Editor unificado lê/escreve user_acessos como fonte da verdade. Tipo derivado pelo trigger sync_from_user_acessos. RLS via pode_gerenciar_usuarios.
type: feature
---

## Modelo único

- `user_acessos` = fonte ÚNICA de permissões/escopo (modulos, lojas, setores, acesso_total)
- `profiles.tipo_usuario` + `profiles.lojas` + `profiles.setor_id` = derivados pelo trigger `sync_from_user_acessos`
- `user_roles` = espelho automático mantido pelo MESMO trigger (admin / operador / setor_usuario por setor ou loja)
- Trigger legado `sync_user_roles_from_profile` em `profiles` foi REMOVIDO para eliminar bifurcação

## RLS

Função `public.pode_gerenciar_usuarios(uuid)` (SECURITY DEFINER) retorna true para:
- Admin clássico (user_roles.role='admin'), OU
- `user_acessos.acesso_total=true`, OU
- `user_acessos.modulos->>'configuracoes' IN ('agir','encerrar')`

Usada em policies de escrita de `user_acessos`, `profiles` (UPDATE) e `user_roles` (INSERT/UPDATE/DELETE).

## UI

`GestaoUsuariosCard` lista profiles + user_acessos juntos. Mostra Tipo (de profiles), Acesso (TOTAL/N módulos/Sem acessos) e Escopo (lojas+setores de user_acessos). Único caminho de edição é `AcessosEditorDialog` (identidade + acesso + escopo). Linha sem `user_acessos` recebe badge "sem acessos" e fundo amarelo claro.

## Criação de usuário

`admin-create-user` edge function cria o auth user + profile (via `handle_new_user` trigger), e LIMPA qualquer user_roles default. Permissões são gravadas pelo frontend em seguida via upsert em `user_acessos`, disparando o trigger que cria user_roles e ajusta profiles.tipo_usuario.
