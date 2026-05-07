---
name: Router de armações exige verbo + bypass receita
description: POST-DATA router de "modelos/armações" só dispara com verbo de pedido; bypassa quando cliente afirma receita ou já recebeu o convite
type: feature
---

# Router de armações — gatilho estreito

Local: `supabase/functions/ai-triage/index.ts` (POST-DATA ROUTER, ~linha 2036).

## Antes (bug)
Regex disparava em QUALQUER menção a "armação/modelo", incluindo:
- "já tenho a armação" → resposta = convite presencial (errado, era resposta à pergunta da IA)
- "não preciso de armação" → mesma resposta (loop)
- "não" subsequente sem palavra → não disparava, mas as 2 anteriores já tinham disparado 3x → loop_escalation → humano

## Agora
Disparo exige TODOS:
1. `ARM_WORD` (armação/modelo) presente
2. `VERBO_PEDIDO` presente (quero, mostra, ver, tem, qual, foto, catálogo, trabalha com…)
3. NÃO houver `NEGACAO` próxima ("não preciso de armação")
4. NÃO houver `POSSE` próxima ("já tenho armação", "uso a minha")
5. Cliente NÃO afirmou ter receita nos últimos 3 inbounds (`TEM_RECEITA`)
6. `contatoMeta.armacoes_orientado !== true` (anti-loop duro: mandamos só uma vez)

## Resultado
"Já tenho a armação e tenho receita" → router NÃO dispara → fluxo normal pede foto da receita.
"Quero ver armações Ray-Ban" → router dispara normalmente.
