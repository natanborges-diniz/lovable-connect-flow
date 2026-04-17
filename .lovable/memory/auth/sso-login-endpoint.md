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
2. `departamento` string → normalizado (lowercase, sem acento, remove `dpto/depto/departamento/setor`) e comparado contra `setores.nome` normalizado em memória.
3. Auto-cura: lê `profiles.setor_id` existente do usuário.

## Provisionamento
- Sempre que houver setor resolvido (qualquer das 3 fontes acima), faz `upsert` em `user_roles` com `role` default `setor_usuario` (idempotente, `onConflict: user_id,role,setor_id`).
- Persiste `setor_id` no `profiles` quando resolvido.
- Logs estruturados em todas as etapas (`[sso-login] ...`) — inclui lista de setores disponíveis quando o departamento não casa.

## Cross-login (Em Foco) deve enviar `departamento`
Setores Atrium canônicos: `Atendimento Corporativo`, `Dpto Armações`, `Financeiro`, `Loja`, `TI`. A normalização aceita variações (`dpto_armacoes`, `Dpto Armações`, `dpto armacoes`, `armações`, etc).

## Defesa em UI (Atrium)
- `TopNavigation` NUNCA mostra `allModules` quando sem roles. Fallback seguro: `["mensagens", "tarefas"]`. Admin/operador continuam vendo tudo.
- Usa `getEffectiveSetorIds()` (roles → fallback `profile.setor_id`) para resolver módulos visíveis.
- `AppLayout` usa o mesmo "setor efetivo" para decidir redirect setorial (`/interno`).

## useAuth
- `onAuthStateChange` chama `setLoading(true)` síncrono antes do `setTimeout(0)` para evitar flash de roles vazias durante magic link.
- Expõe `getEffectiveSetorIds()` que combina `user_roles.setor_id[]` com fallback `profile.setor_id`.
- Log de diagnóstico `[useAuth] hydrated` imprime `userId/email/profile/roles` após hidratação (temporário).
