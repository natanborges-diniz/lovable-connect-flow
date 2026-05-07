---
name: Pós-Confirmação de Receita Força Cotação
description: Após cliente confirmar receita lida via OCR, IA cota deterministicamente; se catálogo zerar, devolve estimativa SEM perguntar valores de novo e liga revisao_humana_pendente para cyl>4 / add>3.5
type: feature
---

# Pós-Confirmação de Receita — Cotação Determinística

## Caso Franciana (Mai/2026)

1. OCR leu OD ESF -1,00 CIL -5,50 EIXO 40 / OE -0,75 CIL -3,00 EIXO 145.
2. Cliente: "Sim" → gate marcou `pending=false` e disparou `runConsultarLentes`.
3. Catálogo `pricing_table_lentes` não cobre cyl=-5,50 → zero linhas → fallback `runConsultarLentesEstimativa` devolveu 3 faixas + frase final "Consegue me confirmar o cilindro e eixo de cada olho (ou enviar foto da receita)?"
4. Cliente respondeu o cilindro de novo → parser de correção interpretou como ESF → loop infinito de "confere?".

## Regra

Após `detectRxConfirmation` + `pending=false` + `!foraDaFaixa`:

1. `runConsultarLentes` é chamado direto (gate, ~linha 2305).
2. Se catálogo zera, fallback `runConsultarLentesEstimativa` é chamado com `rx_ja_confirmada: true`.
3. Com `rx_ja_confirmada=true`, a estimativa NUNCA pergunta cilindro/eixo/ADD de volta — termina com CTA de fechamento ("Posso seguir com uma dessas opções e já te indicar a loja mais próxima…").
4. Se `requerRevisaoHumanaPosOrcamento(rx).precisa` (cyl>4, add>3.5, sph 8-10), o `ai-triage` anexa `MSG_REVISAO_HUMANA_SUFIXO` à resposta E liga `atendimentos.metadata.revisao_humana_pendente=true` (com motivos), gravando evento `revisao_humana_pos_cotacao`. Consultor vê o badge e confirma/corrige sem incomodar o cliente.

## Proibições

- PROIBIDO devolver "Recebi sua receita / estou analisando" depois da confirmação (guardrail anti-loop em ~linha 4830).
- PROIBIDO repetir "Consegue me confirmar o cilindro e eixo…" / "Consegue me enviar foto da receita ou os números de ADD…" quando a receita-alvo tem `confirmed_by_client_at`.

## Arquivos

- `supabase/functions/ai-triage/index.ts`
  - Gate ~2305 (disparo determinístico)
  - Guardrail anti-analisando ~4830
  - Fallback estimativa em `runConsultarLentes` ~5444 (passa `rx_ja_confirmada` + liga revisão humana)
  - `runConsultarLentesEstimativa` ~5593 (parâmetro `rx_ja_confirmada` suprime perguntas finais)
