## Diagnóstico (caso Jorge — 558488766851)

Olhando as mensagens reais no banco:

```
21:00:29.055  outbound  Sistema  [Template: retomada_contexto_1] Params: Jorge, seu atendimento
21:00:29.130  outbound  Sistema  [Template: retomada_contexto_1] Params: Jorge, seu atendimento   ← 75ms depois
21:36:46      inbound   558...   Gostaria de um orçamento                                          ← sem resposta
```

Atendimento está em `modo='humano'` desde 19/04, sem `atendente_nome` (órfão na fila humana).

### Problema 1 — Template duplicado (75ms de diferença)
`vendas-recuperacao-cron` está agendado a cada 1 min e a função `processHumano` lê `recuperacao_humano.tentativas=0`, dispara o template e só depois grava `tentativas=1`. Duas execuções concorrentes (ou retry interno do pg_cron quando a anterior demora) leem o mesmo zero, ambas enviam.

Não há lock de idempotência: nada compara `ultima_tentativa_at` antes de disparar (só compara depois pra calcular delay, mas com `tentativas=0` o `referenceTime` cai em `lastInboundAt`, que é antigo, então a janela passa nas duas execuções).

### Problema 2 — Cliente respondeu e nada aconteceu
`whatsapp-webhook/index.ts:605` só dispara `ai-triage` quando `atendimento.modo` é `ia` ou `hibrido`. Como o atendimento do Jorge ficou em `humano` (handoff de 19/04 que nunca foi encerrado), a mensagem "Gostaria de um orçamento" foi gravada mas **não foi para a IA nem para humano nenhum** — ninguém olha aquela fila pra esse contato.

O fato de a IA ter acabado de mandar um template de retomada e o cliente ter respondido prova que o cliente ainda quer atendimento. Ignorar essa resposta é o pior cenário.

## Solução

### Correção 1 — Idempotência da retomada humano (`vendas-recuperacao-cron`)

Em `processHumano` (linhas 457-486), adicionar guard antes de disparar o template:

```ts
// Idempotência: se já tentou nas últimas N horas, pula (evita duplicação por race do cron)
if (recH.ultima_tentativa_at) {
  const minIntervaloMs = 60 * 60 * 1000; // 1h mínimo entre tentativas
  const desde = now.getTime() - new Date(recH.ultima_tentativa_at).getTime();
  if (desde < minIntervaloMs) {
    console.log(`[HUMANO-DEDUPE] ${contato.nome}: tentativa já feita há ${Math.round(desde/60000)}min`);
    return result;
  }
}
```

Adicionalmente, fazer o `update` do contador **antes** do `fetch` do template (lock otimista) e reverter se falhar — ou usar `update ... where metadata->'recuperacao_humano'->>'ultima_tentativa_at' is distinct from <novo_valor>` pra garantir que só uma execução ganha.

Implementação prática mais simples e robusta: **gravar `ultima_tentativa_at = now` ANTES do fetch**. Se duas execuções rodam, a segunda lê o valor recém-escrito e cai no guard acima. Em caso de falha do fetch, fica registrado como tentativa "perdida" — preferível a duplicar.

### Correção 2 — Reativar IA quando cliente responde a template de retomada (`whatsapp-webhook`)

Em `whatsapp-webhook/index.ts` (logo após salvar a mensagem inbound, antes do bloco ~605 que decide o roteamento), adicionar:

```ts
// Auto-reativação IA: se o atendimento está em modo='humano' SEM atendente_nome
// (órfão na fila) E a última outbound foi um template de retomada do Sistema/IA,
// significa que o handoff humano foi abandonado. Reativa IA pra responder o cliente.
if (atendimentoModo === "humano") {
  const { data: at } = await supabase
    .from("atendimentos")
    .select("atendente_nome, metadata")
    .eq("id", atendimentoId)
    .single();

  const semAtendente = !at?.atendente_nome;
  const recH = at?.metadata?.recuperacao_humano;
  const teveRetomadaRecente = recH?.ultima_tentativa_at &&
    (Date.now() - new Date(recH.ultima_tentativa_at).getTime()) < 7 * 24 * 3600 * 1000;

  if (semAtendente && teveRetomadaRecente) {
    await supabase.from("atendimentos")
      .update({ modo: "hibrido", updated_at: new Date().toISOString() })
      .eq("id", atendimentoId);
    atendimentoModo = "hibrido"; // cai no branch da IA logo abaixo
    await supabase.from("eventos_crm").insert({
      contato_id: contato.id,
      tipo: "reativacao_ia_pos_retomada",
      descricao: "Cliente respondeu após template de retomada — IA reativada (modo híbrido)",
      metadata: { template_anterior: recH.template_usado },
    });
    console.log(`[REATIVACAO-IA] ${contato.id}: humano órfão → híbrido após resposta a ${recH.template_usado}`);
  }
}
```

Por que `híbrido` e não `ia`? Mantém o card visível na fila humana caso o operador queira retomar, mas a IA já processa e responde — alinhado com a regra "Continuity After Handoff" da memória.

### Correção 3 — Limpar metadata `recuperacao_humano` quando cliente responde

Quando o cliente envia inbound, o ciclo de retomada deve resetar (a próxima vez que ele ficar em silêncio, conta de novo do zero):

```ts
if (atendimentoModo === "humano" && recH?.tentativas) {
  await supabase.from("atendimentos").update({
    metadata: { ...(at?.metadata || {}), recuperacao_humano: null }
  }).eq("id", atendimentoId);
}
```

Aplicar em conjunto com a correção 2.

## Arquivos a editar

- `supabase/functions/vendas-recuperacao-cron/index.ts` — guard de idempotência em `processHumano` (~linha 457) + gravar `ultima_tentativa_at` antes do envio.
- `supabase/functions/whatsapp-webhook/index.ts` — reativar IA + limpar contador de retomada humano antes do roteamento (~linha 600).
- `.lovable/memory/crm/recuperacao-ia-anti-abandono.md` — documentar idempotência e auto-reativação pós-retomada.

Sem mudanças de schema. Sem novos templates.

## Resultado esperado no caso Jorge

1. Próxima execução do cron não duplica template (guard de 1h).
2. Quando ele responde "Gostaria de um orçamento", o webhook detecta atendimento humano órfão com retomada recente → flipa para `hibrido` → IA dispara, lê o histórico (tem receita salva, tópico = orçamento de lentes de contato) e responde com a tool `consultar_lentes_contato`.
