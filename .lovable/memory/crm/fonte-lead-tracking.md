---
name: Fonte do Lead — cascata + retorno + validação de nome
description: Webhook classifica origem em site/instagram/retorno/organico (nunca null); marca precisa_confirmar_nome para nomes genéricos; registra retomada_espontanea após 14d
type: feature
---

## Cascata de classificação (whatsapp-webhook, 1ª inbound do contato cliente)
1. Texto contém "Acessei o site" → `site`
2. Texto contém "no Instagram" / "vi vocês no Insta" → `instagram`
3. ciclo_funil≥2 OU ≥1 atendimento encerrado anterior OU tag `comprador`/`lead-recuperado` OU contato existia há ≥7d → `retorno`
4. fallback → `organico`

Persiste sempre em `contatos.metadata.fonte_lead` (nunca null para clientes). Detalhes em `fonte_lead_detalhe`.

## Retomada espontânea
Se `ultimo_contato_at` ≥14d, incrementa `ciclo_funil`, grava `metadata.retomada_espontanea_at` e evento `retomada_espontanea`. Idempotente em janela 24h.

## Validação telefone+nome
Webhook seta `metadata.precisa_confirmar_nome=true` quando `contatos.nome` é placeholder (telefone, "Cliente", "WhatsApp User"). `ai-triage.buildFirstContactBlock` dispara confirmação independente de `inboundCount` quando flag true. Tool `registrar_nome_cliente` zera ambos os flags (`nome_confirmado=true`, `precisa_confirmar_nome=false`).

## UI
`useFonteLeads` + `FonteLeadsCard`: 5 categorias (site, instagram, retorno, organico, desconhecido) + KPI %retorno + linhas no timeline.

## Backfill
v2 aplicado em ~147 contatos legados (`metadata.fonte_lead_backfill_v2=true`).
