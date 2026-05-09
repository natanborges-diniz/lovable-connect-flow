
# Receita vazia indo para confirmação — fix

## Diagnóstico (caso Yuri)

`supabase/functions/ai-triage/index.ts`, ramo de pós-OCR (linhas 4000–4051):

```text
if (rxJustValid && !explicitOptOut)        → pede confirmação (correto)
else if (needsHumanReview)                 → MSG_PEDIR_RECEITA_TEXTO (correto)
else                                       → resposta = args.resposta  ← BUG
```

A foto do Yuri não era receita. A tool `interpretar_receita` voltou com `eyes.od = {}` / `eyes.oe = {}` (todos null) **e `confidence ≥ 0.80`**. Por isso:

- `rxJustValid` = false (sem `sphere`/`cylinder` numéricos → `isReceitaValida` reprova).
- `needsHumanReview` = false (`confidence` alta).
- Caiu no `else` final → **mandou o `args.resposta` cru do LLM**, que mimetizou o template `buildMsgConfirmarReceita` e disparou "Li sua receita assim, confere? ESF ? CIL ? EIXO ?°".

Quando o Yuri respondeu "Isso", o gate em `~2257` (`detectRxConfirmation`) marcou a receita vazia como confirmada e iria disparar `runConsultarLentes` com receita zerada — degenerando para escalada genérica.

Sintoma adicional: ainda existem casos de OCR retornar `confidence` baixa **mas sem entrar como `totalmenteIlegivel`** (rxType detectado como `single_vision` porque o modelo devolveu `sphere: 0`); o ramo `needsHumanReview` envia "Consegui ler boa parte da sua receita…" — também enganoso para foto que não é receita.

## Correção

### 1. Hard guard pós-OCR (`fn === "interpretar_receita"`)

Antes do bloco `if (rxJustValid && !explicitOptOut)`, calcular um sinal mais rigoroso:

```ts
const odNumCount = ["sphere","cylinder","axis","add"].filter(k => typeof od[k] === "number").length;
const oeNumCount = ["sphere","cylinder","axis","add"].filter(k => typeof oe[k] === "number").length;
const ocrSemValores = (odNumCount + oeNumCount) === 0;       // nenhum número em nenhum olho
const ocrEsfericoZerado =                                      // só sphere=0 em ambos, sem cyl/axis/add
  odNumCount + oeNumCount > 0 &&
  ![od.cylinder, oe.cylinder, od.axis, oe.axis, od.add, oe.add].some(v => typeof v === "number") &&
  (od.sphere === 0 || od.sphere == null) && (oe.sphere === 0 || oe.sphere == null);
const ocrInutil = ocrSemValores || ocrEsfericoZerado || rxType === "unknown";
```

Se `ocrInutil` → forçar `MSG_PEDIR_RECEITA_TEXTO`, **independente de `confidence`**, e:

- **Não** salvar a receita inútil em `receitas[]` (hoje salva mesmo com `rxType=unknown`).
- **Não** setar `receita_confirmacao.pending`.
- Gravar evento `receita_ocr_inutil` com `{ confidence, rxType, odNumCount, oeNumCount }`.
- Usar `validatorFlags.push("ocr_inutil_pedindo_texto")`.

Substitui o `else { resposta = args.resposta }` cego — o `args.resposta` só é aceito quando `rxJustValid=true` (atualmente já é, mas hoje o ramo "default" cai aqui também).

### 2. Sanitizer pós-LLM (defesa em profundidade)

Logo antes de `sendWhatsApp` da `resposta` no fluxo de `interpretar_receita`, regex de segurança:

```ts
if (/ESF\s*\?|CIL\s*\?|EIXO\s*\?°/.test(resposta || "")) {
  console.warn("[RX-SANITIZE] resposta com placeholders vazios — substituindo por MSG_PEDIR_RECEITA_TEXTO");
  resposta = MSG_PEDIR_RECEITA_TEXTO;
  validatorFlags.push("rx_sanitize_empty_template");
}
```

Pega qualquer caso futuro em que o LLM hallucine o template fora desse fluxo.

### 3. Gate de confirmação não pode aceitar "Sim" para receita vazia

Em `~2257` (`isReceitaPending(contatoMeta) && !lastIsImage`), antes de aceitar `detectRxConfirmation`:

```ts
if (lastRx && !isReceitaValida(lastRx)) {
  // pending corrompida — limpa e força pedido por texto
  await supabase.from("contatos").update({
    metadata: { ...contatoMeta, receita_confirmacao: { ...contatoMeta.receita_confirmacao, pending: false, invalidada_at: new Date().toISOString() } },
  }).eq("id", contatoId);
  await sendWhatsApp(..., MSG_PEDIR_RECEITA_TEXTO);
  // evento + return
}
```

Garantia idempotente para conversas já corrompidas (5 órfãos hoje têm `pending=true` com `lastRx` inválida).

### 4. Backfill (uma migration de leitura/limpeza)

```sql
-- Limpa receita_confirmacao.pending de contatos cuja última receita é inválida
UPDATE contatos
SET metadata = jsonb_set(
  metadata,
  '{receita_confirmacao}',
  COALESCE(metadata->'receita_confirmacao','{}'::jsonb) ||
    jsonb_build_object('pending', false, 'invalidada_at', now()::text)
)
WHERE metadata->'receita_confirmacao'->>'pending' = 'true'
  AND (
    metadata->'receitas' IS NULL
    OR jsonb_array_length(metadata->'receitas') = 0
    OR (
      (metadata->'receitas'->-1->>'rx_type') IN ('unknown','')
      OR (metadata->'receitas'->-1->>'rx_type') IS NULL
    )
  );
```

### 5. Ajustes em `isReceitaValida` / salvamento

Atualmente `receitas[]` recebe `rxData` em `linha 3987` mesmo quando `rx_type='unknown'` e olhos vazios. Mover o `push` para **depois** do `isReceitaValida(rxWithLabel) === true`. Caso inválido: **não polui** o array. Evita que próxima rodada veja `receitas.length>0` e tenha decisões enviesadas (mesmo com `hasReceitasValidas` filtrando, há outros pontos do código que checam `receitas.length`).

## Arquivos

- `supabase/functions/ai-triage/index.ts` — itens 1, 2, 3, 5.
- `supabase/migrations/<nova>.sql` — item 4.
- Memória: atualizar `mem://ia/receita-vazia-e-shorthand-correcao.md` com o caso Yuri (foto não-receita + `confidence` alta + LLM hallucina template).

## Validação

1. Reproduzir conversa: contato manda foto ambígua → IA responde "Tô tendo dificuldade…" e **não** envia "ESF ? CIL ?".
2. SQL pós-deploy: `select count(*) from contatos where metadata->'receita_confirmacao'->>'pending' = 'true' and (metadata->'receitas'->-1->>'rx_type') in ('unknown','')` → 0.
3. Observar evento `receita_ocr_inutil` por 24h em `eventos_crm` para medir incidência real.
