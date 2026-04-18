
## Problema
Hoje "Devolver para IA" dispara **imediatamente** `ai-triage` com gatilho sintético (`[continuidade pós-devolução humano→ia]`), fazendo a IA falar sozinha após a troca. O usuário quer que a IA **aguarde silenciosamente** o cliente responder e só então retome o fluxo normal.

## Mudanças

### 1. `src/pages/Pipeline.tsx` (linhas ~1067-1098)
Remover o bloco que invoca `ai-triage` na devolução humano→IA. Manter apenas:
- update de `modo` para `ia`
- toast "IA reativada — aguardando retorno do cliente"
- invalidações de cache

### 2. `src/pages/Atendimentos.tsx` (linhas ~254-280)
Mesma simplificação: trocar modo, toast informativo, **sem** invocar `ai-triage`.

### 3. `supabase/functions/ai-triage/index.ts`
Garantir que o fluxo normal (disparado pelo `whatsapp-webhook` quando o cliente envia próxima msg) reconheça que houve interlúdio humano e retome com tom natural — isso já é coberto pelo prompt-compiler com histórico completo, então **nenhuma mudança necessária** ali. Apenas remover/desativar tratamento especial de `motivo_disparo === "devolucao_humano_ia"` se houver lógica dedicada.

### 4. Memória — atualizar `mem://ia/continuidade-pos-devolucao-humano`
Reescrever a regra:
- "Devolver para IA" = troca de modo silenciosa.
- IA NÃO fala até o cliente responder.
- Quando o cliente responder, `whatsapp-webhook` dispara `ai-triage` normalmente; histórico inclui últimas falas do humano para contexto natural.

### 5. Memória `mem://index.md`
Atualizar o item "Continuity After Handoff" para refletir o novo comportamento (espera passiva).

## Resultado
- Operador clica "Devolver para IA" → modo muda para `ia`, nenhuma mensagem é enviada.
- Cliente responde a qualquer momento → webhook dispara IA normalmente, com contexto completo do que o humano disse.
- Zero risco de IA falar "sozinha" logo após handoff.
