---
name: Auditoria IA — roteamento por vetor de conversa
description: audit-ia-consolidar classifica cada grupo em vetor A/B/C/D/E/F antes de propor ação. Apenas A vira regra/exemplo/diretriz no prompt; B–F viram tarefa estruturada com deep-link.
type: feature
---

## Vetores que regem a conversa com cliente

- **A** Prompt da IA (turno conversacional) → `ia_instrucoes_prompt`, `ia_regras_proibidas`, `ia_exemplos`. Tipos: `regra_proibida` | `exemplo` | `ajuste_prompt`.
- **B** Disparos proativos (crons) → B1 `vendas-recuperacao-cron`, B2 `agendamentos-cron`, B3 `watchdog-inbound-orfao`, B4 `watchdog-loop-ia`, B5 `recuperar-atendimentos`, B6 `pipeline-automations`. Tipo: `ajustar_cron`.
- **C** Templates Meta (fora janela 24h) → `whatsapp_templates` + `template_aliases`. Tipo: `ajustar_template`.
- **D** Tools/parsers/detectores → `ai-triage` (tool selection, sanitização, detector pós-LLM, despedida determinística), `interpretar_receita`, etc. Tipo: `tarefa_ti`.
- **E** Bot de lojas/B2B → `bot_fluxos`. Tipo: `ajustar_bot_fluxo`.
- **F** Configurações operacionais → `app_config` (horário, homologação, cadências), `feriados`. Tipo: `ajustar_config`.

## Comportamento

- `audit-ia-consolidar` recebe heurísticas explícitas no system prompt para classificar pelo vetor antes de escolher tipo. Proibido propor `ajuste_prompt` para vetores B–F.
- Cada ação carrega `vetor`, `alvo_ref`, `sugestao` (B–F) ou `instrucao`/`pergunta`/`regra` (A).
- `audit-ia-aplicar-grupo` aplica direto apenas A. B–F + `tarefa_ti` criam linha em `tarefas` com:
  - título prefixado (`[Cron]`, `[Template]`, `[Bot Fluxo]`, `[Config]`, `[TI]`)
  - prioridade `alta` se grupo é `critical`
  - `metadata.deep_link` apontando para a aba relevante de Configurações
  - `metadata.auditoria_grupo_id` e `auditoria_run_id` para rastreabilidade
- UI `AuditoriaIaCard` mostra badge "cria tarefa" e troca o botão para "Criar tarefa" / "Aplicar e criar tarefa" conforme os tipos presentes.
