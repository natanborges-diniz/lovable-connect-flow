## Diagnóstico

A IA travou em loop no caso do Artur Borges porque **a receita nunca foi interpretada** — `metadata.receitas` do contato está vazio. Sem receita salva, todos os guardrails que forçam `consultar_lentes_contato` ficam inativos (eles dependem de `hasReceitas = true`).

Cronologia confirmada no banco:

1. Cliente enviou imagem (`tipo_conteudo = image`, com `media_url` válida) → 12:54.
2. IA respondeu "dois caminhos" sem chamar `interpretar_receita` — **falha #1**.
3. Cliente respondeu "As opções de lentes compatíveis" → IA voltou a perguntar "Quer que eu leia?" — **falha #2**.
4. Cliente disse "Sim", "É uma receita", "Analise para mim" — IA continuou em loop sem chamar a tool.

### Por que `interpretar_receita` não foi chamada

O bloco `[PRIORIDADE MÁXIMA — RECEITA PENDENTE]` (linhas 1700–1707) só é injetado quando `hasUnparsedImage` é detectado. Pelo log de mensagens, a imagem chegou como `tipo_conteudo = image` — então o sistema identificou como imagem inbound. Mas o modelo respondeu com texto genérico ("Recebi sua receita aqui 😊… dois caminhos") em vez de chamar a tool, e a partir daí cada nova mensagem do cliente passou a ser texto curto ("Sim", "É uma receita", "Analise para mim") — o modelo continuou ecoando a frase em vez de chamar a tool.

Causas-raiz:

1. **Não há fallback determinístico que force `interpretar_receita`** quando o modelo recusa a tool. Existe fallback determinístico para `consultar_lentes`/`consultar_lentes_contato` (que requer receita salva), mas para `interpretar_receita` o sistema apenas injeta um hint textual e confia que o modelo vai obedecer.

2. **A frase "Recebi sua receita aqui… dois caminhos" está hard-coded** em `deterministicIntentFallback` (linhas 352 e 378) e é a resposta padrão quando há contexto de imagem mas a receita ainda não foi salva. Ou seja: a própria função fallback que deveria proteger contra esse cenário **devolve exatamente a frase do loop**.

3. **A detecção de loop não cobre o caso "imagem pendente + cliente pedindo análise"**. Quando o cliente diz "Analise para mim" (mensagem clara de intent), o `forcedIntent` para `interpretar_receita` exige `hasUnparsedImage`, mas a janela de checagem ou a heurística podem estar perdendo a imagem após várias trocas de texto.

## Correções

Vou alterar `supabase/functions/ai-triage/index.ts`:

### 1. Forçar `interpretar_receita` server-side quando o modelo se recusa

Hoje, se o modelo retorna texto em vez de chamar `interpretar_receita`, a Edge Function aceita e envia. Vou adicionar:

- Se houver imagem inbound não interpretada nas últimas 5 mensagens **E** receitas vazias **E** o cliente pediu análise/orçamento (intent claro: "analise", "lê pra mim", "opções", "orçamento", "sim"/"é uma receita" como resposta a "quer que eu analise"), e o modelo retornou texto sem chamar a tool, **forçar uma segunda chamada ao modelo** com mensagem `tool_choice` específica para `interpretar_receita` (ou injetar mensagem de sistema ainda mais agressiva).

### 2. Trocar o fallback hard-coded "dois caminhos"

Substituir as duas ocorrências da frase "Recebi sua receita aqui 😊 Se você quiser, eu posso seguir por dois caminhos…" no `deterministicIntentFallback` por:

- Quando há imagem pendente: `"Já estou analisando sua receita aqui 👀 Um instante…"` + marcar para retry com `interpretar_receita` na próxima execução (ou simplesmente NÃO devolver fallback de texto e sim retornar erro para o orquestrador chamar a tool).

### 3. Detector de loop com a frase "dois caminhos"

Adicionar guardrail no momento do output: se a resposta gerada pelo modelo contém a substring "dois caminhos" **E** a mesma frase já apareceu em `recentOutbound`, descartar a resposta e:
- Se há imagem pendente: forçar `interpretar_receita`.
- Se há receita salva + LC: forçar `consultar_lentes_contato`.

### 4. Ampliar `hasRecentUnparsedPrescriptionImage`

Hoje olha as últimas 5 inbound. Quando há ping-pong de "Sim/É uma receita/Analise" depois da imagem, a imagem ainda está nas últimas 5 inbound — ok. Mas o intent textual "analise/lê/opções/sim" combinado com imagem pendente deveria **disparar `forcedIntent = interpretar_receita` mesmo sem o cliente repetir "orçamento"**. Hoje `detectForcedToolIntent` só dispara `interpretar_receita` quando há imagem + pedido de orçamento. Vou expandir os triggers.

## Validação

Após as alterações:

1. Reproduzir cenário do Artur: cliente envia imagem → IA chama `interpretar_receita` na primeira ou segunda mensagem (não na quinta).
2. Se modelo recusar a tool e responder texto, fallback server-side dispara `interpretar_receita` automaticamente.
3. Frase "dois caminhos" nunca pode aparecer 2× seguidas — se aparecer, é descartada e substituída pela tool correta.
4. Após interpretar a receita, segue o fluxo já existente: `consultar_lentes_contato` → 2-3 opções → região → agendar.

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` (única alteração — função de orquestração da IA)

## Observações

- Nenhuma mudança de schema ou de UI.
- Vou também atualizar `mem://ia/lentes-de-contato-orcamento` adicionando o caso "Artur Borges" como regressão documentada e a nova proteção contra loop em `interpretar_receita`.
