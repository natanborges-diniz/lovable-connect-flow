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

### Franciana 2026-05-06 (forced retry pulava confirmação)
Cliente mandou nova receita; modelo não chamou `interpretar_receita` no 1º turno e caiu no FORCED RETRY (bloco 9.4). Esse ramo salvava receita mas devolvia mensagem hardcoded "Prontinho, consegui ler... Em qual região?" — pulando a confirmação dos valores que o caminho normal já fazia. **Fix:** ramo de sucesso do retry agora marca `metadata.receita_confirmacao.pending=true`, insere evento `receita_confirmacao_solicitada` (source=`ocr_forced_retry`) e usa `buildMsgConfirmarReceita(...)`. Comportamento idêntico ao caminho normal.

## 🆕 Mai/2026 — Gate de confirmação BLOQUEANTE pós-OCR (caso Franciana 2)
Toda receita lida via OCR fica com `contatos.metadata.receita_confirmacao.pending=true` (com `fora_da_faixa` calculado). Gate pré-LLM em `ai-triage`:
- **Confirmação** (`detectRxConfirmation`: sim/isso/confere/perfeito/ok…) → limpa pending. Se `fora_da_faixa` (|esf|>12, |cil|>4 ou ADD>3.5 progressivo) → escala determinística para Consultor com `MSG_ESCALADA_GRAU_FORA_FAIXA` (respeita horário humano), evento `escalada_grau_fora_faixa`. Caso contrário libera o fluxo (LLM cota normalmente).
- **Rejeição** (`detectRxRejeicao`: não/errado/errou…) → 1ª vez repete `buildMsgConfirmarReceita(rx,true)` + abre porta para correção por texto; 2ª vez manda `MSG_PEDIR_RECEITA_TEXTO`. Loga `receita_rejeitada_cliente`.
- **Outra coisa** sem ser correção válida → repete `buildMsgConfirmarReceita`. Não chama LLM.
- **Defesa em depth**: `runConsultarLentes` e `runConsultarLentesEstimativa` checam `isReceitaPending` no início e retornam `buildMsgConfirmarReceita`, logando `consultar_lentes_bloqueado_pendente_confirmacao` — garante que mesmo se LLM ignorar, nenhum preço sai.

**Caso Franciana 2 (06/05 20:27):** OCR leu OD esf -13.50 / OE esf -20.50 (extremo). `consultar_lentes` zerou, fallback estimativa zerou, IA escalou direto com "preciso que um Consultor finalize" — sem nunca pedir confirmação ao cliente. Erros de OCR para mais/para menos passavam batido. Com o gate, agora SEMPRE pergunta "Está certinho?" antes de qualquer cotação ou escalada; só após confirmação positiva escala (e com mensagem específica de grau sob encomenda).

## 🆕 Mai/2026 — Bloqueio de "grau alto" sem receita + gate vence escalada no mesmo turno (caso Franciana 3)

**Caso Franciana 3 (06/05 21:05):** cliente disse "Quero orçamento" SEM ter mandado receita. IA respondeu "Encontrei poucas opções automáticas para esse grau alto. Posso acionar um Consultor?" — alucinação total. Cliente reclamou "Mas não mandei receita ainda", mandou foto, e no turno seguinte IA escalou direto com "Para esse grau bem alto, vou acionar um Consultor para buscar opções sob encomenda" — sem pedir confirmação dos valores OCR.

**Causa raiz:**
1. Sem guardrail contra IA inventar "grau alto" sem receita interpretada.
2. Gate `receita_confirmacao.pending` só agia no **próximo** turno; no turno em que `interpretar_receita` setava pending, o LLM podia emitir `escalar_consultor` no mesmo turno e sobrescrever a confirmação.

**Correções:**
- **Helpers `escaladaGrauSemReceitaTexto` + `MSG_PEDIR_RECEITA_PARA_GRAU_ALTO`**: regex `/grau (alto|elevado|bem alto)|sob encomenda|sob medida específic|fora da faixa/i`.
- Branches `responder` e `escalar_consultor`: se `!hasReceitasValidas(receitas)` E motivo/resposta casa a regex → descarta tool, responde pedindo a receita, loga `escalada_grau_sem_receita_bloqueada`.
- **Gate pós-loop em ai-triage**: flags `rxConfirmGateTriggered` + `rxConfirmGateRx` setadas quando `interpretar_receita` marca pending. Após o loop de tools, se outras tools rodaram OU `precisa_humano=true`, FORÇA `resposta = buildMsgConfirmarReceita(...)`, zera escalada e loga `escalada_bloqueada_pendente_confirmacao`. Aplicado nos 2 caminhos (normal e forced retry).
- **Prompt** (modo restrito): adicionada proibição explícita de mencionar grau/sob encomenda/Consultor por causa do grau antes da receita ter sido interpretada.
- **`watchdog-loop-ia`**: exceção para outbounds que começam com "Li sua receita assim" / "Anotei! Ficou assim:" — repetir confirmação faz parte do fluxo, não é loop.

## 🆕 Mai/2026 — Confirmação por receita (caso 558488766851)

**Caso 558488766851 (07/05 21:38–21:48):** cliente já tinha receita 1 confirmada, mandou foto da receita 2. IA leu (`interpretar_receita`), perguntou "Uso qual receita...", cliente respondeu **"A segunda"** e IA pulou direto pra `consultar_lentes` com OD -2.5/-0.5 OE -3/-1, sem confirmar valores da segunda receita.

**Causa raiz:** `receita_confirmacao.pending` era flag global do contato. Receita 1 já estava `pending=false`, e nenhum gate re-armava pending pra receita 2 quando o cliente escolhia.

**Correções:**
- Cada receita em `metadata.receitas[]` agora carrega `confirmed_by_client_at` (null no save).
- Helper `detectEscolhaReceita`: detecta "primeira/segunda/última/nova/de agora/etc" e retorna o índice.
- **Gate 4.4a**: quando `!pending && receitas.length>=2` e cliente escolhe uma com `confirmed_by_client_at=null`, re-arma `receita_confirmacao { pending:true, rx_index }` e envia `buildMsgConfirmarReceita`.
- **Confirmação granular**: `detectRxConfirmation` agora marca `confirmed_by_client_at` da receita pelo `rx_index` (ou última como fallback).
- **Safety net pós-LLM**: antes da validação geral, se a resposta tem `R$`/preços ou tool de quote rodou, e existe alguma receita sem `confirmed_by_client_at`, sobrescreve com `buildMsgConfirmarReceita(rxAlvo)`. Evento `bloqueado_orcamento_receita_nao_confirmada`.
- **Prompt**: contexto das receitas marca `✅ confirmada` ou `⚠️ AGUARDA confirmação` por receita; instrui IA a nunca cotar receita não confirmada.

## 🆕 Mai/2026 — Nova receita após receita confirmada (caso Tati)

**Caso Tati (07/05):** cliente já tinha receita confirmada (-13,5 / -20,5), declarou "Tenho nova receita" e mandou foto. LLM viu `hasValidReceitas=true` + bloco "FLUXO PÓS-RECEITA OBRIGATÓRIO" e ficou paralisado — sem chamar tool. Caiu no fallback determinístico que respondeu "Recebi sua receita 👀… analisando" e parou. O `9.4 FORCED RETRY` estava condicionado a `!hasValidReceitas` e foi pulado.

**Correções (`ai-triage/index.ts`):**
- **Flag `hasPendingNewPrescriptionImage`**: imagem inbound mais recente que `max(receitas[].data_leitura)` OU intent declarado ("nova receita", "outra receita", "receita atualizada", etc.) com imagem nas últimas 5 inbounds. Loga `[RX-NEW-PENDING]`.
- **`isImageContext`**: passa a incluir esse flag mesmo quando `hasValidReceitas=true`.
- **Hint de prompt**: novo bloco `[SISTEMA: NOVA RECEITA PENDENTE]` substitui o `[FLUXO PÓS-RECEITA OBRIGATÓRIO]` quando aplicável — força `interpretar_receita` AGORA com a imagem nova e proíbe usar receita antiga em `consultar_lentes`.
- **Force-retry estendido** (bloco 9.4): dispara quando `hasPendingNewPrescriptionImage=true` mesmo com receita salva. Sucesso do retry faz append em `receitas[]` (FIFO 5) e marca `receita_confirmacao.pending=true` — preserva receita anterior.
- **Quote-engine bloqueia** `consultar_lentes`/`consultar_lentes_contato` quando `hasPendingNewPrescriptionImage=true`: devolve "Recebi sua nova receita 👀… lendo" e loga `quote_blocked_new_rx_pending`.

## "Recebi sua receita" só com envio real (caso Gabriely 2026-05-08)
Fallback determinístico em `deterministicIntentFallback` NÃO pode disparar a frase "Recebi sua receita 👀…" só porque o texto contém a palavra "receita" / "grau" / "oftalmologista". Cliente que diz **"perdi a receita"** ou **"preciso refazer o exame"** não enviou nada — frase falsa de recebimento gera expectativa errada.

Regra atual:
- **Dispara "Recebi sua receita"** apenas com `isImageContext=true` (ramo de imagem) OU texto explícito de envio: `enviei (minha) receita`, `te mandei`, `recebeu minha receita`, `mandei a foto`, `segue a receita`, `acabei de mandar`.
- **"Perdi / sem / refazer exame"** roteia para indicação de clínica parceira, pedindo bairro/região.
- Outras menções a "receita" sem indicador de envio caem no ramo de orçamento que pede a foto.

## 🆕 Mai/2026 — Contador `ocr_falhas_count` (anti-loop receita ilegível)

**Bug:** branches `_ocrInutil` (eyes vazios / rxType=unknown) e `forced_interpretar_receita_low_confidence` (retry forçado com confidence<0.6) sempre devolviam `MSG_PEDIR_RECEITA_TEXTO` — sem contar tentativas. Cliente reenviando fotos ruins ficava em loop infinito de "manda por texto".

**Fix:** `contatos.metadata.ocr_falhas_count` é incrementado nas duas branches; ao chegar em **2 falhas consecutivas**, IA escala pra humano (mensagem respeita `isHorarioHumano()`), com evento `ocr_falhas_escalado`. Sucesso de OCR (caminho normal e forced retry) reseta o contador para 0. Evita repetição da mesma frase em loop quando a foto está ruim/cliente insiste.

## 🆕 Mai/2026 — Failsafe pós forced retry + watchdog "analisando órfão" + escalada por recusa de digitar (caso Emerson 12/05)

**Caso Emerson (12/05/2026):** cliente mandou foto de receita, IA respondeu "Recebi sua receita 👀 Já estou analisando…" e nunca mais voltou. `interpretar_receita` não foi chamado, forced retry inline (`bloco 9.4`) também não retornou tool_call. Conversa morreu até `vendas-recuperacao-cron` disparar `retomada_contexto_1` 1h depois.

**3 correções:**

1. **`ai-triage` failsafe pós forced retry** (após bloco 9.4): se `resposta` ainda casa `MSG_ANALISANDO_RE` depois do retry, substitui por `MSG_PEDIR_RECEITA_TEXTO`, incrementa `ocr_falhas_count` e grava `receita_ocr_failsafe_pedido_texto`. Em 2 falhas, escala humano com flag `force_interpretar_failsafe_escalado_humano`.

2. **`watchdog-inbound-orfao` passo 2 — "analisando" órfão**: além do passo legado (re-disparar ai-triage em silent drop de inbound), agora varre atendimentos `modo=ia` cuja **última** mensagem é OUTBOUND batendo `MSG_ANALISANDO_RE`, idade 2-30min, sem evento posterior de `receita_interpretada` / `receita_confirmacao_solicitada` / `receita_ocr_failsafe_pedido_texto` / `receita_texto_recusada_escalado_humano`. Anti-duplo via `metadata.analisando_orfao_last_at` (~7.5min). Envia `MSG_PEDIR_RECEITA_TEXTO` direto via `send-whatsapp` e incrementa `ocr_falhas_count`. Em ≥2 falhas, escala humano com motivo `ocr_orfao_2_falhas`. Eventos `receita_ocr_orfao_pedido_texto` / `ocr_orfao_escalado_humano`.

3. **`ai-triage` detector "não consigo digitar"** (gate ~2502, antes do gate 4.4): quando última outbound foi `MSG_PEDIR_RECEITA_TEXTO` e cliente responde regex tipo `não consigo/sei digitar|tô sem receita aqui|não entendo|me ajuda` (e não é nova imagem), escala direto pra humano com mensagem amigável (ou `mensagemEscaladaForaHorario` fora do expediente). Marca `revisao_humana_motivo=receita_texto_recusada` e grava `receita_texto_recusada_escalado_humano`. Early return — não passa pelo LLM.
