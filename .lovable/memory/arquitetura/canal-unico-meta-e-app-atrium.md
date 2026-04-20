---
name: Canal Único — Meta Official + App Atrium Messenger
description: Modelo definitivo de canais. WhatsApp = Meta Official só para clientes finais. Lojas/colaboradores/setores via app Atrium Messenger (mensagens_internas + notificacoes + push).
type: feature
---

## Modelo Definitivo

**Dois canais únicos, separados por audiência:**

1. **WhatsApp Meta Official** — exclusivo para clientes finais.
   - `send-whatsapp` envia somente via Meta. Texto livre só dentro da janela 24h; fora exige template aprovado.
   - `whatsapp-webhook` parser Meta apenas. `canal_provedor` sempre `meta_official`.
   - Evolution API e Z-API foram descontinuados — código mantido apenas como referência histórica.

2. **App Atrium Messenger** — exclusivo para tudo que é interno/B2B.
   - Lojas, colaboradores, departamentos, setores, agendamentos internos, demandas B2B, comprovantes (picote), confirmações de comparecimento.
   - Backend grava em `mensagens_internas` (chat 1:1) + `notificacoes` (push push-friendly).
   - Trigger `trg_notificacoes_dispatch_push` chama `dispatch-push` a cada nova notificação → FCM/APNs.
   - Realtime garante entrega in-app; push é só lembrete.

## Funções consumidoras (todas roteiam internamente)

- `criar-demanda-loja`: usa `resolver_destinatarios_loja(loja_nome)` → notificacoes + mensagens_internas. Sem WhatsApp.
- `encerrar-demanda-loja`: notifica solicitante (loja/auto) ou destinatários internos (operador). Sem WhatsApp.
- `payment-webhook`: comprovante picote vai como `notificacoes` + `solicitacao_comentarios`. Sem WhatsApp.
- `agendamentos-cron` (cobranças loja): notificacoes em vez de WA. Lembretes para clientes finais ainda via WA dentro de 24h.
- `bot-lojas`: curto-circuito. Webhook inbound corporativo retorna 200 com log `bot_lojas_inbound_ignored`.

## Função SQL chave

`resolver_destinatarios_loja(_loja_nome text)` — retorna `{user_id, setor_id}` de usuários ativos vinculados ao setor da loja (via `telefones_lojas.setor_destino_id`) ou diretamente por `user_roles.loja_nome`.

## Status do `dispatch-push`

Opera em **modo log-only** enquanto FCM/APNs não estão configurados. Mensagens internas continuam funcionando 100% via Realtime; push é apenas notificação fora-do-app.

## Bot fluxos corporativos

`bot_fluxos.ativo = false` para `tipo_bot IN ('loja','departamento','colaborador')`. UI exibe badge "Desativado (substituído pelo app)".
