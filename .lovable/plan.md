## Correções para Latência + Intent de Consulta de OS

### Problema A — Latência ~2min após perda do CAS lock

Quando `ai-triage` perde o CAS lock (outra execução concorrente segura o lock), o código **aborta sem retry** (`supabase/functions/ai-triage/index.ts` L3261-3263). A recuperação só vem via `watchdog-inbound-orfao` (cron de 1min), gerando ~107s de silêncio entre o inbound e a resposta.

**Fix:** transformar o ponto de aquisição do lock em um pequeno loop de retry com backoff. Antes de desistir, esperar 2 vezes (3s cada) tentando reaquirir — assim cobrimos o caso onde a execução concorrente termina em poucos segundos. Continua-se preservando a anti-duplicação (uma única execução por vez), mas elimina-se a dependência do cron de 1min nesse cenário.

```text
acquire_lock()                  → ok → segue
fail → wait 3s → acquire_lock() → ok → segue
fail → wait 3s → acquire_lock() → ok → segue
fail → abort (watchdog cobre)
```

Quando o lock é perdido por execução genuinamente concorrente que produz uma outbound, o anti-duplicação posterior (`veryRecentOut <10s`) bloqueia naturalmente a nossa segunda execução. Não há risco de resposta duplicada.

### Problema B — "quero saber do meu pedido" não bate em consulta_os

O router pre-LLM em `OS_INTENT_CORE_REGEX` (L759-783) cobre "status/situação/andamento", "como está", "cadê meu pedido", mas **não cobre o padrão `(quero|preciso|queria|gostaria) saber ... pedido`** — exatamente a frase que o cliente 5511963268878 usou. Resultado: caiu no LLM, classificado como "outro" com conf 0.00, escalado por loop-detector — sem disparar `consulta_os` nem o roteamento direto para humano.

**Fix:** adicionar **uma regex** ao `OS_INTENT_CORE_REGEX` para esses verbos de consulta + objeto pedido/OS/óculos/encomenda, e **3 keywords** ao `OS_INTENT_DEFAULT_KEYWORDS` como rede de segurança.

```text
Nova regex:
\b(quero|queria|preciso|gostaria|posso)\b[\s\S]{0,30}\b(saber|consultar|ver|acompanhar)\b[\s\S]{0,30}\b(pedido|encomenda|os|[oó]culos|len(te|tes)|compra)\b

Novas keywords:
"saber do meu pedido"
"saber do pedido"
"saber sobre meu pedido"
```

### Detalhes técnicos

**Arquivo único:** `supabase/functions/ai-triage/index.ts`

1. **L729-736 (`OS_INTENT_DEFAULT_KEYWORDS`)** — append 3 strings.
2. **L759-783 (`OS_INTENT_CORE_REGEX`)** — append 1 regex.
3. **L3253-3264 (bloco de CAS lock)** — envolver em loop de 3 tentativas com `await new Promise(r => setTimeout(r, 3000))` entre cada; mantém o log `[LOCK-CAS] Lock atômico adquirido` no sucesso e `[LOCK-CAS] Lock held by concurrent execution — abortando` quando esgota.

Mudanças são todas pontuais, no `ai-triage`. Sem migration, sem mexer em outras edge functions, sem mexer em frontend. Edge function sobe via autodeploy assim que aprovada.

### Validação pós-deploy

- Conferir nos logs do `ai-triage` que `quero saber do meu pedido` agora dispara o branch de `consulta_os` (escalada direta para humano, conforme memória `consulta-os-escalada-humano`).
- Em conversas com lock concorrente, observar nova linha de log indicando "lock retry adquirido" (a adicionar) e ausência de eventos de `watchdog-inbound-orfao` recuperando o mesmo atendimento.

### Memória a atualizar (após confirmar fix em produção)

- `ia/consulta-os-escalada-humano.md`: registrar que o intent agora cobre "quero/queria/preciso/gostaria saber + pedido/OS/óculos".
- `ia/watchdog-inbound-orfao.md`: nota de que o triage agora faz retry curto antes de cair no watchdog (watchdog vira fallback de 2ª camada).