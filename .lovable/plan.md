## Problemas observados no diálogo da Francisca

**1. Pergunta duplicada no mesmo balão (20:38, 20:39, 20:42, 20:44)**
> "Tenho estes horários: amanhã 05/05 às 11:00 ou 17:30 (...). **Qual você prefere?**. **Qual horário você prefere: amanhã 05/05 às 11:00, 17:30, ou sábado 09/05 às 11:00?**"

A `resposta` do modelo já contém a pergunta, e o `proximo_passo` repete a mesma pergunta com outras palavras — o merge concatena os dois.

**2. Re-orçamento + pergunta de loja/região após agendamento já confirmado (20:45)**
Cliente disse "Transitions" (preferência durante conversa pós-fechamento). A IA chamou `consultar_lentes` de novo, devolveu opções DMAX e ainda perguntou *"Posso te indicar a loja mais próxima... Em qual região/bairro você está?"* — sendo que a loja (Super Shopping) e o agendamento já estavam confirmados.

---

## Causa raiz

### Bug 1 — Duplicação `resposta` + `proximo_passo`
Em `supabase/functions/ai-triage/index.ts` linha 2774:
```ts
if (args.proximo_passo && !resposta.includes(args.proximo_passo)) {
  resposta = resposta.trimEnd().replace(/[.!]$/, "") + ". " + args.proximo_passo;
}
```
O check `includes(args.proximo_passo)` exige string idêntica. O modelo gera duas variações da mesma pergunta ("Qual você prefere?" e "Qual horário você prefere: ...") — não há match exato e ambas são concatenadas.

### Bug 2 — Hint "AGENDAMENTO ATIVO" não cobre re-orçamento nem pergunta de loja
Em `index.ts` linha 2600, o hint só proíbe `agendar_visita`/`reagendar_visita` e perguntas de cancelamento. Não bloqueia:
- Chamadas redundantes a `consultar_lentes`/`consultar_lentes_contato` na fase pós-agendamento
- O template fixo "Posso te indicar a loja mais próxima... Em qual região/bairro?" anexado ao final do output dessas tools (a loja já está definida no agendamento)

Adicionalmente, o template de saída de `consultar_lentes` sempre encerra com "Em qual região/bairro você está?" sem checar `hasAgendamentoAtivo`.

---

## Correções

### Fix 1 — Detecção robusta de duplicação no merge `proximo_passo`

Em `ai-triage/index.ts` (~linha 2772-2776 e ~linha 3500-3502), substituir o `includes` exato por uma checagem semântica:

- Se `resposta` já termina com pergunta (`?` nas últimas ~120 chars) **E** `proximo_passo` também é pergunta, **não concatenar** (a `resposta` do modelo já cobriu o próximo passo).
- Caso contrário, manter o merge atual.

Pseudocódigo:
```ts
function respostaJaTemPergunta(r: string) {
  const tail = r.slice(-150);
  return /\?\s*$/.test(tail.trim());
}
function ehPergunta(s: string) {
  return /\?/.test(s);
}
if (args.proximo_passo
    && !resposta.includes(args.proximo_passo)
    && !(respostaJaTemPergunta(resposta) && ehPergunta(args.proximo_passo))) {
  resposta = resposta.trimEnd().replace(/[.!]$/, "") + " " + args.proximo_passo;
}
```

Aplicar nos dois pontos do arquivo (merge principal e merge de retry).

### Fix 2 — Hint "AGENDAMENTO ATIVO" mais forte

Estender o bloco da linha 2593-2604 para também:

- Proibir chamar `consultar_lentes` / `consultar_lentes_contato` quando o cliente está em conversa pós-agendamento sobre **detalhes do produto** (cor, estilo, tratamento, transitions, filtro azul) — a IA deve apenas **anotar a preferência** e reafirmar o agendamento, sem rodar nova faixa de preços.
- Proibir perguntar região/bairro/loja mais próxima — a loja **já está fixada** no agendamento ativo.
- Permitir nova consulta de orçamento **apenas** se o cliente pedir explicitamente preço/orçamento/quanto custa **um item diferente** (ex.: "quanto sai com Transitions?" → aí sim consultar_lentes para a marca/categoria nova).

Texto sugerido a adicionar ao hint existente:
```
PROIBIDO chamar consultar_lentes/consultar_lentes_contato apenas porque o
cliente mencionou um tratamento/material (transitions, filtro azul, fotossensível,
antirreflexo, índice). Trate como PREFERÊNCIA registrada para a visita —
anote brevemente ("Anotado, vou separar opções com Transitions") e reafirme
o agendamento. Só chame consultar_lentes/consultar_lentes_contato se o
cliente pedir EXPLICITAMENTE preço/orçamento/quanto custa.

PROIBIDO perguntar região/bairro/"qual a loja mais próxima" — a loja JÁ ESTÁ
DEFINIDA no agendamento ativo (${agAtivoRecentEarly?.loja_nome || ''}).
```

### Fix 3 — Template de saída `consultar_lentes` ciente de agendamento

Localizar o ponto onde a saída de `consultar_lentes` injeta "Posso te indicar a loja mais próxima pra você ver pessoalmente e fechar a melhor opção? Em qual região/bairro você está?" e, quando `hasAgendamentoAtivo === true`, substituir por:
> "Te mostro tudo isso pessoalmente {agendamentoFmt} no {loja_nome} 😉"

(precisa localizar o template — provavelmente em `compile-prompt` ou no próprio handler da tool `consultar_lentes` dentro de `ai-triage`).

---

## Arquivos alterados

- `supabase/functions/ai-triage/index.ts` — fix 1 (2 ocorrências do merge) + fix 2 (extensão do hint AGENDAMENTO ATIVO) + fix 3 (template de fechamento da saída de orçamento)

Sem migrations, sem mudanças de UI, sem mudanças em outras edge functions.

---

## Validação

Reproduzir mentalmente os turnos do diálogo após o fix:
- Turno 20:38 — modelo gera `resposta` terminando em "?" e `proximo_passo` também pergunta → **só `resposta`** é enviada
- Turno 20:45 — cliente diz "Transitions" com agendamento ativo → IA usa `responder` para anotar preferência e reafirmar visita, **sem** chamar `consultar_lentes` e **sem** perguntar região

Salvar nota em memory `mem://ia/agendamento-ativo-anti-duplicacao` (já existe) atualizando regras: bloquear consultar_lentes pós-agendamento sem pedido explícito de preço.
