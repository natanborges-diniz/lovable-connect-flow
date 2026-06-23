---
name: Bridge Firebird — Contingência D-N e auditoria
description: Tabela bridge_sync_log + health-check + catch-up automático nos crons que dependem da firebird-bridge. Painel /configuracoes/bridge-saude (admin) com heatmap 30 dias e botão de reprocesso manual por célula.
type: feature
---

## Problema original
Três crons consultam `BRIDGE_URL` (firebird-bridge) olhando só D-1. Se a bridge fica fora:
- `regua-disparo-aguardando-armacao` perdia OS de etapa 15 daquele dia silenciosamente.
- `regua-ingestao` perdia entregas (PRIMEIRO_CONTATO, ADAPTACAO_7D) e aniversariantes.
- `regua-reconciliacao` ficava pulando todas as inscrições.
Sem alerta, sem retry, sem catch-up.

## Solução

### Tabela `bridge_sync_log`
Uma linha por `(fonte, data_alvo)` UNIQUE. Status: `ok | vazio | parcial | bridge_down`. Fontes:
- `armacao_codetapa15`
- `ingestao_entregas` (D-1 entregas + D-7 adaptação)
- `ingestao_aniv` (D+0 aniversariantes — sem catch-up útil, é específico do dia)
- `reconciliacao_vendas` (uma linha por dia, status agregado)

### Helper compartilhado `supabase/functions/_shared/bridge-health.ts`
- `pingBridge(BRIDGE_URL, SVC_SECRET, timeout=5s)` → GET `/health`.
- `listarGaps(supabase, fonte, n, hoje)` → datas dos últimos N dias **sem** linha `status in ('ok','vazio')`.
- `marcarSync({fonte,data_alvo,status,linhas,erro_msg})` → upsert.
- `notificarAdminBridgeDown(fonte, detalhe)` → insere `notificacoes` para todos os admins **uma vez por dia** (dedup por `link=/configuracoes/bridge-saude?key=bridge_down:<fonte>:<hoje>`).

### Catch-up automático
- **`regua-disparo-aguardando-armacao`**: antes de processar D-1, busca gaps dos últimos **14 dias** e processa todos. Cada data marca seu próprio `bridge_sync_log`. Idempotência via UNIQUE `os_avisos_armacao_log(os_numero,loja_nome)`.
- **`regua-ingestao`**: não tem catch-up automático ainda (chamada manual via painel). Grava `bridge_sync_log` para `ingestao_entregas` (D-1 e D-7) e `ingestao_aniv` (hoje) por execução.
- **`regua-reconciliacao`**: não precisa de loop de datas — inscrições pendentes persistem em `regua_inscricao.status='aguardando_entrega'`. Apenas detecta bridge fora, grava `bridge_down` e sai 200 sem mexer nas inscrições (que serão reprocessadas na próxima rodada).

### Crons agendados
- `regua-reconciliacao-diaria-07h-sp` — `0 10 * * *` (existente)
- `cron_9d3334ac…` (armação) — `0 10 * * *` (existente)
- `regua-ingestao-diaria-0730-sp` — `30 10 * * *` (**novo**, criado nesse ciclo)

### Painel `/configuracoes/bridge-saude`
- Acesso: `admin` only (ProtectedRoute).
- Heatmap 30 dias × 4 fontes. Verde=ok, cinza=vazio, âmbar=parcial, vermelho=bridge_down.
- Clique numa célula chama a edge function com `{datas:[d]}` (armação) ou `{data:d}` (ingestão) ou `{}` (reconciliação).
- Lista as últimas 30 execuções com timestamp, fonte, status, linhas e erro.

## RLS
- `SELECT` para admin OR operador (via `has_role`).
- `service_role` ALL (crons gravam).

## Como diagnosticar bridge fora
1. Abrir `/configuracoes/bridge-saude` → linhas vermelhas indicam gaps.
2. Notificação automática chega aos admins quando ping falha.
3. Quando bridge voltar, o cron seguinte pega o gap sozinho (armação) ou clica-se a célula no painel (ingestão).
