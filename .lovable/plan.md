## Implementado: Detalhamento/Comparação de Lentes Pós-Orçamento

### Problema
Após enviar orçamento (DNZ / Essilor / Zeiss), cliente pediu "Detalhe a essilor e a zeiss" e a IA respondeu com fallback genérico "Conta pra mim com mais detalhes…" — não detalhou as opções já cotadas.

### Causa raiz
- Sem instrução específica para o caso "detalhar/comparar opção já enviada".
- LLM gerava resposta similar à anterior → validador rejeitava por similaridade >70% → caía no `VALIDATOR_FAILED_POOL` genérico.
- Sem fallback determinístico para detalhamento.

### Mudanças em `supabase/functions/ai-triage/index.ts`

1. **Detector `isDetalhamentoContext`** (após `isLCContextGlobal`): dispara quando msg atual contém intent (`detalh|diferença|comparar|qual a melhor|vantagem`) OU menciona uma marca extraída do orçamento recente nas últimas 3 outbound (regex sobre formato `🔍 *Opções* / 💚 / 💛 / 💎`).

2. **Bloco de prompt `[FLUXO DETALHAMENTO/COMPARAÇÃO DE LENTES]`** injetado no array `messages` quando o detector dispara: inclui o orçamento original, lista das marcas detectadas, conhecimento técnico de cada marca (DNZ, Essilor, Zeiss, Hoya, Kodak), regras de formato (1 parágrafo curto por marca, fechamento com 1 pergunta entre escolher ou agendar) e exemplo de resposta.

3. **Bypass do validador de similaridade**: aceita resposta longa (>120ch) que mencione pelo menos uma marca do orçamento, mesmo com similaridade alta — reuso de termos técnicos é esperado.

4. **Fallback determinístico `detalhamentoFallback()`**: se LLM falhar mesmo após retry, monta resposta a partir do conhecimento embutido das marcas + marcas citadas pelo cliente. Substitui `pickFallback` (genérico) nos dois pontos do validador. Nunca cai em "conta pra mim mais detalhes".

### Memória criada
- `mem://ia/comparacao-lentes-detalhamento.md` — conhecimento técnico/comercial de cada marca (DNZ, Essilor, Zeiss, Hoya, Kodak, Solflex), tabela comparativa Essilor × Zeiss, formato esperado da resposta, regras anti-loop.

### Deploy
Edge function `ai-triage` redeployada.

### Resultado esperado
Cliente: *"Detalhe a essilor e a zeiss"*

Gael: 1 parágrafo curto por marca com diferenciais técnicos reais (Crizal Prevencia / DuraVision Platinum / BlueGuard integrado) + pergunta de fechamento entre Essilor / Zeiss / agendar visita. Sem fallback genérico.
