---
name: WhatsApp Webhook — Meta Official Only
description: whatsapp-webhook aceita apenas payload Meta Cloud API. Evolution/Z-API/Generic removidos. canais.provedor e mensagens.provedor sempre meta_official.
type: feature
---

## Estado definitivo (pós ban Meta)

- `whatsapp-webhook` aceita **apenas** payload Meta Cloud API (`body.object === "whatsapp_business_account"`).
- Qualquer outro shape → log `Payload não-Meta recebido — ignorado` e resposta 200 `{status:"ignored"}` (não 4xx, evita retentativas).
- `NormalizedMessage` não tem mais `source` — webhook sempre processa como `meta_official`.
- `canais.provedor`, `mensagens.provedor`, `atendimentos.canal_provedor` → sempre gravados como `meta_official` em novos registros.
- `downloadAndStoreMedia` simplificado: só Meta Graph API (`/{media_id}` → URL temporária → download com Bearer). Branches Evolution/Z-API removidos.
- `send-whatsapp` removeu o param `force_provider` (era no-op).

## Verificação Meta (GET)

`GET /functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=<n>`
→ retorna `<n>` em texto puro com 200. Token errado → 403.

## UI

`src/pages/Atendimentos.tsx`: badge de provedor mostra "Oficial" (verde) para `meta_official` e "Legado" (cinza) para qualquer valor histórico (`evolution_api`, `z_api`). Sem rótulos ativos para os legados.

## Secrets ainda no projeto (a remover manualmente)

`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` — não são mais lidos por nenhum código de produção (`bot-lojas` legado está desativado por flag). Remover via Connectors quando conveniente.
