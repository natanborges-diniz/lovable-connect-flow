## O que aconteceu na conversa do Artur

Hoje (24/04, 15:13) o Artur enviou a foto da receita. A IA respondeu **"Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções certinhas, um instante…"** e parou. Nunca mais respondeu.

A frase parece um "aguarde", mas na verdade é o **fim da execução**. Não há nenhum mecanismo que continue depois dela.

## Causa raiz

Na correção anterior (caso Artur Borges das 12:54), criamos o guardrail anti-loop que substitui a frase "dois caminhos" por "Já estou analisando…". O problema:

1. **A frase de "analisando" virou um beco sem saída.** Quando o modelo se recusa a chamar `interpretar_receita` e devolve qualquer texto, o guardrail troca esse texto pela frase tranquilizadora — mas a Edge Function termina logo depois (`sendWhatsApp` + `return`). Não dispara a tool, não agenda retry, não faz follow-up.
2. **Não há "segundo turno" automático.** Como o cliente não envia uma nova mensagem (afinal, a IA disse "um instante…"), o `ai-triage` nunca mais é chamado. A receita nunca é interpretada. A conversa morre.
3. **Mesmo o `[PRIORIDADE MÁXIMA — RECEITA PENDENTE]` injetado no prompt** não garante a chamada da tool — é só uma instrução. Quando o modelo ignora, não há plano B server-side que force a execução de `interpretar_receita`.

Resumindo: trocamos um loop infinito por uma parada silenciosa. O cliente fica esperando uma resposta que não vem.

## Correção proposta

Tornar `interpretar_receita` **server-side enforceable**: quando há imagem pendente e o modelo devolve texto sem chamar a tool, o próprio `ai-triage` chama a tool diretamente (sem depender do modelo) e segue o fluxo.

### Alterações em `supabase/functions/ai-triage/index.ts`

1. **Retry forçado com `tool_choice` específico**
   - Detectar: `hasUnparsedImage === true` + `receitas.length === 0` + resposta sem tool_call.
   - Antes de aceitar a resposta de texto, fazer uma **segunda chamada ao modelo** com `tool_choice: { type: "function", function: { name: "interpretar_receita" } }` — força a tool.
   - Se o segundo turno também falhar, executar `interpretar_receita` **diretamente** (sem modelo) usando a `media_url` da última imagem inbound, e em seguida chamar `consultar_lentes_contato` (ou `consultar_lentes`) para devolver opções na mesma resposta.

2. **Guardrail "Já estou analisando" deixa de ser terminal**
   - Quando o guardrail troca a resposta para "Já estou analisando…", marcar uma flag `requiresFollowUp = true`.
   - Após `sendWhatsApp`, se a flag estiver setada, executar imediatamente o pipeline `interpretar_receita → consultar_lentes_contato` e enviar uma segunda mensagem com as opções (5–10s depois, para parecer natural).
   - Assim a frase tranquilizadora cumpre a promessa: o cliente recebe as opções logo em seguida.

3. **Watchdog de imagem pendente sem follow-up**
   - Adicionar verificação no `watchdog-loop-ia` (ou similar): se a última outbound contém "estou analisando" / "um instante" e há imagem inbound não interpretada há mais de 60s, disparar `ai-triage` com hint forçado para processar a receita.
   - Garante recuperação mesmo se o retry inline falhar por timeout.

4. **Log e telemetria**
   - Adicionar `validatorFlags.push("forced_interpretar_receita_retry")` e `("inline_followup_after_analyzing")` para conseguirmos rastrear quantas vezes o modelo recusa a tool.

### Memória atualizada

Adicionar ao `mem://ia/lentes-de-contato-orcamento` o caso "Artur Borges 24/04 15:13" como **regressão da correção anterior** — documentar que a frase "Já estou analisando" só pode existir se houver follow-up garantido.

## Validação

Reproduzir o cenário Artur:
1. Cliente envia receita pela primeira vez → IA chama `interpretar_receita` direto (sem cair em "analisando…").
2. Se cair em "Já estou analisando…", uma segunda mensagem com opções de lente chega em até 10s.
3. O watchdog cobre o caso de falha do retry inline (segunda camada de proteção).

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` (retry forçado + follow-up inline)
- `supabase/functions/watchdog-loop-ia/index.ts` (detecção de "analisando" órfão) — opcional, depende se o watchdog inline já cobrir
- `.lovable/memory/ia/lentes-de-contato-orcamento.md` (documentar regressão)

## Observações

- Sem mudança de schema.
- Sem mudança de UI.
- Custo extra: até 1 chamada adicional ao modelo por mensagem com imagem pendente (apenas quando o primeiro turno falha em chamar a tool).
