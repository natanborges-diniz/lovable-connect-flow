# Monitoramento de origem dos leads (Site vs Instagram)

## Objetivo
Identificar automaticamente quando um cliente abre conversa pelo **site** (`www.dinizosasco.com.br`) ou pelo **Instagram** e exibir um painel com o volume e a tendência de cada origem. Sem quebra por loja — central única.

## Detecção
No `supabase/functions/whatsapp-webhook/index.ts`, na primeira mensagem inbound de um contato `cliente`, aplicar regex sobre o texto:

- `fonte_lead = "site"` se casar `/Acessei o site/i` (com ou sem o domínio).
- `fonte_lead = "instagram"` se casar `/(no|pelo) Instagram|vi vocês no Insta/i`.
- caso contrário, `fonte_lead = "outro"`.

Persistido em `contatos.metadata.fonte_lead`, `fonte_lead_at`, `fonte_lead_mensagem` (snippet original p/ auditoria). Idempotente: nunca sobrescreve valor já existente.

Volume já presente nos últimos 180 dias: **105 mensagens "site" / 13 "Instagram"** — confirma que o padrão é estável.

## Painel "Origem dos Leads" (Dashboard)
Novo card em `src/pages/Dashboard.tsx`:

1. **KPIs** — totais Site / Instagram / Outro no período.
2. **Donut** — distribuição percentual entre as 3 origens.
3. **Linha temporal** — leads/dia por origem (Site vs Instagram), recharts `LineChart`.
4. **Filtro de período** — 7d / 30d / 90d / tudo, no padrão dos demais filtros do Dashboard.

Hook novo `src/hooks/useFonteLeads.ts` com query a `contatos` filtrando por `tipo='cliente'` + `metadata->>fonte_lead`.

## Backfill (uma vez)
Migration SQL que varre `mensagens` (`direcao='inbound'`) das primeiras mensagens de cada contato e popula `contatos.metadata.fonte_lead` retroativamente, para o painel já nascer com histórico.

## Arquivos a tocar
- `supabase/functions/whatsapp-webhook/index.ts` — detecção + gravação no `metadata`.
- Migration SQL — backfill no histórico.
- `src/hooks/useFonteLeads.ts` — novo hook.
- `src/pages/Dashboard.tsx` — novo card (KPIs + donut + linha temporal + filtro).
- `mem://index.md` + `mem://crm/fonte-lead-tracking.md` — registrar regra.

## Resultado
- Cada contato novo é classificado automaticamente como Site / Instagram / Outro.
- Dashboard mostra volume e tendência de cada canal de captação, ajudando decisões de mídia.
- Sem mudanças em fluxos da IA — apenas leitura de metadata.
