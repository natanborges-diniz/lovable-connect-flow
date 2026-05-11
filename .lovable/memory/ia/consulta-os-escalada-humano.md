---
name: Triagem de Consulta de OS — escalada direta para humano
description: Pergunta sobre status do pedido/OS/óculos pronto sempre escala para humano, IA NUNCA pede receita nem oferece orçamento nesse intent
type: feature
---

# Triagem de Consulta de OS

## Regra

Quando o cliente pergunta sobre **status do pedido**, **OS**, **se o óculos está pronto**, **previsão de retirada** ou **onde está o pedido**, o `ai-triage` detecta o intent `consulta_os` **antes do LLM** e:

1. Envia mensagem fixa `os_escalada` (editável em `ia_mensagens_fixas`) pedindo nº da OS ou nome completo
2. Marca atendimento como `modo='humano'`
3. Move card para coluna **"Consulta de OS"** no setor Atendimento Corporativo (`32cbd99c-4b20-4c8b-b7b2-901904d0aff6`)
4. Loga `eventos_crm.tipo='consulta_os'` com a mensagem original
5. Dispara `summarize-atendimento` (via `handleNonClientEscalation`)

A IA **NUNCA** chega ao LLM nesse caso — bloqueia automaticamente pedido de receita, foto, grau, ADD, CIL ou orçamento. Reforço também via `ia_regras_proibidas` (categoria `comportamento`) e 3 exemplos em `ia_exemplos` categoria `consulta_os`.

## Detector (em `ai-triage` ~linha 439)

Função `matchesConsultaOs(msg, keywords)` combina **regex núcleo (codadas)** + **keywords editáveis**:

- 8 regex em `OS_INTENT_CORE_REGEX` cobrem paráfrases: "OS 12345", "quanto tempo fica pronto", "meu pedido está pronto/atrasado/aguardando", "ia/vou retirar", "fiz pedido online esperando", "tô esperando meu pedido", "pedido atrasado/não chegou", "cadê meu pedido/óculos".
- Lista substrings em `configuracoes_ia.os_intent_keywords` (cache 60s) — auditoria adiciona variações sem redeploy.

Roda em **TODOS os modos** (ia/hibrido/humano/ponte):
- `ia`/`hibrido`: escalação completa (mensagem fixa `os_escalada` + move card + evento + `modo=humano`).
- `humano`/`ponte`: apenas seta `metadata.intent_consulta_os_at` + grava `eventos_crm` (sem auto-mensagem — operador já está respondendo).

## Hard guards contra "voltar a pedir receita"

Quando `metadata.intent_consulta_os_at` foi setado nos últimos 30min (`isConsultaOsActive`), bloqueia 3 caminhos que ainda forçavam fluxo de receita:

1. Hint `[PRIORIDADE MÁXIMA — RECEITA PENDENTE]` no prompt
2. Hint `[NOVA RECEITA PENDENTE]` no prompt
3. Retry forçado `precisaForcarInterpretacao` (re-chama `interpretar_receita`)

Resultado: mesmo se o cliente enviar uma foto junto da pergunta sobre OS, a IA não cai em receita.

## Por que sem integração com ERP nesta fase

- Resolve imediatamente IA confundindo consulta com orçamento (incidente reportado)
- Zero dependência externa
- Humano consulta status no ERP da loja e responde via Atrium
- Endpoint `os-status-public` do Infoco OB (Firebird Bridge) está pronto e pode ser plugado depois como tool `consultar_status_os` sem desfazer este fluxo

## Bypass

`isHibrido=true` ignora o router (operador já está no comando).
