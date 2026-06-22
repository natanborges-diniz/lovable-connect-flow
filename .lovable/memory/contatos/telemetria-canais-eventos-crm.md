---
name: Telemetria de efetividade do contato em canais + eventos_crm
description: Toda interação WhatsApp (enviado/entregue/lido/respondido/falhou/pessoa_errada/validado) atualiza contadores e status na tabela canais e loga evento em eventos_crm via RPC canal_registrar_evento. Sem tabelas novas.
type: feature
---

## Modelo

A tabela `canais` (já existente, 1 linha por identificador WhatsApp do contato) é a **fonte de verdade** do status do telefone. Ganhou:

- `status` text default `'nao_validado'` (`nao_validado | validado | pessoa_errada | invalido | sem_resposta`).
- `validado_at`, `canal_consentimento`, `termos_versao`.
- `ultimo_motivo_falha` (`numero_invalido | entrega_falhou | sem_leitura | lido_sem_resposta | pessoa_errada`), `ultima_falha_at`.
- Contadores: `tentativas_enviadas`, `tentativas_entregues`, `tentativas_lidas`, `tentativas_respondidas`.

A trilha por evento vive em `eventos_crm.tipo` com prefixo `contato_*`: `contato_enviado`, `contato_entregue`, `contato_lido`, `contato_respondido`, `contato_falhou`, `contato_pessoa_errada`, `contato_validado`, `contato_sem_resposta`.

## RPC `canal_registrar_evento(_telefone, _evento, _motivo, _canal_consentimento, _termos_versao)`

SECURITY DEFINER. Localiza contato por telefone (testa com e sem prefixo `55`), garante linha em `canais`, incrementa contador apropriado, atualiza `status`/`ultimo_motivo_falha` quando aplicável e grava em `eventos_crm`.

Eventos suportados: `enviado`, `entregue`, `lido`, `respondido`, `falhou`, `pessoa_errada`, `validado`.

## Quem chama

| Evento | Chamador | Quando |
|---|---|---|
| `enviado` | `send-whatsapp-template` (e futuramente `send-whatsapp`) | Após Meta API responder 200 |
| `entregue` / `lido` / `falhou` | `whatsapp-webhook` ramo `statuses` | Callback Meta `entry[].changes[].value.statuses[]` |
| `respondido` | `whatsapp-webhook` (linha 0z) | Toda mensagem inbound |
| `pessoa_errada` | `whatsapp-webhook` (linha 0y) | Botão `nao_fui_eu` OU texto "NÃO FUI EU" — retorna imediatamente, não cai no fluxo IA |
| `validado` | `cashback-loja` action `confirmar_pin` OU botão `sim_sou_eu` no webhook | PIN ok ou cliente clicou "Sim, sou eu" |

## Ramo `statuses` no webhook

`whatsapp-webhook/index.ts` (logo após `const body = await req.json()`) inspeciona `body.entry[].changes[].value.statuses`. Mapeia:
- `sent` → `enviado`
- `delivered` → `entregue`
- `read` → `lido`
- `failed` → `falhou`, motivo `numero_invalido` se err code ∈ {131026, 131051}, senão `entrega_falhou`.

Também atualiza `mensagens.metadata.last_status` quando consegue casar pelo `whatsapp_message_id`. Se o payload **só** tinha statuses (sem messages), retorna sem cair no resto do webhook.

## O que NÃO criamos

- ❌ Tabela `contato_interacoes` — `eventos_crm` cumpre.
- ❌ Tabela `contato_telefone_status` — `canais` cumpre.
- ❌ Edge function `marcar-contato-falha` — webhook + RPC cobrem todos os caminhos.
