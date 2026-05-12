## Diagnóstico

A regra `brand_refinement` (transitions/fotossensível/varilux/etc.) já existe em `ai-triage` (linhas 751–773 e 3936–3981). Catálogo `pricing_table_lentes` tem **>10 opções fotossensíveis** compatíveis com o grau da Thais (OD 0/-2,50, OE 0/-2,75) entre R$ 471 (DMAX 1.56 Foto) e R$ 1.599 (Hoya Hilux Sensity), incluindo Sensity Original/2 e Foto Filtro Azul.

Mesmo assim, no atendimento `4689bd82-ffb4-438b-bb79-9360e7294e67`, após o deploy, a IA respondeu:
- "Encontro as opções fotossensíveis certinhas pra seu grau direto na loja, pode ser?"
- "Encontro as opções fotossensíveis compatíveis com seu grau agora e te aviso na sequência."

Ou seja: o **hint de brand_refinement chegou, mas o modelo gerou frase-aguarde em vez de chamar `consultar_lentes`**. É exatamente o mesmo anti-pattern já tratado para receita ("Já estou analisando…" sem follow-up). Aqui não há fallback que force a tool — o forced-retry de receita (bloco 9.4) só dispara para `interpretar_receita` em `isImageContext`.

## Mudanças

### 1. Forced retry para `consultar_lentes` em brand_refinement
Em `supabase/functions/ai-triage/index.ts`, espelhar o bloco 9.4 (forced retry de `interpretar_receita`) com um novo bloco logo antes do guardrail "dois caminhos":

- Disparo: `forcedIntent?.tool === "consultar_lentes"` AND `forcedIntent.reason?.startsWith("brand_refinement:")` AND **a 1ª resposta do modelo NÃO chamou `consultar_lentes`** (nenhum tool_call do nome no turno).
- Ação: 2ª chamada ao gateway com `tool_choice: { type: "function", function: { name: "consultar_lentes" } }`, passando os parâmetros derivados do token (`filtro_photo:true` para photo, `filtro_blue:true` para blue, `preferencia_marca:"…"` para varilux/zeiss/hoya/dnz/dmax/kodak).
- Processa o tool_call inline, formata 2–3 opções (família + índice + tratamento + preço) e devolve resposta amigável.
- Se a tool retornar 0 opções compatíveis, devolve mensagem específica ("para o seu grau não tenho fotossensível em estoque na faixa X, mas posso oferecer Y") em vez de empurrar para loja.
- Flags de log: `forced_consultar_lentes_retry_ok` / `forced_consultar_lentes_zero_results`.

### 2. Bloquear frases-aguarde sem follow-up
No guardrail logo após o forced retry, descartar a resposta se contiver `(encontro|busco|procuro|verifico|confirmo) .*(opções|fotossens|lentes).*(agora|sequência|já|um instante|pode ser)` E `forcedIntent` for brand_refinement E nenhuma tool foi chamada. Substituir pelas opções formatadas (mesmo caminho do retry).

### 3. Reabrir Thais
Após deploy, invocar `ai-triage` com `force_resume:true` em `4689bd82-ffb4-438b-bb79-9360e7294e67` para que ela receba a lista de fotossensíveis e o atendimento volte a `modo='ia'`.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — novo bloco de forced retry (~próximo ao bloco 9.4 existente) + guardrail anti-stall. Sem migration, sem secret.

## Memória

Atualizar `mem://ia/auto-receita-e-anti-loop` (ou criar nó irmão) registrando: padrão "frase-aguarde sem follow-up" também se aplica a `consultar_lentes` em brand_refinement — se prometeu opções, tem que listar no mesmo turno.

## Validação

1. `read_query` em `mensagens` da Thais para confirmar que a próxima outbound traz 2–3 fotossensíveis com preço.
2. `edge_function_logs ai-triage` filtrando `forced_consultar_lentes_retry_ok`.
3. Confirmar `atendimentos.modo='ia'` após o force_resume.
