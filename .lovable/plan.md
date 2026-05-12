## Contexto

Atendimento da Thais Santiago: receita confirmada (OD 0/-2,50 / OE 0/-2,75), IA enviou orçamento DNZ. Cliente perguntou "Eu queria uma lente transition. Teria?" — pergunta de **disponibilidade/preço implícita**, com receita compatível e catálogo Hoya/DMAX fotossensível disponível em `pricing_table_lentes` (várias opções entre R$ 471 e R$ 2.000+ cobrindo cil até -4).

A IA respondeu "Pra esses graus específicos preciso confirmar a disponibilidade direto na loja antes de te passar o valor exato. Em qual região/bairro você está?" e foi escalada. Causa raiz:

1. `detectForcedToolIntent` só dispara `consultar_lentes` quando o regex de preço (`preço|valor|quanto|orçamento|custa…`) bate. "Teria?" não casa.
2. O bloco `BRAND_REFINEMENT_RE` (que cobre transitions/varilux/zeiss/etc.) só é avaliado **dentro** do branch de loop detectado (`loopCheck.detected && !forcedIntent`). Sem loop, nunca roda.
3. Sem intent forçado nem refinamento, o LLM caiu em fallback conservador (a regra "PROIBIDO chamar consultar_lentes só porque mencionou tratamento" do bloco `[AGENDAMENTO ATIVO]` reforça esse comportamento — mas a Thais ainda nem agendou).

Resultado: cliente com receita pronta, orçamento prévio e produto compatível foi tratada como ambíguo e empurrada pra fila humana.

## Mudanças

### 1. Novo gatilho em `detectForcedToolIntent` (ai-triage)

Adicionar, **antes** do regex de preço atual, uma regra:

> Se `hasReceitas && !isLCContext` E o inbound contém **tratamento/marca específicos** (`transitions|fotossensiv|fotocrom|antirreflex|filtro azul|blue|polariz|varilux|essilor|eyezen|zeiss|hoya|kodak|dnz|dmax|stellest|crizal`) E o cliente está **perguntando** (frase contém `?`, "tem", "teria", "trabalha", "tem opção", "consegue", "vocês têm" etc.) → retorna `{ tool: "consultar_lentes", reason: "cliente perguntou tratamento/marca específico após receita" }` **com hint estendido** indicando filtro/marca detectado.

Para passar o filtro detectado adiante sem mudar a assinatura pública, retornar via `reason` o token (`reason: "brand_refinement:photo"` / `"brand_refinement:varilux"` etc.) e ler isso no hint.

### 2. Hint dedicado quando `forcedIntent.reason` começa com `brand_refinement:`

No bloco `else if (forcedIntent && (forcedIntent.tool === "consultar_lentes" …))` (linha ~3931), adicionar branch que injeta:

> `[SISTEMA: REFINAMENTO POR TRATAMENTO/MARCA] Cliente já recebeu orçamento e agora pergunta sobre <X>. Há receita salva. AÇÃO OBRIGATÓRIA: chame consultar_lentes AGORA com {filtro_photo:true|filtro_blue:true|preferencia_marca:"…"}. Se houver opções compatíveis, apresente 2–3 com nome de família e preço. Se não houver para esse grau, diga isso explicitamente e ofereça alternativa equivalente. PROIBIDO responder "preciso confirmar na loja" / "preciso verificar disponibilidade" — o catálogo é a fonte da verdade. PROIBIDO escalar.`

Mapeamento token → parâmetro:
- `transitions|fotossensiv|fotocrom` → `filtro_photo:true`
- `blue|filtro azul|antirreflex` → `filtro_blue:true`
- `varilux|essilor|eyezen|crizal|stellest` → `preferencia_marca:"ESSILOR"`
- `zeiss|hoya|kodak|dnz|dmax` → `preferencia_marca` correspondente

### 3. Reaproveitar mesmo guard no bloco `[AGENDAMENTO ATIVO]`

Hoje, quando há agendamento ativo, o prompt manda "trate como preferência registrada e NÃO rode consultar_lentes". Isso é correto para "quero plaquetas douradas", mas não para perguntas diretas de **disponibilidade de tratamento/marca** ("teria transitions?"). Adicionar exceção paralela ao `explicitPriceAsk`: se a inbound for uma **pergunta de disponibilidade** sobre tratamento/marca conhecido, libera rodar `consultar_lentes` com o filtro adequado (sem perguntar região, pois agendamento já existe).

### 4. Reabrir Thais

Após deploy, invocar `ai-triage` com `force_resume:true` para o atendimento `4689bd82-ffb4-438b-bb79-9360e7294e67` para que ela receba o orçamento de fotossensíveis e o atendimento volte ao modo IA (continua em fila humana hoje).

## Arquivos

- `supabase/functions/ai-triage/index.ts` — `detectForcedToolIntent` (~linha 691) + branches de hint (~linhas 3853 e 3931). Sem migration, sem novo secret.

## Memória

Atualizar `mem://ia/regras-negocio-e-proibicoes-criticas` (ou criar `mem://ia/refinamento-tratamento-marca`) registrando: pergunta de disponibilidade de tratamento/marca com receita salva = sempre rodar `consultar_lentes` com filtro correspondente; nunca responder "preciso confirmar na loja" quando o catálogo cobre o grau.

## Validação

1. `read_query` em `mensagens` da Thais antes/depois pra confirmar que a IA enviou opções fotossensíveis (Hoya Sensity / DMAX Foto) com preço e voltou para `modo='ia'`.
2. `edge_function_logs ai-triage` filtrando `brand_refinement` para confirmar o trigger.
3. Caso a tool não retorne nenhuma fotossensível compatível com -2,75 cyl (improvável: Hilux Pronta cobre até -2.0, mas Maxxee/Hilux full e DMAX cobrem -4), a resposta deve dizer isso e oferecer alternativa premium em vez de empurrar pra loja.
