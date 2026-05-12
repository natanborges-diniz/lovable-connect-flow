---
name: Receita Digitada por Texto (Primeira ou Correção)
description: Aceita receita digitada como PRIMEIRA leitura (quando IA pediu por texto após OCR falhar) ou como correção; entende pl/plano/neutro=0 (inclusive na validação anti-hallucination); bypassa loop_escalation; correções de ALTO IMPACTO exigem confirmação explícita antes de cotar/escalar
type: feature
---

# Receita por Texto — Primeira leitura OU correção (ai-triage)

## Modos
1. **First** (`source=client_typed_first`): IA pediu valores por texto (OCR falhou) e cliente respondeu. Detector roda mesmo sem receita prévia desde que regex em `recentOutbound[-2]` case com `MSG_PEDIR_RECEITA_TEXTO`.
2. **Correction** (`source=client_correction`): já existe receita salva, cliente envia novos valores → merge parcial.

## Parser por bloco de olho + validação anti-fantasma (Mai/2026)
- Pre-normalização remove asteriscos de markdown (`*OD*`, `*CIL`).
- Texto é dividido em blocos por olho (`/\b(od|oe|os)\b([\s\S]*?)(?=…)/`). Em cada bloco extraímos `axis`/`add` por palavra-chave (e removemos do bloco), e os 2 primeiros números restantes viram `sphere` e `cylinder`. Elimina dependência de `com/x//` e ignora rótulos `esf`/`cil`/`*`/`:`.
- **Validação anti-hallucination:** todo número que sobreviver é checado contra os números presentes no texto-fonte original (Math.abs com 2 casas). Se não bater, o campo é **descartado** (`null`) — log `[RX-VALIDATE] descartando {campo}…`.
- **Caso Thais (Nov/2026):** `OD: Esférico Plano / -2,5 cil / 05 eixo` foi descartado porque `sphere=0` (vindo de "Plano") não estava em `sourceNumbers` (haystack construído do texto cru, sem normalizar keywords). Corrigido aplicando as MESMAS substituições `pl|plano|neutro|zerado|zero|sc` → `0` ao construir `rawNorm` antes de extrair `sourceNumbers`. Agora receita puramente astigmática (esférico zero + cilindro) passa pela validação.
- Caso Franciana (Mai/2026): `*OD*: ESF -13,50 *CIL -0,50` antes não capturava `-0,50` porque o regex Pattern A não tolerava a palavra `cil` entre os números → cilindro antigo (`-0,80` do OCR) sobrevivia ao merge. Parser por bloco corrige.

## Convenções parseadas
- `pl`, `plano`, `neutro`, `zerado`, `zero` → `0`. `sc` removido. (Aplicado tanto no parser quanto no haystack de validação.)
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

## Escalada após 2 falhas de confirmação (Mai/2026)

Quando `metadata.receita_confirmacao.correction_count >= 2` no ramo de **rejeição** (`detectRxRejeicao`) — i.e. cliente disse "Não" 2x seguidas — IA admite dificuldade de leitura e escala:

- `MSG_ESCALADA_RECEITA_LEITURA` ("Desculpa, tô com dificuldade…") dentro do expediente; `mensagemEscaladaForaHorario` fora.
- `atendimentos.modo = "humano"`, `metadata.revisao_humana_pendente=true` com motivo `receita_confirmacao_falhou_2x`.
- `receita_confirmacao.pending=false` (consultor assume) + `escalado_humano_at`.
- Evento `receita_escalada_apos_2_rejeicoes`.
- Retorna `precisa_humano: true`, `pipeline_coluna_sugerida: "Aguardando Humano"`.

No ramo de **correção textual de alto impacto** (~3424), threshold é `correction_count >= 3` (1ª correção é estado normal; só a partir da 3ª textual em sequência sem confirmação intermediária é loop). Mesma mensagem e mesma flag, evento com `via: "correcao_textual"`.

Contador zera em `detectRxConfirmation` (gate ~2256) — confirmação bem-sucedida limpa também o histórico de falhas.


## Tom para grau elevado
Substituído "grau alto / sob encomenda" por "lente especial / lente personalizada" nas mensagens visíveis ao cliente:
- `MSG_ESCALADA_GRAU_FORA_FAIXA`: "Por ser uma *lente especial*, vou te conectar com um Consultor…".
- Fallback `consultar_lentes` quando rxType=unknown / esfera absurda: "Pra montar o orçamento certinho dessa *lente personalizada*…".

## Casos
- **Jardel (25/04)**: shorthand "-400" — corrigido no parser.
- **Bianca (28/04)**: `Od -4.50 / Oe -pl` digitada como 1ª leitura — modo "first" implementado.
- **Manel (Mai/2026)**: cliente corrigiu OE de -1.00 para -14.50 (Δ=13.5) — antes a IA pulava direto para escala humana sem confirmar; agora dispara confirmação determinística antes de qualquer cotação/escalada.
- **Thais (Nov/2026)**: receita puramente astigmática (`Esférico Plano / -2,5 cil / 05 eixo`) — antes o anti-hallucination descartava `sphere=0` por "Plano" não ser número no texto cru, e o parser retornava `null`. Agora `rawNorm` aplica as mesmas normalizações de keyword e a receita passa.
