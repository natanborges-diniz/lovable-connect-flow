

## Objetivo
Criar e submeter para aprovação na Meta os **templates WhatsApp** indispensáveis para retomar a operação (proativos + B2B lojas) usando o número oficial. Sem templates aprovados, todos os crons ficam pausados e a operação trava fora da janela 24h.

## Inventário de templates necessários (mapeado dos crons/EFs)

### Categoria UTILITY (lembretes, confirmações, status)
1. **lembrete_agendamento_24h** — `agendamentos-cron`
   Body: "Olá {{1}}! Lembrete: você tem horário marcado em {{2}} no dia {{3}} às {{4}}. Posso confirmar sua presença?"
2. **confirmacao_agendamento** — `agendamentos-cron` (criação)
   Body: "Oi {{1}}! Seu horário em {{2}} foi agendado para {{3}} às {{4}}. Endereço: {{5}}."
3. **noshow_recuperacao_loja** — `agendamentos-cron` (3h após horário)
   Body: "Cliente {{1}} (agend. {{2}}) não compareceu até agora. Pode confirmar status com a loja {{3}}?"
4. **comprovante_pagamento_loja** — `payment-webhook`
   Body: "Pagamento confirmado! Cliente: {{1}} | Valor: R$ {{2}} | NSU: {{3}} | Loja: {{4}}"
5. **demanda_loja_nova** — `criar-demanda-loja`
   Body: "Nova demanda {{1}} para loja {{2}}: {{3}}. Responda esta mensagem para tratar."
6. **demanda_loja_encerrada** — `encerrar-demanda-loja`
   Body: "Demanda {{1}} encerrada. Resumo: {{2}}"

### Categoria MARKETING (recuperação proativa CRM)
7. **retomada_contexto_lead** — `vendas-recuperacao-cron`
   Body: "Oi {{1}}! Tudo bem? Notei que conversamos sobre {{2}} e não fechamos ainda. Posso te ajudar com mais alguma informação?"
8. **retomada_pos_orcamento** — `vendas-recuperacao-cron`
   Body: "Olá {{1}}! Sobre o orçamento de {{2}} que enviamos: alguma dúvida? Posso reservar horário para você conhecer presencialmente."
9. **despedida_cordial** — `vendas-recuperacao-cron` (encerramento da cadência)
   Body: "{{1}}, vou pausar nosso atendimento por aqui. Quando precisar é só chamar! Equipe Atrium."

## Implementação

### 1. UI — `WhatsAppTemplatesCard.tsx`
A interface já existe e fala com `manage-whatsapp-templates`. Adicionar:
- **Botão "Carregar Templates Padrão"** que injeta os 9 templates acima como rascunhos (form pré-preenchido — usuário revisa antes de submeter).
- Coluna **Status Meta** com cores: PENDING (amarelo), APPROVED (verde), REJECTED (vermelho com motivo).
- **Filtro por categoria** (UTILITY / MARKETING / AUTHENTICATION).
- Ação **Submeter à Meta** chama `manage-whatsapp-templates` action `create`.
- Ação **Sincronizar Status** chama action `list` e atualiza tabela local.

### 2. Tabela `whatsapp_templates` (nova)
Persistir localmente o catálogo + status sincronizado da Meta:
```sql
CREATE TABLE whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text UNIQUE NOT NULL,         -- ex: "lembrete_agendamento_24h"
  categoria text NOT NULL,           -- UTILITY | MARKETING | AUTHENTICATION
  idioma text NOT NULL DEFAULT 'pt_BR',
  body text NOT NULL,
  variaveis jsonb DEFAULT '[]',      -- ["nome","loja","data","hora"]
  status text DEFAULT 'rascunho',    -- rascunho | pending | approved | rejected
  motivo_rejeicao text,
  funcao_alvo text,                  -- qual EF consome (vendas-recuperacao-cron, etc)
  ultima_sincronizacao timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```
RLS: admin escreve, authenticated lê.

### 3. Edge Functions — adaptar consumidores
Cada cron/EF que dispara mensagens proativas passa a:
- Consultar `whatsapp_templates` pelo `nome`.
- Se `status != 'approved'` → não dispara, registra evento `template_pendente` em `eventos_crm`.
- Se aprovado → chama `send-whatsapp-template` com nome + params.

Funções a ajustar (read-only nesta fase, edits na implementação):
- `vendas-recuperacao-cron/index.ts`
- `agendamentos-cron/index.ts`
- `payment-webhook/index.ts`
- `criar-demanda-loja/index.ts`
- `encerrar-demanda-loja/index.ts`

### 4. Reativação automática dos crons
Após aprovação Meta, sincronização atualiza `whatsapp_templates.status = approved` e o card UI mostra botão **"Reativar cron correspondente"** que faz `UPDATE cron_jobs SET ativo = true` + `schedule_cron_job(...)`.

### 5. Memória
- `mem://integracao/templates-whatsapp-catalogo.md` (nova) — lista os 9 templates, função consumidora, status esperado.
- `mem://index.md` — atualizar Core mencionando dependência template-aprovado para qualquer disparo proativo.

## Fluxo do usuário
```text
1. Configurações > WhatsApp Templates
2. Clica "Carregar Templates Padrão" → 9 rascunhos aparecem
3. Revisa cada um, clica "Submeter à Meta" → status vai para PENDING
4. Aguarda 1-24h aprovação Meta
5. Clica "Sincronizar Status" → APPROVED aparece em verde
6. Clica "Reativar cron correspondente" → operação volta gradualmente
```

## Arquivos
**Edits/Create:**
- `src/components/configuracoes/WhatsAppTemplatesCard.tsx` (rewrite com catálogo padrão + sync)
- Nova migration: `whatsapp_templates` table + RLS
- `supabase/functions/vendas-recuperacao-cron/index.ts` (gate por template aprovado)
- `supabase/functions/agendamentos-cron/index.ts` (gate por template aprovado)
- `supabase/functions/payment-webhook/index.ts` (rota via template)
- `supabase/functions/criar-demanda-loja/index.ts` (rota via template)
- `supabase/functions/encerrar-demanda-loja/index.ts` (rota via template)
- `mem://integracao/templates-whatsapp-catalogo.md` (nova)
- `mem://index.md` (Core update)

**Não incluso:** alterar layout geral de Configurações; tudo concentrado no card existente.

