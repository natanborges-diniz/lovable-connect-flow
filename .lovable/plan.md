

## Plano: Automações Atreladas a Colunas do Pipeline

### Conceito

Hoje as automações (lembretes, cobranças, no-show) são disparadas por um cron que verifica horários e flags. O novo modelo inverte a lógica: **a movimentação de coluna é o gatilho**. Quando um card entra numa coluna — seja por ação do sistema, da IA ou do operador manual — a regra daquela coluna é executada (ex: enviar mensagem WhatsApp, atualizar status, etc.).

### O que muda

```text
ANTES:  Cron verifica hora → muda status → envia mensagem
DEPOIS: Card muda de coluna → Edge Function "column-action" executa a regra → envia mensagem
```

### Arquitetura

```text
┌──────────────────┐       ┌──────────────────┐
│  Pipeline UI     │       │  AI Triage /      │
│  (drag & drop)   │       │  Cron / Bot       │
└────────┬─────────┘       └────────┬──────────┘
         │ UPDATE contato.pipeline_coluna_id    │
         └────────────┬────────────┘
                      ▼
         ┌────────────────────────┐
         │  DB Trigger (webhook)  │
         │  on contatos UPDATE    │
         │  or agendamentos UPDATE│
         └────────────┬──────────┘
                      ▼
         ┌────────────────────────┐
         │  Edge Function         │
         │  "pipeline-automations"│
         │  - Lê regras da coluna │
         │  - Executa ação        │
         │  (msg, template, etc.) │
         └────────────────────────┘
```

### Etapas de implementação

**1. Tabela `pipeline_automacoes`** — regras por coluna
- `id`, `pipeline_coluna_id` (FK), `tipo_acao` (enum: `enviar_template`, `enviar_mensagem`, `atualizar_status`, `criar_tarefa`), `config` (jsonb com template_name, params, texto, etc.), `ativo`, `ordem`, `created_at`
- Permite múltiplas ações por coluna

**2. Edge Function `pipeline-automations`** — executa ações
- Recebe `{ entity_type, entity_id, coluna_id, coluna_anterior_id }`
- Busca automações ativas daquela `coluna_id`
- Para cada ação: envia template WhatsApp, envia mensagem livre, atualiza campo, cria tarefa, etc.
- Respeita modo de homologação (só dispara para contatos whitelisted)

**3. DB Trigger + Webhook (pg_net)** — detecta mudança de coluna
- Trigger `AFTER UPDATE` em `contatos`: se `pipeline_coluna_id` mudou, chama `pipeline-automations` via `net.http_post`
- Trigger `AFTER UPDATE` em `agendamentos`: se `status` mudou, faz o mesmo para o pipeline de agendamentos

**4. Refatorar o cron `agendamentos-cron`**
- O cron continua existindo para ações baseadas em tempo (verificar se o horário passou), mas ao invés de enviar mensagens diretamente, ele **move o card de coluna** (ex: `agendado` → `no_show`), o que dispara a automação da coluna
- O cron se torna apenas um "motor de transição temporal"

**5. Frontend: UI de configuração de automações**
- Em Configurações → aba "Automações" ou dentro de cada coluna do pipeline
- Para cada coluna: lista de ações configuradas (template, mensagem livre, etc.)
- Formulário para adicionar/editar ações com preview da mensagem

**6. Adaptar os pipelines UI** (Vendas, Agendamentos, Financeiro)
- O `onDragEnd` no Pipeline de Vendas já faz `updateContato({ pipeline_coluna_id })` — o trigger cuida do resto
- O Pipeline de Agendamentos passa a usar drag-and-drop também (hoje é read-only) — ao mover card, atualiza `agendamentos.status` e dispara a automação

### Seção técnica

- **Trigger SQL** usa `pg_net` para chamar a Edge Function, evitando acoplamento direto
- **Idempotência**: a Edge Function verifica se a ação já foi executada (usando metadata do agendamento/contato) para evitar duplicatas
- **Automações pré-configuradas padrão**: ao criar o sistema, seed com as regras atuais (lembrete no "Confirmado", cobrança no "No-Show", recuperação no "Recuperação")
- **Retrocompatibilidade**: o cron continua como fallback temporal, mas delega o envio de mensagens à lógica de automação de coluna

