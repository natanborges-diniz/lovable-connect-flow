---
name: Comprovante vs Receita — prioridade pós-link
description: Imagem inbound após template link_pagamento_* (ou solicitacao link_pagamento aberta) é tratada como comprovante — anexa ao card existente, encerra atendimento e notifica Financeiro (sem virar humano)
type: feature
---

## Regra
Se `lastIsImage` E (regex `[Template: link_pagamento*]` em `recentOutbound[-10]` OU existe `solicitacoes.tipo='link_pagamento'` últimas 24h sem `metadata.comprovante_recebido_at`) → **short-circuit** em `ai-triage`:

1. Envia ack via `ia_mensagens_fixas.comprovante_recebido_cliente` (editável; fallback hardcoded): _"Recebi seu comprovante 🙌 Já encaminhei para o Financeiro conferir. Assim que confirmar, te aviso por aqui. Obrigado!"_
2. Anexa a imagem em `solicitacao_anexos` (`tipo='comprovante_pagamento_cliente'`, `url_publica`, `mime_type`) na solicitação de link mais recente.
3. Atualiza `solicitacoes.metadata`: `comprovante_recebido_at`, `comprovante_url`, `comprovante_origem='cliente_whatsapp'`. **Não move a coluna do card de link** (continua em "Link Enviado").
4. Espelha `pagamentos_link.comprovante_recebido_at`.
5. Move o card do **CRM** (contato) para a coluna terminal **"Encerrados"** (setor_id NULL) com `metadata.encerramento_motivo='comprovante_recebido'`. Registra `pipeline_card_eventos.tipo='atendimento_encerrado'`.
6. Encerra atendimento: `status='encerrado'`, `modo='ia'` (NÃO vira humano), `metadata.encerramento_motivo='comprovante_recebido'`. Limpa `ia_lock`.
7. Notifica usuários do Financeiro via `notificacoes` (tipo `comprovante_recebido`) — push automático via trigger existente.
8. Registra `eventos_crm.comprovante_pagamento_recebido`.
9. **NÃO chama LLM nem interpretar_receita.**

## Conciliação posterior
`payment-webhook` ao receber `status=PAGO` do OB, se existir anexo `comprovante_pagamento_cliente`, carimba `solicitacoes.metadata.conciliado_com_print=true`.

## Reabertura natural
Cliente que voltar a falar reabre atendimento pelo fluxo padrão (novo inbound em contato com atendimento encerrado).

## Por quê
Comprovante do cliente é apenas registro de comprometimento — webhook do OB é a verdade financeira. Não há ação humana exigida para concluir, então não faz sentido virar atendimento humano. Quando o Financeiro mover o card de link para "Concluído", a automação `pipeline_automacoes` da coluna dispara mensagem fixa de confirmação ao cliente.

## Ponto de inserção
`supabase/functions/ai-triage/index.ts` — branch "PRIORIDADE: COMPROVANTE DE PAGAMENTO" (~linha 4157), antes do build context do LLM.
