## Diagnóstico do caso Emerson

Linha do tempo no banco:
- 14:55:12 — cliente envia foto da receita.
- 14:56:18 — IA responde "Recebi sua receita 👀 Já estou analisando…" (fallback determinístico de imagem em `ai-triage` linha 1008).
- Nenhum evento `receita_interpretada` ou `receita_confirmacao_solicitada` foi gravado → **OCR nunca rodou com sucesso**.
- 16:00 — `vendas-recuperacao-cron` dispara `retomada_contexto_1` 2× porque atendimento ficou "silencioso".
- 16:06 — `watchdog-loop-ia` marca como loop.

A frase "analisando…" deveria ser substituída em até 1 turno por:
- (a) `interpretar_receita` salvando a receita, **ou**
- (b) `MSG_PEDIR_RECEITA_TEXTO` ("não consegui ler, me passa por texto OD/OE…").

Existe um **forced retry** em `ai-triage` (linha 5227+) que tenta forçar `tool_choice=interpretar_receita`. No caso do Emerson ele:
- não retornou tool_call (modelo recusou), **ou**
- lançou exceção silenciosa, **ou**
- `isImageContext` virou false até esse ponto.

Em qualquer um desses três ramos a `resposta` permanece como "analisando…" e o cliente fica esperando indefinidamente — exatamente o que o usuário relatou.

## Plano

### 1. `ai-triage`: failsafe quando o forced retry não consegue salvar receita

Em `supabase/functions/ai-triage/index.ts` no bloco `precisaForcarInterpretacao` (linha 5235+):

- Detectar se a `resposta` atual é a frase determinística de "analisando" (regex `MSG_ANALISANDO_RE` já existe na linha 365).
- Quando o forced retry **não** produz `interpretar_receita` (modelo sem tool_call, HTTP erro, exceção, ou args vazios) **e** `resposta` casa com `MSG_ANALISANDO_RE`, **substituir** por `MSG_PEDIR_RECEITA_TEXTO` antes de enviar e adicionar flag `force_interpretar_failed_pedindo_texto`.
- Já existe ramo de low-confidence que faz isso após 1 falha; precisamos do mesmo comportamento quando o retry sequer retorna tool_call.

Resultado: cliente recebe **na mesma resposta** o pedido para digitar OD/OE em vez de "analisando…" pendurado.

### 2. Watchdog para casos onde nenhum forced retry rodou

Em `supabase/functions/watchdog-inbound-orfao/index.ts` (cron 1min, já varre 113 atendimentos):

- Adicionar passo: se o último outbound de um atendimento `modo=ia` casa com `MSG_ANALISANDO_RE`, foi enviado há **>2min e <30min**, e **não existe** evento `receita_interpretada` posterior nem `receita_confirmacao_solicitada` nem mensagem outbound posterior, então:
  - Enviar `MSG_PEDIR_RECEITA_TEXTO` direto via `send-whatsapp`.
  - Gravar evento `receita_ocr_orfao_pedido_texto`.
  - Marcar `metadata.ocr_falhas_count += 1` no contato.
  - Se `ocr_falhas_count >= 2`, escalar pra humano (`atendimentos.modo=humano`, `revisao_humana_pendente=true`, motivo `ocr_orfao_2_falhas`) com a mensagem padrão dentro/fora do horário.

Isso fecha o buraco para conversas em produção onde o forced retry inline já falhou e o cliente está parado esperando.

### 3. Reforçar tratamento de "não consigo digitar" → humano

Verificar/adicionar no `ai-triage`: quando o último outbound foi `MSG_PEDIR_RECEITA_TEXTO` e o cliente responde com regex tipo `n[ãa]o (consigo|sei|tenho como) (digitar|passar|ler)|t[ôo] sem (a )?receita aqui|n[ãa]o entendo (de|nada)|me ajuda` → escalar pra humano com mensagem "Sem problema, vou chamar alguém da equipe pra te ajudar com isso 🙌" (ou `mensagemEscaladaForaHorario` fora do expediente). Evento `receita_texto_recusada_escalado_humano`.

### 4. Memória

Atualizar `mem://ia/auto-receita-e-anti-loop.md` adicionando o failsafe pós forced-retry e a nova rota do watchdog-inbound-orfao para "analisando órfão".

## Fora do escopo

- Mudar o modelo de OCR ou prompt de `interpretar_receita` (problema é entrega/persistência, não qualidade do OCR neste caso).
- Mexer em `vendas-recuperacao-cron` (a recuperação só disparou porque a IA travou — corrigindo a trava, o cron volta a se comportar).
- Backfill em conversas antigas (Emerson e similares ficam para o operador resolver manualmente).

## Arquivos afetados

- `supabase/functions/ai-triage/index.ts` (failsafe pós forced retry + tratamento "não consigo digitar")
- `supabase/functions/watchdog-inbound-orfao/index.ts` (novo passo de "analisando órfão")
- `.lovable/memory/ia/auto-receita-e-anti-loop.md` (atualização)
