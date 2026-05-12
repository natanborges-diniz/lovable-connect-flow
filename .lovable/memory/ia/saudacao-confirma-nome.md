---
name: Saudação inicial confirma/registra nome
description: 1ª interação é DETERMINÍSTICA (sem LLM) — ai-triage envia "Falo com X?" ou "Posso saber seu nome?" direto via send-whatsapp. Tool registrar_nome_cliente persiste no próximo turno. proximo_passo só é mesclado na resposta se for pergunta (terminar em ?).
type: feature
---

## Fluxo
- Webhook captura `senderName` do WhatsApp e grava `metadata.nome_perfil_whatsapp` + `nome_confirmado=false`.
- `ai-triage` carrega `contatos.nome`, `metadata.nome_perfil_whatsapp`, `metadata.nome_confirmado`, `precisa_confirmar_nome`.
- **FAST-PATH determinístico (`ai-triage` ~linha 2415):** quando `inboundCount===1` OU `precisaConfirmarNome===true`, e a última mensagem do cliente NÃO é imagem, e contato é `cliente`:
  - Com `senderName` real → `"Olá! Falo com {primeiroNome}? 😊 Aqui é o Gael das Óticas Diniz Osasco."`
  - Sem nome → `"Oi! Tudo bem? Aqui é o Gael das Óticas Diniz Osasco 😊 Posso saber seu nome, por favor?"`
  - **Pula completamente o LLM** (zero latência de gateway, zero risco de vazamento de prompt). Loga `[FAST-PATH] greeting_deterministic_sent` e `eventos_crm.tipo='saudacao_deterministica'`.
- Quando o cliente confirma/corrige no próximo turno, IA chama `registrar_nome_cliente` que faz UPDATE em `contatos.nome` + `metadata.nome_confirmado=true`.

## Guardrail proximo_passo (defesa em profundidade)
- `responder.proximo_passo` é **metadado interno** (define a próxima ação). Antes era concatenado na `resposta` enviada ao cliente sempre que não fosse pergunta repetida.
- **Regra atual** (linhas 4225 e 5188 em `ai-triage/index.ts`): só mescla `proximo_passo` na resposta se ele **terminar em `?`** (for pergunta). Caso contrário, descarta e loga `[GUARDRAIL] proximo_passo descritivo descartado`.
- `sanitizeLeakedInstructions` cobre frases típicas vazadas: "confirmar o nome do cliente", "dar sequência ao atendimento", "para prosseguir", "aguardar resposta do cliente", "verificar com o cliente".

## Caso de regressão (12-mai-2026 — Mary/Gi)
WhatsApp entregou `senderName="Gi"`. Modelo gerou `resposta="Olá! Falo com Gi? 😊 Aqui é o Gael das Óticas Diniz Osasco"` + `proximo_passo="Confirmar o nome do cliente para dar sequência no atendimento."` — código antigo concatenava qualquer `proximo_passo` que não fosse pergunta repetida, então o cliente recebeu a frase descritiva como se fosse parte da saudação. Correção: short-circuit determinístico + filtro `proximo_passo` só pergunta + sanitizer ampliado.

## Helper
`looksLikeRealName(senderName, phone)` no whatsapp-webhook (linha ~896): exige letras (não só dígitos), descarta nomes corporativos.
