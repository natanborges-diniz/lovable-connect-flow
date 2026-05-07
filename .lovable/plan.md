
## Diagnóstico

Sequência observada com a Franciana:

1. Cliente manda foto → IA OCR → IA pergunta "Li sua receita assim, confere?" (gate de confirmação ligado, `receita_confirmacao.pending=true`).
2. Cliente: "Sim".
3. IA: **"Recebi sua receita 👀 Já estou analisando aqui pra te passar as opções certinhas, um instante…"** ❌

O gate de confirmação em `ai-triage/index.ts` (linhas 2219–2306) detecta o "Sim", marca `pending=false` e `confirmed_by_client_at`, e em seguida **só dá `fall-through` para o LLM**. Aí o modelo, em vez de chamar `consultar_lentes` (apesar do system-prompt FLUXO PÓS-RECEITA OBRIGATÓRIO), retorna o texto "Recebi sua receita 👀 Já estou analisando…" — exatamente a mensagem que já é usada como fallback de imagem nova ainda não lida. Não há nenhum guardrail bloqueando essa string quando a receita já está confirmada.

Resultado: cliente fica esperando, e a próxima passada do watchdog vê outbound recente ("analisando") e silencia.

## O que vou alterar

Arquivo: `supabase/functions/ai-triage/index.ts`

### 1. Forçar `consultar_lentes` / `consultar_lentes_contato` imediatamente após confirmação

No bloco do gate (após linha 2305, ramo `Confirmada DENTRO da faixa`), em vez de só setar `pending=false` e seguir o fluxo normal:

- Disparar uma chamada ao gateway com `tool_choice` forçado para `consultar_lentes` (óculos) ou `consultar_lentes_contato` (LC, baseado em `isLCContextGlobal`/`metadata.contexto_lc`), passando os valores da receita confirmada (`receitas[targetIdx]`).
- Se a tool retornar opções, montar a resposta com 3 faixas (econômica/intermediária/premium) seguindo o padrão atual.
- Se retornar zero opções, escalar para humano (já é a regra).
- Se a chamada falhar/timeout, devolver mensagem determinística curta de transição (ex.: "Perfeito! Já vou te mandar as opções compatíveis 👇") + `validatorFlags.push("post_confirm_tool_failed")` e seguir para o LLM como hoje.

Isso espelha o padrão que já existe em `9.4 FORCED RETRY: interpretar_receita` (linhas 4670–4792), só que aplicado ao próximo passo do funil.

### 2. Guardrail anti-"analisando" pós-confirmação

Logo antes do envio da resposta final (perto de `9.5 GUARDRAIL ANTI-LOOP`), adicionar:

```text
se (resposta casa MSG_ANALISANDO_RE) e (última receita tem confirmed_by_client_at):
  descartar a resposta do LLM
  forçar consultar_lentes(_contato) (mesma rotina do passo 1)
  validatorFlags.push("anti_loop_analisando_pos_confirmacao")
```

Cobre tanto o caminho do gate (passo 1) quanto qualquer outro turno em que o modelo voltar a esse texto depois que a receita já foi confirmada.

### 3. Ajuste em `deterministicIntentFallback` (linhas ~821–861)

O pool de "Recebi sua receita 👀 Já estou analisando…" só deve disparar quando `!hasValidReceitas` **e** `!últimaReceitaConfirmada`. Se a receita já foi confirmada, ir direto para a transição "Já vou te mandar as opções compatíveis com sua receita 😊" (sem repetir "Recebi sua receita") e marcar `intencao=orcamento` para o pipeline.

### 4. Memória

Atualizar `mem://ia/memoria-multiplas-receitas` (ou criar `mem://ia/pos-confirmacao-forca-cotacao`) com a regra:

> Após `detectRxConfirmation` + `pending=false` + `!foraDaFaixa`, é OBRIGATÓRIO chamar `consultar_lentes`/`consultar_lentes_contato` no mesmo turno. PROIBIDO devolver "Recebi sua receita / estou analisando" depois da confirmação.

E acrescentar uma linha curta no índice (`mem://index.md` → Core) referenciando essa nova memória.

## Detalhes técnicos

- Reaproveitar o helper de chamada do gateway que já existe no FORCED RETRY (mesmas envs `LOVABLE_API_KEY`, modelo `openai/gpt-5`, `tool_choice: { type: "function", function: { name: "consultar_lentes" } }`).
- Usar `requerRevisaoHumanaPosOrcamento(rx)` (já existe, linha 231) para anexar `MSG_REVISAO_HUMANA_SUFIXO` quando `cylMax>4` ou `addMax>3.5` — preserva o comportamento atual.
- Eventos CRM novos: `tipo="cotacao_pos_confirmacao_forcada"` para auditoria.
- Sem alterações de schema/migration. Sem mudanças no front.

## Fora de escopo

- Não vou mexer no `interpretar_receita` nem no parser de receita por texto (funcionando).
- Não vou alterar `watchdog-loop-ia` (a regex `MSG_ANALISANDO_RE` continua válida; o fix é antes da mensagem ser emitida).
