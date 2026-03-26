## Sistema de Agendamentos — Implementado ✅

### O que foi feito

1. **Tabela `agendamentos`** — completa com status, flags de lembrete/cobrança, confirmação de loja
2. **Colunas `horario_abertura`, `horario_fechamento`, `endereco`** em `telefones_lojas`
3. **Setor + Pipeline "Agendamentos"** — colunas: Agendado, Confirmado, Atendido, Orçamento, Venda Fechada, No-Show, Recuperação, Reagendado, Abandonado, Cancelado
4. **Secret `WHATSAPP_BUSINESS_ACCOUNT_ID`** configurado
5. **Edge function `agendar-cliente`** — cria agendamento + envia confirmação WhatsApp
6. **Edge function `agendamentos-cron`** — motor de transição temporal (move cards, não envia mensagens)
7. **Edge function `manage-whatsapp-templates`** — CRUD de templates Meta via Graph API
8. **Bot Lojas opção 4** — confirmar comparecimento do cliente
9. **AI Triage** — contexto de lojas injetado, tools `agendar_visita` e `reagendar_visita`
10. **Frontend** — Pipeline Agendamentos (Kanban com drag-and-drop), rota `/agendamentos`

## Automações Atreladas a Colunas — Implementado ✅

### Arquitetura

```text
Card muda de coluna → DB Trigger → Edge Function "pipeline-automations" → executa regras
```

### O que foi feito

1. **Tabela `pipeline_automacoes`** — regras por coluna/status (template, mensagem, tarefa, campo)
2. **Edge function `pipeline-automations`** — executa ações configuradas, respeita homologação
3. **DB Triggers** — `on_agendamento_status_change` e `on_contato_coluna_change` via `pg_net`
4. **Cron refatorado** — apenas transição temporal, disparo de mensagens delegado às automações
5. **Drag-and-drop no Pipeline Agendamentos** — operador pode mover cards manualmente
6. **UI de Automações** — aba em Configurações para criar/gerenciar regras por status
7. **Automações pré-configuradas** — lembrete (confirmado), recuperação (no_show), pós-venda (venda_fechada)

### Variáveis de template

- `{{primeiro_nome}}`, `{{nome}}`, `{{loja}}`, `{{hora}}`, `{{data}}`, `{{telefone}}`

### Próximos passos

- Submeter templates Meta para aprovação: `confirmacao_agendamento`, `lembrete_agendamento`, `noshow_reagendamento`
- Testar fluxo completo: agendamento → lembrete → confirmação loja → no-show → recuperação
- Configurar cron job no pg_cron para executar `agendamentos-cron` a cada 15min
