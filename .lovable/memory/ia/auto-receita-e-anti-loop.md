---
name: Auto-OCR + Anti-Loop + Fluxo Pós-Receita
description: Image+quote intent triggers automatic interpretar_receita; loop detector forces tool execution or escalates; post-receita flow forces consultar_lentes → opções → região → agendamento
type: feature
---

# Auto-OCR, Anti-Loop e Fluxo Pós-Receita (ai-triage)

## Auto-disparo de `interpretar_receita`
Quando há imagem inbound recente sem receita salva e o cliente sinaliza intenção de orçamento (palavras-chave: "orçamento", "preço", "valor", "lentes compatíveis", "opções"), o `ai-triage` injeta hint de sistema obrigando o uso de `interpretar_receita` antes de qualquer pergunta. Não é mais permitido perguntar "quer que eu analise?" — a IA analisa direto.

## Auto-chain pós-OCR (DEFAULT ON para óculos)
Quando `interpretar_receita` retorna receita válida em contexto de óculos, `ai-triage` encadeia `consultar_lentes` no MESMO turno por padrão. Único skip: cliente sinalizou explicitamente outra intenção (`explicitOptOut`: "só queria que você guardasse a receita", "depois te falo", "só uma dúvida", "não quero orçamento").

Antes (até 2026-04-27): exigia keyword `or[cç]amento|preço|valor|opções`. Casos André + Paulo Henrique: cliente mandou só foto sem texto explícito → IA salvou receita e disse "vou separar opções" mas gastou turno extra perguntando região, abrindo brecha pra escalada injustificada no turno seguinte.

## Pós-leitura — fluxo obrigatório
Quando `hasValidReceitas` (receita salva é válida), o `ai-triage` injeta hint determinístico forçando os 4 passos:
1. `consultar_lentes` AGORA com os valores da receita mais recente
2. Apresentar 2-3 opções (DNZ entrada / DMAX custo-benefício / HOYA premium) com valores retornados
3. Perguntar região/bairro do cliente
4. Sugerir agendamento na loja mais próxima

**PROIBIDO:** "posso te mostrar uma base?", "quer que eu mostre opções?", confirmação genérica. Confirmação só se confiança baixa (mostrar "OD X,XX / OE Y,YY, confere?"). Repetir confirmação 2× = loop = escalada.

**PROIBIDO ESCALAR (NOVO):** "vou encaminhar para um Consultor", "para esse grau específico vou passar para alguém da equipe", "um Consultor pode detalhar melhor" — receita com esférico até ±10 e cilíndrico até ±4 é trivial e tem orçamento automático. Escalar só se: (a) `consultar_lentes` retornou ZERO opções, (b) cliente pediu humano explicitamente, (c) reclamação grave.

Reforço em `ia_regras_proibidas` (categoria comportamento) + exemplo modelo em `ia_exemplos` (categoria pos_receita_fluxo).

## `detectForcedToolIntent` — região após orçamento prometido
Se a última saída da IA pediu região/bairro (`/regi[aã]o|bairro|cidade|cep|onde voc[eê]/`) E há receita válida E o inbound atual parece resposta de região (CEP, cidade conhecida, "Centro"/"Vila X"/"Jardim Y", ou texto curto sem verbo), retorna `{ tool: "consultar_lentes" }`. Garante que "Osasco centro", "Vila Yara", etc. não caiam em "responder genérico" e disparem o orçamento de fato.

## Loop detector (pré-LLM)
Função `detectLoop(recentOutbound)` roda **antes** do LLM e antes do guardrail de similaridade. Se 2 das últimas 3 mensagens outbound têm >70% de similaridade:
- Se há intent claro do cliente (orçamento/agendar) → injeta hint forçando a tool correspondente.
- Se não há intent claro → escala imediatamente para humano (`modo='humano'`), envia mensagem discreta e loga `loop_ia_escalado` em `eventos_crm`.

## Forced intent → tool
Mapeamento determinístico:
- "orçamento" + receita salva → `consultar_lentes`
- "orçamento" + imagem pendente → `interpretar_receita`
- "agendar" / "marcar" → `agendar_visita`
- região (CEP/cidade) + receita salva + IA pediu região no turno anterior → `consultar_lentes`

## Watchdog (cron 2 min)
`watchdog-loop-ia` verifica atendimentos `modo='ia'` cuja última mensagem é outbound de IA há >5min, com inbound prévio e similaridade >70% entre últimas 2 outbound. Ação: muda para `modo='humano'`, loga `loop_ia_escalado_watchdog` e cria notificação.

## Casos documentados

### Rosana (2026-04)
Cliente enviou receita; IA interpretou ("boa parte"), mas travou em "posso te mostrar uma base e confirmar na loja?" e repetiu 2× → escalou para humano. Causa raiz: faltava hint pós-receita forçando `consultar_lentes`. Corrigido com bloco `receitas.length > 0` no `ai-triage` + regra proibida + exemplo modelo.

### André (2026-04-27)
Cliente envia receita + texto neutro; auto-chain não disparou (regex `wantsQuote` exigia keyword explícita), IA só anunciou "vou separar opções". Corrigido: auto-chain default ON pós-OCR válido em óculos.

### Paulo Henrique (2026-04-27)
Receita válida (-2.00 / -2.50). IA leu, perguntou região; cliente disse "Osasco centro"; IA escalou ("vou encaminhar para um Consultor que pode detalhar"). Causa raiz dupla: (a) auto-chain não disparou no turno da receita, (b) hint pós-receita não proibia escalonamento explicitamente. Corrigido: auto-chain default ON + nova detecção de "região após orçamento prometido" em `detectForcedToolIntent` + hint pós-receita reforçado contra escalonamento + nova regra proibida.

## Salvaguardas
- Watchdog ignora outbounds humanas.
- Loop detector só age com ≥3 outbound recentes.
- Eventos detalhados em `eventos_crm` para auditoria.
