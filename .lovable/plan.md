## Problema (caso Franciana)

Sequência real:

1. Cliente: "Quero orçamento" (sem receita ainda).
2. IA (21:08): **"Encontrei poucas opções automáticas para esse grau alto. Posso acionar um Consultor…"** — alucinação: não existe receita, mas IA já fala em "grau alto" e oferece escalada.
3. Cliente: "Mas não mandei receita ainda" → manda foto.
4. IA: "Recebi sua receita 👀 já estou analisando…"
5. IA (turno seguinte): **"Para esse grau bem alto, vou acionar um Consultor para buscar opções sob encomenda específicas."** — escala direto, sem pedir confirmação dos valores lidos.

Hoje já existe gate `receita_confirmacao.pending` + `MSG_ESCALADA_GRAU_FORA_FAIXA`, mas:

- O gate só bloqueia no **próximo turno** (lê `pending` no início). No turno em que a OCR é feita, `interpretar_receita` marca `pending=true` e seta `resposta = buildMsgConfirmarReceita(...)`, mas o LLM pode emitir, na mesma resposta, outros tool calls (`escalar_consultor`, `consultar_lentes`) que sobrescrevem `resposta` / disparam `precisa_humano=true`. Foi o que aconteceu com Franciana.
- Não há guardrail contra a IA inventar "grau alto" sem receita lida.

## Regra final

1. **Sem receita interpretada no histórico**, é PROIBIDO escalar com motivo de "grau alto / sob encomenda / fora de faixa". Se o LLM tentar (`escalar_consultor` com motivo casando essa regex, ou `responder` com texto contendo "grau alto/sob encomenda/sob medida" + oferta de consultor), o turno é interceptado: IA pede a receita ("Pra te passar opções certinhas, me manda uma foto da receita 📸").
2. **No turno em que `interpretar_receita` marca `pending=true`**, qualquer outro tool call do mesmo turno (`escalar_consultor`, `consultar_lentes*`, `agendar_visita`) é descartado. Resposta enviada é exclusivamente `buildMsgConfirmarReceita(...)`. `precisa_humano` permanece `false`. Aplica-se ao caminho normal (linhas ~3404-3432) e ao retry forçado (linhas ~4216-4247).
3. Mensagens enviadas durante `pending=true` que apenas repetem a confirmação **não disparam** watchdog de loop (já parcialmente coberto, garantir cobertura do texto do `buildMsgConfirmarReceita`).

## Mudanças

### `supabase/functions/ai-triage/index.ts`

**a) Helpers novos (perto dos detectores de receita ~linha 110):**

- `escaladaGrauSemReceita(motivoOuTexto: string): boolean` → regex `/\b(grau\s+(alto|elevado|bem\s+alto)|sob\s+encomenda|sob\s+medida\s+espec[ií]fic|opções?\s+sob\s+encomenda)\b/i`.
- `MSG_PEDIR_RECEITA_PARA_GRAU_ALTO = "Pra te passar opções certinhas, preciso primeiro da sua receita 😊 Me manda uma foto que eu já analiso e te respondo com as opções compatíveis."`

**b) Loop de tool calls (`for (const toolCall of toolCalls)` ~linha 3243):**

Após processar cada tool, manter um flag `rxConfirmGateTriggeredThisTurn`. Quando `interpretar_receita` (linhas ~3404 e ~4216) seta `receita_confirmacao.pending=true`, marcar o flag.

No final do loop, se `rxConfirmGateTriggeredThisTurn === true`:
- Forçar `resposta = buildMsgConfirmarReceita(rxRecemLido, false)`.
- Forçar `precisa_humano = false`, `intencao = "receita_oftalmologica"`, `pipeline_coluna = "Orçamento"`.
- Limpar qualquer `setor_sugerido` herdado de `escalar_consultor`.
- Logar `eventos_crm` tipo `escalada_bloqueada_pendente_confirmacao` com snapshot dos tool calls descartados.

**c) Antes de aceitar `escalar_consultor` (~linha 3280, dentro do branch `else if (fn === "escalar_consultor")`):**

Adicionar checagem:
```ts
const motivoTxt = `${args.motivo || ""} ${args.resposta || ""}`;
const semReceita = !hasReceitasValidas(receitas);
if (semReceita && escaladaGrauSemReceita(motivoTxt)) {
  // descartar tool call
  resposta = MSG_PEDIR_RECEITA_PARA_GRAU_ALTO;
  intencao = "receita_oftalmologica";
  pipeline_coluna = "Orçamento";
  precisa_humano = false;
  await supabase.from("eventos_crm").insert({
    contato_id: contatoId,
    tipo: "escalada_grau_sem_receita_bloqueada",
    descricao: `IA tentou escalar "grau alto" sem receita salva`,
    metadata: { motivo: args.motivo, resposta: args.resposta?.substring(0,200) },
    referencia_tipo: "atendimento", referencia_id: atendimento_id,
  });
  validatorFlags.push("escalada_grau_sem_receita_bloqueada");
  continue;
}
```

**d) `responder` (branch ~3243):** mesma checagem aplicada ao texto de `args.resposta` quando `semReceita`. Substitui a resposta por `MSG_PEDIR_RECEITA_PARA_GRAU_ALTO`.

**e) Prompt do sistema (~linhas 1389-1511, blocos com lista de proibições):** adicionar regra explícita:

> "PROIBIDO mencionar 'grau alto', 'grau elevado', 'sob encomenda' ou oferecer Consultor por causa do grau ANTES de ter recebido e interpretado a receita do cliente. Sem receita = pedir receita por foto."

### `supabase/functions/watchdog-loop-ia/index.ts`

Garantir que mensagens iguais a `buildMsgConfirmarReceita` (regex `^(Li sua receita assim|Anotei! Ficou assim:)`) NÃO contam como loop e NÃO disparam escalada. Se já existe exceção parcial, ampliar para esses dois prefixes.

### Memórias

- Atualizar `mem://ia/auto-receita-e-anti-loop.md` com:
  - Caso Franciana 2 (escalada por "grau alto" sem receita).
  - Regra: gate de confirmação vence escalada/cotação no mesmo turno.
  - Proibição de falar em grau sem receita.

## Eventos novos

- `escalada_grau_sem_receita_bloqueada`
- `escalada_bloqueada_pendente_confirmacao`

## Out of scope

- Ajustes em `consultar_lentes` para casos pós-confirmação (já cobertos).
- UI/Dashboard de escaladas bloqueadas.

## Arquivos tocados

- `supabase/functions/ai-triage/index.ts`
- `supabase/functions/watchdog-loop-ia/index.ts`
- `.lovable/memory/ia/auto-receita-e-anti-loop.md`
