## Diagnóstico

Olhando o agendamento `b67174ef…` (Fran, DINIZ ANTONIO AGU, 17:30 SP), três bugs distintos aconteceram:

### Bug 1 — Lembretes duplicados às 17:00
- Os dois "Oi Fran, ainda não conseguimos confirmar..." em 20:00:02 UTC (40 ms de diferença) vieram do **antigo** `processLembreteRetry`, que ainda estava deployado quando o cron rodou. Nosso commit que removeu esse fluxo só foi feito 24 min depois.
- **Já corrigido em código** (cron novo só roda véspera 08h e 1h-antes com lock atômico + skip <60min). Não precisa nova alteração aqui — só validar pós-deploy.

### Bug 2 — "Seu agendamento foi confirmado ✅ … hoje às 20:30 ⏰ 20:30"
Causa raiz: a automação `pipeline_automacoes` `2a9f41ef…` com `status_alvo = 'agendado'` (texto: "Perfeito {{primeiro_nome}}! Seu agendamento foi confirmado ✅…") **dispara em qualquer transição que termine em `agendado`**, inclusive o caminho inverso `lembrete_enviado → agendado` (foi o que ocorreu em 20:11:59, evento `automacao_pipeline status_anterior=lembrete_enviado, status_novo=agendado`).

Consequências:
- Mensagem é enviada **sem o cliente ter confirmado nada** — viola a política de "1 lembrete só".
- O placeholder `{{quando}}/{{hora}}` foi renderizado como `20:30`, indicando que naquele instante o `data_horario` estava gravado como `2026-05-04T20:30:00` interpretado como SP local (= 23:30 UTC), provavelmente por uma reentrada de `agendar_visita` com a string que o cliente repetiu. Quando a IA realmente chamou de novo às 20:28 com o horário certo, o valor foi normalizado de volta. Mas a mensagem-fantasma já tinha saído com o texto errado.

### Bug 3 — IA ecoou "Obg." 17 segundos depois do cliente
Mensagens 20:12:30 outbound "Obg." e 20:12:47 inbound "Obg" — a IA enviou "Obg." **antes** do cliente. Isso é o agente respondendo após "Seu agendamento foi confirmado…" como se fosse um encerramento. Provavelmente disparado pela mesma automação que mudou status para `agendado` e re-fired a triage.

## Plano de correção

### 1) Desligar / reescrever a automação `2a9f41ef…` (`status_alvo = agendado`)
Esta automação é a fonte do "Seu agendamento foi confirmado" não solicitado. Opções:
- **Recomendado**: desativar (`ativo = false`) via migration SQL. A IA já manda a confirmação no momento certo (após `agendar_visita`), e a automação `e254400e…` (`status_alvo = confirmado`) já cobre o caso "cliente confirmou".
- Migration:
  ```sql
  UPDATE pipeline_automacoes
  SET ativo = false, updated_at = now()
  WHERE id = '2a9f41ef-93cd-4339-a2f5-beb53171d700';
  ```

### 2) Bloquear automação para transições "regressivas" em `pipeline-automations`
Mesmo desativando a regra acima, o cron / outras rotas podem rebaixar status (`lembrete_enviado → agendado`). Adicionar guarda na função:
```ts
// Em pipeline-automations/index.ts, dentro da branch entity_type === "agendamento":
const ORDEM = { agendado: 1, lembrete_enviado: 2, confirmado: 3, no_show: 4, recuperacao: 5, venda_fechada: 6 };
if (status_anterior && status_novo && ORDEM[status_novo] < ORDEM[status_anterior]) {
  console.log(`[AUTOMATIONS] Skip regressive transition ${status_anterior} → ${status_novo}`);
  return new Response(JSON.stringify({ status: "skipped_regressive" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

### 3) Skip se `metadata.cliente_confirmou_at` existir
Se cliente já confirmou, NENHUMA automação por status deve disparar mensagens duplicadas:
```ts
if (entity_type === "agendamento" && agendamento?.metadata?.cliente_confirmou_at) {
  // pula automações de envio (mensagem/template) — mantém apenas tarefa/notificação interna se houver
  automacoes = automacoes.filter(a => !["enviar_mensagem","enviar_template"].includes(a.tipo_acao));
}
```

### 4) Endurecer `agendar-cliente` contra `data_horario` sem TZ
Para prevenir que o `Bug 2 - parte horário` reapareça, exigir offset/`Z` no input:
```ts
if (!/[+-]\d{2}:?\d{2}$|Z$/.test(String(data_horario))) {
  return new Response(JSON.stringify({ error: "data_horario sem timezone — use ISO 8601 com offset" }), { status: 400, headers: corsHeaders });
}
```
E reforçar a description da tool em `ai-triage` para "OBRIGATÓRIO sufixo `-03:00`".

### 5) Bloquear ai-triage de auto-disparar em watchdog logo após confirmação
O watchdog re-firou a triage às 20:28 (5 min depois do "Eu já confimei" em 20:00, que tinha sido escalado). Como o cliente JÁ confirmou via SIM no webhook, adicionar guard no `watchdog-inbound-orfao`:
```ts
// se existe agendamento ativo com cliente_confirmou_at no último 1h → não re-fire
```

### 6) Validação manual pós-deploy
- Criar agendamento de teste para hoje +30min → não deve ter lembrete (`janela_curta`).
- Criar para hoje +90min → 1 lembrete às T-60min, nenhum a mais.
- Cliente responde SIM → recebe "Show, presença confirmada" (regra `confirmado`) UMA vez. NÃO recebe "Seu agendamento foi confirmado…".
- Mover manualmente de `lembrete_enviado` → `agendado` no DB → automação não dispara (regressive guard).

## Arquivos a alterar

1. **Migration nova** — desativa pipeline_automacao `2a9f41ef…`
2. **`supabase/functions/pipeline-automations/index.ts`** — guard regressivo + skip se `cliente_confirmou_at`
3. **`supabase/functions/agendar-cliente/index.ts`** — exige offset no `data_horario`
4. **`supabase/functions/ai-triage/index.ts`** — reforça description da tool `agendar_visita`
5. **`supabase/functions/watchdog-inbound-orfao/index.ts`** — pula contatos com agendamento confirmado recente
6. **Memória** — atualiza `mem://agendamentos/janela-comunicacao-e-d-day.md` com as novas guardas (regressivo + cliente_confirmou_at) e adiciona core rule "Automação por status_alvo NUNCA dispara em transição regressiva nem se cliente_confirmou_at existir".

## O que NÃO mexer
- Fluxos da cron de lembrete (`processLembreteVespera`, `processLembrete1hAntes`) — já corretos.
- Webhook handler de SIM/confirmação — já grava `cliente_confirmou_at`.
- Templates WhatsApp aprovados.
