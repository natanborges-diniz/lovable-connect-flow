---
name: Pós-Confirmação de Receita Força Cotação
description: Após cliente confirmar receita via OCR, IA cota deterministicamente; G1 anti-loop é bypassado quando rxJaConfirmada=true; fallback final mudo SEMPRE liga revisao_humana_pendente para receita complexa
type: feature
---

# Pós-Confirmação de Receita — Cotação Determinística

## Casos Franciana (Mai/2026)

**1ª iteração:** OCR -5,50 cyl → catálogo zera → estimativa + sufixo de revisão. OK.

**2ª iteração (gap original):** cliente reenviou foto + "Sim" de novo. `runConsultarLentes` rodou, mas G1 anti-loop (`fallbackJaEnviado` detecta prefixo "Pra esse grau específico" nas últimas 3 outbounds) bloqueou estimativa → caiu no fallback final mudo "Em qual região/bairro você está?" SEM preços e SEM ligar `revisao_humana_pendente`.

## Regra

Após `detectRxConfirmation` + `pending=false` + `!foraDaFaixa`:

1. `runConsultarLentes` chamado direto (gate ~2305).
2. Se catálogo zera, fallback `runConsultarLentesEstimativa` com `rx_ja_confirmada: true`.
3. Estimativa com `rx_ja_confirmada=true` NUNCA pergunta cilindro/eixo/ADD de volta — termina com CTA de fechamento.
4. Se `requerRevisaoHumanaPosOrcamento(rx).precisa` (cyl>4, add>3.5, sph 8-10): anexa `MSG_REVISAO_HUMANA_SUFIXO` + liga `atendimentos.metadata.revisao_humana_pendente=true` + evento `revisao_humana_pos_cotacao`.

## Bypass G1 anti-loop (Mai/2026)

`rxJaConfirmada = !!rxMeta?.confirmed_by_client_at` é calculado ANTES do gate `podeFallback`. Quando `true`, `fallbackJaEnviado` é IGNORADO — a estimativa é tratada como cotação determinística obrigatória, não como repetição. Evento: `cotacao_estimativa_pos_confirmacao_bypass_g1`.

Quando o prefixo já saiu na conversa anterior, troca para variante leve: "Conforme te passei, suas opções pra esse grau:" — evita parecer cópia carbono.

## Fallback final endurecido (Mai/2026)

Antes de retornar "Em qual região/bairro você está?", se `rxJaConfirmada=true` E `requerRevisaoHumanaPosOrcamento(rxMeta).precisa`:
- Liga `revisao_humana_pendente` (idempotente — só se ainda não estiver true).
- Anexa `MSG_REVISAO_HUMANA_SUFIXO`.
- Grava evento `revisao_humana_pos_cotacao_fallback_mudo`.

Garantia: cliente com receita complexa confirmada NUNCA fica órfão sem alertar consultor.

## Proibições

- PROIBIDO "Recebi sua receita / estou analisando" depois da confirmação (~linha 4830).
- PROIBIDO repetir "Consegue me confirmar o cilindro e eixo…" / "Consegue me enviar foto da receita…" quando receita-alvo tem `confirmed_by_client_at`.

## Arquivos

- `supabase/functions/ai-triage/index.ts`
  - Gate ~2305 (disparo determinístico pós-confirmação)
  - Guardrail anti-analisando ~4830
  - `runConsultarLentes` ~5436 (bypass G1 + fallback final endurecido)
  - `runConsultarLentesEstimativa` ~5643 (parâmetro `rx_ja_confirmada` suprime perguntas finais)
