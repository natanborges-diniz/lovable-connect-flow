---
name: Fonte do Lead (Site/Instagram)
description: Webhook classifica origem do lead (site/instagram) na 1ª inbound; gravado em contatos.metadata.fonte_lead; dashboard mostra KPIs + donut + timeline
type: feature
---

## Detecção
`whatsapp-webhook` aplica regex na 1ª inbound de contatos `tipo='cliente'` sem `metadata.fonte_lead`:

- `/Acessei o site/i` → `fonte_lead = "site"` (ex.: "Acessei o site www.dinizosasco.com.br...")
- `/(no|pelo)\s+Instagram|vi\s+voc[êe]s?\s+no\s+Insta/i` → `fonte_lead = "instagram"`
- caso contrário → não grava (mantém `null`, considerado "outro" na UI).

Persiste `metadata.fonte_lead`, `fonte_lead_at`, `fonte_lead_mensagem` (snippet 280 chars). Idempotente.

## Visualização
Card "Origem dos Leads" no Dashboard (`src/components/dashboard/FonteLeadsCard.tsx`), hook `useFonteLeads(periodo)`. Filtro 7d/30d/90d/Tudo. KPIs Site/Instagram/Outro + donut + LineChart leads/dia.

Sem quebra por loja — central de captação é única para toda a rede.

## Backfill
Migration de dados (insert) varreu `mensagens(direcao='inbound')` pegando 1ª por `atendimentos.contato_id` e classificando. Marcado com `metadata.fonte_lead_backfill=true`.
