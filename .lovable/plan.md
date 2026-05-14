# Plano — Opção 1: Ponte cross-project via INTERNAL_SERVICE_SECRET

## Objetivo
Fazer os botões "Compareceu / No-show / Venda fechada" do app **InFoco Messenger** voltarem a funcionar, chamando a edge function `loja-acao-agendamento` que vive **só no Atrium** — sem duplicar dados, sem mover telas.

## Arquitetura

```text
[InFoco Messenger UI]
    hook useAcaoAgendamento
        |
        |  fetch POST {ATRIUM_URL}/functions/v1/loja-acao-agendamento
        |  headers: x-service-key: INTERNAL_SERVICE_SECRET
        |  body: { agendamento_id, acao, ..., user_email }
        v
[Atrium Edge Function loja-acao-agendamento]
    - valida x-service-key
    - resolve user_id pelo email (profiles)
    - mantém checagem de permissão (resolver_destinatarios_loja / is_admin)
    - executa update + evento_crm + marca notificacoes lidas
```

Mesmo padrão já usado entre Atrium ↔ Infoco Optical Business para pagamentos (`mem://integracao/pagamentos-cross-project`).

## Mudanças

### 1. Atrium — `supabase/functions/loja-acao-agendamento/index.ts`
- Adicionar **modo de autenticação alternativo**: além do JWT atual, aceitar header `x-service-key` igual a `INTERNAL_SERVICE_SECRET`.
- Quando vier por service key, ler `user_email` (ou `user_id`) do body para resolver `userId` via `profiles` e seguir o mesmo fluxo de permissão (`resolver_destinatarios_loja` / `is_admin`).
- Rejeita 401 se nem JWT nem service key válidos.
- CORS continua liberando `x-service-key` (já consta no `Access-Control-Allow-Headers` em outras funções; ajustar aqui).
- `verify_jwt` permanece `true` no config (a função já valida internamente; service key é checada antes do `getClaims`).

### 2. Atrium — `supabase/config.toml`
- Garantir bloco `[functions.loja-acao-agendamento]` com `verify_jwt = false` para permitir requisições sem JWT (a validação é feita no código). Sem isso o gateway bloqueia antes do código rodar.

### 3. InFoco Messenger — hook `useAcaoAgendamento`
(arquivo no projeto cross — a editar via cross_project no segundo turno, depois da aprovação)
- Trocar `supabase.functions.invoke("loja-acao-agendamento", ...)` por `fetch` direto:
  - URL: `https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/loja-acao-agendamento`
  - Headers: `Content-Type: application/json`, `x-service-key: <INTERNAL_SERVICE_SECRET>` (precisa estar nos secrets do InFoco Messenger; o usuário já tem `INTERNAL_SERVICE_SECRET` configurado lá pelo flow de pagamentos).
  - Body: inclui `user_email` do usuário logado para o Atrium resolver permissão.
- Tratamento de erro/toast permanece igual.

### 4. Backfill manual
- Reprocessar a ação da Cláudia (DEM-2026-00012 / DINIZ UNIÃO) que falhou: marcar `compareceu` direto via SQL ou nova chamada após o deploy.

## Pontos de atenção

- `INTERNAL_SERVICE_SECRET` é segredo compartilhado — nunca deve aparecer no bundle do front. Por isso a chamada do InFoco Messenger precisa sair de uma **edge function intermediária** lá no projeto InFoco Messenger (não direto do React). Vou criar uma função `proxy-loja-acao-agendamento` no InFoco Messenger que valida o JWT do usuário, lê o email do `auth.getUser()`, e faz o fetch para o Atrium com a service key. O hook chama essa função local via `supabase.functions.invoke` — sem segredo no front.

- Permissões continuam aplicadas no Atrium: o usuário só age se aparecer em `resolver_destinatarios_loja(loja_nome)` ou for admin. Service key não bypassa isso.

- Auditoria: `eventos_crm` registra `autor_nome` resolvido via `profiles.nome` no Atrium.

## Entregáveis após aprovação

1. Editar `supabase/functions/loja-acao-agendamento/index.ts` no Atrium (suporte a service key + resolução por email).
2. Editar `supabase/config.toml` no Atrium (`verify_jwt = false` para essa função).
3. No projeto InFoco Messenger:
   - Criar edge function `proxy-loja-acao-agendamento` (proxy autenticado).
   - Ajustar `useAcaoAgendamento` para chamar o proxy.
4. Reprocessar a demanda da Cláudia.
5. Atualizar memória `mem://agendamentos/loja-acao-agendamento` documentando o canal cross-project.

## Tempo estimado
1–2 horas de implementação, incluindo deploy e backfill.
