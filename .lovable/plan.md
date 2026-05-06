## Diagnóstico confirmado

- Atrium e InFoco Messenger usam **o mesmo backend Supabase** (`kvggebtnqmxydtwaumqz`). Não há dois bancos.
- Schema real de `public.notificacoes` no Atrium:
  `id, usuario_id, setor_id, titulo, mensagem, tipo, referencia_id, lida, created_at` — **não tem `user_id` nem `payload`**.
- O Messenger lê `user_id` e `payload` em 3 pontos, então o filtro nunca casa e o `select` ainda fere o schema. Resultado: nada aparece.

Atrium já está correto (insere `usuario_id` em todos os lugares — `agendamentos-cron`, `notificar-loja-agendamento`, `payment-webhook`, etc.). **Só o Messenger precisa de ajuste.**

## Mudanças (somente no projeto InFoco Messenger)

### 1. `src/pages/NotificacoesList.tsx`
- Trocar `select("id,titulo,mensagem,lida,created_at,tipo,payload")` por `select("id,titulo,mensagem,lida,created_at,tipo,referencia_id")`.
- Trocar `.eq("user_id", user.id)` → `.eq("usuario_id", user.id)`.
- Trocar `filter: "user_id=eq.${user.id}"` (Realtime) → `usuario_id=eq.${user.id}`.
- Ajustar tipo `Notif` (remover `payload`, adicionar `referencia_id: string | null`).
- Onde a UI usar `payload?.agendamento_id`, derivar de `referencia_id` quando `tipo` começar com `agendamento_` / `cobranca_comparecimento_loja`.

### 2. `src/hooks/useNotificacoesRealtime.ts`
- Trocar `filter: "user_id=eq.${user.id}"` → `usuario_id=eq.${user.id}`.

### 3. Botões 3-em-1 (Compareceu / Não compareceu / Venda fechada)
- Onde antes usava `payload.agendamento_id`, passar `referencia_id` como `agendamento_id` para `loja-acao-agendamento` (já existe no Atrium e funciona com JWT do mesmo projeto).
- Renderizar os botões para os tipos: `agendamento_novo_loja`, `agendamento_confirmado_loja`, `cobranca_comparecimento_loja`, `cobranca_comparecimento_loja_2`.

### 4. (Opcional, mesma sessão) Inclusão de notificações por setor
A policy do Atrium já permite `usuario_id = auth.uid() OR setor_id IN (setor do profile)`. O Messenger filtra só por `usuario_id`, então notificações endereçadas só ao setor não aparecem. Adicionar um segundo `or(`usuario_id.eq.${user.id},setor_id.eq.${profile.setor_id}`)` quando o profile tiver `setor_id`. **Confirmar se quer isso agora ou deixar para depois.**

## Fora de escopo

- Qualquer mudança no Atrium (schema, EFs, triggers, RLS).
- Bridge entre projetos, secrets compartilhados, EF receptora — descartados.
- Backfill: notificações antigas já inseridas com `usuario_id` correto vão aparecer automaticamente após o ajuste.

## Validação após deploy

1. Abrir `/notificacoes` no Messenger logado como usuário da loja → ver linhas reais (cobrança, novo agendamento, confirmação).
2. Forçar um insert de teste em `notificacoes` com `usuario_id` = uid logado → checar Realtime + push local.
3. Clicar "Compareceu" em uma cobrança → verificar status do agendamento mudar no Atrium.
