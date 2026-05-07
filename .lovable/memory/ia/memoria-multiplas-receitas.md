---
name: Memória de Múltiplas Receitas
description: Até 5 receitas em metadata.receitas[]; cada uma carrega confirmed_by_client_at; IA pergunta qual usar e SEMPRE confirma valores antes de cotar
type: feature
---

# Múltiplas receitas no contato

`contatos.metadata.receitas[]` (FIFO, máx 5). Cada item:
```
{
  rx_type, eyes, confidence, label, source, data_leitura,
  confirmed_by_client_at: ISO | null
}
```

## Regras
- Toda receita lida via OCR começa com `confirmed_by_client_at: null`.
- Quando há ≥2 receitas, IA pergunta "Para qual receita?" antes de cotar (system hint em `receitaCtx`).
- Cliente escolhendo uma ainda não confirmada (ex.: "a segunda", "a nova", "a primeira") → `detectEscolhaReceita` re-arma `receita_confirmacao.pending=true` com `rx_index` e dispara `buildMsgConfirmarReceita`.
- Confirmação do cliente (`detectRxConfirmation`) marca `confirmed_by_client_at` da receita-alvo (rx_index ou última) e libera fluxo.
- Safety net pós-LLM: se `resposta` contém preços/`R$` ou tool de quote, e há receita `confirmed_by_client_at=null`, sobrescreve com pedido de confirmação. Evento `bloqueado_orcamento_receita_nao_confirmada`.

## Caso 558488766851 (mai/2026)
Cliente tinha receita 1 confirmada, mandou foto de receita 2. IA leu e perguntou qual usar; cliente disse "A segunda" e IA cotou direto sem confirmar valores da segunda. Corrigido pelos gates 4.4a + safety pós-LLM.
