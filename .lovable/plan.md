# Correções no fluxo do Drin (e leads silenciosos no geral)

## Diagnóstico (caso Drin)

Linha do tempo real apurada no banco:

```
08:57  Drin envia: "Acessei o site..."
08:57  Gael responde: "Olá! Falo com Drin? 😊 ... Aguardar confirmação do nome..."  ← prompt vazado
10:00  Cron dispara `retomada_contexto_1`
10:00  Cron dispara `retomada_contexto_1` de novo (~100ms depois)              ← duplicado
10:06  watchdog-loop-ia detecta loop (similaridade 80%) e escala para HUMANO   ← problema
10:54  watchdog-loop-ia detecta loop de novo e re-escala
13:54  Card termina em modo=humano, status=aguardando, na coluna "Novo Contato"
```

Drin nunca respondeu. O que deveria ter acontecido: após esgotar 2 retomadas + despedida, lead vai para **Perdidos**. O que aconteceu: o watchdog de loop, vendo retomadas idênticas seguidas, classificou como loop e jogou em **Humano**.

## O que vamos corrigir

### 1. Vazamento do prompt na saudação (`ai-triage`)

Em `buildFirstContactBlock` o LLM ocasionalmente concatena a instrução interna ("Aguardar confirmação do nome...") na mensagem do cliente. Vamos:

- Reescrever o bloco para deixar a frase canônica destacada (entre aspas) e separar as regras com cabeçalho `# REGRAS INTERNAS — NÃO ENVIAR AO CLIENTE`.
- Adicionar guardrail intra-mensagem (já existe um para duplicação, vamos estender): se `inboundCount<=1` e o texto final contiver tokens de instrução vazada (`aguardar confirmação`, `confirme o nome`, `sem reformular`, `tool registrar_nome`, `primeira interação`), **substituir** pela frase canônica determinística e logar `[GUARDRAIL] Prompt vazado corrigido`.

### 2. Idempotência da retomada (`vendas-recuperacao-cron`)

Hoje o lock anti-race existe apenas no ramo `processHumano` (linhas 465-488). O ramo IA (`processContato`, linhas 216-330) **não tem** o mesmo lock — por isso disparou `retomada_contexto_1` 2x em 100ms.

- Replicar o padrão "lock otimista antes do fetch": gravar `recuperacao_vendas.ultima_tentativa_at = now` + `lock_pending=true` ANTES de chamar `responder-solicitacao`/`send-whatsapp-template`.
- Adicionar guard: se `ultima_tentativa_at` foi escrita há menos de `requiredDelay/2` (ou 30 min), pular.

### 3. Lead silencioso → Perdidos (não Humano)

Trocar a política do `watchdog-loop-ia` quando o "loop" é, na verdade, **a IA falando sozinha** (cliente em silêncio, só temos templates de retomada repetidos):

- Detectar a condição: última inbound do cliente foi há > X horas (ex.: 2h) E os outbounds recentes são todos templates de retomada/IA (sem mensagem humana).
- Nesse caso, em vez de marcar `modo=humano`, **mover o contato direto para a coluna `Perdidos`**, encerrar o atendimento (`status=encerrado`, `fim_at=now`) e registrar `eventos_crm` com tipo `lead_silencioso_perdido`.
- Manter o comportamento atual de escalar para humano APENAS quando houver ping-pong real entre cliente e IA (cliente respondeu recentemente e a IA está repetindo).

Resultado: leads que nunca respondem nem ao 1º contato + 2 retomadas + despedida fluem naturalmente para Perdidos sem sujar a fila humana.

### 4. Ação imediata no card do Drin

Mover o card `5843fcdb...` de "Novo Contato"/modo humano direto para **Perdidos**, encerrar o atendimento e registrar evento `lead_silencioso_perdido` (saneamento manual desse caso).

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` — reescrever `buildFirstContactBlock` + extender guardrail intra-mensagem
- `supabase/functions/vendas-recuperacao-cron/index.ts` — adicionar lock otimista no ramo IA (`processContato`)
- `supabase/functions/watchdog-loop-ia/index.ts` — bifurcar decisão (Perdidos vs Humano) conforme há resposta recente do cliente
- Migration / insert de saneamento — mover Drin para Perdidos

## Memórias a atualizar

- `mem://ia/saudacao-confirma-nome` — anotar guardrail anti-vazamento
- `mem://crm/recuperacao-ia-anti-abandono` — anotar lock otimista no ramo IA
- Nova: `mem://watchdog/lead-silencioso-perdidos` — política "silêncio total → Perdidos, não Humano"

## Não vou tocar

- Não vou alterar a cadência (1h → 24h → despedida +1h) — só o destino final em casos de silêncio total.
- Não vou alterar o fluxo de escalada quando o cliente está conversando ativamente com a IA e ela trava.
