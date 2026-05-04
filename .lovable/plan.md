## Problema

Cliente Francisca mandou em sequência:
- 20:50 "Não" → IA respondeu **"Combinado, Francisca! Te espero terça-feira, 05/05 às 11:00 na DINIZ SUPER SHOPPING 👋 Qualquer dúvida é só me chamar."**
- 20:50 "Obg" (3s depois) → IA respondeu **a mesma frase exata** novamente em 20:51.

## Causa raiz

`supabase/functions/ai-triage/index.ts` aplica overrides determinísticos de despedida em dois caminhos independentes:
- `isShortNoToHelp` (cliente diz "Não" após pergunta "posso te ajudar em mais alguma coisa?")
- `isThanksClose` (cliente diz "Obg" após agendamento ativo)

Como o cliente disparou os dois turnos em sequência (`Não` depois `Obg`), cada um entrou em um override diferente e ambos enviaram a mesma frase de despedida — sem checar se o último outbound já é a frase canônica de encerramento.

## Correção

Adicionar **guardrail de deduplicação de despedida** logo no início do bloco "POST-LLM VALIDATION" (linha 3395 de `ai-triage/index.ts`):

```ts
// Detecta se o último outbound já é a frase canônica de encerramento.
const _lastOut = String((recentOutbound || []).slice(-1)[0] || "");
const _despedidaJaEnviada =
  /Qualquer d[úu]vida [ée] s[óo] me chamar/i.test(_lastOut)
  && (/Te espero/i.test(_lastOut) || /Qualquer coisa estou por aqui/i.test(_lastOut));

// Se já mandou despedida E cliente respondeu curto/obg/não, suprime.
if (_despedidaJaEnviada && (isThanksClose || isShortNoToHelp || isThanksOnly || SHORT_NO_RE.test(msgTrim2))) {
  console.log("[CLOSE-DEDUP] Despedida já enviada — silenciando reenvio");
  await supabase.from("eventos_crm").insert({
    contato_id: contatoId,
    tipo: "despedida_duplicada_evitada",
    descricao: "Cliente respondeu após despedida final; IA suprimiu reenvio",
    metadata: { last_outbound: _lastOut.substring(0, 200), inbound: msgTrim2.substring(0, 100) },
    referencia_tipo: "atendimento",
    referencia_id: atendimento_id,
  });
  resposta = "";
}
```

E gatear os overrides existentes (`isThanksClose`, `isShortNoToHelp`) com `if (resposta && ...)` para que, quando suprimida, eles não reescrevam a string vazia.

O bloco de envio (linha 3808) já trata `resposta` vazia como `skipped: "empty_response"` — não há mensagem enviada ao cliente.

## Arquivos alterados

- `supabase/functions/ai-triage/index.ts` — adiciona guardrail antes dos overrides de despedida + gateia overrides com `resposta &&`

Sem migrations, sem mudanças em outras edge functions.

## Validação

Reproduzir o cenário Francisca:
- Turno 1 ("Não" após "posso ajudar em mais?") → `isShortNoToHelp` → manda "Combinado... Te espero..." ✅
- Turno 2 ("Obg" 3s depois) → `_despedidaJaEnviada=true` + `isThanksClose=true` → resposta zerada → `skipped: empty_response` → **nenhuma mensagem enviada** ✅
- Evento `despedida_duplicada_evitada` registrado em `eventos_crm` para auditoria.

Atualizar memory `mem://crm/fluxo-encerramento-atendimento` com a regra de dedup.
