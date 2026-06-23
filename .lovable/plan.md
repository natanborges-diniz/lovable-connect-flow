## Diagnóstico

Hoje **três crons dependem da firebird-bridge** e todos olham apenas D-1 (sem rede de segurança):

| Cron | Schedule | Janela bridge | O que faz se bridge cai |
|---|---|---|---|
| `regua-disparo-aguardando-armacao` | 07:00 SP | D-1 (seg pega D-1+D-2 do fim de semana) | Loga `erros++` no detalhe da execução, **não reprocessa** D-1 no dia seguinte. Etapa 15 daquele dia é **perdida silenciosamente**. |
| `regua-ingestao` (pós-venda: PRIMEIRO_CONTATO, ADAPTACAO_7D, ANIVERSARIO) | **sem cron ativo** (rodada manual) | D-1 entregas / D-7 adaptação / hoje aniversário | Mesma coisa: falha = perda do dia. |
| `regua-reconciliacao` (cashback D+1) | 07:00 SP | D-1 vendas confirmadas | Idem. |

Evidência: `os_avisos_armacao_log` tem **0 linhas nos últimos 7 dias** → ou bridge está fora há dias, ou o cron de armação está disparando vazio sem ninguém perceber. Não há alerta, não há retry, não há catch-up D-N.

A função `regua-disparo-aguardando-armacao` **já aceita** `{ datas: ["YYYY-MM-DD", …] }` no body, mas hoje isso é manual. Falta orquestração.

## Plano de contingência

### 1. Tabela de auditoria `bridge_sync_log`
Uma linha por (fonte, data_alvo, executado_at) com `status: ok|bridge_down|parcial`, `linhas_recebidas`, `erro_msg`. Fonte = `armacao_codetapa15` | `ingestao_entregas` | `ingestao_aniv` | `reconciliacao_vendas`.

### 2. Health-check da bridge antes de cada cron
Helper `pingBridge()` (GET `/health` com timeout 5s). Se falhar:
- Grava `bridge_sync_log(status='bridge_down')` para a data alvo.
- Insere `notificacoes` (admin/TI) **uma única vez por dia** com link "ver gaps".
- Retorna 200 sem processar (não polui logs com 500).

### 3. Catch-up D-N automático
Antes de processar D-1, cada cron:
1. Lê `bridge_sync_log` buscando datas **dos últimos N dias** (armação=14, reconciliação=7, ingestão=10) **sem linha `status='ok'`**.
2. Monta lista `datas = [...gaps, D-1]` (ordenado).
3. Itera; para cada data, faz a query na bridge → se OK, processa + grava `status='ok'`; se falha, mantém pendente para próxima rodada.

Idempotência já existe nos três fluxos (UNIQUE em `os_avisos_armacao_log(os_numero,loja_nome)`, `regua_touchpoint` por contato+tipo+data, `cashback_credito` por venda). Reprocessar D-3 três dias depois não duplica nada.

### 4. Painel `/configuracoes/bridge-saude`
Tabela simples mostrando últimos 30 dias × 4 fontes, célula verde/vermelha/cinza. Botão "Reprocessar manualmente" chama a edge function com `{ datas: [...] }`.

### 5. Agendar `regua-ingestao` (atualmente órfã)
`pg_cron` 07:30 SP. Mesmo health-check + catch-up.

### 6. Mudança no `regua-disparo-aguardando-armacao`
Manter a regra atual (domingo pulado, segunda processa sáb+dom) **como piso mínimo**, mas o catch-up D-N cobre lacunas adicionais. Bloco novo só na entrada da função.

## Arquivos previstos

- **Migração**: tabela `bridge_sync_log` + grants/RLS (admin/operador SELECT; service_role ALL) + UNIQUE `(fonte, data_alvo)`.
- **Migração**: agendar `regua-ingestao` via `pg_cron`.
- `supabase/functions/_shared/bridge-health.ts` — `pingBridge()`, `listarGaps(fonte, n)`, `marcarOk()`, `marcarFalha()`, `notificarAdminUmaVezPorDia()`.
- `supabase/functions/regua-disparo-aguardando-armacao/index.ts` — integrar health-check + loop de catch-up.
- `supabase/functions/regua-ingestao/index.ts` — idem; aceitar `datas[]` no body.
- `supabase/functions/regua-reconciliacao/index.ts` — idem.
- `src/pages/BridgeSaude.tsx` + entrada em `Configuracoes` (admin only).
- `.lovable/memory/integracao/bridge-firebird-contingencia.md` — documentar política D-N e onde olhar.

## Validação

1. **Simular bridge fora** (mock 503 no `BRIDGE_URL`) → cron grava `bridge_down`, manda 1 notificação admin, sai sem erro.
2. **Subir bridge no dia seguinte** → próxima execução pega gap de ontem + D-1 normal, processa as duas, grava 2× `status='ok'`.
3. **Rodar duas vezes a mesma data** → segunda execução pula 100% por idempotência (counters: enviados=0, pulados=N).
4. **Painel** lista os dois dias verdes após backfill.

## Fora de escopo

- Não muda mensagem ao cliente, templates ou tom.
- Não toca em `bridge-mensageria` nem em `bridge-demanda` (outro domínio, sem Firebird).
- Não tenta consertar a bridge em si — só a resiliência do nosso lado.
