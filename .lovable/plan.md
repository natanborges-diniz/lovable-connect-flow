# Reforma do catálogo Hoya — aplicação

## Contexto

As 2 migrations preparadas ainda estão disponíveis em `/tmp/h1.sql` (428 linhas) e `/tmp/h2.sql` (429 linhas), totalizando 857 SKUs Hoya do catálogo Abr/2025. Elas resolvem o gap que impediu a IA de orçar a receita do Cleber (cilindro -4.25 multifocal não tinha cobertura).

A estratégia é: **deletar** todo o Hoya atual **exceto a família `Hoyalux D+`** (preservar) e re-inserir o catálogo novo.

## Etapas

### 1. Snapshot de segurança
Antes de qualquer DELETE, gravar `SELECT count(*), family FROM pricing_table_lentes WHERE brand='Hoya' GROUP BY family` para conferência pós-aplicação.

### 2. Migration 1 — Visão Simples + parte das Progressivas (h1.sql)
- `DELETE FROM pricing_table_lentes WHERE brand='Hoya' AND family <> 'Hoyalux D+'`
- INSERT de ~428 SKUs: Nulux iDentity V+ (todos índices/tratamentos), Nulux iDentity, MyStyle V+, e início das progressivas.

### 3. Migration 2 — Restante das Progressivas (h2.sql)
- INSERT de ~429 SKUs: Hoyalux iD LifeStyle 4, Hoyalux iD MyStyle V+, Hoyalux Daynamic etc. (sem novo DELETE).

### 4. Validação pós-aplicação
Rodar 3 queries de smoke test:
- Total Hoya ativo (esperado ≈ 857 + linhas Hoyalux D+ preservadas).
- Cobertura da receita Cleber: `WHERE category='progressiva' AND sphere_min<=-5.50 AND sphere_max>=5.50 AND cylinder_min<=-4.25` — esperar ≥1 linha (Nulux iD MyStyle V+ 1.67/1.74 etc.).
- Conferir que `Hoyalux D+` continua presente.

### 5. Atualizar memory
Atualizar `mem://ia/auto-receita-e-anti-loop` registrando que a reforma Hoya Abr/2025 foi aplicada e o cilindro -4.25 multifocal passou a ter cobertura nativa (não depende mais do fallback estimativa).

### 6. Commit do plano de correção do `ai-triage`
As correções do ai-triage (logar zero-linhas, fallback automático para `consultar_lentes_estimativa`, re-disparo após resposta de região, anti-loop endurecido) descritas em `.lovable/plan.md` **não** entram nesta passada — ficam para uma rodada subsequente. Aqui o foco é só desbloquear o catálogo.

## Observações

- As migrations vão pelo tool de migração (DELETE + INSERT em lote dentro de transação) — se algo falhar, rollback automático.
- Nenhum schema novo, só dados — sem impacto em código TS.
- Após apply, o orçamento "OD +4.25/-1.25, OE +5.50/-4.25" passa a retornar opções reais via `consultar_lentes` no `ai-triage`, sem precisar do fallback.

Aprovar para eu aplicar as 2 migrations + validação?
