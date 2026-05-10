## Objetivo

O consolidador de auditoria precisa saber que a conversa com o cliente é regida por **15+ sistemas**, não só pelo prompt da IA. Hoje ele sempre propõe `ajuste_prompt`, então correções para crons, templates, automações, watchdogs, tools, fluxos do bot, sanitizadores e configurações de horário viram texto inerte injetado no prompt.

## Mapa de vetores de conversa (referência para a LLM)

```
A) Texto/decisão da IA durante o turno
   → ia_instrucoes_prompt, ia_regras_proibidas, ia_exemplos
   → tipos: ajuste_prompt, regra_proibida, exemplo

B) Disparos proativos (fora do turno conversacional)
   B1) vendas-recuperacao-cron .... retomada 1h/24h/despedida
   B2) agendamentos-cron ........... lembrete/confirmação/no-show
   B3) watchdog-inbound-orfao ...... re-fire IA em silent drop
   B4) watchdog-loop-ia ............ lead → Perdidos/Humano
   B5) recuperar-atendimentos ...... manual >15min
   B6) pipeline-automations ........ mensagens por movimento de coluna
   → tipo: ajustar_cron | ajustar_automacao | tarefa_ti

C) Texto fora da janela 24h Meta
   → whatsapp_templates + template_aliases
   → tipo: trocar_alias_template | criar_template | tarefa_ti

D) Tools / parsers / detectores
   D1) ai-triage tool selection (agendar_visita, interpretar_receita, ...)
   D2) sanitização anti-vazamento de prompt
   D3) detector pós-LLM (auto-persiste agendamento)
   D4) despedida determinística
   → tipo: tarefa_ti

E) Fluxos do bot (lojas/B2B)
   → bot_fluxos (menus, opções)
   → tipo: ajustar_bot_fluxo | tarefa_ti

F) Configurações operacionais
   → app_config (horário humano, homologação, cadências, janelas)
   → tipo: ajustar_config | tarefa_ti
```

## Mudanças

### 1. `supabase/functions/audit-ia-consolidar/index.ts`

Reescrever o system prompt com:

- **Mapa de vetores acima** (compactado em ~30 linhas) listando cada sistema, qual tabela/arquivo o controla e qual `tipo` de ação se aplica.
- **Regra de roteamento**: a LLM precisa, para cada grupo, identificar qual vetor (A–F) é a causa-raiz **antes** de propor a ação.
- **Heurísticas explícitas** que forçam `tarefa_ti`/ação específica em vez de `ajuste_prompt`:
  - Menciona "template", "fora de 24h", "retomada de contexto" → C
  - Menciona "follow-up automático", "depois de N minutos sem resposta" → B3/B4
  - Menciona "lembrete", "no-show", "confirmação automática" → B2
  - Menciona "tool não disparou", "não persistiu", "não detectou imagem" → D
  - Menciona "menu do bot", "opção 1/2/3" → E
  - Menciona "horário comercial", "fim de semana", "feriado" → F

### 2. Schema de saída ampliado

Cada ação passa a ter:
```json
{
  "tipo": "ajuste_prompt | regra_proibida | exemplo | tarefa_ti | ajustar_cron | ajustar_automacao | trocar_alias_template | ajustar_bot_fluxo | ajustar_config",
  "vetor": "A | B1..B6 | C | D | E | F",
  "alvo_ref": "<nome do cron / id do template / chave em app_config>",
  "instrucao": "...",
  "titulo": "...",
  "descricao": "..."
}
```

### 3. `supabase/functions/audit-ia-aplicar-grupo/index.ts`

Adicionar branches para os novos tipos:

- `ajustar_cron`, `ajustar_automacao`, `trocar_alias_template`, `ajustar_bot_fluxo`, `ajustar_config` → criam **tarefa estruturada** em `tarefas` com `tipo` específico, `alvo_ref` e link de deep-link pra UI correspondente (Configurações > Cron Jobs, Automações, Templates, Bot Fluxos, etc.). Não aplicam automaticamente — operador valida e executa pela UI.
- Tipos antigos (`ajuste_prompt`, etc.) seguem aplicando direto como já fazem.

Justificativa: alterar cron, automação ou template em produção sem revisão humana é arriscado. Tarefa direcionada com link já é grande ganho.

### 4. UI `AuditoriaIaCard.tsx`

Já normaliza ação genérica via `normalizeAcao`. Acrescentar:

- `ACAO_LABEL` para os novos tipos (badge colorido distinto: roxo p/ cron, laranja p/ template, etc.)
- Botão "Aplicar" muda de label para "Criar tarefa" quando ação é dos tipos B/C/D/E/F.
- Ícone de deep-link na card para abrir a aba relevante de Configurações.

### 5. Re-rodar consolidação na run atual

Validar que:
- "Loop Retomada de Contexto" → vetor B1 → `ajustar_cron` em `vendas-recuperacao-cron`
- "Silêncio Pós-Inbound" → vetor B3 → `ajustar_cron` em `watchdog-inbound-orfao`
- "Placeholder de Receita Vazia" → vetor D1/D3 → `tarefa_ti` em `interpretar_receita` / detector pós-LLM
- "Preço Marca Sensível" → vetor A → `regra_proibida` (correto)
- Os demais grupos genuinamente do prompt seguem em A.

## Não escopo

- Não cria UI nova (Configurações já tem aba para cada vetor — só linkamos).
- Não muda `audit-ia-rodar` (achados crus seguem iguais).
- Não toca em `compile-prompt`.
- Não automatiza alteração de cron/template/automação — sempre cria tarefa para revisão humana.

## Validação

1. Após redeploy, rodar "Consolidar achados" na run atual.
2. Conferir distribuição dos `tipo` por grupo: nenhum grupo cuja causa-raiz seja cron/template/automação deve sair como `ajuste_prompt`.
3. Aplicar 1 grupo de cada vetor (A, B, C) e ver se cai no destino certo (regra/instrução vs tarefa estruturada).
