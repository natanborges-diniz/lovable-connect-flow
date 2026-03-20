

## Plano: Migrar webhook para API oficial do WhatsApp (Meta Cloud API)

### O que muda

O webhook atual aceita payloads de Evolution API e Z-API. Vamos adaptá-lo para o formato oficial da Meta, que exige:

1. **Verificação GET** — A Meta envia um GET com `hub.verify_token` para validar o endpoint. O webhook precisa responder com `hub.challenge`.
2. **Formato POST diferente** — O payload da Meta vem em `entry[].changes[].value.messages[]` com estrutura própria.
3. **Envio de mensagens** — Para responder, usa-se `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages` com token de acesso.

### Arquivos afetados

| Arquivo | Alteração |
|---|---|
| `supabase/functions/whatsapp-webhook/index.ts` | Reescrever para suportar verificação GET + payload oficial da Meta (manter compatibilidade com Evolution/Z-API como fallback) |
| `src/pages/Configuracoes.tsx` | Adicionar campos para configurar `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID`; atualizar instruções |

### Detalhes técnicos

**Webhook (Edge Function):**
- `GET`: Validar `hub.verify_token` e retornar `hub.challenge`
- `POST`: Parsear `entry[].changes[].value.messages[]`, extrair `from`, `text.body`, `id`
- Manter o fallback para Evolution/Z-API no `normalizeWebhookPayload`
- Adicionar função para envio de respostas via Graph API (para uso futuro)

**Secrets necessários:**
- `WHATSAPP_VERIFY_TOKEN` — token arbitrário para verificação do webhook
- `WHATSAPP_ACCESS_TOKEN` — token permanente da Meta
- `WHATSAPP_PHONE_NUMBER_ID` — ID do número no Meta Business

**Configurações (Frontend):**
- Atualizar instruções na seção WhatsApp com passos para configurar no Meta Business Manager
- Exibir URL do webhook para colar no painel da Meta

