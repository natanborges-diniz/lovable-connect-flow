---
name: Catálogo central de templates WhatsApp Meta
description: Catálogo local em `whatsapp_templates` + `template_aliases`; gate em send-whatsapp-template bloqueia disparos quando status != approved; aliases permitem repointar UTILITY/MARKETING sem redeploy
type: feature
---

## Catálogo central de templates WhatsApp

### Tabela `whatsapp_templates`
Catálogo local sincronizado com a Meta. Campos: nome (único), categoria (UTILITY/MARKETING/AUTHENTICATION), idioma, body, variaveis (jsonb), status (rascunho/pending/approved/rejected), motivo_rejeicao, funcao_alvo, ultima_sincronizacao, **descontinuado** (boolean — esconde da UI sem perder histórico).

### Categorias e custo Meta
- **UTILITY** ≈ 5–10× mais barato que MARKETING. Use para: confirmação/lembrete de agendamento, recibo de pagamento, retomada de tópico que o cliente já estava conversando, status de operação em curso.
- **MARKETING** premium. Use APENAS para campanhas, ofertas, anúncio de novo número, reativação fria sem contexto prévio.
- **AUTHENTICATION** OTPs (não usado no projeto hoje).
- Regra: template novo nasce UTILITY, salvo se for promoção pura.

### Tabela `template_aliases` (alias lógico → nome real)
Permite trocar a versão usada (ex.: MARKETING aprovado hoje → UTILITY aprovado amanhã) sem redeploy. Crons chamam `send-whatsapp-template` com `template_alias` em vez de `template_name`; a EF resolve o alias antes do gate de aprovação.

Aliases ativos (abr/2026):
- `link_pagamento_cliente` → `link_pagamento_cliente_v3` (UTILITY aprovado — usado por `criar-solicitacao-loja`)
- `noshow_reagendamento` → `noshow_reagendamento` (MARKETING — `_v2` UTILITY rejeitado)
- `retomada_contexto_1` → `retomada_contexto_1` (MARKETING)
- `retomada_contexto_2` → `retomada_contexto_2_v3` (MARKETING aprovado, texto refeito)
- `retomada_despedida`  → `retomada_despedida_v3` (MARKETING aprovado, texto refeito)

**Regra de ouro**: TODA edge function que dispara template proativo DEVE usar `template_alias`, nunca `template_name`. Isso permite repontar versões via UI sem redeploy.

UI em **Configurações > Templates WhatsApp > Aliases lógicos**: dropdown por alias listando templates aprovados compatíveis. Mudança é instantânea (próximo disparo já usa).

### Templates padrão

**UTILITY (transacional)**
- `confirmacao_agendamento` (approved) → agendamentos-cron
- `lembrete_agendamento` (approved) → agendamentos-cron
- `link_pagamento_cliente` (rascunho) → criar-solicitacao-loja
- `noshow_reagendamento_v2` (rascunho — UTILITY) → agendamentos-cron via alias
- `retomada_contexto_1_v2` (rascunho — UTILITY) → vendas-recuperacao-cron via alias
- `retomada_contexto_2_v2` (rascunho — UTILITY) → vendas-recuperacao-cron via alias
- `retomada_despedida_v2` (rascunho — UTILITY) → vendas-recuperacao-cron via alias

**MARKETING (legítimos)**
- `aviso_novo_numero_v3` (pending) → comunicacao-cron
- `diniz_comvocacao_agradecimento`, `diniz_vendas_comvocao` (approved) → campanhas

**Descontinuados (escondidos na UI)**
- `despedida_cordial_v2` (rejected) — substituído por `retomada_despedida`

### Gate de envio
`send-whatsapp-template` aceita `template_alias` (resolve via `template_aliases`) ou `template_name` direto. Faz lookup em `whatsapp_templates.nome`:
- status != 'approved' → 409 `blocked_template_not_approved` + evento `template_pendente`
- não existe no catálogo → passa direto (compat legado)

### Fluxo do operador para criar nova versão UTILITY
1. Configurações > Templates WhatsApp > "Novo Template" com `_v2` no nome e categoria UTILITY (ou copiar body do MARKETING existente)
2. **Submeter** → Meta analisa em 1–24h
3. Quando `approved`, abrir seção **Aliases lógicos** e trocar o alias para apontar ao `_v2`
4. Próximo disparo já usa UTILITY (≈ 5–10× mais barato)
5. Marcar o template MARKETING antigo como `descontinuado=true` se quiser sumir da listagem
