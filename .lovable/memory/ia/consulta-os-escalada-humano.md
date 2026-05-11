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

## Detector (em `ai-triage` ~linha 2082)

Função `matchesConsultaOs(msg, keywords)`:
- Match exato de regex `\bos\s*[#nº]?\s*\d{3,8}\b` (ex.: "OS 12345")
- Match por keywords case/accent-insensitive carregadas de `configuracoes_ia.os_intent_keywords` (cache 60s, fallback `OS_INTENT_DEFAULT_KEYWORDS`)

Keywords padrão: "oculos pronto", "ficou pronto", "posso retirar", "ja chegou", "quando fica pronto", "cade meu pedido", "status do pedido", "minha os", "numero da os", "ordem de servico", "previsao de entrega" etc.

Auditoria edita a lista sem redeploy.

## Por que sem integração com ERP nesta fase

- Resolve imediatamente IA confundindo consulta com orçamento (incidente reportado)
- Zero dependência externa
- Humano consulta status no ERP da loja e responde via Atrium
- Endpoint `os-status-public` do Infoco OB (Firebird Bridge) está pronto e pode ser plugado depois como tool `consultar_status_os` sem desfazer este fluxo

## Bypass

`isHibrido=true` ignora o router (operador já está no comando).
