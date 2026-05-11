## Por que ainda pede receita

Hoje o detector `consulta_os` (em `ai-triage`) só dispara quando a frase do cliente bate **substring exata** com uma das keywords salvas em `configuracoes_ia.os_intent_keywords` (ou `OS <número>`).

Olhando o tráfego das últimas 24h, ele falhou em frases reais como:

- "Quanto tempo fica pronto a lente?" → caiu no LLM e virou pitch de prazo + agendamento
- "Ia pedir para retirar" → caiu no fallback de imagem e respondeu "Recebi sua receita 👀 Já estou analisando..."
- "eu fiz um pedido pela loja oticas diniz online" / "e estou esperando o pedido com urgencia" → atendimento estava em `modo=ponte`, o router de OS nem rodou

Causas:

1. Frases parafraseadas ("quanto tempo fica pronto a lente", "ia pedir para retirar", "fiz um pedido online e estou esperando") não estão na lista de substrings.
2. O router de OS hoje só roda para `modo=ia` (`if (!isHibrido)` impede híbrido, e `modo=humano/ponte` já sai do triage antes). Quando o operador devolve para IA em híbrido, ou quando a conversa está em ponte, o intent some.
3. Em paralelo, três caminhos do `ai-triage` ainda forçam fluxo de receita:
   - `precisaForcarInterpretacao` (re-dispara `interpretar_receita` em qualquer imagem nova)
   - `deterministicIntentFallback` para imagens (responde "Recebi sua receita…")
   - hint "PRIORIDADE MÁXIMA — RECEITA PENDENTE" injetado no prompt
   Nenhum deles verifica se o intent atual é `consulta_os` — então, se uma foto entrar junto da pergunta de pedido, a IA volta a pedir receita.

## O que muda

### 1. Detector mais robusto (regex + sinônimos)

Substituir o `matchesConsultaOs` por uma combinação de:

- Lista de keywords atual (mantida em `configuracoes_ia.os_intent_keywords`, editável)
- **Conjunto de regex** que cobre o padrão "verbo + pedido/encomenda/óculos/lente + tempo/status/retirada", por exemplo:
  - `\b(quanto|qual)\s+(tempo|prazo)\b.*\b(pronto|fica|demora|leva|chega)\b`
  - `\b(meu|minha)?\s*(pedido|encomenda|compra|os)\b.*\b(pronto|chega|chegou|atras|aguardando|esperando|status|previs|retirar|retirada)\b`
  - `\b(ia|vou|gostaria|queria|pra|para)\b.*\bretirar\b`
  - `\b(fiz|comprei|encomendei)\b.*\b(pedido|compra|oculos|óculos|lente)\b.*\b(online|loja|site|aguardando|esperando|urg[eê]ncia)\b`
  - `\b(esperando|aguardando)\b.*\b(pedido|encomenda|oculos|óculos|chegada|entrega)\b`

As regex ficam **codadas** (não editáveis pelo auditor) porque são o "núcleo" do intent; a lista de keywords continua sendo a porta para auditoria adicionar variações novas sem deploy.

### 2. Rodar o router também em híbrido e ponte

- Em **híbrido** (`isHibrido=true`): hoje há bypass. Vou remover o bypass apenas para esse intent — se o cliente perguntar pedido/OS, mesmo em híbrido o card volta para `modo=humano` e vai pra coluna "Consulta de OS". Operador continua no comando, só ganha contexto.
- Em **ponte** (`atendimento.modo === 'ponte'`): hoje o triage faz `return skipped` antes do router. Vou mover a checagem de `consulta_os` para **antes** desse return, e em vez de devolver para IA, registrar `eventos_crm.tipo='consulta_os'` + `metadata.intent='consulta_os'` no atendimento ponte, para o operador da loja ver o badge na conversa. Não envia mensagem automática nesse caso (operador já está respondendo manualmente).

### 3. Hard guards que blindam o fluxo de receita

Quando o detector classificar como `consulta_os`, marcar `atendimento.metadata.intent_consulta_os_at = now()` e usar essa flag em três pontos:

- `precisaForcarInterpretacao`: retornar `false` se `intent_consulta_os_at` foi setado nos últimos 30 minutos
- `deterministicIntentFallback` (ramo `isImageContext`): pular o pool "Recebi sua receita…" e responder a mensagem fixa `os_escalada`
- `compile-prompt` / hint "RECEITA PENDENTE": suprimir esse hint quando `intent_consulta_os_at` recente

Assim, mesmo se vier foto junto da pergunta, a IA não cai em receita.

### 4. Watchdog editável

Manter `os_intent_keywords` e mensagem `os_escalada` editáveis pela auditoria, e adicionar 5 novas variações de frase em `ia_exemplos` categoria `consulta_os` cobrindo os casos reais detectados:

- "quanto tempo fica pronto a lente"
- "ia pedir para retirar"
- "fiz um pedido online e estou esperando"
- "tô esperando meu pedido"
- "meu pedido está atrasado"

### 5. Validação

- Rodar `ai-triage` com 8 mensagens-teste (incluindo os casos reais que falharam) e conferir:
  - `[ROUTER] Consulta de OS detectada` no log
  - Evento `consulta_os` criado em `eventos_crm`
  - Card movido para "Consulta de OS"
  - Nenhuma chamada a `interpretar_receita` / `consultar_lentes*`
- Repetir um caso com imagem anexada à mesma mensagem para garantir que o guard contra `precisaForcarInterpretacao` está funcionando.

---

### Arquivos tocados

- `supabase/functions/ai-triage/index.ts` — regex set + remoção do bypass de híbrido para o intent + flag `intent_consulta_os_at` + 3 hard guards
- Migração SQL — inserir 5 novos exemplos em `ia_exemplos` categoria `consulta_os`

**Sem secrets, sem nova tabela, sem dependência cross-project.**
