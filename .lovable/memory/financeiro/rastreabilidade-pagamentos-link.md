---
name: Rastreabilidade Pagamentos Link
description: Tabela pagamentos_link + eventos + tela /financeiro/pagamentos como fonte de verdade financeira dos links via WhatsApp
type: feature
---
- `pagamentos_link` (PK `payment_link_id` único) é fonte de verdade; `solicitacoes tipo='link_pagamento'` continua como ticket espelho.
- Histórico de transição em `pagamentos_link_eventos` via trigger `trg_pagamentos_link_history`.
- Trigger `trg_pagamentos_link_pago` em status='pago': insere `eventos_crm.pagamento_confirmado` + adiciona tag `comprador` no contato.
- Espelhos automáticos: `payment-webhook` (status do OB), `criar-solicitacao-loja` (criação/envio), `ai-triage` (comprovante recebido).
- Resolver `contato_id` por telefone (upsert) — destrava pós-venda futuro (LTV, recompra).
- Tela `/financeiro/pagamentos`: lista filtrável + KPIs + drawer com timeline + export CSV.
- Estrutura pronta para crons D+7/D+30/D+180 e NPS — disparo fica para depois.
- **Bandeira do cartão:** OB não envia `brand`/`brandName`, só `cardBin`. `payment-webhook` deriva via `resolveBrandFromBin(cardBin)` (tabela BR: Visa/Master/Elo/Hipercard/Amex/Diners/Discover/JCB/Aura) e carimba `metadata.brand_origem='derivado_bin'`. Função SQL espelho: `public.infer_brand_from_bin(text)` — usada para backfill e disponível para queries.
