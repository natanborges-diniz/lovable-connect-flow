# Ajustes Financeiro: notificações, sininho e Confirmação PIX

Três correções no setor Financeiro. Tratativas com lojas via app InFoco Messenger continuam como estão.

## 1. Silenciar notificações do fluxo de link de pagamento

O fluxo `link_pagamento` é 100% automático: card aparece, muda de coluna sozinho via `payment-webhook`, picote vai pra loja pelo Messenger. Notificações no sininho só geram ruído.

**O que muda:**
- `criar-solicitacao-loja/index.ts` — quando `tipoSolicitacao === "link_pagamento"`, **não** insere em `notificacoes`. Card continua sendo criado.
- `payment-webhook/index.ts` — quando status vira `PAGO`, **não** insere notificação `comprovante_pagamento`. Movimentação automática do card, comentário "picote" no ticket e evento em `eventos_crm` continuam.

**Não muda:** boleto, consulta CPF, estorno, reembolso e demais fluxos seguem notificando.

## 2. Sininho de notificações sem scroll

Hoje o `ScrollArea` em `TopNavigation.tsx` usa `max-h-80` sem altura efetiva no viewport — operador só lê o que aparece na tela.

**O que muda:**
- `src/components/layout/TopNavigation.tsx` — trocar `max-h-80` por `h-96` no `ScrollArea` (ativa o scroll do Radix); alargar popover de `w-80` → `w-96`.
- `src/hooks/useNotificacoes.ts` — subir `limit(50)` → `limit(200)` para o backlog atual ficar acessível.

## 3. Fluxo Confirmação PIX completo

Hoje o card cai em "Confirmação PIX" e o dialog genérico não tem ação.

### Novas colunas (migração)

Duas colunas no setor Financeiro, logo após "Confirmação PIX":

- **PIX Confirmado** — terminal feliz; card encerra.
- **PIX Não Confirmado** — terminal de pendência; card encerra, mas continua disponível para a loja reabrir.

### Ações no card (operador financeiro)

Novo `src/components/financeiro/ConfirmarPixDialog.tsx`. Aberto quando o card está em "Confirmação PIX" **ou** "PIX Não Confirmado":

- **Confirmar PIX** — move para "PIX Confirmado", grava `metadata.pix_confirmado_at` + `pix_confirmado_por`, marca `solicitacoes.status = 'concluida'`. Envia retorno automático à loja no app (via `solicitacao_comentarios` `tipo='retorno_setor'` + `notificacoes` resolvidas por `resolver_destinatarios_loja(loja_nome)` — mesmo trilho do retorno CPF). Mensagem: *"PIX confirmado e compensado. Pode liberar a venda."*
- **Não confirmar PIX** — sem campo de motivo. Move para "PIX Não Confirmado", grava `metadata.pix_nao_confirmado_at`, marca `status = 'concluida'`, envia ao app: *"A confirmação de PIX solicitada ainda não foi compensada no banco. Peça nova conferência em alguns instantes."*

Em "PIX Confirmado", botão **Reverter para Não Confirmado** para correção manual.

### Reabertura pela loja

Quando o card está em **PIX Não Confirmado**, a loja vê na thread da demanda no app Messenger o botão **"Pedir nova conferência"**. Ao clicar:

- O **mesmo card** volta para "Confirmação PIX".
- `solicitacoes.status` volta para `em_atendimento`.
- Comentário automático na thread: *"Loja pediu nova conferência em {timestamp}."*
- Linha em `pipeline_card_eventos` (tipo `reabertura_loja`).
- Notifica o setor Financeiro (notificação útil aqui — é reabertura manual).

**Implementação:** novo edge function `reabrir-confirmacao-pix` (`{ solicitacao_id }`), valida tipo `confirmacao_pix` e coluna "PIX Não Confirmado", então move e registra evento. O botão na UI da loja vive no app Messenger (projeto cross `2d68a67b-…`) — entrego o EF pronto e marco em nota o que falta no app consumir.

### Roteamento no `PipelineFinanceiro.tsx`

Quando `selectedSolicitacao.tipo === "confirmacao_pix"` ou `pipeline_coluna_id` ∈ {Confirmação PIX, PIX Confirmado, PIX Não Confirmado}, abrir `ConfirmarPixDialog` em vez do dialog genérico. Mostra anexos do comprovante, valor, loja e botões contextuais por estágio.

## Detalhes técnicos

- Migração: 2 inserts em `pipeline_colunas` (setor Financeiro) reorganizando `ordem` para encaixar logo após "Confirmação PIX".
- Retorno à loja usa o trilho de `mem://financeiro/retorno-setor-via-app` — sem WhatsApp Meta.
- Push do app dispara automaticamente pelo trigger `trg_push_nova_notificacao` existente.
- Sem mudanças em `dispatch-push` nem nos demais pipelines.

Confirma para eu começar?
