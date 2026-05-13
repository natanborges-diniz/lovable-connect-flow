---
name: Saudação inicial confirma/registra nome + auto-persistência anti-loop
description: 1ª interação determinística. Quando cliente responde nome em texto, fast-path persiste direto e segue (sem repetir pergunta). Após 3 tentativas sem reconhecer nome, escala para humano.
type: feature
---

## Fluxo
- Webhook captura `senderName` do WhatsApp e grava `metadata.nome_perfil_whatsapp` + `nome_confirmado=false`.
- `ai-triage` carrega `contatos.nome`, `metadata.nome_perfil_whatsapp`, `metadata.nome_confirmado`, `precisa_confirmar_nome`, `tentativas_pedido_nome`.
- **FAST-PATH determinístico (`ai-triage` ~linha 2424):** quando `inboundCount===1` OU `precisaConfirmarNome===true`, contato cliente, último inbound não é imagem:
  1. **Tenta extrair nome do último inbound em texto** via `extrairNomeDoInbound()` — aceita "Beatriz", "Me chamo Beatriz", "Sou a Bia", etc. Rejeita saudações, perguntas, URLs, dígitos longos, >4 tokens.
  2. Se extraiu → UPDATE `contatos.nome` + `metadata.nome_confirmado=true`, `precisa_confirmar_nome=false`, `nome_origem='ia_fast_path'`, `tentativas_pedido_nome=0` + evento `nome_registrado_fast_path`. **NÃO retorna** — segue para o LLM responder a intenção real do cliente já tratando-o pelo nome (`contatoNomeAtual` reatribuído em runtime).
  3. Se não extraiu:
     - `tentativas_pedido_nome >= 2` (3ª tentativa fracassada) e `inboundCount > 1` → **escala para humano** com motivo `loop_pedido_nome` via `handleEscalation`.
     - Senão → envia saudação determinística e incrementa `tentativas_pedido_nome`. Pula completamente o LLM.
- Quando o cliente confirma/corrige no próximo turno via LLM, IA chama `registrar_nome_cliente` que faz mesmo UPDATE.

## Heurística `extrairNomeDoInbound`
- Trim + remove pontuação inicial.
- Strip de prefixos: `meu nome é/eh/e`, `me chamo`, `chamo-me`, `sou o/a`, `sou`, `é o/a`, `é`, `eh`.
- Corta tudo após `.,;:!`.
- Rejeita: vazio, <2 ou >40 chars, saudações puras (oi/olá/bom dia/etc), `?` no fim, URLs, `@`, `.com`, `.br`.
- Aceita 1–4 tokens, todos alfabéticos `/^[A-Za-zÀ-ÿ'’-]{2,}$/`. Capitaliza.

## Guardrail proximo_passo (defesa em profundidade)
- `responder.proximo_passo` é metadado interno. Só mesclado na resposta se terminar em `?`. Senão descartado e logado `[GUARDRAIL] proximo_passo descritivo descartado`.
- `sanitizeLeakedInstructions` cobre frases típicas vazadas.

## Caso de regressão (13-mai-2026 — Beatriz)
Cliente entrou via site (`metadata.precisa_confirmar_nome=true`, `nome_perfil_whatsapp="."`). Respondeu "Beatriz", "Me chamo Beatriz", "Bia" 5x. Fast-path antigo só verificava elegibilidade e re-enviava "Antes de seguir, posso saber seu nome, por favor? 😊" eternamente — nunca chegava ao LLM, então `registrar_nome_cliente` jamais era chamada. Correção: heurística determinística + auto-persist + escalada após 3 tentativas.

## Helper webhook
`looksLikeRealName(senderName, phone)` no whatsapp-webhook (~linha 896): exige letras, descarta nomes corporativos e telefones.
