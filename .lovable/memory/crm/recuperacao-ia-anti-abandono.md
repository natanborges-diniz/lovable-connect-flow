---
name: Recuperação IA anti-abandono — cadência rápida
description: vendas-recuperacao-cron monitora inatividade no CRM. Cadência atual 1h → 24h → despedida 1h depois → Perdidos. Sem 3ª tentativa.
type: feature
---

# Recuperação anti-abandono (CRM Vendas)

`vendas-recuperacao-cron` varre periodicamente cards do CRM em colunas elegíveis (Novo Contato, Lead, Orçamento, Qualificado, Retorno) e dispara retomadas contextuais quando o cliente para de responder.

## Cadência (atualizada)

| Fase | Quando | Ação |
|---|---|---|
| 1ª retomada | **1h** sem resposta do cliente | IA dispara retomada via `responder-solicitacao` (modo recuperacao) |
| 2ª retomada | **24h** após a 1ª (sem resposta) | IA dispara retomada com tom mais direto (`is_final=true`) |
| Despedida final | **1h** após a 2ª (sem resposta) | Mensagem fixa de agradecimento + encerra atendimento + move para Perdidos |

Total: ~26h do silêncio até Perdidos. Não há 3ª tentativa de IA.

## Mensagem fixa de despedida

> "Olá {primeiro_nome}! 😊 Agradeço muito o seu contato com as Óticas Diniz Osasco. Não quero te incomodar, então vou encerrar nossa conversa por aqui. Qualquer dúvida que surgir — sobre lentes, armações, agendamento ou orçamento — é só me chamar de volta, estou à disposição. Tenha um ótimo dia! ✨"

- Enviada via `send-whatsapp` (Evolution, mantém continuidade do canal — não usa template Meta).
- Remetente: "Gael".
- NÃO passa pela IA — é texto fixo determinístico para garantir tom de encerramento educado.
- Registra evento `lead_despedida_final` em `eventos_crm` com a mensagem.

## Defaults no código (`vendas-recuperacao-cron/index.ts`)

```ts
DELAY_HOURS = [1, 24]            // 1ª e 2ª tentativa
FINAL_WAIT_HOURS = 1             // despedida 1h após 2ª
MAX_TENTATIVAS = 2               // só 2 retomadas IA
```

Todos overridáveis via payload do cron em **Configurações → Agendamentos Automáticos**.

## Modo humano/híbrido
Pulado: cron não dispara IA nesses modos, apenas gera notificação de inatividade após threshold (default 48h, "Reclamações" 24h).

## Histórico
- Antes: 48h → 72h → 72h → espera 72h → Perdidos (~192h+).
- Agora: 1h → 24h → 1h despedida → Perdidos (~26h). Tom final positivo abre porta para retorno espontâneo.
