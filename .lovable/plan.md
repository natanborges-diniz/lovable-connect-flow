## Diagnóstico

A confirmação dos valores **já está implementada** no caminho normal da tool `interpretar_receita` (`ai-triage/index.ts` linha 3274-3301): salva `receita_confirmacao.pending=true` no contato e devolve a mensagem canônica via `buildMsgConfirmarReceita(...)`.

Só que esse atendimento da Franciana **não passou pelo caminho normal** — passou pelo **FORCED RETRY** (bloco `9.4`, linhas 4019-4116). Os logs confirmam:

```
[FORCE-INTERPRETAR] Imagem pendente sem chamada de interpretar_receita — forçando retry
[FORCE-INTERPRETAR] Receita salva via retry (lc=false)
[RESULT] validator=...,forced_interpretar_receita_retry_ok
```

E nesse ramo, na linha **4090**, a resposta é hardcoded:

```ts
resposta = `Prontinho, consegui ler sua receita 😊\n${odSummary}\n${oeSummary}\n\nJá vou separar opções de ${ctxLC} compatíveis. Em qual região/bairro você está...`;
```

Ou seja: salva a receita, pula a confirmação e já pede região. Foi exatamente o que apareceu pra Franciana.

## Correção

No bloco de sucesso do retry forçado (linhas 4069-4095 do `ai-triage/index.ts`), espelhar o comportamento do caminho normal:

1. Após salvar a receita em `contatos.metadata.receitas`, gravar também `metadata.receita_confirmacao = { pending: true, rx_label, asked_at, correction_count: 0 }`.
2. Inserir evento `receita_confirmacao_solicitada` em `eventos_crm` (com `metadata.source = "ocr_forced_retry"` pra distinguir nos logs).
3. Trocar a mensagem hardcoded "Prontinho... Em qual região..." por `buildMsgConfirmarReceita(rxWithLabel, false)` — a mesma usada no caminho normal.
4. Manter `validatorFlags.push("forced_interpretar_receita_retry_ok")` e adicionar `"receita_confirmacao_solicitada"` pra rastreabilidade.

Não toco no ramo `lowConfidence` (já pede dados por texto, comportamento correto) nem no fluxo pós-confirmação (já existe e dispara `consultar_lentes` quando o cliente confirma).

## Arquivos

- `supabase/functions/ai-triage/index.ts` — único arquivo alterado (~15 linhas dentro do bloco do retry forçado).

## Memória

- Atualizar `mem://ia/auto-receita-e-anti-loop.md` adicionando nota: "Forced retry interpretar_receita também precisa pedir confirmação (espelha caminho normal)" pra não regredir.
