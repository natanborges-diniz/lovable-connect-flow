# Fix: IA silencia após correção de receita por texto (caso Eduardo)

## Causa raiz

No gate 6.4 do `ai-triage/index.ts` (linhas 4840-5040), quando o cliente clica em ✏️ Corrigir e digita a receita:

- Se a correção é **alto impacto** (Δsphere≥0.75D ou |sphere|≥8D), o código envia `buildMsgConfirmarReceita` deterministicamente e dá `return` antes do LLM. ✅
- Se a correção é **igual ou de baixo impacto** (caso do Eduardo: digitou os mesmos valores do OCR), o código só marca `confirmed_by_client_at=null`, monta `receitaCtx` com hint "vá DIRETO para consultar_lentes" e devolve ao LLM. ❌

O LLM frequentemente não dispara a tool nessa situação e cai em fallback genérico ("Conta pra mim com mais detalhes…"). O safety-net pós-LLM só intercepta saídas contendo `R$` — uma resposta genérica passa.

## Mudança

No gate 6.4, tratar **toda correção textual** (qualquer magnitude, inclusive valores idênticos aos da última leitura) como determinística:

1. Após persistir a receita corrigida (`merged` com `confirmed_by_client_at=null`), **sempre** chamar `sendReceitaConfirmInteractive(...)` com `buildMsgConfirmarReceita(merged, true)` e dar `return` antes do LLM.
2. Setar `metadata.receita_confirmacao = { pending:true, rx_index, asked_at, correction_count:+1, reason: isHighImpact ? "high_impact_correction" : "low_impact_correction" }`.
3. Limpar `ia_lock` (igual ao ramo atual de alto impacto).
4. Evento `receita_corrigida_pelo_cliente` (já existe) com `confirmacao_enviada:true`.
5. **Manter** a escalada após 3 correções consecutivas sem confirmação (já existe).
6. **Manter** o ramo standalone-typed (receita digitada do zero sem pedido prévio) intacto.

Resultado: Eduardo verá a mesma mensagem "Li sua receita assim, confere? OD … / OE …" com botões ✅ Tá certo / ✏️ Corrigir após qualquer redigitação. Ao clicar ✅, gate `isReceitaPending` marca `confirmed_by_client_at` e libera cotação.

## Arquivo

- `supabase/functions/ai-triage/index.ts` — gate 6.4 (~linhas 4910-5014). Mover o bloco `sendReceitaConfirmInteractive + return` para fora do `if (isHighImpact)`, mantendo a escalada em `corrCount>=3` dentro dele.

## Memória

Atualizar `mem://ia/correcao-receita-por-texto.md`: "Toda correção textual reenvia confirmação determinística com os valores merge (mesmo se idênticos à última leitura). Sem confirmação implícita."
