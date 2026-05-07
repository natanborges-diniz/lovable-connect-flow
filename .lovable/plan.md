## Problema (caso 558488766851 — 21:38–21:48)

Cliente já tinha **receita 1** confirmada e mandou uma **receita 2** (foto). A IA leu a segunda (`interpretar_receita`), perguntou "Uso qual receita...", o cliente respondeu **"A segunda"** e a IA pulou direto para `consultar_lentes`, **sem confirmar com o cliente os valores lidos da nova receita**.

Hoje o gate `receita_confirmacao` (`ai-triage/index.ts` ~L2129, L3622, L4116) trata `pending` como flag **global do contato**, não por receita. Quando a primeira foi confirmada (`pending=false`) e depois a IA fez uma pergunta de desambiguação sem re-armar o pending na receita 2, o "A segunda" caiu no LLM normal e virou orçamento.

## Regra final

Toda receita lida via OCR (1ª, 2ª, 3ª…) precisa ser **explicitamente confirmada pelo cliente antes de virar base de orçamento**. Quando há múltiplas receitas e o cliente escolhe uma ainda não confirmada, a IA precisa mostrar `Li sua receita assim, confere? 😊` com os valores DAQUELA receita antes de chamar `consultar_lentes`.

## Mudanças

### 1. `supabase/functions/ai-triage/index.ts` — marcar confirmação por receita

**a) No salvamento da receita (~L3598–3606 e L4470–4491, force-interpretar):**
- Adicionar `confirmed_by_client_at: null` em `rxWithLabel` antes do append em `existingReceitas`.
- Manter o `receita_confirmacao` global como hoje (controla o gate "estamos esperando confirmação").

**b) Quando o cliente confirma (~L2135–2180, bloco `detectRxConfirmation`):**
- Além de setar `receita_confirmacao.pending=false`, marcar a última receita de `receitas[]` com `confirmed_by_client_at = now` e regravar `metadata.receitas`.

### 2. Novo helper `detectEscolhaReceita(text, receitas)`

Regex/heurística leve em ~L180 (junto dos outros `detect*`):
- "primeira / 1ª / a 1 / receita 1 / a antiga / a anterior" → idx 0
- "segunda / 2ª / a 2 / receita 2 / a nova / a última / essa última / a recente / a de agora / a que mandei agora" → último idx
- Numeração explícita ("a 3") quando `receitas.length >= n`.
- Retorna `{ idx, label } | null`.

### 3. Novo gate "escolha de receita não confirmada" (logo após o bloco do gate atual, ~L2225)

```
if (!isReceitaPending(...) && receitas.length >= 2 && !lastIsImage) {
  const escolha = detectEscolhaReceita(lastInboundText, receitas);
  if (escolha) {
    const rxEscolhida = receitas[escolha.idx];
    if (!rxEscolhida.confirmed_by_client_at) {
      // Re-arma pending para ESSA receita
      contatoMeta.receita_confirmacao = {
        pending: true,
        rx_label: rxEscolhida.label || `receita_${escolha.idx + 1}`,
        rx_index: escolha.idx,
        asked_at: now,
        correction_count: 0,
        fora_da_faixa: isReceitaForaDaFaixa(rxEscolhida),
      };
      await supabase.from("contatos").update({ metadata: contatoMeta }).eq("id", contatoId);
      await sendWhatsApp(..., buildMsgConfirmarReceita(rxEscolhida, false));
      eventos_crm: "receita_escolhida_aguardando_confirmacao";
      return jsonResponse({ status: "ok", tools_used: ["receita_aguardando_confirmacao"], ... });
    }
    // Se já confirmada, deixa fluxo normal seguir, mas injeta hint pro LLM usar essa receita
  }
}
```

E quando `rx_index` está presente em `receita_confirmacao`, o `detectRxConfirmation` aplica `confirmed_by_client_at` na receita correta (não só na última).

### 4. Pós-LLM safety net (~L4116, onde já existe `rxConfirmGateTriggered`)

Antes de aceitar a `resposta` final, se `receitas.length >= 2`, alguma receita está com `confirmed_by_client_at = null`, e o turno atual gerou intent de orçamento (`consultar_lentes`/`consultar_lentes_contato`/resposta com preços), substituir a resposta por `buildMsgConfirmarReceita(receitaPendente, false)` + setar `receita_confirmacao.pending=true` para essa receita. Loga `flag: "bloqueado_orcamento_receita_nao_confirmada"`.

### 5. `watchdog-loop-ia/index.ts`

Adicionar `buildMsgConfirmarReceita` (regex `^Li sua receita assim, confere|^Anotei! Ficou assim`) à allowlist de não-loop quando o último inbound for escolha de receita ("a segunda" etc.) — já existe `CONFIRM_RX_RE` parcial; ampliar.

### 6. Memória

- Atualizar `mem://ia/auto-receita-e-anti-loop.md` com o caso (cliente escolhe nova receita após múltiplas leituras → confirmar antes de cotar).
- Adicionar `confirmed_by_client_at` por receita ao schema descrito em `mem://ia/memoria-multiplas-receitas`.

## Out of scope

- Mudar a forma como o LLM faz a pergunta "Uso qual receita...?" (continua via prompt).
- Confirmação de receita digitada por texto (já tratada por `correcao-receita-por-texto`).
- Backfill de `confirmed_by_client_at` em receitas antigas (só novas receitas a partir desta mudança).

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts`
- `supabase/functions/watchdog-loop-ia/index.ts`
- `.lovable/memory/ia/auto-receita-e-anti-loop.md`
- `.lovable/memory/ia/memoria-multiplas-receitas.md`
