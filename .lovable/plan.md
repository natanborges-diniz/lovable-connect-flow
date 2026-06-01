
## Objetivo
Resolver baixa reatividade das lojas às demandas disparadas pelo CRM, criando hierarquia (operador → supervisor → gerente), watchdog de SLA com escalonamento progressivo, e garantindo que cada usuário-loja tenha push ativo no InFoco Messenger.

## 1. Hierarquia de lojas (Atrium — DB)

Migração:
- `profiles.cargo_loja` já existe (`operador|supervisor|gerente`) — reaproveitar.
- Adicionar coluna `profiles.lojas_responsaveis text[]` (default `'{}'`) para supervisor/gerente cobrirem N lojas além das próprias.
- Função `resolver_destinatarios_loja(_loja_nome, _nivel)` aceitando `_nivel ∈ ('operador','supervisor','gerente','todos')`:
  - `operador` → `tipo_usuario='loja'` com a loja em `lojas[]` e `cargo_loja='operador'` (ou null = operador).
  - `supervisor` → cargo `supervisor` com a loja em `lojas[]` OU `lojas_responsaveis[]`.
  - `gerente` → cargo `gerente` com a loja em `lojas[]` OU `lojas_responsaveis[]`.
  - `todos` → união (comportamento atual).
- Default da criação de demanda continua `operador`.

## 2. SLA escalonado — novo cron `watchdog-demandas-loja`

Nova edge function (1×/min), payload em `cron_jobs` para thresholds editáveis (memória `watchdog/thresholds-editaveis`):

```
T+15min  → 1º lembrete push aos operadores da loja
T+30min  → 2º lembrete push + escala para supervisor (notificação + push + entra em demanda_destinatarios)
T+60min  → escala para gerente regional + cria Tarefa em "Cobranças loja" (pipeline TI ou Interno) com link da demanda
T+120min → status='sem_resposta' (novo enum), notifica solicitante original no Atrium
```

Idempotência via `metadata.escalonamentos: { t15_at, t30_at, t60_at, t120_at }` — cada nível dispara só uma vez. Escalonamento envia mensagem no canal `demanda_<id>` (visível no thread), não cria conversa nova.

## 3. Substituir `auto-encerrar-demandas`

Hoje fecha qualquer demanda com 30min sem atividade — inclusive não respondidas. Mudar para:
- Só fecha automaticamente demandas com `status='respondida'` (loja já respondeu) inativas >30min.
- Demandas `aberta` nunca são auto-encerradas — ficam para o watchdog de SLA tratar.

## 4. Novo status `sem_resposta`

- Adicionar ao enum `demandas_loja.status`.
- Aparece em aba dedicada em `/demandas` (Atrium) e badge vermelho em `/demandas` do Messenger.
- Não bloqueia loja de ainda responder; ao responder, volta para `respondida`.

## 5. Onboarding push obrigatório (InFoco Messenger)

Mudanças no projeto `desktop-joy-app`:
- Banner persistente no topo enquanto `getSubscription() === null` para `tipo_usuario='loja'`: "Ative as notificações para receber demandas urgentes."
- Bloquear `/demandas` com modal-gate se push não estiver ativo (botão único "Ativar agora").
- Tela `/demandas`: badge "ATRASADA" pulsante + som curto quando demanda da loja do usuário tem `metadata.escalonamentos.t30_at` setado.
- Nova aba "Demandas das minhas lojas" para `cargo_loja ∈ ('supervisor','gerente')` — lista demandas de todas as lojas em `lojas[] ∪ lojas_responsaveis[]` com coluna SLA.

## 6. UI Atrium (`/demandas`)

- Nova aba "Atrasadas" (filtra demandas com `t15_at` ou `t30_at` setado e ainda `aberta`).
- Coluna SLA na lista: chip verde (<15min), amarelo (15–30), laranja (30–60), vermelho (>60).
- No `DemandaThreadView`: linha do tempo dos escalonamentos ("Supervisor notificado às 14:32", "Gerente regional notificado às 15:02").
- Em `/configuracoes` → Gestão de Usuários: ao editar usuário `cargo_loja='supervisor'|'gerente'`, mostrar checklist "Lojas que supervisiona" gravando em `lojas_responsaveis[]`.

## Detalhes técnicos

- **Cron:** registrar `watchdog-demandas-loja` em `cron_jobs` com `payload.thresholds = {t15:15, t30:30, t60:60, t120:120}` (minutos, editáveis pela UI).
- **Push:** reutiliza `send-push` do Messenger via `fn_send_push(user_ids, title, body, url='/demandas?demanda=<id>')`. Sem mudança na infraestrutura VAPID.
- **Tarefa em cobrança:** insert em `tarefas` com `setor_id` do solicitante original e `metadata.demanda_id`.
- **Memória nova:** `mem://demandas/sla-escalonado` documentando os 4 níveis e a regra de não auto-fechar `aberta`.

## Fora de escopo

- Trocar canal para WhatsApp (Canal Único Meta é só cliente final).
- Mexer em `confirmacoes_estoque` (já tem watchdog próprio).
- Dashboard agregado de SLA por loja/região (próxima iteração).
- Configurar VAPID/FCM — já funciona.

## Aprovação necessária para entrar em build

Confirmar:
1. Thresholds 15/30/60/120 min ok? (editáveis depois)
2. Tarefa de cobrança vai no pipeline **TI** ou **Interno**? Coluna "Cobranças loja" nova.
3. Demanda nunca auto-encerrar se `aberta` — supervisor/gerente fecham manualmente quando resolverem fora do sistema?
