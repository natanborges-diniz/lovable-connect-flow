## Problema

A Leticia perguntou **"quantos está a Biofinity"** depois do orçamento inicial e a IA respondeu com a frase genérica *"Sobre o que a gente estava falando — quer que eu retome o orçamento ou te ajudo com outra coisa?"*. Ela ficou sem o preço.

A Biofinity existe no catálogo (`pricing_lentes_contato`):
- Biofinity — R$ 285 (mensal, esférica)
- Biofinity Energys — R$ 310
- Biofinity Toric — R$ 390 (tórica, cyl ≥ 0.75)
- Biofinity XR — R$ 310
- Biofinity XR Toric — R$ 655

Ou seja: a informação está no banco, o problema é que a IA não chegou a consultar.

## Causa raiz (no `ai-triage`)

A pergunta foi dropada em **dois pontos**:

1. **`detectForcedToolIntent` não disparou `consultar_lentes_contato`.** O regex de preço/quantidade exige `\bquanto\b`, mas a cliente escreveu **"quantos"** (com "s"). O `\b` final invalida o match. Resultado: nenhum forced intent, nenhum hint determinístico para o LLM.

2. **Não existe regra "marca mencionada = consultar preço daquela marca".** Hoje `LC_BRAND_REGEX` só é usado para *fechamento de pedido* (cliente já escolhendo marca depois de ver opções). Quando o cliente pergunta sobre uma marca específica fora desse fluxo, nada é acionado.

3. Sem forced intent, a resposta gerada caiu na **`deterministicIntentFallback`**, cujo regex de orçamento (`/lente|oculos|comprar|preço|valor|barato/`) também não casa com "quantos está a Biofinity" (não tem nenhuma dessas palavras). Fallback final → frase genérica do `genericPool`.

## Correção proposta

Edição única em `supabase/functions/ai-triage/index.ts`:

### 1. Aceitar variações de "quanto"
No regex de preço dentro de `detectForcedToolIntent` (linha ~299), trocar `\bquanto\b` por `\bquantos?\b|\bqto\b|\bqnto\b` para cobrir "quanto/quantos/qto/qnto".

### 2. Detectar pergunta de preço por marca de LC
Logo antes do bloco de preço/orçamento atual, adicionar um detector novo: se o texto contém uma marca do `LC_BRAND_REGEX` (ex.: "biofinity", "acuvue", "solflex", "dnz") **e** o atendimento já está em contexto LC (`isLCContext`) **e** já há receita salva, forçar `consultar_lentes_contato` com `reason: "cliente perguntou sobre marca específica de LC"`. Isso cobre "quantos está a Biofinity", "tem Acuvue?", "valor da Solflex", etc., independente de typo.

### 3. Reforçar o `deterministicIntentFallback`
Adicionar `biofinity|acuvue|oasys|solflex|dnz|solótica|air optix` ao regex genérico de orçamento (linha ~484), para que mesmo se o forced intent falhar, o fallback responda algo coerente em vez do "Sobre o que a gente estava falando".

### 4. Hint reforçado no prompt do LLM
Quando o forced intent for `consultar_lentes_contato` por causa de marca, injetar um hint específico: *"Cliente perguntou preço de uma marca específica de LC. Chame `consultar_lentes_contato` AGORA filtrando pela marca mencionada e responda com o preço dela e 1-2 alternativas próximas."*

## Resposta imediata para a Leticia (manual, agora)

Enquanto o ajuste vai pra produção, mandar pelo `send-whatsapp` no atendimento dela:

> Oi Leticia! 👋 Sobre a **Biofinity** (Coopervision, mensal):
> - **Biofinity** esférica: **R$ 285/caixa**
> - **Biofinity Energys** (conforto digital, telas): **R$ 310/caixa**
>
> Pra sua receita (-0.75 esf, -0.50 cil), como o cilíndrico é -0.50 (abaixo de 0.75), a esférica comum atende. Combo 3+1 vale: 4 caixas = ~12 meses pelo preço de 3.
>
> Quer que eu reserve a Biofinity ou prefere comparar com a DNZ Mensal (R$ 204,99)?

E registrar nota interna no atendimento `bbd9d1cd-fe27-4963-8967-111ac5b890b0` documentando o gap corrigido.

## Detalhes técnicos

**Arquivo:** `supabase/functions/ai-triage/index.ts`

- Linha ~267: `LC_BRAND_REGEX` já existe — reaproveitar.
- Linha ~270 (`detectForcedToolIntent`): adicionar branch novo de "marca de LC + contexto LC + receita salva" antes do bloco de orçamento.
- Linha ~299: ampliar regex de "quanto".
- Linha ~484 (`deterministicIntentFallback`): incluir marcas de LC no regex de orçamento.
- Linha ~2329/2358: hints do `forcedIntent === "consultar_lentes_contato"` já existem; estender mensagem para o caso "pergunta de preço por marca".

**Memória a atualizar:** `mem://ia/lentes-de-contato-orcamento.md` — adicionar caso "Leticia (abr/2026)" na seção de regressões e a nova regra de detecção por marca.

**Validação:** após deploy, testar via `curl_edge_functions` o `ai-triage` simulando inbound "quantos está a Biofinity" no atendimento de teste, conferir que `consultar_lentes_contato` é chamada e a resposta traz o preço.
