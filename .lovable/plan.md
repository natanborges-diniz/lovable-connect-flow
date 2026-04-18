
## Diagnóstico
Cliente "Ju" pediu **modelos de óculos** (armações) — IA respondeu duplicando o orçamento de **lentes** (já enviado). Dois problemas:

1. **Confusão semântica:** "modelos de óculos" = armações, não lentes. IA não distingue.
2. **Duplicação:** mesma resposta enviada 2× seguidas (falha de debounce na rota `consultar_lentes`).

## Regra de negócio
Não temos catálogo digital de armações em banco. Política: **armações são experimentadas presencialmente** (memória `mem://ia/regras-de-terminologia-e-produto`: usar "provar armações" na loja, nunca "experimentar lentes"). IA NÃO deve listar/inventar modelos de armação — deve convidar para a loja.

## Implementação

### 1) `supabase/functions/ai-triage/index.ts` — detector "modelos/armações"
Adicionar detecção determinística antes da rota de quote:
- Regex: `/\b(modelo|modelos|armaç|armacao|armações|óculos.*(?:mostrar|enviar|ver|foto|catálogo|catalogo))\b/i` no texto do cliente.
- Se acionado E não houver pedido explícito de "lente/grau/orçamento de lente", forçar resposta determinística (sem chamar tool de lentes):
  > "Sobre armações, a gente trabalha com várias marcas e estilos (Ray-Ban, Oakley, Vogue, Carolina Herrera, Diniz exclusivas, infantis, esportivas...). Como o caimento muda muito de rosto pra rosto, o ideal é provar pessoalmente — a gente separa várias opções pra você no balcão 😊
  > 
  > Quer agendar uma visita? Temos *Antônio Agú* (centro), *União Osasco* e *SuperShopping*. Qual fica melhor pra você?"
- Marcar no metadata `armacoes_orientado: true` para anti-loop.

### 2) Anti-duplicação reforçada
No mesmo handler, antes de responder com bloco "Opções de lentes para o seu grau", checar última mensagem outbound:
- Se conteúdo idêntico (>90% similar) enviado nos últimos 60s → **abortar segunda emissão** e logar `[DEDUPE] consultar_lentes duplicado bloqueado`.
- Já existe `seenOutboundContent` em alguns pontos; estender para a saída da tool `consultar_lentes` formatada.

### 3) Memória nova `mem://ia/armacoes-presencial.md`
- "Modelos/armações = produto presencial. IA nunca lista marcas inventadas nem promete catálogo. Sempre convidar pra loja com as 3 unidades de Osasco."
- Atualizar `mem://index.md` Core: "Armações nunca listadas digitalmente — convite presencial com 3 lojas."

### 4) Resposta operacional imediata para Ju
Enviar manual via `send-whatsapp` no atendimento ativo, remetente "Consultor Diniz":
> "Oi Ju! Desculpa a confusão — você pediu *modelos de armação*, não de lente 🙈
> 
> A gente trabalha com várias marcas (Ray-Ban, Oakley, Vogue, Carolina Herrera, linha Diniz exclusiva, infantis e esportivas). Como caimento e estilo dependem muito do seu rosto, o ideal é provar pessoalmente — separamos várias opções pra você no balcão.
> 
> *Nossas lojas:*
> 📍 Antônio Agú (centro Osasco)
> 📍 União Osasco (shopping)
> 📍 SuperShopping (até 22h)
> 
> Quer que eu reserve um horário? Me diz o dia e a unidade 😊"

## Arquivos
- `supabase/functions/ai-triage/index.ts` (detector + dedupe)
- `.lovable/memory/ia/armacoes-presencial.md` (nova)
- `.lovable/memory/index.md` (atualizar Core)
- Ação operacional: `send-whatsapp` para atendimento da Ju
