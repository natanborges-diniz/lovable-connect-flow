---
name: SSO Login Cross-Project
description: Endpoint sso-login Atrium aceita departamento (string) e auto-resolve setor_id; auto-cura via profile.setor_id; provisiona role setor_usuario por padrão
type: feature
---

# SSO Login Cross-Project — Provisionamento Automático

## Body aceito por `sso-login` (Atrium)
```json
{ "email": "...", "nome": "...", "setor_id": "uuid?", "role": "setor_usuario?", "departamento": "Dpto Armações?" }
```

## Resolução de setor (ordem)
1. `setor_id` explícito (UUID).
2. `departamento` string → busca em `setores.nome` (case-insensitive, aceita `_` ou espaço).
3. Auto-cura: lê `profiles.setor_id` existente do usuário.

## Provisionamento
- Sempre que houver setor resolvido (qualquer das 3 fontes acima), faz `upsert` em `user_roles` com `role` default `setor_usuario`.
- Persiste `setor_id` no `profiles` quando resolvido.

## Cross-login (Em Foco) deve enviar `departamento`
Setores Atrium canônicos (use o nome exato): `Atendimento Corporativo`, `Dpto Armações`, `Financeiro`, `Loja`, `TI`.

## Defesa em UI (Atrium)
`TopNavigation` NUNCA mostra `allModules` quando `roles.length === 0`. Fallback seguro: apenas `["mensagens", "tarefas"]`. Admin/operador continuam vendo tudo.

## useAuth
`onAuthStateChange` chama `setLoading(true)` síncrono antes do `setTimeout(0)` para evitar flash de roles vazias durante magic link.
