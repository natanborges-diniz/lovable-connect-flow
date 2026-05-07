## Causa raiz

Tati já tinha receita confirmada (`-13,50 / -20,50`). Ao enviar nova foto, o LLM viu `hasValidReceitas=true` + bloco `[FLUXO PÓS-RECEITA OBRIGATÓRIO]` e ficou sem chamar tool. Caiu no fallback determinístico que respondeu "Recebi sua receita 👀… analisando" e parou — o `9.4 FORCED RETRY` não dispara porque está condicionado a `!hasValidReceitas`.

## Mudanças em `supabase/functions/ai-triage/index.ts`

1. **Detectar nova receita pendente** (perto da linha 2138):
   - Computar `lastInboundImageAt` (max `created_at` de inbound image em `last5Inbound`).
   - Computar `lastReceitaAt` (max `data_leitura` em `receitas[]`).
   - `hasPendingNewPrescriptionImage = lastInboundImageAt && (!lastReceitaAt || lastInboundImageAt > lastReceitaAt)`.
   - Reforço por intent: regex `/nova receita|outra receita|receita nova|receita atualizada|tenho (uma )?receita/i` em últimos 3 inbounds próximos da imagem.

2. **`isImageContext`**: incluir `hasPendingNewPrescriptionImage` independentemente de `hasValidReceitas`.

3. **Hint de prompt** (~linha 2963/2974): se `hasPendingNewPrescriptionImage`, substituir o bloco "FLUXO PÓS-RECEITA OBRIGATÓRIO" por um `[SISTEMA: NOVA RECEITA PENDENTE]` que ordena `interpretar_receita` AGORA com a imagem nova e proíbe `consultar_lentes` com a receita antiga.

4. **Force-retry** (linha 4576): estender condição
   ```
   precisaForcarInterpretacao =
     (isImageContext && !hasValidReceitas && !interpretouReceitaNesteTurno && !precisa_humano)
     || (hasPendingNewPrescriptionImage && !interpretouReceitaNesteTurno && !precisa_humano);
   ```
   O sucesso do retry já faz append em `metadata.receitas[]` (FIFO 5) e marca `receita_confirmacao.pending=true` — preserva receita anterior.

5. **Quote-engine** (linha 3382 e adjacentes): bloquear `consultar_lentes` quando `hasPendingNewPrescriptionImage=true`, devolvendo confirmação da nova OCR antes.

## Memória

Atualizar `mem://ia/auto-receita-e-anti-loop` com seção "Nova receita após confirmada": gatilho por timestamp + intent, force-retry estendido, proibição de cotar com receita antiga até OCR rodar.

## Validação pós-deploy

Reenviar foto de receita em conversa com receita já confirmada → log `[FORCE-INTERPRETAR] Receita salva via retry` ou tool_call `interpretar_receita` + mensagem de confirmação com novos valores. Não pode mais parar em "estou analisando".

## Fora de escopo

- Parser de correção por texto (já corrigido — caso Franciana).
- Mudanças de copy além dos hints citados.
