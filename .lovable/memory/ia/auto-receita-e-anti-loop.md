---
name: Auto-OCR + Anti-Loop + Fluxo Pós-Receita
description: Image+quote intent triggers automatic interpretar_receita; loop detector forces tool execution or escalates; post-receita flow forces consultar_lentes → opções → região → agendamento; templates de tools NUNCA contêm escalada hardcoded; referência a opção FORÇA tool_choice=responder; template é gap-aware (esconde premium >2× se houver salto)
type: feature
---

# Auto-OCR, Anti-Loop e Fluxo Pós-Receita (ai-triage)

## Auto-disparo de `interpretar_receita`
Quando há imagem inbound recente sem receita salva e o cliente sinaliza intenção de orçamento, `ai-triage` injeta hint obrigando `interpretar_receita` antes de qualquer pergunta.

## Auto-chain pós-OCR (DEFAULT ON para óculos)
Quando `interpretar_receita` retorna receita válida em contexto de óculos, encadeia `consultar_lentes` no MESMO turno. Único skip: `explicitOptOut` ("só queria que você guardasse", "depois te falo", etc.).

## Pós-leitura — fluxo obrigatório
4 passos: 1) `consultar_lentes` AGORA, 2) apresentar 2-3 opções (DNZ/DMAX/HOYA), 3) perguntar região, 4) sugerir agendamento.

**PROIBIDO ESCALAR:** receita com esférico até ±10 e cilíndrico até ±4 é trivial. Escalar só se: (a) `consultar_lentes` retornou ZERO opções, (b) cliente pediu humano, (c) reclamação grave.

## ⚠️ Templates de tool NUNCA contêm escalada hardcoded
**Lição Paulo Henrique 2ª rodada (2026-04-27 16:48):** mesmo com hint pós-receita reforçado, a IA continuou dizendo "vou encaminhar pra um Consultor" porque a string estava **dentro do template de `runConsultarLentes`** (linha 3859). Hint do prompt não vence texto fixo de tool. Regra: nenhum template de resposta de tool pode conter "Consultor", "vou encaminhar", "passar para alguém da equipe". Se quiser orientar à loja, use frase como "Posso te indicar a loja mais próxima pra você ver pessoalmente?".

Pontos corrigidos no `ai-triage`:
- **Linha 3859** (template de orçamento entregue): trocado por "Posso te indicar a loja mais próxima pra você ver pessoalmente e fechar a melhor opção? Em qual região/bairro você está?"
- **Linha 3840** (fallback "zero opções"): trocado por "Pra esses graus específicos preciso confirmar disponibilidade na loja antes de te passar o valor exato. Em qual região/bairro você está?" — mantém engajamento sem escalar.
- **Linha 1300** (instrução do prompt MODO RESTRITO): removida a sugestão "Vou encaminhar para um Consultor" do system prompt. Substituída por "peça mais detalhes OU sugira agendamento na loja mais próxima".

## Referência a opções de orçamento anterior
Caso "Quero orçamento da 1 e 2 por favor" (Paulo Henrique 16:49): cliente referencia opções do orçamento que o operador (humano OU IA) já enviou. Detector novo (`/\b(op[cç][aã]o\s*\d|da\s*\d(\s*[ee]\s*\d)?|n[uú]mero\s*\d|a\s+\d(\s*[ee]\s*\d)?\b)/i` + outbound recente com R$/marca conhecida) injeta hint forçando recapitulação SOMENTE das opções pedidas, sem rodar `consultar_lentes` de novo (que pode trazer outras opções, como aconteceu com Eyezen/Zeiss em vez de DNZ/DMAX/HOYA).

## VALIDATOR_FAILED_POOL — escala em 1 fallback
**Lição Paulo Henrique 16:53:** "Me explica melhor a sua necessidade..." disparou 3× em loop quando o cliente bateu "Ol" 3×. `pickFallback` agora retorna `null` (escalada) já no SEGUNDO fallback consecutivo (antes permitia 5 antes de escalar).

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

## Casos documentados

### Rosana (2026-04)
Travou em "posso te mostrar uma base?" 2× → escalou. Causa: faltava hint pós-receita. Corrigido.

### André (2026-04-27)
Auto-chain não disparou (regex `wantsQuote` exigia keyword explícita). Corrigido: auto-chain default ON.

### Paulo Henrique 1ª rodada (2026-04-27 15:54-15:58)
IA leu receita, perguntou região; cliente disse "Osasco centro"; IA escalou. Causa dupla: auto-chain não disparou + hint não proibia escalonamento. Corrigido: auto-chain default ON + detecção de "região após orçamento prometido" + hint reforçado.

### Paulo Henrique 2ª rodada (2026-04-27 16:48-16:53)
Operador mandou orçamento manual (DNZ/DMAX/HOYA). IA disse "vou separar as opções" sem rodar tool. Cliente: "Quero orçamento da 1 e 2" → IA escalou ("vou encaminhar para Consultor"). Cliente: "Ol" 3× → IA mandou opções *erradas* (Eyezen/Zeiss em vez de DNZ/DMAX/HOYA) com escalada hardcoded no fim. Depois 3× "Me explica melhor...". Causa raiz: 3 textos fixos no código (template do orçamento, fallback de zero opções, instrução do prompt) ignoravam o hint "PROIBIDO escalar". Corrigido: A) template sem escalada, B) fallback orientado a loja, C) prompt sem "Consultor", E) hint para referência a opção, F) `pickFallback` escala em 1 fallback.

## Salvaguardas
- Watchdog ignora outbounds humanas.
- Loop detector só age com ≥3 outbound recentes.
- Eventos detalhados em `eventos_crm` para auditoria.

### Paulo Henrique 3ª rodada (2026-04-27 16:48-16:53) — hint REFERÊNCIA-OPÇÃO ignorado + gap de catálogo
Operador mandou às 16:48 três marcas (DNZ HDI / DMAX BlueGuard / HOYA Hi-Vision) sem valores. Cliente: "Quero orçamento da 1 e 2". Hint REFERENCIA-OPCAO foi injetado mas a IA chamou `consultar_lentes` mesmo assim — devolveu **ESSILOR Eyezen Start R$1.985 + Eyezen Boost R$2.135 + ZEISS SmartLife R$2.190**, opções que nem estavam no orçamento humano. Loop "Me explica melhor..." 3× depois.

**Causa dupla:**
1. **Hint sozinho não basta** quando há tool_choice=required — LLM ainda escolhe `consultar_lentes` porque a intent original era "orçamento". Fix: quando detector REFERENCIA-OPCAO dispara, sobrescreve `tool_choice` para `{ type: "function", function: { name: "responder" } }`. LLM fica fisicamente impedido de chamar `consultar_lentes`.
2. **Gap real no catálogo**: pra OD 0/-2 OE 0/-2.50 single_vision o catálogo tem DNZ R$520, DNZ Free Form R$690, depois pula direto pra ZEISS R$1.490+ e ESSILOR R$1.985+. Não há DMAX nem HOYA single_vision; nem fotossensível nessa faixa. Tool retornava as 3 opções (econômica/mid/premium) misturando entrada DNZ com ZEISS/ESSILOR caríssimos. Fix: template "gap-aware" — se `premium > economy * 2`, mostra só faixa de entrada (até 2× a econômica) e oferece detalhar premium sob demanda. Evita o efeito "DNZ R$520 ao lado de ZEISS R$1.949".

**Gap operacional pendente** (não corrigido em código): popular `pricing_table_lentes` com DMAX BlueGuard 1.60 single_vision, HOYA Hi-Vision LongLife 1.67, e ao menos 1 fotossensível Transitions entry. Sem isso operadores continuarão citando marcas que a tool não conhece.

**Recuperação Paulo:** atendimento `26464d89` — operador enviou DNZ HDI R$520 + DNZ Free Form R$690 + esclareceu fotossensível, marcado modo=humano. Auditoria em `eventos_crm` (`recuperacao_manual_lentes`).
