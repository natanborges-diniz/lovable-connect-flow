## Plano — Ligar arquivamento automático do Pipeline Financeiro

### Resultado esperado
- Cron `auto-arquivar-cards-diario` rodando todo dia às **03:30 SP**.
- Regra única: cards parados há **7+ dias** em qualquer coluna terminal ganham `metadata.arquivado_at = now()` e somem da tela (toggle "Mostrar arquivados" continua trazendo de volta).
- Na primeira execução (madrugada seguinte), aproximadamente **37 cards** antigos saem da visualização padrão de uma vez:
  - Link Pago: 23
  - PIX Confirmado: 7
  - Link Enviado: 5
  - Dados Incompletos: 1
  - Concluído: 1

### Passo único de execução

Atualizar o registro do cron em `cron_jobs` para `ativo = true` e (re)registrar no `pg_cron` via Edge Function `manage-cron-jobs` (já existente neste projeto), preservando schedule `30 6 * * *` (UTC) e `funcao_alvo='auto-arquivar-cards'`.

Não há mudança de código nem de migration:
- A EF `auto-arquivar-cards` já existe e foi testada.
- `pipeline_colunas.dias_auto_arquivar = 7` já está setado em todas as colunas terminais.
- O filtro do frontend (`metadata.arquivado_at IS NULL` por padrão + toggle) já está em produção.
- Índice em `metadata->>'arquivado_at'` já criado.

### Reversibilidade

Se algo der errado na primeira rodada:
1. `UPDATE cron_jobs SET ativo=false WHERE nome='auto-arquivar-cards-diario'` desliga imediatamente.
2. Para desarquivar tudo de uma vez: `UPDATE solicitacoes SET metadata = metadata - 'arquivado_at' WHERE metadata ? 'arquivado_at'` — os cards reaparecem instantâneos.
3. Cada arquivamento gera um evento `tipo='card_arquivado'` em `pipeline_card_eventos`, então é auditável card a card.

### Detalhes técnicos

- **Cron job alvo:** `cron_jobs.id = 859944b1-3e30-4dc8-a6ae-eff662983f66`
- **Operação:** `manage-cron-jobs` com `action: "update"` → flip `ativo` para `true`, o que faz a função registrar `cron.schedule()` no `pg_cron` e popular `pg_cron_job_id`.
- **Próxima execução:** 03:30 SP do dia seguinte à aprovação (a EF dispara via `pg_net.http_post` com a service_role).
- **O que a EF faz por execução:** `SELECT` em `solicitacoes` com `JOIN pipeline_colunas` filtrando `terminal=true AND updated_at < now() - (pc.dias_auto_arquivar || ' days')::interval AND metadata->>'arquivado_at' IS NULL`; para cada hit, faz `UPDATE` adicionando `arquivado_at` no jsonb e insere evento em `pipeline_card_eventos`.
- **Sem efeito colateral em relatórios:** os cards continuam contáveis em `vw_disparos_unificados`, cashback, demandas, timeline 360 — só somem da visão padrão do Kanban.
