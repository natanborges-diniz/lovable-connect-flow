# Pix automático (cob dinâmica BTG via Optical Business)

Fluxo fechado de cobrança Pix espelhando o link de pagamento cartão: a loja solicita no Messenger, o cliente paga pelo QR/copia-e-cola e a confirmação volta automaticamente para a loja — sem intervenção do Financeiro (substitui, para novos casos, o fluxo manual de "Confirmação PIX").

## Fluxo

1. **Loja solicita** — wizard do Messenger (`LojaNovaDemanda.tsx`), fluxo `pix_pagamento` (bot_fluxos): valor, descricao, cliente (opcional), cliente_whatsapp (opcional).
2. **Geração** — `criar-solicitacao-loja` branch `acao.endpoint === "pix-charges"` → `POST ${OPTICAL_BUSINESS_URL}/functions/v1/pix-charges` (`x-service-key`). OB cria cob dinâmica no BTG (expiração 24h) e devolve `{ id, txid, pix_copia_cola, qr_code_base64, url_pagamento, expira_em }`. `qr_code_base64` vai só na resposta ao app (não persiste em metadata).
3. **Entrega** — Messenger mostra QR + copia-e-cola (copiar/compartilhar); cliente recebe template WhatsApp `pix_pagamento_cliente` (alias → `pix_pagamento_cliente_v1`, UTILITY, params: protocolo, valor, link). Falha de template não bloqueia o fluxo (`cliente_envio_status`).
4. **Card** — solicitação `tipo='pix_pagamento'` na coluna **"Pix Enviado"** (Financeiro), espelho em `pagamentos_link` com `metodo='pix'`, `txid`, `pix_copia_cola`, `expira_at`. Sem notificações ao setor (fluxo 100% automático, igual link_pagamento).
5. **Confirmação** — BTG → OB → `payment-webhook` com `{ payment_link_id, metodo:'pix', status:'PAGO', txid, end_to_end_id, pagador_nome, pagador_documento, valor, dateTime }`. Card vai para **"Pix Pago"** (fallback "Link Pago" se a coluna não existir), solicitação `concluida`, `pagamentos_link.status='pago'`. `EXPIRADO`/`CANCELADO` → "Cancelado".
6. **Picote Pix** — comprovante com **TXID em destaque** (baixa no sistema), E2E, pagador, data/hora, entregue via `notificacoes` + `solicitacao_comentarios` + `demandas_loja`/`demanda_mensagens` (mesmo mecanismo do cartão).

## Decisões

- **Mesma tabela** `pagamentos_link` para cartão e Pix, discriminada por `metodo` ('cartao' default | 'pix'). `payment_link_id` continua sendo a chave universal (para Pix, é o `id` da cobrança no OB).
- **Lookup do webhook endurecido**: busca direta por `metadata->>payment_link_id` (via `.eq`) com fallback no scan legado das 100 últimas — corrige a fragilidade antiga para os dois métodos.
- Colunas novas do pipeline Financeiro: "Pix Enviado" e "Pix Pago" (terminais, auto-arquiváveis).
- Eventos CRM: `pix_pagamento_solicitado` (automático via sufixo), `pix_pagamento_enviado_cliente` / `pix_pagamento_envio_falhou`, `pagamento_confirmado`.

## Lado OB (tica-diniz-insights) — implementado (ver docs/ob-pix-charges-contrato.md)

- `pix-charges` (reusa `payment_links` com `adquirente='PIX_BTG'`), confirmação via `btg-webhook` (instant-collections) + poll 30min + verificação on-demand na página `/pix/:id`, notificação ao `payment-webhook` com retry/auditoria `cf_notify`.

## Pendências externas

- BTG: reautorizar empresas (novos escopos instant-collections), habilitar eventos `instant-collections.*` no painel; confirmar contrato do endpoint na 1ª chamada real.
- Meta: aprovar template `pix_pagamento_cliente_v1`.
- ai-triage: a detecção de comprovante por print (`PAYMENT_TEMPLATE_RE`) cobre só templates `link_pagamento*`; com confirmação automática o print perde importância para Pix, mas se desejado basta incluir `pix_pagamento` no regex.

## Arquivos

- `supabase/migrations/20260730170000_pix_automatico_btg.sql`
- `supabase/functions/criar-solicitacao-loja/index.ts` (branch pix-charges)
- `supabase/functions/payment-webhook/index.ts` (suporte metodo pix)
- desktop-joy-app: `src/pages/LojaNovaDemanda.tsx` (bloco de resultado Pix)
