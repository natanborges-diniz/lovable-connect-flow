---
name: Lentes de Contato — Orçamento e Combo
description: Catálogo pricing_lentes_contato + tool consultar_lentes_contato. Pós-receita LC = fluxo obrigatório (tool LC→2-3 opções variadas→região→agendar). Esporte = dica consultiva. Combo 3+1. Tórica obrigatória se cyl≥0.75. Prioriza DNZ.
type: feature
---

## Tabela
`pricing_lentes_contato`: fornecedor, produto, descarte (diario|quinzenal|mensal|anual), unidades_por_caixa, dias_por_unidade, sphere/cylinder min/max, is_toric, is_dnz, combo_3mais1, price_brl, priority.

## Tool: consultar_lentes_contato
Filtra por sphere/cylinder da receita (`metadata.receitas[ultimo]`). Se `|cyl| ≥ 0.75` em qualquer olho ⇒ força `is_toric=true` (sob encomenda). Ordena por `is_dnz desc, priority asc, price asc`.

## Fluxo obrigatório pós-receita LC (igual a óculos)
Hint determinístico em `ai-triage`:
- `detectPendingIntent` + `detectForcedToolIntent` detectam contexto LC (palavras: "lente de contato", "LC", "diária/quinzenal/mensal", "tórica", "esporte/academia/corrida/futebol/natação/treino").
- `isLCContextGlobal` é calculado uma vez por execução a partir das últimas 5 inbound e usado em 3 lugares:
  1. Bloco `[FLUXO PÓS-RECEITA OBRIGATÓRIO — LENTES DE CONTATO]` injetado quando `receitas.length > 0` + LC context — força `consultar_lentes_contato`, exige 2-3 opções com descartes variados, proíbe escalar para humano nesse cenário.
  2. Hint de loop / intent (`forcedIntent.tool === "consultar_lentes_contato"`) — quando há loop OU intent claro, reforça LC tool, proíbe "dois caminhos" e proíbe escalada.
  3. `deterministicIntentFallback(... hasReceitas, isLCContext)` — se cair no fallback determinístico com receita salva + LC, devolve resposta curta orientada a orçamento + região, NUNCA "posso seguir por dois caminhos".

Sequência obrigatória:
1. `consultar_lentes_contato` (NÃO `consultar_lentes`)
2. Apresentar **2-3 opções com descartes VARIADOS** — mín. 2 categorias diferentes entre diária + quinzenal + mensal
3. Perguntar região
4. Sugerir agendamento na loja mais próxima

Proibido encerrar pedindo apenas marca/tipo quando já há receita salva. Proibido escalar para humano nesse cenário (cliente com receita pedindo orçamento de LC).

## Esporte = dica consultiva, NUNCA filtro
Se cliente menciona esporte/academia/corrida/futebol/natação:
- Recomenda DIÁRIA como mais indicada (frase curta: "lente nova a cada uso, sem estojo, sem solução, zero risco com suor")
- **SEMPRE** apresenta também quinzenal/mensal — cliente decide
- Nunca remove opções por causa do uso esportivo

## Combo 3+1 (mensais/quinzenais)
- 1 unidade = 1 mês (mensal) ou 15 dias (quinzenal) por OLHO
- Mesma dioptria OD=OE: 1 caixa atende ambos → divide duração por 2
- Dioptrias diferentes: 1 caixa por olho (mín. 2 caixas)
- 3 caixas pagas + 1 grátis = 4 caixas → ~12 meses
- Diárias: combo NÃO se aplica

## Tóricas
Cilíndrico ≥ 0.75 ⇒ obrigatória. Sempre SOB ENCOMENDA — pagamento confirma o pedido.

## Receita ilegível / baixa confiança
Se `confidence < 0.6` ou `needs_human_review=true` ou eyes vazios: pedir valores por texto (OD esf/cil + OE esf/cil) MAS já apresentar 2-3 opções genéricas do catálogo (DNZ 1 Day diária, DNZ Mensal, Biofinity) com preços base — não travar.

## Casos de regressão documentados
**Guilherme Gomes (5511992589925, 18-04-2026):** Após enviar receita (leitura parcial), IA travou em "Lentes de contato é com nosso Consultor especializado…" pedindo marca/tipo. Cliente respondeu "uso pra esporte" e ficou parado. Correção inicial: hint LC pós-receita.

**Kelly Gonçalves (abr/2026):** Mesmo após o ajuste do Guilherme, IA seguia respondendo "Recebi sua receita aqui 😊 Se você quiser, eu posso seguir por dois caminhos…" e quando cliente respondia "Lentes de contato" / "Orçamento", a IA escalava para humano ("Vou chamar alguém da equipe pra te ajudar…"). Causas residuais corrigidas:
- Bloco pós-receita global ainda forçava `consultar_lentes` (óculos), não LC.
- `forcedIntent` cobria LC mas o hint de loop e o hint de intent claro só mencionavam `consultar_lentes` e `interpretar_receita`, deixando `consultar_lentes_contato` sem reforço explícito → modelo caía em fallback genérico.
- `deterministicIntentFallback` ainda devolvia "dois caminhos" mesmo com receita salva e contexto LC.

**Artur Borges (558499498472, 24-04-2026):** Cliente pediu LC sem receita, depois enviou imagem da receita. IA respondeu 5× seguidas com "Recebi sua receita aqui 😊… dois caminhos" sem nunca chamar `interpretar_receita`. Cliente respondeu "Sim", "É uma receita", "Analise para mim" e ficou em loop. Correções:
- Removida frase "dois caminhos" hard-coded de `imageContextFallback` e do branch `receita` em `deterministicIntentFallback` — agora devolve "Recebi sua receita 👀 Já estou analisando…".
- `detectForcedToolIntent` agora dispara `interpretar_receita` quando há imagem pendente + intent de análise (`analise|leia|olha|sim|pode|é uma receita`), não só quando o cliente repete "orçamento".
- Novo guardrail antes do `sendWhatsApp`: se a resposta gerada contém "dois caminhos" E a mesma frase já está em `recentOutbound`, descarta e substitui por mensagem-ponte ("já estou analisando" / "já vou te mandar as opções") conforme contexto (imagem pendente, receita+LC, receita+óculos, sem receita).

**Artur Borges (558499498472, 24-04-2026 15:13) — REGRESSÃO da correção anterior:** Após o ajuste do "dois caminhos", a IA passou a responder "Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções certinhas, um instante…" e **parar**. A frase parecia um "aguarde", mas era o fim da execução — não havia retry nem follow-up. Cliente ficou esperando indefinidamente. Correção:
- Novo bloco **9.4 FORCED RETRY** em `ai-triage/index.ts` (logo antes do guardrail "dois caminhos"): se `isImageContext && receitas.length === 0 && interpretar_receita NÃO foi chamada neste turno`, faz uma 2ª chamada ao gateway com `tool_choice: { type: "function", function: { name: "interpretar_receita" } }` (forçado), processa o tool call inline, salva a receita em `metadata.receitas[]` e devolve resposta amigável já com OD/OE + pergunta de região (LC ou óculos conforme `isLCContextGlobal`).
- Se confiança < 0.6 ou eyes vazios → pede valores por texto em vez de salvar lixo.
- Flags: `forced_interpretar_receita_retry_ok` / `forced_interpretar_receita_low_confidence`.
- Princípio: a frase "Já estou analisando…" só pode existir se houver follow-up garantido na mesma execução.


## Regra desativada
`lentes_de_contato` em `ia_regras_proibidas` foi desativada (id 489cef81-bbc9-4d87-b1f3-0a785afcca21).
