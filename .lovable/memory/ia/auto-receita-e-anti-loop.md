---
name: Auto-OCR + Anti-Loop + Fluxo Pós-Receita
description: Image+quote intent triggers automatic interpretar_receita; loop detector forces tool execution or escalates; post-receita flow forces consultar_lentes → opções → região → agendamento; templates de tools NUNCA contêm escalada hardcoded; referência a opção FORÇA tool_choice=responder; template é gap-aware (esconde premium >2× se houver salto); 4 fases anti-loop ai-triage Mai/2026
type: feature
---

# Auto-OCR, Anti-Loop e Fluxo Pós-Receita (ai-triage)

## Auto-disparo de `interpretar_receita`
Quando há imagem inbound recente sem receita salva e o cliente sinaliza intenção de orçamento, `ai-triage` injeta hint obrigando `interpretar_receita` antes de qualquer pergunta.

## Auto-chain pós-OCR (DEFAULT ON para óculos)
Quando `interpretar_receita` retorna receita válida em contexto de óculos, encadeia `consultar_lentes` no MESMO turno. Único skip: `explicitOptOut` ("só queria que você guardasse", "depois te falo", etc.).

## Pós-leitura — fluxo obrigatório
4 passos: 1) `consultar_lentes` AGORA, 2) apresentar 2-3 opções (DNZ/DMAX/HOYA), 3) perguntar região, 4) sugerir agendamento.

**PROIBIDO ESCALAR:** receita com esférico até ±10 e cilíndrico até ±4 é trivial. Escalar só se: (a) `consultar_lentes` retornou ZERO opções E o fallback estimativa também não cobriu, (b) cliente pediu humano, (c) reclamação grave.

## OCR ilegível → pedir digitação (caso Renata 2026-04-28)
Quando OCR falha (modelo não lê valores OU `rxType=unknown` OU receita totalmente vazia), a IA NÃO pode repetir "estou analisando" nem escalar — deve pedir os valores por texto. Constante `MSG_PEDIR_RECEITA_TEXTO` em `ai-triage/index.ts` é a frase canônica (OD/OE esf/cil/eixo/add com exemplo). Aplicada em 3 pontos:
1. **Pool de imagem** (`pickFallback`): se já mandou "analisando" antes, próxima resposta = pedir texto.
2. **Auto-chain pós-OCR** (`needsHumanReview` + `rxType==="unknown"` ou sem sphere/cyl): pede texto em vez de "consegui ler boa parte".
3. **`watchdog-loop-ia`**: antes de escalar, se as 2 últimas outbound batem em `MSG_ANALISANDO_RE` e o contato não tem receita válida, manda pedido de texto via `send-whatsapp`, loga `loop_ia_resgate_pedindo_texto` e NÃO escala. Só escala se já pediu texto antes e o loop persiste.

Parser `detectPrescriptionCorrection` (memory: `ia/correcao-receita-por-texto`) aceita os valores digitados e força `consultar_lentes`.

## ⚠️ Templates de tool NUNCA contêm escalada hardcoded
**Lição Paulo Henrique 2ª rodada (2026-04-27 16:48):** mesmo com hint pós-receita reforçado, a IA continuou dizendo "vou encaminhar pra um Consultor" porque a string estava **dentro do template de `runConsultarLentes`**. Hint do prompt não vence texto fixo de tool. Regra: nenhum template de resposta de tool pode conter "Consultor", "vou encaminhar", "passar para alguém da equipe". Use frases tipo "Posso te indicar a loja mais próxima pra você ver pessoalmente?".

## Referência a opções de orçamento anterior
Detector novo (regex de "opção N", "da 1 e 2", "número N" + outbound recente com R$/marca conhecida) injeta hint forçando recapitulação SOMENTE das opções pedidas, e SOBRESCREVE `tool_choice` para `{ type: "function", function: { name: "responder" } }` — LLM fica fisicamente impedido de chamar `consultar_lentes` de novo.

## VALIDATOR_FAILED_POOL — escala em 1 fallback
`pickFallback` retorna `null` (escalada) já no SEGUNDO fallback consecutivo (antes permitia 5).

## `detectForcedToolIntent` — região após orçamento prometido
Se a última saída pediu região/bairro E há receita válida E o inbound parece resposta de região, retorna `consultar_lentes`. Garante que "Osasco centro", "Vila Yara" etc. disparem o orçamento.

## Loop detector (pré-LLM)
2 das últimas 3 outbound com >70% similaridade → injeta hint forçando tool ou escala.

## Forced intent → tool
Mapeamento determinístico:
- "orçamento" + receita → `consultar_lentes` (ou `_contato` se LC)
- "orçamento" + imagem pendente → `interpretar_receita`
- "agendar"/"marcar" → `agendar_visita`
- região + receita + IA pediu região → `consultar_lentes`
- "opção 1 e 2" + outbound recente com R$ → hint de recapitulação

## Watchdog (cron 2 min)
`watchdog-loop-ia` verifica atendimentos `modo='ia'` cuja última msg é outbound de IA há >5min, com inbound prévio e similaridade >70% entre últimas 2 outbound.

## ═══════════════════════════════════════════
## 🆕 4 FASES anti-loop ai-triage (Mai/2026 — caso Cleber 2026-05-06)
## ═══════════════════════════════════════════

### Fase 1 — Logar zero-linhas
`runConsultarLentes` e `runConsultarLentesEstimativa` aceitam `atendimentoId` e gravam `eventos_crm` tipo `consultar_lentes_zero_resultados` com filtros completos (`tool`, `rx_type`, `sphere`, `cylinder`, `add`, `filtro_blue`, `filtro_photo`, `preferencia_marca`, `receita_label`). Auditoria sem mudar comportamento.

### Fase 2 — Fallback automático endurecido para `consultar_lentes_estimativa`
Quando `consultar_lentes` retorna 0, `runConsultarLentes` chama `runConsultarLentesEstimativa` automaticamente, prefixando "Pra esse grau específico (com cilíndrico mais alto) confirmamos a opção exata na loja, mas já te dou uma referência de preço:". Loga `consultar_lentes_fallback_estimativa_acionado`.

**Guardrails (G1-G4):**
- G1. Prefixo "Pra esse grau específico" já apareceu nas últimas 3 outbounds → NÃO repete.
- G2. Cliente pediu marca específica (`preferencia_marca`) → estimativa traria outras marcas e confundiria; pula.
- G3. Filtros `blue`/`photo` propagam pra estimativa.
- G4. Só roda em `single_vision` ou `progressive`.

Cada skip loga `consultar_lentes_fallback_estimativa_skip` com `metadata.motivo`. Anti-duplicação extra: se resposta final (prefixo+estimativa) tem sim>0.85 com outbound recente, cai no fallback de loja.

### Fase 3 — Re-disparar tool após resposta de região (force tool_choice)
Quando `forcedIntent.reason` contém "respondeu região" e tool é `consultar_lentes`:
- Injeta hint específico proibindo "obrigado pela região, vou separar" / "preciso confirmar na loja" / "vou verificar com um especialista".
- Ativa `forceConsultarLentesTool=true` → `tool_choice: { type:"function", function:{ name:"consultar_lentes" }}` no gateway. LLM fica fisicamente impedido de devolver texto puro.
- Zera `forceResponderTool` (preço prevalece sobre recapitulação).
- Loga `regiao_pos_orcamento_forcando_tool` em `eventos_crm`.

### Fase 4 — Anti-loop endurecido pós-LLM (Jaccard + handoff <30s)
Logo antes do `sendWhatsApp` final, calcula `computeSimilarity` (Jaccard tokens >3) entre resposta nova e última outbound. Se sim>0.80 → escala IMEDIATAMENTE pra humano (não espera watchdog 5min).

**Guardrails (G1-G5):**
- G1. Tools determinísticas chamadas (`consultar_lentes*`, `agendar_visita`, `interpretar_receita`) → pula (orçamento da mesma receita pode repetir legítimo).
- G2. Já é escalada (`precisa_humano=true` ou `escalada_fora_horario`) → pula.
- G3. `inboundCount<=1` (saudação) → pula.
- G4. Resposta ou outbound <20 chars normalizados → pula (evita falso positivo em "ok"/"beleza").
- G5. `recentOutbound` em `ai-triage` já filtra apenas IA, então comparação é IA-vs-IA.

Loga `loop_ia_pos_llm_jaccard` com `similarity`, `tools_chamadas`, `resposta_proposta`, `ultima_outbound`. Mensagem de escalada respeita horário comercial.

## Casos documentados

### Cleber 2026-05-06 (atendimento 7e7c5bf9) — gap de catálogo Hoya + zero-linhas silencioso + 2 fallbacks idênticos
Receita lida OK (OD +4.25/-1.25 Add+3, OE +5.50/-4.25 Add+3). IA prometeu "já vou separar opções", pediu região, recebeu "Osasco, Vila Ayrosa" → respondeu 3× evasivas, depois 2× "Conta pra mim..." idênticas, escalou.

**Causa raiz:** `pricing_table_lentes` não cobria a combinação extrema (esf+5.5, cil-4.25 multifocal).

**Correções aplicadas (3 + 4 fases):**
1. Reforma Hoya Abr/2025 (857 linhas Nulux iD, MyStyle, MySelf, LifeStyle 4/4i, Maxxee, Sportive, Surfaçadas + Prontas + Hoyalux D+).
2. `runConsultarLentes` zero-linhas → fallback automático para `runConsultarLentesEstimativa` com prefixo + log.
3. `pickFallback` checagem ESTRITA de identidade exata nas últimas 3 outbounds antes da similaridade.
4. **Fases 1-4 anti-loop (este documento)** — logar zero-linhas, fallback endurecido, force-tool em região, anti-loop pós-LLM com handoff <30s.

### Paulo Henrique 1ª/2ª/3ª rodadas (2026-04-27)
- 1ª: faltava hint pós-receita + detecção "região após orçamento" → corrigido.
- 2ª: 3 textos fixos no código (template orçamento, fallback zero, prompt) tinham escalada → removidos.
- 3ª: hint REFERENCIA-OPCAO ignorado pelo LLM mesmo com tool_choice=required → fix com `forceResponderTool` sobrescrevendo `tool_choice`. Catálogo gap (DMAX/HOYA single_vision pra grau baixo) ainda pendente operacionalmente.

### Rosana / André (2026-04)
Travou em "posso te mostrar uma base?" / auto-chain não disparou — ambos corrigidos com auto-chain default ON + hint reforçado.

## Salvaguardas
- Watchdog ignora outbounds humanas.
- Loop detector só age com ≥3 outbound recentes.
- Eventos detalhados em `eventos_crm` para auditoria de TODAS as fases.
