## Objetivo

Resolver de vez o problema "Aplicar correção mente": hoje o botão diz que aplicou, mas em vários casos só cria tarefa pra alguém mexer no código depois. Vamos fazer duas coisas em sequência — primeiro consertar a honestidade do botão, depois ampliar o que ele realmente sabe consertar sozinho.

---

## Fase 1 — Honestidade do botão (rápido, alto impacto)

Cada achado da auditoria passa a ter um de três rótulos visíveis no card antes de clicar:

- **Auto-aplicável** — clicar resolve 100%, sem mais nada.
- **Requer código** — clicar abre uma tarefa pra TI; o card mostra "não resolve sozinho, ainda vai precisar de deploy".
- **Requer decisão humana** — exige aprovação/contexto (ex: mudar valor de horário comercial).

Mudanças concretas:

1. `audit-ia-consolidar/index.ts` — ao montar `acoes_propostas`, classifica cada vetor em um desses três modos e grava em `acoes_propostas[].modo_aplicacao`.
2. `audit-ia-aplicar-grupo/index.ts` — se todas as ações do grupo são `tarefa_ti`, o status final do grupo vira `pendente_codigo` (não `aplicado`). Hoje vira `aplicado` mesmo só criando tarefa — é a raiz da mentira.
3. `AuditoriaIaCard.tsx` — badge colorido no card ("Auto-aplicável" / "Requer código" / "Requer decisão") e o botão muda de label conforme o modo: "Aplicar agora", "Abrir tarefa pra TI", "Revisar e aplicar".
4. Roteamento do vetor A (template de retomada) corrigido pra B1 (mexe em `vendas-recuperacao-cron` payload, não no prompt). Já estava errado no run atual.

Resultado: você nunca mais clica achando que resolveu quando só virou backlog.

---

## Fase 2 — Migrar mais coisas pra auto-aplicável (estrutural)

Hoje o botão só sabe mexer em 4 lugares: prompt, regras proibidas, exemplos, instruções. Tudo que é cron / template / horário / fluxo de bot vira tarefa porque está cravado em código. Vamos mover esses parâmetros pra tabelas que o botão já consegue editar:

| Domínio | Hoje | Depois | Auto-aplicável? |
|---|---|---|---|
| Cadência cron de retomada (timings, msgs) | hardcoded em `vendas-recuperacao-cron` | linhas em `cron_jobs.payload` (já existe) lidas pela função | Sim |
| Templates WhatsApp (qual template, quando, condições de bloqueio) | hardcoded em `pipeline-automations` e `vendas-recuperacao-cron` | tabela `pipeline_automacoes.config` (já existe) + nova flag `bloquear_se` | Sim |
| Horário comercial humano | hardcoded em `ai-triage` e watchdogs | `app_config` keys `horario_comercial_*` (tabela já existe) | Requer decisão (mudança sensível) |
| Watchdogs (intervalos, thresholds) | hardcoded em cada EF | `cron_jobs.payload.thresholds` | Sim |
| Mensagens fixas (despedida, escalada fora-horário, retomada) | hardcoded em `ai-triage` | tabela nova `ia_mensagens_fixas` (chave + texto + ativo) | Sim |

Cada migração: 1 migration de schema + ajuste da EF pra ler da tabela (com fallback ao default atual) + novo vetor de auditoria que sabe gravar nessa tabela.

Ordem de entrega (cada item é um passo independente, com valor isolado):

1. **`ia_mensagens_fixas`** — tira despedida/escalada/retomada do código. Auditoria passa a poder reescrever esses textos sozinha. (resolve grupo #5 do run atual.)
2. **Watchdog thresholds em `cron_jobs.payload`** — auditoria já consegue ajustar timings sem deploy. (resolve grupo #4.)
3. **Loop de receita: heurística do `ai-triage` em `configuracoes_ia`** — limites de tentativa, gatilho de escalada, viram config. (resolve grupo #3.)
4. **Template de retomada com condições em `pipeline_automacoes.config.bloquear_se`** — auditoria muda quando dispara, sem deploy.

---

## O que NÃO vai virar auto-aplicável (e por quê)

- **Mudar prompt-mestre** — já é, fica.
- **Adicionar nova ferramenta (tool) pra IA** — exige código, sempre será "Requer código".
- **Mudar horário comercial** — sensível, vira "Requer decisão" com diff visível antes de aplicar.
- **Trocar provedor (Meta, push)** — código + secrets, sempre "Requer código".

---

## Entregável final

Depois das duas fases, ao rodar uma auditoria você vai ver:

- ~80% dos achados como **Auto-aplicável** (clicou, acabou).
- ~15% como **Requer decisão** (clica, vê o diff, confirma — aplica direto, sem deploy).
- ~5% como **Requer código** (gera tarefa honestamente, com aviso claro de que precisa deploy).

Nenhum achado vai mais sair como "aplicado" sem ter mudado nada de verdade.

---

## Detalhes técnicos

- Novo campo `acoes_propostas[].modo_aplicacao: 'auto' | 'codigo' | 'decisao'` em `ia_auditorias_grupos`.
- Novo status de grupo: `pendente_codigo` e `pendente_decisao` (além de `pendente`, `aplicado`, `ignorado`).
- `audit-ia-aplicar-grupo` ganha branch que, pra modo `decisao`, retorna o diff proposto e exige segundo clique de confirmação no frontend.
- Tabela nova `ia_mensagens_fixas (chave text PK, texto text, ativo bool, updated_at)` com seed dos textos atuais.
- Migration adiciona índice em `cron_jobs (nome)` pra leitura rápida pelas EFs.
- EFs (`vendas-recuperacao-cron`, `ai-triage`, watchdogs) ganham helper `getConfig(key, fallback)` que lê `cron_jobs.payload` / `configuracoes_ia` / `ia_mensagens_fixas` com cache de 60s.
- Frontend: `AuditoriaIaCard` ganha 3 variantes de botão + badge + (no caso `decisao`) modal de diff.