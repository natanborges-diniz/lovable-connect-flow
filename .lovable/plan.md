

## Plano Unificado: OpenAI Responses API + Knowledge Base

### Resumo

Duas mudanças coordenadas na mesma implementação:
1. Migrar o `ai-triage` do Lovable AI Gateway (Gemini) para a **OpenAI Responses API**
2. Criar tabela `conhecimento_ia` e injetá-la como contexto na IA
3. Card de gestão da Knowledge Base em Configurações

### Status: ✅ Implementado

---

## Plano: Bot de Autoatendimento para Lojas + Link de Pagamento

### Status: ✅ Implementado

### Componentes criados/alterados

| Componente | Status |
|---|---|
| Migração SQL (`telefones_lojas` + `bot_sessoes`) | ✅ |
| `supabase/functions/bot-lojas/index.ts` | ✅ |
| `supabase/functions/whatsapp-webhook/index.ts` (roteamento) | ✅ |
| `supabase/config.toml` | ✅ |
| `src/components/configuracoes/TelefonesLojasCard.tsx` | ✅ |
| `src/pages/Configuracoes.tsx` (integração do card) | ✅ |
| Secrets: `OPTICAL_BUSINESS_URL`, `INTERNAL_SERVICE_SECRET` | ✅ |

### Fluxo implementado

```text
Loja envia msg via WhatsApp
  ↓ webhook consulta telefones_lojas
  ↓ telefone identificado → roteia para bot-lojas (não ai-triage)
  ↓ contato.tipo atualizado para "loja"
  ↓ bot envia menu: 1️⃣ Gerar Link de Pagamento
  ↓ coleta: valor → descrição → parcelas → cliente → confirmação
  ↓ chama payment-links no Optical Business via X-Service-Key
  ↓ devolve link na conversa
  ↓ cria solicitação tipo "link_pagamento" no pipeline Financeiro
```
