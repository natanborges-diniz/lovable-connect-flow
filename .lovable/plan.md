## Diagnóstico

Consultei `pagamentos_link` (últimos 9 pagamentos confirmados):

- **0/9 transações** chegam com `brand` no payload do webhook do Infoco Optical Business.
- Só a transação de **hoje** (Luciene — DINIZ PRIMITIVA II, NSU 253990233) começou a trazer `cardBin: 650507` — sinal de que o OB passou a enviar o BIN, mas ainda **não envia a bandeira**.
- Resultado: a linha do comprovante "picote" sai como `**** 3723 — 4x` (sem "Visa"/"Mastercard"/"Elo" antes), e `metadata.brand` fica `null` em CRM, eventos e na tela `/financeiro/pagamentos`.

O `payment-webhook` confia 100% no campo `brand`/`brandName` vindo do OB. Como o OB não manda, todo registro fica sem bandeira — independente do template/cron/IA.

## O que vou fazer

Resolver a bandeira **localmente** dentro do `payment-webhook`, a partir do `cardBin` (com fallback para `last4` quando o BIN não vier). Sem depender de mudança no Infoco Optical Business.

### 1. Adicionar resolver de bandeira por BIN em `supabase/functions/payment-webhook/index.ts`

Função pequena `resolveBrandFromBin(bin: string)` com tabela curada para o mercado brasileiro:

- **Visa** — `4xxxxx`
- **Mastercard** — `51-55`, `2221-2720`
- **Elo** — faixas oficiais (`401178-401179`, `438935`, `451416`, `457393`, `457631-457632`, `504175`, `506699-506778`, `509000-509999`, `627780`, `636297`, `636368`, `650031-650033`, `650035-650051`, `650405-650439`, `650485-650538`, `650541-650598`, `650700-650718`, `650720-650727`, `650901-650920`, `651652-651679`, `655000-655019`, `655021-655058`) — cobre o BIN `650507` da transação de hoje.
- **Hipercard** — `606282`, `637095`, `637568-637599`
- **Amex** — `34`, `37`
- **Diners** — `300-305`, `36`, `38`
- **Discover** — `6011`, `65`
- **JCB** — `35`
- **Aura** — `50`

Ordem: tabela de prefixos longos primeiro (Elo/Hipercard), depois prefixos curtos (Visa/Master/Amex). Retorna `null` se nada bater.

### 2. Aplicar a bandeira derivada quando o OB não enviar

```text
const bandeiraResolvida = brand || brandName || resolveBrandFromBin(cardBin);
```

E usar `bandeiraResolvida` em:
- `updatedMeta.brand`
- `pagamentos_link.metadata.brand` (espelho)
- `eventos_crm.metadata.brand`
- `cartaoLinha` do comprovante "picote" enviado via Atrium

Carimbar também `metadata.brand_origem` = `"webhook"` ou `"derivado_bin"` para auditoria.

### 3. Backfill leve dos 9 pagamentos sem bandeira

Migration única que percorre `pagamentos_link` onde `metadata->>'brand' IS NULL` e `metadata->>'card_bin' IS NOT NULL`, aplica a mesma tabela de BIN via função SQL `infer_brand_from_bin(text)` e atualiza `metadata`. As 8 transações antigas (sem BIN) ficam como estão — não temos como inferir sem dado.

### 4. Atualizar memória `mem://financeiro/rastreabilidade-pagamentos-link`

Anotar que a bandeira é derivada do BIN dentro do webhook quando o OB não envia, e que o comprovante "picote" usa esse valor derivado.

## Detalhes técnicos

```text
supabase/functions/payment-webhook/index.ts
├── + resolveBrandFromBin(bin)            // tabela de prefixos BR
├── ~ const bandeira = brand || brandName || resolveBrandFromBin(cardBin)
├── ~ updatedMeta.brand_origem            // "webhook" | "derivado_bin" | null
└── ~ cartaoLinha = [bandeira, kindLabel] // já existe, passa a ter valor

supabase/migrations/<ts>_backfill_brand_pagamentos_link.sql
└── função SQL infer_brand_from_bin(text) + UPDATE pontual

mem://financeiro/rastreabilidade-pagamentos-link.md
└── nota sobre derivação por BIN
```

Sem mexer em frontend, IA, prompts, ou no OB. Risco baixo: a função só preenche um campo hoje sempre vazio.

## Validação após deploy

1. Reenvio o último payload confirmado via `supabase--curl_edge_functions` para o `payment-webhook` (idempotente — mesmo `payment_link_id`) e confirmo que `pagamentos_link.metadata.brand = 'Elo'` e `brand_origem = 'derivado_bin'`.
2. Confiro o comprovante gerado em `solicitacao_comentarios` da Luciene — deve aparecer `Elo Crédito **** 3723 — 4x`.
3. Conto quantos registros foram corrigidos pelo backfill (esperado: 1 — só o da Luciene tem BIN).
