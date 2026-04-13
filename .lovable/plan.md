

# Plano Revisado — Operacional CRM com Crons Gerenciáveis e Intervenção Humana Inteligente

## Resumo das Decisões do Usuário

1. **Cron jobs devem ser visualizáveis, editáveis e criáveis na UI de Configurações**
2. **Automações CRM NÃO devem conflitar com a IA** — a IA já está atendendo o cliente; notificações ao humano só quando a IA escalar ou houver inatividade real
3. **Remover a coluna "Atendimento Humano"** como estágio fixo — em vez disso, qualquer card pode ser sinalizado como "necessita humano" via flag
4. **Remover a coluna "Redirecionado"** — clientes sempre ficam no CRM, nunca são "redirecionados" para setores
5. **Follow-ups e recuperação são 100% automáticos** (IA + cron) — humano só atua quando explicitamente acionado
6. **Fila de prioridade** — humano vê cards sinalizados ordenados por tempo de espera

---

## 1. Gerenciamento de Cron Jobs na UI

### Nova aba em Configurações: "Agendamentos Automáticos" (Crons)

Criar um card `CronJobsCard.tsx` que:
- Lista os cron jobs existentes (lidos de uma nova tabela `cron_jobs`)
- Permite criar, editar, ativar/desativar e excluir
- Cada cron tem: nome, descrição, expressão cron (com helper visual), função alvo (edge function), payload, ativo/inativo, último disparo, próximo disparo

**Nova tabela `cron_jobs`:**
```
id, nome, descricao, expressao_cron, funcao_alvo, payload (jsonb), ativo, ultimo_disparo, created_at, updated_at
```

Os crons reais são registrados via `pg_cron` + `pg_net`. Ao criar/editar na UI, uma edge function `manage-cron-jobs` sincroniza com `cron.schedule`/`cron.unschedule`.

**Crons pré-configurados:**
- `agendamentos-cron` — a cada 5 min
- `vendas-recuperacao-cron` — a cada 15 min

| Arquivo | Mudança |
|---------|---------|
| `src/components/configuracoes/CronJobsCard.tsx` | **Novo** — UI de listagem e edição de crons |
| `src/pages/Configuracoes.tsx` | Adicionar aba/card de Cron Jobs |
| `supabase/functions/manage-cron-jobs/index.ts` | **Novo** — CRUD de pg_cron via service_role |
| Migração SQL | Criar tabela `cron_jobs` + habilitar pg_cron/pg_net + inserir crons iniciais |

---

## 2. Revisão das Automações CRM — Sem Conflito com IA

### Princípio: a IA é o agente primário. Automações CRM são de *suporte*, não de atendimento.

**Automações que NÃO devem existir** (IA já faz):
- ~~Lead → notificar operador~~ (IA trata)
- ~~Qualificado → template boas-vindas~~ (IA já conversa)
- ~~Informações Gerais → tarefa responder~~ (IA responde)

**Automações que FAZEM sentido:**
- **Qualquer coluna com card em modo "humano"** → notificação urgente ao operador
- **Perdidos** → encerrar atendimento automaticamente (já no plano)
- **Agendamento criado** → notificação para a loja (já existe)

### Flag "Necessita Humano" em vez de coluna dedicada

Remover as colunas "Atendimento Humano" e "Redirecionado" do pipeline CRM. Em vez disso:

- O campo `atendimentos.modo = 'humano'` já indica necessidade de intervenção humana
- Quando a IA muda o modo para "humano" (escalação), o card recebe destaque visual **em qualquer coluna** onde estiver
- Ícone de alerta pulsante + borda vermelha no card
- A sumarização do diálogo é gerada automaticamente ao escalar

### Painel de Fila Humana (novo componente no CRM)

Acima do Kanban, adicionar um painel colapsável "Fila de Atendimento Humano":
- Lista todos os cards com `modo = 'humano'` **de qualquer coluna**
- Ordenados por tempo de espera (mais antigo primeiro)
- Badge com contagem total
- Clique abre o card/conversa diretamente
- Quando o operador resolve, alterna de volta para IA ou encerra

| Arquivo | Mudança |
|---------|---------|
| `src/pages/Pipeline.tsx` | Adicionar painel "Fila Humana" acima do Kanban; destaque visual em cards com modo humano; remover referências a colunas "Atendimento Humano" e "Redirecionado" |
| Migração SQL | Remover automações das colunas extintas; inserir automação de encerramento em "Perdidos" |

---

## 3. Motor de Inatividade 100% Automático

### Toda recuperação e follow-up é feita pela IA/cron — nunca pelo humano

Atualizar `vendas-recuperacao-cron` para:

1. **Detectar inatividade** (sem mensagem inbound há X horas por coluna)
2. **Acionar a IA** para retomar o diálogo contextualmente (via `responder-solicitacao` com prompt de retomada) em vez de apenas enviar templates genéricos
3. **3 tentativas automáticas** (48h, +72h, +72h) com mensagens geradas pela IA
4. **Sem resposta após 3a tentativa** → mover para Perdidos automaticamente
5. **Resposta inbound** → cancelar cadência, IA retoma naturalmente

O humano **nunca** é acionado para follow-up ou recuperação.

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/vendas-recuperacao-cron/index.ts` | Adicionar lógica de inatividade por coluna; usar IA para retomada em vez de templates fixos |

---

## 4. Movimentação Livre no Card Detail

No `ConversationPanel` (dentro do dialog de card):

- **Seletor de coluna**: dropdown com todas as colunas do CRM agrupadas por `grupo_funil`, permitindo mover o contato para qualquer etapa
- **Botão "Encerrar Atendimento"**: marca `atendimentos.status = 'encerrado'`, gera resumo IA, move para Perdidos se apropriado
- **Corrigir rota**: "Abrir em Atendimentos" → `/crm/conversas?open=${atendimentoId}`

| Arquivo | Mudança |
|---------|---------|
| `src/pages/Pipeline.tsx` | Adicionar seletor de coluna e botão encerrar no ConversationPanel; corrigir rota |

---

## 5. Resumo de Arquivos

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `src/components/configuracoes/CronJobsCard.tsx` | Novo | UI para gerenciar cron jobs |
| `supabase/functions/manage-cron-jobs/index.ts` | Novo | Edge function para CRUD de pg_cron |
| `src/pages/Configuracoes.tsx` | Editar | Adicionar aba de crons |
| `src/pages/Pipeline.tsx` | Editar | Fila humana, destaque visual, seletor de coluna, encerrar atendimento, corrigir rota |
| `supabase/functions/vendas-recuperacao-cron/index.ts` | Editar | Inatividade por coluna, retomada via IA |
| Migração SQL | Novo | Tabela cron_jobs, pg_cron, automações revisadas |

