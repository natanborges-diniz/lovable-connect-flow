## Diagnóstico

O projeto **Infoco Optical Business** (`supabase/functions/payment-links/index.ts`, linhas ~370-393) já envia para o nosso `payment-webhook` do Atrium o payload completo no momento da confirmação:

```
payment_link_id, status, tid, nsu, authorization,
dateTime, date, time, valor, installments,
cardBin, last4, brand, brandName, kind,
origem_ref, origem
```

Ou seja, **bandeira (`brand`/`brandName`), autorização da adquirente (`authorization`), data/hora oficial da Rede (`dateTime`/`date`/`time`), BIN do cartão (`cardBin`) e tipo (`kind` — crédito/débito)** já chegam até nós.

No nosso `supabase/functions/payment-webhook/index.ts` hoje só consumimos:
`tid, authorization, valor, origem_ref, nsu, last4, installments, descricao, nome_cliente`.

Resultado: bandeira, kind, cardBin e dateTime oficial são descartados — não vão para `pagamentos_link`, não vão para `solicitacoes.metadata` e não aparecem no comprovante "picote" entregue à loja. O `authorization` até é lido, mas só usamos quando a Infoco envia explicitamente (estava OK).

## O que mudar (somente `supabase/functions/payment-webhook/index.ts`)

1. **Ler os novos campos** do payload:
   - `brand` / `brandName` → bandeira (Visa, Master, Elo…)
   - `cardBin` → BIN
   - `kind` → `credit` / `debit`
   - `dateTime` (ISO com offset -03:00), `date`, `time` → momento oficial da Rede
   - manter compatibilidade: se Infoco não enviar, cair no `now()` atual

2. **Espelhar em `pagamentos_link`** (upsert já existente):
   - Adicionar ao `metadata` do upsert: `brand`, `card_bin`, `kind`, `rede_datetime`, `rede_date`, `rede_time`.
   - `pago_at` passa a usar `dateTime` quando vier; senão `now()` (fallback).
   - Não precisa de migração se mantivermos tudo dentro de `metadata` (jsonb). Se quisermos colunas dedicadas (`brand`, `kind`, `card_bin`), aí sim faz migração — proponho começar só por `metadata` para destravar rápido.

3. **Espelhar em `solicitacoes.metadata`**:
   - Acrescentar `brand`, `card_bin`, `kind`, `rede_datetime` no `updatedMeta`.

4. **Comprovante "picote" (loja via app Atrium Messenger)**:
   - Linha do cartão passa de `Cartão: **** 1234 | 3x` para
     `💳 Visa Crédito **** 1234 — 3x` (quando bandeira e kind existirem).
   - Trocar `dateStr/timeStr` (que hoje usam `new Date()` local) por `date`/`time` vindos da Rede quando presentes — assim o horário no comprovante bate com o horário oficial da adquirente, não com o instante em que nosso webhook foi processado.
   - Adicionar linha `🔐 Autorização: <authorizationCode>` (já temos `authorization` mas não é exibido hoje).

5. **`eventos_crm.pagamento_confirmado.metadata`**:
   - Incluir `brand`, `kind`, `card_bin`, `rede_datetime` para auditoria e relatórios futuros.

## O que NÃO muda

- Sem alterações em `pipeline-automations`, em `pagamentos_link_eventos`, no espelho de tag `comprador`, ou no fluxo de coluna ("Link Pago" / "Cancelado").
- Sem alterações no Infoco OB — ele já envia tudo.
- Sem migração de banco nesta primeira etapa (tudo cabe em `metadata` jsonb).

## Validação

1. Disparar um pagamento de teste no Infoco OB com link originado em `ATRIUM_INFOCO`.
2. Conferir `pagamentos_link.metadata` na tela `/financeiro/pagamentos` (drawer) — deve mostrar bandeira e autorização.
3. Conferir comentário automático do "Sistema Financeiro" no card da solicitação — deve aparecer bandeira + autorização + horário Rede.
4. Conferir push/notificação para a loja com o novo formato.

## Extensão opcional (para depois, se quiser)

Promover `brand`, `kind`, `card_bin`, `authorization_code` (já existe), `rede_datetime` de `metadata` para colunas dedicadas em `pagamentos_link`, permitindo filtros/relatórios na tela `/financeiro/pagamentos` (ex.: "todas as vendas no crédito Visa do mês"). Isso requer migração simples + ajuste de `PagamentosLink.tsx`.
