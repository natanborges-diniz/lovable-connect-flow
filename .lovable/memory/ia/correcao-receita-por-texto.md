---
name: Receita Digitada por Texto (Primeira ou Correção)
description: Aceita receita digitada como PRIMEIRA leitura (quando IA pediu por texto após OCR falhar) ou como correção; entende pl/plano/neutro=0 e esf-only; bypassa loop_escalation; correções de ALTO IMPACTO exigem confirmação explícita antes de cotar/escalar
type: feature
---

# Receita por Texto — Primeira leitura OU correção (ai-triage)

## Modos
1. **First** (`source=client_typed_first`): IA pediu valores por texto (OCR falhou) e cliente respondeu. Detector roda mesmo sem receita prévia desde que regex em `recentOutbound[-2]` case com `MSG_PEDIR_RECEITA_TEXTO`.
2. **Correction** (`source=client_correction`): já existe receita salva, cliente envia novos valores → merge parcial.

## Convenções parseadas
- `pl`, `plano`, `neutro`, `zerado`, `zero` → `0`. `sc` removido.
- Aceita vírgula/ponto, sinal opcional, espaço entre sinal e número (`-  425` → -4.25).
- Shorthand óptico (`-400` → -4.00).
- Esf-only é válido (cilindro/eixo permanecem null).

## Confirmação OBRIGATÓRIA em correção de alto impacto (Mai/2026)
Após persistir uma correção, calcula o impacto:
- `Δsphere ≥ 0.75D` em qualquer olho (vs receita anterior) **OU**
- `|sphere| ≥ 8D` em qualquer olho da nova receita.

Se qualquer condição: 
- Marca `metadata.receita_confirmacao = { pending: true, rx_index, reason: "high_impact_correction", fora_da_faixa: maxAbs>=8 }`.
- Marca a receita com `confirmed_by_client_at: null`.
- Envia `buildMsgConfirmarReceita(merged, true)` (determinístico) e **RETORNA antes do LLM**.
- Evento: `receita_corrigida_alto_impacto`.

Sem isso (apenas correção pequena): segue o fluxo, hint pós-correção força `consultar_lentes`.

O safety-net pós-LLM continua bloqueando qualquer R$ enquanto `pending=true` (ver `memoria-multiplas-receitas`).

## Tom para grau elevado
Substituído "grau alto / sob encomenda" por "lente especial / lente personalizada" nas mensagens visíveis ao cliente:
- `MSG_ESCALADA_GRAU_FORA_FAIXA`: "Por ser uma *lente especial*, vou te conectar com um Consultor…".
- Fallback `consultar_lentes` quando rxType=unknown / esfera absurda: "Pra montar o orçamento certinho dessa *lente personalizada*…".

## Casos
- **Jardel (25/04)**: shorthand "-400" — corrigido no parser.
- **Bianca (28/04)**: `Od -4.50 / Oe -pl` digitada como 1ª leitura — modo "first" implementado.
- **Manel (Mai/2026)**: cliente corrigiu OE de -1.00 para -14.50 (Δ=13.5) — antes a IA pulava direto para escala humana sem confirmar; agora dispara confirmação determinística antes de qualquer cotação/escalada.
