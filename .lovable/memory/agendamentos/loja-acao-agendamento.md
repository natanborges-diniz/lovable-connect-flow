---
name: Loja age via Atrium Messenger (compareceu / noshow / venda fechada)
description: EF loja-acao-agendamento aceita JWT do Atrium ou x-service-key vindo do proxy do InFoco Messenger. Cards de cobrança chegam como notificacoes com tipo cobranca_comparecimento_loja / _2 e botões 3-em-1.
type: feature
---

## Endpoint
POST `/functions/v1/loja-acao-agendamento` (verify_jwt=false; auth no código)
Body: `{ agendamento_id, acao: "compareceu"|"noshow"|"reverter_noshow"|"venda_fechada", valor_venda?, numero_venda?, numeros_os?, observacao?, user_email?, user_id? }`

## Autenticação (dois modos)
1. **JWT Atrium** (`Authorization: Bearer ...`) — para chamadas internas do Atrium.
2. **Service key cross-project** — header `x-service-key: INTERNAL_SERVICE_SECRET` + `body.user_email` (ou `user_id`). Usado pelo **proxy `proxy-loja-acao-agendamento` no projeto InFoco Messenger**, que valida o JWT do usuário lá, lê o email via `auth.getUser()` e repassa ao Atrium. Resolve `userId` por `profiles.email` (ilike).

Permissão sempre checada via `resolver_destinatarios_loja(loja_nome)` ou `is_admin` antes de qualquer update.

## Efeitos
- compareceu → status=compareceu, loja_confirmou_presenca=true, evento_crm `loja_confirmou_comparecimento`.
- noshow → status=no_show, evento `loja_marcou_noshow` (motivo opcional). Dispara cadência IA via trigger.
- reverter_noshow → volta para compareceu, zera tentativas_recuperacao, evento `loja_reverteu_noshow`.
- venda_fechada → status=venda_fechada + valor/numero/OS, evento `venda_fechada`.
- Marca como lidas todas notificacoes relacionadas (cobrança e avisos) deste agendamento.
- `metadata.via_service_key` registra origem.

## Arquitetura cross-project
`InFoco Messenger UI` → `useAcaoAgendamento` → `supabase.functions.invoke("proxy-loja-acao-agendamento")` (no InFoco) → `fetch` para Atrium com `x-service-key` + `user_email`. Mesmo padrão de `mem://integracao/pagamentos-cross-project`.

## Tipos de notificação que o Messenger reconhece (botões 3-em-1)
- `agendamento_novo_loja` (no momento do agendar)
- `agendamento_confirmado_loja` (no dia-D quando cliente confirma)
- `cobranca_comparecimento_loja` (1ª, 2h após o horário)
- `cobranca_comparecimento_loja_2` (2ª, 10h SP do dia seguinte)

Após 48h sem ação, agendamentos-cron cria tarefa supervisor + status=no_show.
