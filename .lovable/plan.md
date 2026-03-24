

## Plano: Bot de Autoatendimento para Lojas + Link de Pagamento

### Conceito

Criar um fluxo paralelo e independente para contatos do tipo "loja". Quando um telefone de loja é identificado no webhook, em vez de acionar o ai-triage (usado para clientes), o sistema inicia um **bot estruturado** com menu de opções. O primeiro caso de uso é "Gerar Link de Pagamento", que coleta dados via WhatsApp e chama a função `payment-links` do projeto Infoco Optical Business.

### Arquitetura

```text
WhatsApp webhook recebe msg
  ↓ consulta telefones_lojas (telefone identificado?)
  ↓ NÃO → fluxo normal (cliente → ai-triage)
  ↓ SIM → fluxo loja (bot estruturado)
      ↓ contato.tipo = "loja"
      ↓ aciona bot-lojas (edge function)
      ↓ máquina de estados por atendimento
      ↓ coleta dados step-by-step
      ↓ chama payment-links no projeto Optical Business
      ↓ devolve link na conversa
      ↓ solicitação cai no pipeline Financeiro
```

### 1. Migração SQL

**Tabela `telefones_lojas`** — whitelist de telefones por departamento/loja:

```sql
CREATE TABLE public.telefones_lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text NOT NULL UNIQUE,
  nome_loja text NOT NULL,
  cod_empresa text,          -- código da loja no Optical Business (para payment-links)
  departamento text DEFAULT 'geral',
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
-- RLS para authenticated
```

**Tabela `bot_sessoes`** — estado da conversa do bot por atendimento:

```sql
CREATE TABLE public.bot_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id uuid NOT NULL,
  fluxo text NOT NULL DEFAULT 'menu_principal',  -- menu_principal, link_pagamento, etc.
  etapa text NOT NULL DEFAULT 'inicio',            -- inicio, valor, descricao, parcelas, confirmar
  dados jsonb DEFAULT '{}',                        -- dados coletados step-by-step
  status text DEFAULT 'ativo',                     -- ativo, concluido, cancelado
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- RLS para authenticated
```

### 2. Edge Function `bot-lojas/index.ts`

Nova edge function que gerencia o fluxo conversacional por estado:

| Etapa | Bot envia | Espera |
|---|---|---|
| `inicio` | "Olá [loja]! Escolha uma opção:\n1️⃣ Gerar Link de Pagamento\n2️⃣ ..." | Número da opção |
| `valor` | "Qual o valor do link? (ex: 150.00)" | Valor numérico |
| `descricao` | "Descreva o pagamento (ex: Lente Transition)" | Texto livre |
| `parcelas` | "Máximo de parcelas? (1-12)" | Número |
| `cliente` | "Nome do cliente (ou 'pular')" | Texto |
| `confirmar` | "Confirma?\n💰 R$ 150,00\n📝 Lente Transition\n💳 Até 6x\n\nResponda SIM ou NÃO" | SIM/NÃO |
| `resultado` | "Link gerado! 🔗 [url]\nVálido por 24h" | — |

**Chamada cross-project ao payment-links:**

```text
POST https://[OPTICAL_BUSINESS_SUPABASE_URL]/functions/v1/payment-links
Headers:
  X-Service-Key: [INTERNAL_SERVICE_SECRET]
  Content-Type: application/json
Body:
  { "action": "criar", "cod_empresa": "...", "valor": 150, "descricao": "...", "parcelas_max": 6 }
```

### 3. Secrets necessários

| Secret | Descrição |
|---|---|
| `OPTICAL_BUSINESS_URL` | URL do projeto Infoco Optical Business (para chamar payment-links) |
| `INTERNAL_SERVICE_SECRET` | Chave compartilhada entre projetos (já existe no Optical Business) |

### 4. Webhook — roteamento por tipo de contato

No `whatsapp-webhook/index.ts`, adicionar detecção antes do passo 3:

```text
Após identificar contato:
  ↓ consulta telefones_lojas WHERE telefone = phone
  ↓ Se encontrado:
      → contato.tipo = "loja" (se ainda não for)
      → aciona bot-lojas em vez de ai-triage
  ↓ Se não:
      → fluxo normal (ai-triage)
```

### 5. Pipeline — Financeiro

- Ao confirmar geração de link, a solicitação é criada com `tipo = "link_pagamento"` e movida automaticamente para a coluna do pipeline correspondente ao Financeiro
- Precisaremos criar a coluna "Financeiro" no pipeline se não existir

### 6. UI — Gestão de Telefones de Lojas (Configurações)

Card em Configurações para cadastrar/editar telefones:
- Telefone, nome da loja, código empresa, departamento, toggle ativo/inativo

### Componentes alterados

| Componente | Ação |
|---|---|
| Migração SQL | Criar `telefones_lojas` e `bot_sessoes` |
| `supabase/functions/bot-lojas/index.ts` | Nova edge function: máquina de estados do bot |
| `supabase/functions/whatsapp-webhook/index.ts` | Detectar telefone de loja e rotear para `bot-lojas` |
| `supabase/config.toml` | Adicionar `[functions.bot-lojas]` |
| `src/pages/Configuracoes.tsx` | Card "Telefones de Lojas" |
| Secrets | `OPTICAL_BUSINESS_URL` e `INTERNAL_SERVICE_SECRET` |

### Fluxo completo

```text
Loja envia "oi" via WhatsApp
  ↓ webhook identifica telefone em telefones_lojas
  ↓ contato marcado como tipo "loja"
  ↓ bot-lojas é acionado (não ai-triage)
  ↓ bot envia menu de opções
  ↓ loja responde "1" (link pagamento)
  ↓ bot pergunta valor → descrição → parcelas → cliente → confirma
  ↓ bot chama payment-links no Optical Business
  ↓ recebe URL do link
  ↓ envia link na conversa
  ↓ cria solicitação tipo "link_pagamento" no pipeline Financeiro
  ↓ todas as mensagens ficam registradas no atendimento
```

