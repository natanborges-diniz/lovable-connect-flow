## Sistema de Agendamentos — Implementado ✅

### O que foi feito

1. **Tabela `agendamentos`** — completa com status, flags de lembrete/cobrança, confirmação de loja
2. **Colunas `horario_abertura`, `horario_fechamento`, `endereco`** em `telefones_lojas`
3. **Setor + Pipeline "Agendamentos"** — colunas: Agendado, Confirmado, Atendido, No-Show, Recuperação, Reagendado, Abandonado, Cancelado
4. **Secret `WHATSAPP_BUSINESS_ACCOUNT_ID`** configurado
5. **Edge function `agendar-cliente`** — cria agendamento + envia confirmação WhatsApp
6. **Edge function `agendamentos-cron`** — a cada 15min: lembretes, cobrança à loja, detecção no-show, recuperação
7. **Edge function `manage-whatsapp-templates`** — CRUD de templates Meta via Graph API
8. **Bot Lojas opção 4** — confirmar comparecimento do cliente
9. **AI Triage** — contexto de lojas injetado, tools `agendar_visita` e `reagendar_visita`, contexto de no-show para recuperação inteligente
10. **Frontend** — Pipeline Agendamentos (Kanban), rota `/agendamentos`, módulo na navegação

### Próximos passos

- Cadastrar endereços e horários das lojas em Configurações
- Criar e submeter templates Meta: `confirmacao_agendamento`, `lembrete_agendamento`, `noshow_reagendamento`
- Testar fluxo completo: agendamento → lembrete → confirmação loja → no-show → recuperação
