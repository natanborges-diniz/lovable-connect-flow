---
name: Catálogo central de templates WhatsApp Meta
description: Catálogo local de templates Meta em `whatsapp_templates`; gate em send-whatsapp-template bloqueia disparos quando status != approved
type: feature
---

## Catálogo central de templates WhatsApp

### Tabela `whatsapp_templates`
Catálogo local sincronizado com a Meta. Campos: nome (único), categoria (UTILITY/MARKETING/AUTHENTICATION), idioma, body, variaveis (jsonb), status (rascunho/pending/approved/rejected), motivo_rejeicao, funcao_alvo, ultima_sincronizacao.

### Templates padrão (pré-populados como rascunho)

**UTILITY**
- `lembrete_agendamento_24h` → agendamentos-cron
- `confirmacao_agendamento` → agendamentos-cron
- `noshow_recuperacao_loja` → agendamentos-cron
- `comprovante_pagamento_loja` → payment-webhook
- `demanda_loja_nova` → criar-demanda-loja
- `demanda_loja_encerrada` → encerrar-demanda-loja

**MARKETING**
- `retomada_contexto_lead` → vendas-recuperacao-cron
- `retomada_pos_orcamento` → vendas-recuperacao-cron
- `despedida_cordial` → vendas-recuperacao-cron

### Gate de envio
A edge function `send-whatsapp-template` faz lookup em `whatsapp_templates.nome` antes de chamar a Graph API:
- Se template existe e `status != 'approved'` → retorna 409 `blocked_template_not_approved` e registra evento `template_pendente` em `eventos_crm`.
- Se template não existe no catálogo → passa direto (compat com templates legados).

Isso centraliza o gate sem precisar duplicar lógica em cada cron consumidor (vendas-recuperacao-cron, agendamentos-cron, payment-webhook, criar/encerrar-demanda-loja).

### Fluxo do operador
1. Configurações > Templates WhatsApp
2. Editar rascunhos pré-populados (revisar copy)
3. Clicar **Submeter** → status vai para `pending`, vai para análise Meta (1-24h)
4. Clicar **Sincronizar com Meta** → atualiza status local com base em `manage-whatsapp-templates action=list`
5. Templates `approved` desbloqueiam disparos automáticos automaticamente
