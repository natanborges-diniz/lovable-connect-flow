---
name: Receita Digitada por Texto (Primeira ou Correção)
description: Aceita receita digitada como PRIMEIRA leitura (quando IA pediu por texto após OCR falhar) ou como correção; toda correção textual reenvia confirmação determinística (mesmo com valores idênticos à última leitura); entende pl/plano/neutro=0; bypassa loop_escalation
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

## Convenções parseadas
- `pl`, `plano`, `neutro`, `zerado`, `zero` → `0`. `sc` removido.
- Aceita vírgula/ponto, sinal opcional, espaço entre sinal e número (`-  425` → -4.25).
- Shorthand óptico (`-400` → -4.00).
- Esf-only é válido (cilindro/eixo permanecem null).

## Confirmação determinística OBRIGATÓRIA em TODA correção textual (Mai/2026 — caso Eduardo)

Antes, só correção de alto impacto (`Δsphere≥0.75D` ou `|sphere|≥8D`) enviava `buildMsgConfirmarReceita` deterministicamente e dava `return` antes do LLM. Correções iguais/pequenas (cliente digitando os mesmos valores) caíam no LLM com hint "vá DIRETO para consultar_lentes", e o LLM frequentemente respondia fallback genérico (caso Eduardo: "Conta pra mim com mais detalhes…"). O safety-net pós-LLM só intercepta `R$`, então a resposta ruim passava.

**Agora:** todo ramo `client_correction` (qualquer magnitude, inclusive valores idênticos à última leitura):

- Marca `metadata.receita_confirmacao = { pending:true, rx_index, asked_at, correction_count:+1, reason: isHighImpact ? "high_impact_correction" : "low_impact_correction", fora_da_faixa }`.
- Marca a receita com `confirmed_by_client_at: null`.
- Envia `sendReceitaConfirmInteractive(...)` com `buildMsgConfirmarReceita(merged, true)` e **retorna antes do LLM**.
- Limpa `ia_lock`.
- Evento `receita_corrigida_pelo_cliente` (ou `receita_corrigida_alto_impacto`) com `confirmacao_enviada:true`.

Sem confirmação implícita: mesmo que o cliente digite exatamente os mesmos valores da leitura por OCR, reenviamos a mensagem com os valores merge para o cliente confirmar antes de cotar.

O safety-net pós-LLM continua bloqueando qualquer R$ enquanto `pending=true` (ver `memoria-multiplas-receitas`).

## Escalada após 3 correções consecutivas (Mai/2026)

`metadata.receita_confirmacao.correction_count >= 3` em correção textual → IA admite dificuldade de leitura e escala:

- `MSG_ESCALADA_RECEITA_LEITURA` ("Desculpa, tô com dificuldade…") dentro do expediente; `mensagemEscaladaForaHorario` fora.
- `atendimentos.modo = "humano"`, `metadata.revisao_humana_pendente=true` com motivo `receita_confirmacao_falhou_2x`.
- `receita_confirmacao.pending=false` (consultor assume) + `escalado_humano_at`.
- Evento `receita_escalada_apos_2_rejeicoes` com `via: "correcao_textual"`.

No ramo de **rejeição** (`detectRxRejeicao` — cliente disse "Não" 2x): mesma escalada com threshold `>=2`. Contador zera em `detectRxConfirmation`.

## Tom para grau elevado
Substituído "grau alto / sob encomenda" por "lente especial / lente personalizada" nas mensagens visíveis:
- `MSG_ESCALADA_GRAU_FORA_FAIXA`: "Por ser uma *lente especial*, vou te conectar com um Consultor…".
- Fallback `consultar_lentes` quando rxType=unknown / esfera absurda: "Pra montar o orçamento certinho dessa *lente personalizada*…".

## Casos
- **Jardel (25/04)**: shorthand "-400" — corrigido no parser.
- **Bianca (28/04)**: `Od -4.50 / Oe -pl` digitada como 1ª leitura — modo "first" implementado.
- **Manel (Mai/2026)**: cliente corrigiu OE de -1.00 para -14.50 — confirmação determinística antes de cotação/escalada.
- **Thais (Nov/2026)**: receita puramente astigmática (`Esférico Plano / -2,5 cil / 05 eixo`) — `rawNorm` aplica normalizações de keyword para validação passar.
- **Natan (15/05/2026)** + monocular: receita digitada na 1ª mensagem exige rótulo `OD|OE|OS` + esfera em ≥1 olho (`hasStrongRxSignal`). Aceita monocular e só-esférica. Confirmação sempre obrigatória. `detectRxConfirmation` aceita "está certo"/"está certinho".
- **Eduardo (Mai/2026)**: clicou ✏️ Corrigir e digitou exatamente os mesmos valores do OCR. Antes IA caía no LLM e respondia fallback genérico. Agora reenvia `buildMsgConfirmarReceita` deterministicamente com os botões ✅ Tá certo / ✏️ Corrigir.
