

## Plano Atualizado: Sistema de Agendamentos Completo

### Resumo das mudanças solicitadas

1. **Loja confirma comparecimento** — Sistema envia WhatsApp para a loja perguntando se o cliente compareceu. Loja responde via menu do bot.
2. **Cobrança à loja** — Se a loja não responder em 2h (ou 09h do dia seguinte se fora do expediente), o sistema cobra a loja.
3. **Plano de recuperação inteligente** — No-show dispara fluxo de reconquista do cliente com IA adaptativa: se o cliente responde, continua a conversa; se não responde, escala.
4. **Base de arquivos para o agente** — Carregar lista de lojas (telefones_lojas) no contexto da IA para que ela saiba endereços, nomes e horários.

---

### Arquitetura do fluxo

```text
Cliente agenda via IA
  → Cria registro "agendamentos" (status: agendado)
  → Envia confirmação WhatsApp ao cliente
  → Card aparece no Pipeline Agendamentos

[Dia anterior] Cron
  → Lembrete WhatsApp ao cliente (template Meta)

[Horário do agendamento] Cron
  → Envia WhatsApp à LOJA: "O cliente {nome} compareceu?"
  → Loja responde via bot-lojas (opção 4: Confirmar Comparecimento)

[2h após agendamento OU 09h dia seguinte]
  → Se loja NÃO confirmou → Cobra a loja novamente
  → Marca no-show
  → Dispara plano de recuperação ao CLIENTE

Plano de recuperação:
  → IA envia mensagem empática ao cliente
  → Se cliente responde → IA continua conversa e tenta reagendar
  → Se cliente não responde em 24h → Nova tentativa
  → Se 48h sem resposta → Marca como "abandonado"
```

---

### 1. Migração SQL

**Tabela `agendamentos`:**
```sql
CREATE TABLE public.agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL,
  atendimento_id uuid,
  loja_nome text NOT NULL,
  loja_telefone text,
  data_horario timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado',
  -- agendado, confirmado, atendido, no_show, reagendado, cancelado, concluido, recuperacao, abandonado
  observacoes text,
  lembrete_enviado boolean DEFAULT false,
  confirmacao_enviada boolean DEFAULT false,
  noshow_enviado boolean DEFAULT false,
  cobranca_loja_enviada boolean DEFAULT false,
  loja_confirmou_presenca boolean,
  noshow_agendar_para timestamptz,
  tentativas_recuperacao int DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Coluna `horario_fechamento` em `telefones_lojas`:**
```sql
ALTER TABLE telefones_lojas ADD COLUMN horario_fechamento text DEFAULT '19:00';
ALTER TABLE telefones_lojas ADD COLUMN endereco text;
```

**Setor + Colunas pipeline "Agendamentos"** — via insert.

---

### 2. Bot Lojas — Nova opção "4. Confirmar Comparecimento"

Adicionar ao menu do `bot-lojas`:
```
4️⃣ Confirmar Comparecimento de Cliente
```

Fluxo:
- Bot mostra agendamentos pendentes daquela loja (busca por `loja_telefone` na tabela `agendamentos` com status `agendado`/`confirmado` e data = hoje)
- Loja digita o número do agendamento
- Bot pergunta: "O cliente {nome} compareceu? (SIM/NÃO)"
- SIM → status = `atendido`
- NÃO → status = `no_show`, dispara plano de recuperação

---

### 3. Cron `agendamentos-cron` — Lógica completa

A cada 15 minutos:

**a) Lembretes (dia anterior ao cliente):**
- Agendamentos para amanhã + `lembrete_enviado = false` → template `lembrete_agendamento`

**b) Acionamento da loja (horário do agendamento):**
- Agendamentos com `data_horario < now()` + `confirmacao_enviada = false` → envia WhatsApp para a loja: "O cliente {nome} tinha agendamento às {hora}. Ele compareceu? Responda pelo menu opção 4."
- Marca `confirmacao_enviada = true`

**c) Cobrança à loja (2h depois):**
- Agendamentos com `data_horario + 2h < now()` + `loja_confirmou_presenca IS NULL` + `cobranca_loja_enviada = false`
- Se agora > `horario_fechamento` da loja → agenda para 09h do dia seguinte (`noshow_agendar_para`)
- Senão → envia cobrança à loja: "Ainda não recebemos confirmação do comparecimento do cliente {nome}. Por favor confirme pelo menu opção 4."
- Se loja não confirma → assume no-show → dispara recuperação

**d) Executa cobranças agendadas:**
- `noshow_agendar_para <= now()` + não enviado → executa

**e) Plano de recuperação do cliente:**
- Agendamentos com status `no_show` ou `recuperacao`:
  - Se `tentativas_recuperacao = 0` → IA envia mensagem empática via `ai-triage` com contexto de no-show
  - Se `tentativas_recuperacao = 1` e 24h sem resposta → segunda tentativa
  - Se `tentativas_recuperacao >= 2` e 48h sem resposta → marca `abandonado`
  - Se cliente respondeu (verificar mensagens inbound recentes) → manter conversa ativa via IA

---

### 4. Inteligência de recuperação no `ai-triage`

Quando o atendimento tem agendamento com status `no_show` ou `recuperacao`:
- Adicionar ao system prompt: contexto do agendamento (loja, data, motivo)
- Instruções: "O cliente não compareceu ao agendamento. Seja empático, entenda o motivo. Se ele demonstra interesse, reagende. Se ele não quer mais, registre e encerre com elegância."
- Nova tool `reagendar_visita` para criar novo agendamento a partir do no-show

Detecção automática:
- Se cliente responde com justificativa → IA conversa normalmente
- Se cliente confirma reagendamento → cria novo agendamento
- Se cliente diz que não quer → marca `cancelado`, IA encerra com empatia

---

### 5. Base de conhecimento: Lista de lojas no contexto da IA

Em vez de carregar arquivos, usar os dados já existentes em `telefones_lojas`:

No `ai-triage`, ao carregar dados em paralelo, adicionar:
```typescript
supabase.from("telefones_lojas").select("nome_loja, telefone, endereco, horario_fechamento, departamento").eq("ativo", true)
```

Injetar no system prompt como seção:
```
# LOJAS DISPONÍVEIS
- Loja Centro: Rua X, 123 | Horário: 08:00-19:00 | Tel: (11) 9999-0000
- Loja Shopping Y: ...
```

Isso permite que a IA:
- Sugira lojas por proximidade/preferência
- Informe endereço e horário corretamente
- Agende na loja certa

---

### 6. Templates Meta (3 + gerenciamento via plataforma)

1. **`confirmacao_agendamento`** — Confirmação ao cliente
2. **`lembrete_agendamento`** — Lembrete dia anterior
3. **`noshow_reagendamento`** — "Vimos que você não conseguiu comparecer à nossa loja {loja}. Entendemos que a correria do dia a dia é grande. Gostaria de reagendar sua visita?"

Gerenciamento via Graph API (`manage-whatsapp-templates`) — como no plano anterior.

---

### 7. Pipeline Agendamentos — Frontend

Kanban em `/agendamentos-pipeline`:
- Colunas: Agendado → Confirmado → Atendido → Concluído → No-Show → Recuperação → Reagendado → Abandonado → Cancelado
- Cards: nome cliente, loja, data/hora, status loja (confirmou/não)
- Filtro por loja e período
- Indicador visual: agendamentos de hoje em destaque, no-show em vermelho

---

### Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| Migração SQL | Tabela `agendamentos`, colunas em `telefones_lojas`, setor + colunas pipeline |
| `supabase/functions/bot-lojas/index.ts` | Opção 4: confirmar comparecimento |
| `supabase/functions/agendar-cliente/index.ts` | Criar agendamento + confirmação |
| `supabase/functions/agendamentos-cron/index.ts` | Lembretes + cobrança loja + recuperação |
| `supabase/functions/manage-whatsapp-templates/index.ts` | CRUD templates Meta |
| `supabase/functions/ai-triage/index.ts` | Tool `agendar_visita` + `reagendar_visita` + contexto lojas + contexto no-show |
| `supabase/functions/whatsapp-webhook/index.ts` | Detectar SIM/NÃO de confirmação |
| `src/pages/PipelineAgendamentos.tsx` | Kanban visual |
| `src/hooks/useAgendamentos.ts` | Hook de dados |
| `src/App.tsx` + `AppSidebar.tsx` | Rota e navegação |
| `supabase/config.toml` | Registrar novas functions |
| Cron job via `pg_cron` | Disparo a cada 15 min |

### Pré-requisito

- Salvar `WHATSAPP_BUSINESS_ACCOUNT_ID` como secret
- Cadastrar `horario_fechamento` e `endereco` para cada loja em Configurações

