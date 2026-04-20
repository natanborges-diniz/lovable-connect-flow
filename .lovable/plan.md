

## Objetivo
Consolidar o sistema atual em **dois canais únicos e bem separados**:

1. **WhatsApp = somente Meta Official** — usado exclusivamente para clientes finais.
2. **App Atrium Messenger (em desenvolvimento)** — usado para tudo que é interno: lojas, colaboradores, departamentos, setores, agendamentos internos, demandas B2B, comprovantes, confirmações etc.

Remover de vez Evolution / Z-API do código de produção e redirecionar todo tráfego B2B/interno para a fila do app (notificações + mensagens internas).

---

## Mudanças

### 1. `supabase/functions/send-whatsapp/index.ts` — Meta only
- Remover `sendViaEvolution` e `sendViaZApi`.
- `provedor` sempre `meta_official`. Ignora `force_provider` com warning.
- Mantém guard de telefone inválido + guard 24h Meta (bloqueia texto livre fora da janela; obriga template).
- Salva `mensagens.provedor = 'meta_official'`.

### 2. `supabase/functions/whatsapp-webhook/index.ts`
- Parser Meta apenas. Comentar branches Evolution/Z-API (deixar como referência).
- Novo atendimento: `canal_provedor = 'meta_official'` sempre.
- Nunca mais reescreve `canal_provedor` para outro provedor.

### 3. Roteamento B2B/interno → app, não WhatsApp
Funções que hoje disparam WhatsApp para lojas/colaboradores passam a disparar **mensagem interna + notificação** (consumida pelo app Atrium Messenger e pela web `/mensagens`):

- **`criar-demanda-loja`** — cria `demandas_loja` + `demanda_mensagens` + `notificacoes` (setor/usuário responsável da loja). Remove envio WhatsApp.
- **`encerrar-demanda-loja`** — só fecha demanda + notifica via app. Remove envio WhatsApp.
- **`payment-webhook`** — gera mensagem "Picote" como `demanda_mensagens` + `notificacoes` para a loja envolvida. Remove envio WhatsApp direto.
- **`agendamentos-cron`** — cobranças/lembretes para lojas viram `notificacoes` (tipo `agendamento`) + entrada em `mensagens_internas` no canal do setor da loja. Mensagens para clientes finais continuam dependentes de template Meta aprovado (gate já existe).
- **`bot-lojas`** — desativado para chamadas WhatsApp inbound. Toda interação loja/colaborador agora acontece dentro do app (telas Demandas/Atendimento). Webhook que receber inbound de número corporativo retorna 200 sem processar e loga `bot_lojas_inbound_ignored`.

### 4. Resolução de destinatário interno
Função SQL nova `resolver_destinatarios_loja(loja_nome text)` que retorna lista de `user_id` ativos no setor da loja (consulta `telefones_lojas` → `setor_destino_id` → `user_roles` filtrando por `role='setor_usuario'` e `loja_nome` quando aplicável). Usada por `criar-demanda-loja`, `payment-webhook`, `agendamentos-cron` para enfileirar `notificacoes` e `mensagens_internas`.

### 5. Banco
Migration:
- `UPDATE atendimentos SET canal_provedor='meta_official' WHERE canal_provedor IN ('evolution_api','z_api') AND status<>'encerrado';`
- `UPDATE canais SET provedor='meta_official' WHERE provedor IN ('evolution_api','z_api');`
- Marcar `bot_fluxos.ativo=false` onde `tipo_bot IN ('loja','departamento','colaborador')` (bots desligados — substituídos pelo app).
- Index parcial para acelerar `notificacoes` por `usuario_id`/`setor_id` não lidas.

### 6. Edge Function nova `dispatch-push`
Gatilho: trigger Postgres em `notificacoes` (AFTER INSERT) chama `dispatch-push` via `pg_net`. Função busca `profiles.metadata.push_token` dos destinatários e envia push (FCM/APNs). Sem token → registra `eventos_crm.tipo='push_skipped_no_token'`. O app Atrium Messenger consome esses pushes.

Secrets necessários (vou solicitar quando implementar): `FCM_SERVER_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`. Caso não estejam prontos, função opera em modo "log only" e mensagens internas continuam funcionando via Realtime.

### 7. UI
- **`CronJobsCard`** — banner: "Disparos para clientes só com template Meta aprovado. Disparos internos (lojas/colaboradores) agora vão para o app Atrium Messenger."
- **`DemandaLojaPanel`** — banner permanente "Canal B2B migrado para o app Atrium Messenger. Mensagens digitadas aqui são entregues via app + notificação push."
- **`Configuracoes` → `BotMenuCard` / `BotFluxosCard`** — badge "Desativado (substituído pelo app)" enquanto `tipo_bot` for `loja|departamento|colaborador`.
- **Pequena tela em `/configuracoes` → "Canal Único Ativo"** — mostra status: WhatsApp Meta (verde quando `WHATSAPP_PHONE_NUMBER_ID` ok + ≥1 template aprovado), App Atrium (verde quando ≥1 `profiles.metadata.push_token` registrado).

### 8. Memórias
- Atualizar `mem://index.md` Core: WhatsApp = somente Meta Official para clientes; B2B/interno = App Atrium Messenger via `mensagens_internas` + `notificacoes`.
- Marcar **deprecated** com aviso no topo: `mem://bot-lojas/demandas-b2b-canal-evolution.md`, `mem://arquitetura/modelo-channel-bridge.md`, `mem://funcionalidades/integracao-whatsapp-dual-number.md`, `mem://projeto/estrategia-migracao-whatsapp-progressiva.md`, `mem://integracao/evolution-api-decodificacao-media.md`.
- Nova: `mem://arquitetura/canal-unico-meta-e-app-atrium.md` documentando o modelo definitivo.

---

## Arquivos
**Edits**
- `supabase/functions/send-whatsapp/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/criar-demanda-loja/index.ts`
- `supabase/functions/encerrar-demanda-loja/index.ts`
- `supabase/functions/payment-webhook/index.ts`
- `supabase/functions/agendamentos-cron/index.ts`
- `supabase/functions/bot-lojas/index.ts` (curto-circuito + log)
- `src/components/configuracoes/CronJobsCard.tsx`
- `src/components/configuracoes/BotMenuCard.tsx`
- `src/components/configuracoes/BotFluxosCard.tsx`
- `src/components/atendimentos/DemandaLojaPanel.tsx`

**Create**
- `supabase/functions/dispatch-push/index.ts`
- `supabase/config.toml` — bloco `[functions.dispatch-push] verify_jwt = false`
- Nova página/seção `src/components/configuracoes/CanalUnicoCard.tsx`
- Migration: updates de `atendimentos`/`canais`, desativação de `bot_fluxos` corporativos, função `resolver_destinatarios_loja`, trigger `notificacoes_dispatch_push` chamando `dispatch-push`, índice parcial.
- `mem://arquitetura/canal-unico-meta-e-app-atrium.md`

**Marca deprecated (sem deletar)**
- 4 arquivos de memória listados acima
- Funções `bridge-mensageria`, `send-whatsapp` rotas Evolution/Z-API (comentadas)

**Não incluso**
- Build/Publish do app Atrium Messenger (continua no projeto separado).
- Configuração de credenciais FCM/APNs (será solicitada via add_secret quando o app estiver pronto para receber pushes; até lá `dispatch-push` opera log-only e o app pega as mensagens via Realtime).

