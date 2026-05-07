## Objetivo

Corrigir o gap onde, na 2ª confirmação de receita complexa (cyl>4), a IA caía em fallback mudo "Em qual região/bairro você está?" sem preços e sem ativar `revisao_humana_pendente`.

## Causa raiz

Em `supabase/functions/ai-triage/index.ts`, função `runConsultarLentes`:

1. **G1 anti-loop falso-positivo (linhas ~5436-5442):** o guardrail `fallbackJaEnviado` detecta o prefixo "Pra esse grau específico" nas últimas 3 outbounds e bloqueia a estimativa. Mas quando o cliente acabou de confirmar a receita (`confirmed_by_client_at`), a re-emissão é cotação determinística obrigatória, não loop.
2. **Fallback final mudo (linha ~5532):** mesmo com receita confirmada + complexa, sai sem preço, sem sufixo de revisão e sem ligar a flag.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts` — `runConsultarLentes` (~5436-5532)

- Calcular `rxJaConfirmadaG1 = !!rxMeta?.confirmed_by_client_at` antes do gate.
- `podeFallback` passa a ser `(!fallbackJaEnviado || rxJaConfirmadaG1) && ...` → estimativa sempre roda quando receita acabou de ser confirmada.
- Logar evento `cotacao_estimativa_pos_confirmacao_bypass_g1` quando o bypass aciona.
- No caminho do fallback final ("região/bairro"), antes de retornar: se `rxJaConfirmadaG1 && requerRevisaoHumanaPosOrcamento(rxMeta).precisa`, ligar `atendimentos.metadata.revisao_humana_pendente=true` (com `revisao_motivos` + `revisao_solicitada_at`), gravar evento `revisao_humana_pos_cotacao_fallback_mudo` e anexar `MSG_REVISAO_HUMANA_SUFIXO` à resposta. Nunca deixa cliente em silêncio sem alertar consultor.
- Manter dedup de texto idêntico (similarity >0.85), mas se for o caso, trocar prefixo por "Conforme passei antes, suas opções:" em vez de cair no caminho mudo.

### 2. Memory

Atualizar `mem://ia/pos-confirmacao-forca-cotacao` com:
- "G1 anti-loop é bypassado quando `rxJaConfirmada=true` — re-emissão da estimativa é cotação determinística, não loop."
- "Fallback final 'região/bairro' SEMPRE liga `revisao_humana_pendente` se receita confirmada e complexa (cyl>4 / add>3.5 / sph 8-10)."

## Validação pós-deploy

- Curl `ai-triage` simulando "Sim" após confirmação repetida com cyl=-5,50 → conferir que resposta contém preços + sufixo de revisão.
- Query: atendimentos com evento `consultar_lentes_zero_resultados` últimos 7 dias sem `revisao_humana_pos_cotacao` correspondente → casos órfãos para revisão manual.

## Fora de escopo

- Fluxo de lentes de contato.
- Popover front-end (já lê o flag).
- Thresholds de `requerRevisaoHumanaPosOrcamento` (mantém cyl>4 / add>3.5 / sph 8-10).
