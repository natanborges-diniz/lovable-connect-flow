## Implementado: Resposta SIM/NÃO à oferta de comparativo pós-agendamento + despedida

### Problema
Após `agendar_visita` confirmado, Gael ofereceu *"Posso já deixar separado um comparativo Essilor x ZEISS pra você ver na hora?"*. Cliente respondeu **"Sim"** e a IA caiu em fallback genérico ("Me explica melhor sua necessidade…") porque o detector `isDetalhamentoContext` exigia intent (`detalhar/comparar`) ou marca na mensagem do cliente — uma resposta curta de confirmação não batia em nada.

Caso "Não" também não tinha tratamento → sem fluxo de despedida.

### Mudanças em `supabase/functions/ai-triage/index.ts`

1. **Detector `pendingComparativoOffer`**: varre últimas 2 outbound buscando padrão de oferta proativa de comparativo (`comparativ|deixar separado|posso (mostrar|enviar|preparar) … diferen|comparativ`) que mencione ≥2 marcas conhecidas (`Essilor|Zeiss|DNZ|Hoya|Kodak|DMAX|Solflex`). Quando encontra, salva `{ marcas, rawOffer }`.

2. **Classificador SIM/NÃO curto**:
   - `isShortYes` (sim, pode, claro, manda, quero, beleza, ok, perfeito, 👍 etc) → ativa `isDetalhamentoContext = true` e força `orcamentoBrandsList = pendingComparativoOffer.marcas`. LLM vai direto ao comparativo das 2 marcas.
   - `isShortNo` (não, tranquilo, depois, tô bem, tudo certo etc) → ativa `[FLUXO DISPENSA COMPARATIVO]`.
   - `isShortNoToHelp`: `isShortNo` + última outbound contém "posso ajudar em mais alguma coisa" → ativa `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]`.

3. **`agendamentoFmt`** computado a partir de `agendamentosAtivos` (formato "sábado, 25/04 às 17:00 na Diniz Primitiva I") e injetado nos novos blocos de prompt.

4. **Bloco `[FLUXO DETALHAMENTO]` adaptado**: quando há agendamento ativo, troca a regra "termine com 'quer fechar com X?'" por fechamento natural com despedida vinculada ao agendamento. Acrescenta regra extra quando `isShortYes`: "vá direto, não reapresente o orçamento".

5. **Bloco `[FLUXO DISPENSA COMPARATIVO]`** (novo): texto canônico "Tranquilo, [Nome]! Posso te ajudar em mais alguma coisa antes de finalizar?". Pergunta única.

6. **Bloco `[FLUXO DESPEDIDA PÓS-AGENDAMENTO]`** (novo): texto canônico "Combinado, [Nome]! Te espero [data/hora] na [loja] 👋 Qualquer dúvida é só me chamar." — sem perguntas. Marca `intencao = "encerramento_pos_agendamento"`.

7. **Bypass do validador**: respostas dos blocos novos (20–240 chars) passam mesmo se similaridade > 70% (esperado, pois citam loja/data já mencionadas antes).

8. **Fallback determinístico** para os 3 contextos novos (despedida, dispensa, detalhamento pós-agendamento) — usa `contatoNomeAtual.split(" ")[0]` + `agendamentoFmt`. Nunca cai no pool genérico.

### Memória criada
- `mem://ia/pos-agendamento-oferta-comparativo.md` — fluxo SIM/NÃO/NÃO, frases canônicas, proibições, exemplo end-to-end.

### Deploy
Edge function `ai-triage` redeployada.

### Resultado esperado
```
Cliente: Sim   → IA envia comparativo + "Te espero [data/hora] na [loja] 👋"
Cliente: Não   → IA "Tranquilo, [Nome]! Posso te ajudar em mais alguma coisa antes de finalizar?"
Cliente: Não   → IA "Combinado, [Nome]! Te espero [data/hora] na [loja] 👋"
```
