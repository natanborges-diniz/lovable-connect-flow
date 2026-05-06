# Rastreabilidade de pagamentos via link WhatsApp

## Diagnóstico atual

Cada link de pagamento hoje vive como uma `solicitacoes` com `tipo='link_pagamento'` e tudo de útil (TID, NSU, valor, parcelas, last4, autorização, status, cod_empresa, alias_loja, cliente, link, `comprovante_recebido_at`) fica embutido em `metadata` jsonb. Para MVP funcionou, mas:

- Não dá para filtrar/agrupar por loja, status, valor ou período sem fazer parsing de JSON.
- Sem vínculo formal com `contatos.id` — cliente é texto solto (`metadata.cliente`, `metadata.cliente_whatsapp`), então pós-venda (recompra, garantia, jornada) não consegue achar o contato.
- Sem histórico de transição (criado→enviado→pago→estornado), só o estado final.
- Imagem do comprovante já é detectada (regra `comprovante_recebido_at`), mas não fica anexada formalmente à transação.
- Não existe tela dedicada de "fluxo de pagamentos"; mistura tudo no Pipeline Financeiro.

## Proposta — 3 camadas

### 1. Tabela `pagamentos_link` (rastreabilidade dura)

Tabela normalizada, com vínculo lógico para `contatos`, `solicitacoes` e `atendimentos`. `solicitacoes tipo='link_pagamento'` continua existindo (compatibilidade com payment-webhook e UI atual), mas a fonte de verdade financeira passa a ser essa nova tabela.

Colunas principais:
- `id uuid pk`
- `payment_link_id text unique` — chave do sistema externo (Optical Business)
- `solicitacao_id uuid` — link com o ticket existente
- `contato_id uuid` — vínculo com `contatos`, populado por upsert no telefone
- `atendimento_id uuid` — chat onde o link foi enviado
- `loja_nome text`, `cod_empresa text`, `alias_loja text`
- `cliente_nome text`, `cliente_telefone text`
- `valor numeric(10,2)`, `parcelas int`, `descricao text`
- `status text` — `criado | enviado | visualizado | pago | estornado | expirado | falha_envio`
- `tid text`, `nsu text`, `authorization text`, `last4 text`, `bandeira text`
- `link_url text`
- `enviado_at`, `pago_at`, `comprovante_recebido_at`, `expirado_at`
- `comprovante_anexo_id uuid` — FK para `solicitacao_anexos`
- `metadata jsonb` (extras)
- `created_at`, `updated_at`

Tabela de auditoria `pagamentos_link_eventos (pagamento_id, status_anterior, status_novo, payload jsonb, created_at)` alimentada por trigger.

Índices: `(loja_nome, status)`, `(contato_id)`, `(pago_at)`, `(cliente_telefone)`.

### 2. Backfill + ganchos automáticos

- **Backfill:** popular `pagamentos_link` a partir das `solicitacoes tipo='link_pagamento'` existentes (preserva os 4 cards atuais) + resolver `contato_id` por telefone.
- **`payment-webhook`** passa a fazer upsert em `pagamentos_link` (mantém o update na `solicitacoes` por compatibilidade). Cada mudança de status grava em `pagamentos_link_eventos`.
- **`criar-solicitacao-loja`** (origem do link) cria o registro com `status='criado'` ou `'enviado'`.
- **`ai-triage`** (já tem o short-circuit de comprovante) passa a anexar a imagem em `solicitacao_anexos` e a atualizar `pagamentos_link.comprovante_recebido_at` + `comprovante_anexo_id`.
- **Resolver contato:** ao registrar pagamento, faz `upsert contatos by telefone` e grava `contato_id`. Isso é o que destrava o pós-venda futuro.

### 3. Visualização e preparação para pós-venda

**a) Tela "Pagamentos" no Financeiro** (`/financeiro/pagamentos`)
- Lista tabular filtrável: loja, status, período, valor, busca por cliente/telefone/TID/NSU.
- KPIs no topo: total enviado, total pago, ticket médio, conversão (pagos / enviados), pendentes >24h.
- Drawer de detalhe com timeline (criado→enviado→pago), comprovante anexo, link p/ atendimento e contato no CRM.
- Export CSV.

**b) Aba "Pagamentos" no detalhe do contato (CRM)**
Histórico financeiro do cliente: quanto pagou, quando, em qual loja, ticket médio. Base para LTV, segmentação e qualquer ação de pós-venda.

**c) Preparação para pós-venda (estrutura sem disparo)**
- Trigger em `pagamentos_link.status='pago'` insere `eventos_crm` `pagamento_confirmado` no contato — já alimenta a timeline.
- Tag automática `tipo_cliente='comprador'` no contato após 1º pagamento confirmado — habilita segmentação futura.
- **Não cria** crons D+7/D+30/D+180 nem NPS agora; a tabela e os eventos já ficam prontos para que isso seja plugado depois sem schema novo.

## Escopo desta entrega

1. Migração: `pagamentos_link` + `pagamentos_link_eventos` + trigger de histórico + trigger `eventos_crm pagamento_confirmado` + backfill dos 4 registros existentes (com resolução de `contato_id`).
2. Atualizar `payment-webhook`, `criar-solicitacao-loja`, `ai-triage` para popular a nova tabela (mantendo compat com `solicitacoes`).
3. Tela `/financeiro/pagamentos` (lista + filtros + drawer + KPIs + export CSV).
4. Aba "Pagamentos" no detalhe do contato no CRM.
5. Tag automática `comprador` no contato após 1º pagamento.
6. Memória `mem://financeiro/rastreabilidade-pagamentos-link`.

## Fora de escopo (futuro)

- NPS, pesquisa de satisfação.
- Cron de pós-venda D+7/D+30/D+180 e cadências de recompra (estrutura fica pronta, disparo fica desligado).
- Mudanças no contrato com Optical Business (continua mandando o mesmo payload).
- Conciliação contábil/repasse de bandeira.
- Remoção das `solicitacoes tipo='link_pagamento'` (continua como ticket, espelho da transação).
