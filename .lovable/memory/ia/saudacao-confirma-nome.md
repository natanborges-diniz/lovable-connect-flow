---
name: Saudação inicial confirma/registra nome
description: Na 1ª interação, se houver senderName válido (looksLikeRealName) confirmar "Falo com X?"; senão pedir o nome. Tool registrar_nome_cliente persiste em contatos.nome + metadata.nome_confirmado=true.
type: feature
---

## Fluxo
- Webhook captura `senderName` do WhatsApp e grava `metadata.nome_perfil_whatsapp` + `nome_confirmado=false`.
- `ai-triage` carrega `contatos.nome`, `metadata.nome_perfil_whatsapp`, `metadata.nome_confirmado`.
- `buildFirstContactBlock` (inboundCount===1):
  - Se nome real disponível e não confirmado → "Olá! Falo com {primeiro_nome}? 😊"
  - Se sem nome → "Posso saber seu nome, por favor?"
- Quando o cliente confirma/informa, IA chama `registrar_nome_cliente` que faz UPDATE em `contatos.nome` + `metadata.nome_confirmado=true` + evento `nome_confirmado` em eventos_crm.

## Helper
`looksLikeRealName(senderName, phone)` no whatsapp-webhook (linha ~896): exige letras (não só dígitos), descarta nomes corporativos.
