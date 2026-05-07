## Objetivo
Garantir que toda correção de receita digitada com impacto alto (mudança ≥0,75D ou esfera ≥8D) passe por confirmação explícita do cliente antes de cotar/escalar, suavizar o tom para "lente especial/personalizada" e corrigir crashes de runtime causados por `.catch()` em queries Supabase.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts` — Gate de confirmação pós-correção
- No bloco de `detectPrescriptionCorrection` (após persistir a correção):
  - Calcular delta entre receita anterior e a nova (esfera OD/OE).
  - Se `|Δsphere| ≥ 0.75` em qualquer olho **ou** `|sphere| ≥ 8` em qualquer olho → setar `metadata.receita_confirmacao = { pending: true, rx_index: <novo>, reason: "high_impact_correction" }` e disparar `buildMsgConfirmarReceita` em vez do hint que força `consultar_lentes`.
  - Marcar `confirmed_by_client_at: null` na receita recém-gravada.
- Garantir que o safety-net pós-LLM (já existente em `memoria-multiplas-receitas`) bloqueie qualquer R$ / tool de quote enquanto `pending=true`.

### 2. Tom sutil para grau alto
- Substituir copies "grau alto"/"grau muito alto" por "lente especial" / "lente personalizada" em:
  - Fallback de `consultar_lentes` (mensagem quando esfera absurda/alta).
  - System hints de escalada por grau alto.
- Mensagem-padrão sugerida: *"Por ser uma lente especial/personalizada, vou te conectar com um consultor pra montar o orçamento certinho 👌"*.

### 3. Fix `.catch()` em Supabase builders
- Varrer `ai-triage/index.ts` (linhas ~2282–4232) e substituir `await supabase.from(...).insert(...).catch(...)` por `try { await ... } catch (e) { console.error(...) }`. Mesmo tratamento para `update`/`upsert`.

### 4. Memória
- Atualizar `.lovable/memory/ia/correcao-receita-por-texto.md`: adicionar seção "Confirmação obrigatória em correções de alto impacto" (regra Δ≥0,75D ou |esf|≥8D).
- Atualizar `.lovable/memory/ia/memoria-multiplas-receitas.md`: cross-ref ao novo gate.
- Ajustar core do `mem://index.md` se necessário (one-liner sobre "correção alto impacto exige confirmação").

## Fora de escopo
- Reformular OCR ou parser.
- Mudar fluxo de escalada humano além da copy.

## Validação
- Redeploy `ai-triage`.
- Watchdog `watchdog-inbound-orfao` re-dispara conversas pendentes (Manel).
- Conferir logs: deve aparecer `receita_corrigida_alto_impacto` + msg de confirmação enviada antes de qualquer escalada.
