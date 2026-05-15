---
name: Retomada IA Pós-Escalada por Receita Digitada
description: Pre-router em ai-triage devolve atendimento de modo=humano para IA quando cliente digita receita por texto após escalada por OCR ilegível
type: feature
---

# Retomada IA pós-escalada por receita digitada

## Caso (Flávia, 15/05/2026)
IA falhou no OCR 2x e escalou (`modo=humano`, motivo `receita_escalada_apos_2_rejeicoes`). Cliente digitou "Esférico OD -0,50 / Esférico OE -2,50" minutos depois e ficou parado — gate `if (atendimento.modo === "humano") return skipped` silenciava IA.

## Pre-router (ai-triage, antes do gate humano ~linha 2275)

Dispara só quando TODAS as condições:
- `modo === "humano"`
- `metadata.revisao_humana_motivo` (ou item de `revisao_motivos`) ∈ whitelist:
  `receita_escalada_apos_2_rejeicoes`, `receita_texto_recusada`,
  `receita_confirmacao_falhou_2x`, `rx_ocr_falhou`, `rx_invalida`
- `!media.image_url` (texto puro)
- janela ≤ 24h desde `escalado_humano_at`
- `retomada_ia_pos_escalada_at` ≥ 10min atrás (idempotência)
- `detectPrescriptionCorrection(mensagem)` devolve receita que passa em `isReceitaValida`
- nenhuma mensagem outbound após escalada com `remetente_nome` fora da lista de bots
  (`Assistente IA`, `Gael`, `Sistema`, `Bot Lojas`, `Recuperação`) — se humano já enviou algo, ele assumiu, não retoma.

## Ação
1. Persiste receita em `contatos.metadata.receitas[]` com `source="client_typed_first_pos_escalada"`, `confirmed_by_client_at=null`, `label="digitada após escalada"`.
2. Marca `metadata.receita_confirmacao = { pending:true, rx_index, reason:"retomada_pos_escalada", fora_da_faixa: maxAbs>10, correction_count:0 }`.
3. `atendimentos.update({ modo:"ia", status:"em_andamento", metadata:{ ...m, revisao_humana_pendente:false, revisao_humana_motivo:null, retomada_ia_pos_escalada_at, retomada_motivo:"cliente_digitou_receita" } })`.
4. Envia `buildMsgConfirmarReceita(rx, false)` determinístico ("Li sua receita assim, confere?").
5. Evento `ia_retomada_pos_escalada_receita_texto` em `eventos_crm` com receita_parsed, motivo anterior, minutos desde escalada.
6. Retorna `tools_used:["ia_retomada_pos_escalada_receita"]`, `precisa_humano:false`, `pipeline_coluna_sugerida:"Orçamento"`, `modo:"ia"`.

## Fluxo subsequente (sem alteração)
- "Sim/Confere" → gate `isReceitaPending` (~linha 2872) marca `confirmed_by_client_at` e libera LLM com `consultar_lentes`.
- Correção textual → ramo `detectPrescriptionCorrection` em modo `client_correction` com proteção de alto impacto.
- Silêncio → `watchdog-loop-ia`.
