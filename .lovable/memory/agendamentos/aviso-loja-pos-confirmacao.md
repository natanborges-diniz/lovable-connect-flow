---
name: Aviso à loja após confirmação de agendamento
description: Após cliente confirmar agendamento (status=confirmado via whatsapp-webhook ou ai-triage dia-D), a EF notificar-loja-agendamento envia notificação in-app + push pelo Atrium Messenger aos usuários da loja, com nome do cliente, data/hora e resumo do atendimento. Idempotente via metadata.aviso_loja_enviado_at; se loja sem destinatários, cria tarefa para supervisor.
type: feature
---

## Fluxo

1. Cliente responde "sim/ok/confirmado/beleza" ao lembrete OU IA detecta confirmação dia-D.
2. `whatsapp-webhook` (linha ~485) ou `ai-triage` (linha ~3362) marca `agendamentos.status = 'confirmado'`.
3. Imediatamente após o UPDATE, a função invoca `notificar-loja-agendamento` em background (fetch sem await).
4. A EF resolve destinatários via `resolver_destinatarios_loja(loja_nome)`, busca/gera resumo do atendimento (`summarize-atendimento` audience=interno, com cache de 6h em `atendimentos.metadata.resumo_ia`), monta título/mensagem e insere uma `notificacoes` por usuário.
5. O trigger `trg_push_nova_notificacao` dispara push FCM/APNs e badge in-app no Atrium Messenger.

## Conteúdo da notificação

- Título: `📅 Agendamento confirmado — {nome do cliente}`
- Mensagem: nome, loja, data/hora formatada PT-BR, telefone, resumo do atendimento.
- Tipo: `agendamento_confirmado_loja`
- referencia_id: id do agendamento

## Idempotência

- Lê `agendamentos.metadata.aviso_loja_enviado_at` antes de enviar; se existe, retorna `{skipped:true}`.
- Após sucesso, grava `aviso_loja_enviado_at` + `aviso_loja_destinatarios` (count) no metadata.
- Insere evento `aviso_loja_agendamento` em `eventos_crm`.

## Loja sem destinatários

Se `resolver_destinatarios_loja` retorna vazio:
- Cria `tarefas` (prioridade alta) para supervisor configurar usuários da loja.
- Insere evento `aviso_loja_sem_destinatario` no CRM.
- Marca `aviso_loja_enviado_at` mesmo assim com `aviso_loja_status: "sem_destinatario"` para não repetir tarefa.

## Por que NÃO via WhatsApp template

Regra "Canal Único": comunicação B2B com lojas/colaboradores acontece exclusivamente pelo App Atrium Messenger (mensagens_internas + notificacoes + push). WhatsApp Meta é reservado a clientes finais.
